const { quoteIdent } = require('./Tenancy');

/**
 * Acesso ao banco escopado a um tenant. Sempre executa queries com search_path
 * setado para o schema do tenant + public, garantindo isolamento.
 */
class TenantDb {
    constructor(pool, schemaName) {
        this.pool = pool;
        this.schema = schemaName;
        this.qualifiedSchema = quoteIdent(schemaName);
    }

    async _run(sql, params = []) {
        const client = await this.pool.connect();
        try {
            await client.query(`SET search_path TO ${this.qualifiedSchema}, public`);
            return await client.query(sql, params);
        } finally {
            client.release();
        }
    }

    async _tx(fn) {
        const client = await this.pool.connect();
        try {
            await client.query(`SET search_path TO ${this.qualifiedSchema}, public`);
            await client.query('BEGIN');
            const result = await fn(client);
            await client.query('COMMIT');
            return result;
        } catch (e) {
            try { await client.query('ROLLBACK'); } catch (_) {}
            throw e;
        } finally {
            client.release();
        }
    }

    // ==================== ACCOUNTS ====================

    async createAccount(name) {
        return this._tx(async (c) => {
            const r = await c.query('INSERT INTO accounts (name) VALUES ($1) RETURNING *', [name]);
            const acc = r.rows[0];
            await c.query('INSERT INTO account_configs (account_id) VALUES ($1)', [acc.id]);
            await c.query('INSERT INTO account_stats (account_id) VALUES ($1)', [acc.id]);
            return this._joinedAccount(c, acc.id);
        });
    }

    async _joinedAccount(client, id) {
        const r = await client.query(`
            SELECT a.*, c.*, s.*
            FROM accounts a
            LEFT JOIN account_configs c ON a.id = c.account_id
            LEFT JOIN account_stats s ON a.id = s.account_id
            WHERE a.id = $1
        `, [id]);
        return r.rows[0];
    }

    async getAccount(id) {
        const r = await this._run(`
            SELECT a.*, c.*, s.*
            FROM accounts a
            LEFT JOIN account_configs c ON a.id = c.account_id
            LEFT JOIN account_stats s ON a.id = s.account_id
            WHERE a.id = $1
        `, [id]);
        return r.rows[0];
    }

    async getAccountByName(name) {
        const r = await this._run(`
            SELECT a.*, c.*, s.*
            FROM accounts a
            LEFT JOIN account_configs c ON a.id = c.account_id
            LEFT JOIN account_stats s ON a.id = s.account_id
            WHERE a.name = $1
        `, [name]);
        return r.rows[0];
    }

    async getAllAccounts() {
        const r = await this._run(`
            SELECT a.*, c.*, s.*
            FROM accounts a
            LEFT JOIN account_configs c ON a.id = c.account_id
            LEFT JOIN account_stats s ON a.id = s.account_id
            ORDER BY a.created_at DESC
        `);
        return r.rows;
    }

    async countAccounts() {
        const r = await this._run('SELECT COUNT(*)::int AS n FROM accounts');
        return r.rows[0].n;
    }

    async updateAccountStatus(id, status, phoneNumber = null) {
        await this._run(
            'UPDATE accounts SET status = $1, phone_number = COALESCE($2, phone_number), updated_at = CURRENT_TIMESTAMP WHERE id = $3',
            [status, phoneNumber, id]
        );
    }

    async updateAccountConfig(id, config) {
        const allowed = [
            'proxy_enabled','proxy_ip','proxy_port','proxy_username','proxy_password',
            'min_read_delay','max_read_delay','min_typing_delay','max_typing_delay',
            'min_response_delay','max_response_delay','min_message_interval',
            'ignore_probability','media_enabled','media_interval'
        ];
        const fields = [];
        const values = [];
        let i = 1;
        for (const f of allowed) {
            if (config[f] !== undefined) {
                fields.push(`${f} = $${i++}`);
                values.push(config[f]);
            }
        }
        if (!fields.length) return;
        values.push(id);
        await this._run(`UPDATE account_configs SET ${fields.join(', ')} WHERE account_id = $${i}`, values);
    }

