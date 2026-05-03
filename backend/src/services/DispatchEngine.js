const EventEmitter = require('events');
const db = require('../database/DatabaseManager');
const sessionManager = require('./SessionManager');
const logger = require('../utils/logger');
const { delay } = require('../utils/humanBehavior');

/**
 * Engine multi-tenant de disparo em massa.
 * Locks/workers/runningCampaigns são namespaced por tenantId para isolamento total.
 */
class DispatchEngine extends EventEmitter {
    constructor() {
        super();
        this.locks = new Map();           // proxyKey (já com prefixo tenant) -> Promise
        this.activeWorkers = new Map();   // `${tenantId}:${campaignId}:${accountId}` -> true
        this.runningCampaigns = new Set(); // `${tenantId}:${campaignId}`
        this.pauseSweepTimers = new Map(); // `${tenantId}:${campaignId}` -> intervalId
    }

    _campKey(tenantId, campaignId) { return `${tenantId}:${campaignId}`; }
    _workerKey(tenantId, campaignId, accountId) { return `${tenantId}:${campaignId}:${accountId}`; }

    proxyKey(tenantId, account) {
        const base = (account.proxy_enabled && account.proxy_ip && account.proxy_port)
            ? `${account.proxy_ip}:${account.proxy_port}:${account.proxy_username || ''}`
            : `direct:${account.id}`;
        return `tenant_${tenantId}:${base}`;
    }

    async acquireProxyLock(tenantId, account) {
        const key = this.proxyKey(tenantId, account);
        const prev = this.locks.get(key) || Promise.resolve();
        let release;
        const next = new Promise((r) => { release = r; });
        const chain = prev.then(() => next);
        this.locks.set(key, chain);
        await prev;
        return () => {
            release();
            if (this.locks.get(key) === chain) this.locks.delete(key);
        };
    }