    async addAccountMessage(accountId, messageType, messageText) {
        const r = await this._run(
            'INSERT INTO account_messages (account_id, message_type, message_text) VALUES ($1,$2,$3) RETURNING id',
            [accountId, messageType, messageText]
        );
        return { lastInsertRowid: r.rows[0].id };
    }

    async getAccountMessages(accountId, messageType = null) {
        if (messageType) {
            const r = await this._run('SELECT * FROM account_messages WHERE account_id = $1 AND message_type = $2 AND enabled = TRUE', [accountId, messageType]);
            return r.rows;
        }
        const r = await this._run('SELECT * FROM account_messages WHERE account_id = $1 AND enabled = TRUE', [accountId]);
        return r.rows;
    }

    async deleteAccountMessage(id) {
        await this._run('DELETE FROM account_messages WHERE id = $1', [id]);
    }

    async updateStats(accountId, stats) {
        const fields = [];
        const values = [];
        let i = 1;
        if (stats.messages_sent !== undefined) { fields.push(`messages_sent = messages_sent + $${i++}`); values.push(stats.messages_sent); }
        if (stats.messages_received !== undefined) { fields.push(`messages_received = messages_received + $${i++}`); values.push(stats.messages_received); }
        if (stats.unique_contacts !== undefined) { fields.push(`unique_contacts = $${i++}`); values.push(stats.unique_contacts); }
        fields.push('last_activity = CURRENT_TIMESTAMP');
        if (stats.uptime_start !== undefined) { fields.push(`uptime_start = $${i++}`); values.push(stats.uptime_start); }
        values.push(accountId);
        if (!fields.length) return;
        await this._run(`UPDATE account_stats SET ${fields.join(', ')} WHERE account_id = $${i}`, values);
    }

    async deleteAccount(id) {
        await this._run('DELETE FROM accounts WHERE id = $1', [id]);
    }

    async updateAccountMode(id, mode) {
        if (mode !== 'warmup' && mode !== 'dispatch') throw new Error('mode inválido');
        await this._run('UPDATE accounts SET account_mode = $1, updated_at = now() WHERE id = $2', [mode, id]);
    }

    // ==================== DISPATCH ====================