    randInt(min, max) {
        if (max <= min) return min;
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

    async distributeContacts(tenantId, campaignId) {
        const tdb = db.tenant(tenantId);
        const accounts = await tdb.getCampaignAccounts(campaignId);
        if (!accounts.length) throw new Error('Nenhuma conta atribuída à campanha');

        const pending = await tdb.getCampaignContacts(campaignId, { status: 'pending' });
        const unassigned = pending.filter((c) => !c.assigned_account_id);

        const slots = accounts.map((a) => ({ accountId: a.id, quota: a.quota || 0, taken: 0 }));
        let i = 0;
        for (const c of unassigned) {
            let placed = false;
            for (let tries = 0; tries < slots.length; tries++) {
                const slot = slots[i % slots.length];
                i++;
                if (slot.quota === 0 || slot.taken < slot.quota) {
                    await tdb.assignContactToAccount(c.id, slot.accountId);
                    slot.taken++;
                    placed = true;
                    break;
                }
            }
            if (!placed) break;
        }
    }

    async start(tenantId, campaignId) {
        const tdb = db.tenant(tenantId);
        const camp = await tdb.getCampaign(campaignId);
        if (!camp) throw new Error('Campanha não encontrada');
        if (camp.status === 'running') return camp;

        const accounts = await tdb.getCampaignAccounts(campaignId);
        if (!accounts.length) throw new Error('Atribua contas antes de iniciar');

        for (const a of accounts) {
            const s = sessionManager.getSession(tenantId, a.id);
            if (!s || s.status !== 'ready') {
                throw new Error(`Conta ${a.name} não está pronta (status: ${s ? s.status : 'sem sessão'})`);
            }
        }

        await this.distributeContacts(tenantId, campaignId);
        await tdb.updateCampaign(campaignId, { status: 'running', started_at: new Date() });
        const campKey = this._campKey(tenantId, campaignId);
        this.runningCampaigns.add(campKey);

        const updated = await tdb.getCampaign(campaignId);
        this.emit('campaign:update', { tenantId, campaignId, status: 'running' });

        for (const a of accounts) this.spawnWorker(tenantId, campaignId, a.id);

        if (this.pauseSweepTimers.has(campKey)) clearInterval(this.pauseSweepTimers.get(campKey));
        const sweep = setInterval(async () => {
            try {
                const released = await tdb.releaseExpiredPauses(campaignId);
                if (released > 0) {
                    this.emit('campaign:update', { tenantId, campaignId, status: 'running' });
                    const accs = await tdb.getCampaignAccounts(campaignId);
                    for (const a of accs) this.spawnWorker(tenantId, campaignId, a.id);
                }
            } catch (e) {
                logger.error(null, `Erro no sweep tenant=${tenantId} camp=${campaignId}: ${e.message}`);
            }
        }, 30000);
        this.pauseSweepTimers.set(campKey, sweep);

        return updated;
    }

    async pause(tenantId, campaignId) {
        await db.tenant(tenantId).updateCampaign(campaignId, { status: 'paused' });
        const campKey = this._campKey(tenantId, campaignId);
        this.runningCampaigns.delete(campKey);
        if (this.pauseSweepTimers.has(campKey)) {
            clearInterval(this.pauseSweepTimers.get(campKey));
            this.pauseSweepTimers.delete(campKey);
        }
        this.emit('campaign:update', { tenantId, campaignId, status: 'paused' });
    }

    async resume(tenantId, campaignId) {
        return this.start(tenantId, campaignId);
    }

    async stop(tenantId, campaignId) {
        await db.tenant(tenantId).updateCampaign(campaignId, { status: 'done', finished_at: new Date() });
        const campKey = this._campKey(tenantId, campaignId);
        this.runningCampaigns.delete(campKey);
        if (this.pauseSweepTimers.has(campKey)) {
            clearInterval(this.pauseSweepTimers.get(campKey));
            this.pauseSweepTimers.delete(campKey);
        }
        this.emit('campaign:update', { tenantId, campaignId, status: 'done' });
    }

    spawnWorker(tenantId, campaignId, accountId) {
        const key = this._workerKey(tenantId, campaignId, accountId);
        if (this.activeWorkers.get(key)) return;
        this.activeWorkers.set(key, true);
        this.runWorker(tenantId, campaignId, accountId)
            .catch((e) => logger.error(null, `Worker tenant=${tenantId} camp=${campaignId} acc=${accountId} crashou: ${e.message}`))
            .finally(() => this.activeWorkers.delete(key));
    }

    async buildPiece(tenantId, campaign) {
        const tdb = db.tenant(tenantId);
        const texts = await tdb.getCampaignTexts(campaign.id, 'outbound');
        const media = await tdb.getCampaignMedia(campaign.id);
        const haveText = texts.length > 0;
        const haveMedia = media.length > 0;
        const mode = campaign.send_mode || 'alternate';

        if (mode === 'text_only') {
            if (!haveText) return null;
            return { type: 'text', body: this.pick(texts).body };
        }
        if (mode === 'image_with_caption') {
            if (!haveMedia) return null;
            const m = this.pick(media);
            return { type: 'media', mediaPath: m.file_path, caption: haveText ? this.pick(texts).body : null };
        }
        // alternate
        const pickText = haveText && (!haveMedia || Math.random() < 0.5);
        if (pickText) return { type: 'text', body: this.pick(texts).body };
        if (haveMedia) {
            const m = this.pick(media);
            return {
                type: 'media',
                mediaPath: m.file_path,
                caption: campaign.caption_enabled && haveText ? this.pick(texts).body : null
            };
        }
        return null;
    }

    async runWorker(tenantId, campaignId, accountId) {
        const tdb = db.tenant(tenantId);
        const campKey = this._campKey(tenantId, campaignId);

        while (this.runningCampaigns.has(campKey)) {
            const camp = await tdb.getCampaign(campaignId);
            if (!camp || camp.status !== 'running') break;

            const session = sessionManager.getSession(tenantId, accountId);
            if (!session || session.status !== 'ready') {
                logger.warn(null, `Worker pausando: conta ${accountId} não está ready`);
                break;
            }

            const contact = await tdb.takeNextPendingForAccount(campaignId, accountId);
            if (!contact) break;

            const piece = await this.buildPiece(tenantId, camp);
            if (!piece) {
                await tdb.setContactStatus(contact.id, 'failed', { last_error: 'Sem variantes de texto/mídia' });
                this.emit('contact:update', { tenantId, campaignId, accountId, contactId: contact.id, status: 'failed' });
                break;
            }

            const accountRow = await tdb.getAccount(accountId);
            const release = await this.acquireProxyLock(tenantId, accountRow);
            try {
                const to = `${contact.phone}@c.us`;
                let body = null;
                let mediaPath = null;

                if (piece.type === 'text') {
                    await session.sendMessage(to, piece.body);
                    body = piece.body;
                } else {
                    await session.sendMedia(to, piece.mediaPath, piece.caption || undefined);
                    if (piece.caption) body = piece.caption;
                    mediaPath = piece.mediaPath;
                }

                await tdb.setContactStatus(contact.id, 'sent', { sent_at: new Date() });
                const logged = await tdb.logDispatchMessage({
                    campaign_id: campaignId,
                    account_id: accountId,
                    contact_phone: contact.phone,
                    direction: 'out',
                    body, media_path: mediaPath
                });

                this.emit('contact:update', { tenantId, campaignId, accountId, contactId: contact.id, status: 'sent' });
                this.emit('message', { tenantId, ...logged });

                logger.info(session.accountName, `Disparo OK -> ${contact.phone} (tenant ${tenantId} camp ${campaignId})`);
            } catch (err) {
                await tdb.setContactStatus(contact.id, 'failed', { last_error: err.message });
                this.emit('contact:update', { tenantId, campaignId, accountId, contactId: contact.id, status: 'failed' });
                logger.error(null, `Falha disparo tenant=${tenantId} camp=${campaignId} acc=${accountId} -> ${contact.phone}: ${err.message}`);
            } finally {
                release();
            }

            const wait = this.randInt(camp.interval_min_ms, camp.interval_max_ms);
            await delay(wait);
        }

        const counts = await tdb.getCampaignCounts(campaignId);
        const stillWork = counts.pending + counts.sending > 0;
        if (!stillWork && this.runningCampaigns.has(campKey)) {
            await this.stop(tenantId, campaignId);
        } else {
            this.emit('campaign:update', { tenantId, campaignId, status: 'running', counts });
        }
    }
}

const dispatchEngine = new DispatchEngine();
module.exports = dispatchEngine;