    async createCampaign(data) {
        const r = await this._run(
            `INSERT INTO dispatch_campaigns
                (name, messages_per_account, interval_min_ms, interval_max_ms, send_mode, caption_enabled, auto_reply_enabled, pause_on_reply_seconds)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [
                data.name,
                data.messages_per_account || 0,
                data.interval_min_ms || 30000,
                data.interval_max_ms || 60000,
                data.send_mode || 'alternate',
                !!data.caption_enabled,
                !!data.auto_reply_enabled,
                data.pause_on_reply_seconds == null ? 3600 : data.pause_on_reply_seconds,
            ]
        );
        return r.rows[0];
    }

    async updateCampaign(id, data) {
        const allowed = ['name','status','messages_per_account','interval_min_ms','interval_max_ms','send_mode','caption_enabled','auto_reply_enabled','pause_on_reply_seconds','started_at','finished_at'];
        const fields = [];
        const values = [];
        let i = 1;
        for (const k of allowed) {
            if (data[k] !== undefined) { fields.push(`${k} = $${i++}`); values.push(data[k]); }
        }
        if (!fields.length) return this.getCampaign(id);
        values.push(id);
        await this._run(`UPDATE dispatch_campaigns SET ${fields.join(', ')} WHERE id = $${i}`, values);
        return this.getCampaign(id);
    }

    async getCampaign(id) {
        const r = await this._run('SELECT * FROM dispatch_campaigns WHERE id = $1', [id]);
        return r.rows[0];
    }

    async listCampaigns() {
        const r = await this._run('SELECT * FROM dispatch_campaigns ORDER BY created_at DESC');
        return r.rows;
    }

    async deleteCampaign(id) {
        await this._run('DELETE FROM dispatch_campaigns WHERE id = $1', [id]);
    }

    async addCampaignText(campaignId, body, kind = 'outbound') {
        const r = await this._run(
            'INSERT INTO dispatch_campaign_texts (campaign_id, body, kind) VALUES ($1,$2,$3) RETURNING *',
            [campaignId, body, kind]
        );
        return r.rows[0];
    }

    async getCampaignTexts(campaignId, kind = null) {
        if (kind) {
            const r = await this._run('SELECT * FROM dispatch_campaign_texts WHERE campaign_id = $1 AND kind = $2 ORDER BY id', [campaignId, kind]);
            return r.rows;
        }
        const r = await this._run('SELECT * FROM dispatch_campaign_texts WHERE campaign_id = $1 ORDER BY id', [campaignId]);
        return r.rows;
    }

    async deleteCampaignText(id) {
        await this._run('DELETE FROM dispatch_campaign_texts WHERE id = $1', [id]);
    }

    async addCampaignMedia(campaignId, filePath, mimeType) {
        const r = await this._run(
            'INSERT INTO dispatch_campaign_media (campaign_id, file_path, mime_type) VALUES ($1,$2,$3) RETURNING *',
            [campaignId, filePath, mimeType]
        );
        return r.rows[0];
    }

    async getCampaignMedia(campaignId) {
        const r = await this._run('SELECT * FROM dispatch_campaign_media WHERE campaign_id = $1 ORDER BY id', [campaignId]);
        return r.rows;
    }

    async deleteCampaignMedia(id) {
        const r = await this._run('DELETE FROM dispatch_campaign_media WHERE id = $1 RETURNING file_path', [id]);
        return r.rows[0];
    }

    async upsertCampaignAccount(campaignId, accountId, quota) {
        await this._run(
            `INSERT INTO dispatch_campaign_accounts (campaign_id, account_id, quota)
             VALUES ($1,$2,$3)
             ON CONFLICT (campaign_id, account_id) DO UPDATE SET quota = EXCLUDED.quota`,
            [campaignId, accountId, quota]
        );
    }

    async removeCampaignAccount(campaignId, accountId) {
        await this._run('DELETE FROM dispatch_campaign_accounts WHERE campaign_id = $1 AND account_id = $2', [campaignId, accountId]);
    }

    async getCampaignAccounts(campaignId) {
        const r = await this._run(
            `SELECT a.*, c.proxy_enabled, c.proxy_ip, c.proxy_port, c.proxy_username, c.proxy_password,
                    c.min_read_delay, c.max_read_delay, c.min_typing_delay, c.max_typing_delay,
                    c.min_response_delay, c.max_response_delay,
                    ca.quota
             FROM dispatch_campaign_accounts ca
             JOIN accounts a ON a.id = ca.account_id
             LEFT JOIN account_configs c ON c.account_id = a.id
             WHERE ca.campaign_id = $1
             ORDER BY a.id`,
            [campaignId]
        );
        return r.rows;
    }

    async addCampaignContacts(campaignId, contacts) {
        if (!contacts.length) return 0;
        return this._tx(async (c) => {
            let inserted = 0;
            for (const item of contacts) {
                const phone = String(item.phone).replace(/\D/g, '');
                if (!phone) continue;
                const r = await c.query(
                    `INSERT INTO dispatch_contacts (campaign_id, phone, name) VALUES ($1,$2,$3)
                     ON CONFLICT (campaign_id, phone) DO NOTHING`,
                    [campaignId, phone, item.name || null]
                );
                inserted += r.rowCount;
            }
            return inserted;
        });
    }

    async getCampaignContacts(campaignId, filters = {}) {
        const where = ['campaign_id = $1'];
        const values = [campaignId];
        let i = 2;
        if (filters.accountId) { where.push(`assigned_account_id = $${i++}`); values.push(filters.accountId); }
        if (filters.status) { where.push(`status = $${i++}`); values.push(filters.status); }
        const r = await this._run(`SELECT * FROM dispatch_contacts WHERE ${where.join(' AND ')} ORDER BY id`, values);
        return r.rows;
    }

    async getCampaignBoard(campaignId) {
        const accounts = await this.getCampaignAccounts(campaignId);
        const contacts = await this.getCampaignContacts(campaignId);
        const byAccount = new Map();
        for (const a of accounts) byAccount.set(a.id, { ...a, contacts: [] });
        const unassigned = [];
        for (const ct of contacts) {
            if (ct.assigned_account_id && byAccount.has(ct.assigned_account_id)) {
                byAccount.get(ct.assigned_account_id).contacts.push(ct);
            } else {
                unassigned.push(ct);
            }
        }
        return { accounts: Array.from(byAccount.values()), unassigned };
    }

    async assignContactToAccount(contactId, accountId) {
        await this._run('UPDATE dispatch_contacts SET assigned_account_id = $1 WHERE id = $2', [accountId, contactId]);
    }

    async setContactStatus(contactId, status, extra = {}) {
        const fields = ['status = $1'];
        const values = [status];
        let i = 2;
        if (extra.sent_at !== undefined) { fields.push(`sent_at = $${i++}`); values.push(extra.sent_at); }
        if (extra.replied_at !== undefined) { fields.push(`replied_at = $${i++}`); values.push(extra.replied_at); }
        if (extra.pause_until !== undefined) { fields.push(`pause_until = $${i++}`); values.push(extra.pause_until); }
        if (extra.last_error !== undefined) { fields.push(`last_error = $${i++}`); values.push(extra.last_error); }
        values.push(contactId);
        await this._run(`UPDATE dispatch_contacts SET ${fields.join(', ')} WHERE id = $${i}`, values);
    }

    async takeNextPendingForAccount(campaignId, accountId) {
        const r = await this._run(
            `UPDATE dispatch_contacts
                SET status = 'sending'
              WHERE id = (
                SELECT id FROM dispatch_contacts
                 WHERE campaign_id = $1
                   AND assigned_account_id = $2
                   AND status = 'pending'
                   AND (pause_until IS NULL OR pause_until < now())
                 ORDER BY id
                 LIMIT 1
                 FOR UPDATE SKIP LOCKED
              )
              RETURNING *`,
            [campaignId, accountId]
        );
        return r.rows[0];
    }

    async releaseExpiredPauses(campaignId) {
        const r = await this._run(
            `UPDATE dispatch_contacts
                SET status = 'pending', pause_until = NULL
              WHERE campaign_id = $1
                AND status = 'replied'
                AND pause_until IS NOT NULL
                AND pause_until < now()
              RETURNING id`,
            [campaignId]
        );
        return r.rowCount;
    }

    async findActiveContactForAccount(accountId, phone) {
        const r = await this._run(
            `SELECT dc.*, c.id AS campaign_id_join, c.auto_reply_enabled, c.pause_on_reply_seconds, c.status AS campaign_status
               FROM dispatch_contacts dc
               JOIN dispatch_campaigns c ON c.id = dc.campaign_id
              WHERE dc.assigned_account_id = $1
                AND dc.phone = $2
                AND c.status IN ('running','paused')
              ORDER BY dc.id DESC
              LIMIT 1`,
            [accountId, phone]
        );
        return r.rows[0];
    }

    async logDispatchMessage(row) {
        const r = await this._run(
            `INSERT INTO dispatch_messages (campaign_id, account_id, contact_phone, direction, body, media_path)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [row.campaign_id, row.account_id, row.contact_phone, row.direction, row.body || null, row.media_path || null]
        );
        return r.rows[0];
    }

    async getDispatchMessages({ campaignId, accountId, limit = 100, before = null }) {
        const where = [];
        const values = [];
        let i = 1;
        if (campaignId) { where.push(`campaign_id = $${i++}`); values.push(campaignId); }
        if (accountId) { where.push(`account_id = $${i++}`); values.push(accountId); }
        if (before) { where.push(`created_at < $${i++}`); values.push(before); }
        const sql = `SELECT * FROM dispatch_messages
                     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                     ORDER BY created_at DESC LIMIT ${Math.min(parseInt(limit) || 100, 500)}`;
        const r = await this._run(sql, values);
        return r.rows;
    }

    async getCampaignCounts(campaignId) {
        const r = await this._run(
            `SELECT status, COUNT(*)::int AS n FROM dispatch_contacts WHERE campaign_id = $1 GROUP BY status`,
            [campaignId]
        );
        const out = { pending: 0, sending: 0, sent: 0, replied: 0, paused: 0, failed: 0 };
        for (const row of r.rows) out[row.status] = row.n;
        return out;
    }
}

module.exports = TenantDb;
