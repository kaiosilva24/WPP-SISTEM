/**
 * Provisionamento e remoção de schemas por tenant.
 * O DDL aqui é o conjunto de tabelas que cada cliente possui isoladamente.
 */

function quoteIdent(name) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
        throw new Error(`Nome de schema inválido: ${name}`);
    }
    return `"${name}"`;
}

const TENANT_DDL = (schema) => {
    const s = quoteIdent(schema);
    return [
        `CREATE SCHEMA IF NOT EXISTS ${s}`,

        `CREATE TABLE IF NOT EXISTS ${s}.accounts (
            id SERIAL PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            status TEXT DEFAULT 'disconnected',
            phone_number TEXT,
            account_mode TEXT DEFAULT 'warmup',
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )`,

        `CREATE TABLE IF NOT EXISTS ${s}.account_configs (
            account_id INTEGER PRIMARY KEY,
            proxy_enabled BOOLEAN DEFAULT FALSE,
            proxy_ip TEXT,
            proxy_port INTEGER,
            proxy_username TEXT,
            proxy_password TEXT,
            -- delays gerais
            min_read_delay INTEGER DEFAULT 3000,
            max_read_delay INTEGER DEFAULT 15000,
            min_typing_delay INTEGER DEFAULT 5000,
            max_typing_delay INTEGER DEFAULT 20000,
            min_response_delay INTEGER DEFAULT 10000,
            max_response_delay INTEGER DEFAULT 30000,
            min_message_interval INTEGER DEFAULT 20000,
            max_message_interval INTEGER DEFAULT 60000,
            ignore_probability INTEGER DEFAULT 20,
            media_enabled BOOLEAN DEFAULT TRUE,
            media_interval INTEGER DEFAULT 2,
            -- pausas globais
            global_private_delay_minutes INTEGER DEFAULT 2,
            global_group_delay_minutes   INTEGER DEFAULT 2,
            -- followup (privado, depois da 1ª)
            min_followup_read_delay INTEGER DEFAULT 3000,
            max_followup_read_delay INTEGER DEFAULT 15000,
            min_followup_typing_delay INTEGER DEFAULT 5000,
            max_followup_typing_delay INTEGER DEFAULT 20000,
            min_followup_response_delay INTEGER DEFAULT 10000,
            max_followup_response_delay INTEGER DEFAULT 30000,
            min_followup_interval INTEGER DEFAULT 30000,
            max_followup_interval INTEGER DEFAULT 120000,
            followup_audio_enabled BOOLEAN DEFAULT TRUE,
            followup_min_recording_delay INTEGER DEFAULT 5000,
            followup_max_recording_delay INTEGER DEFAULT 15000,
            followup_media_enabled BOOLEAN DEFAULT TRUE,
            followup_media_interval INTEGER DEFAULT 2,
            min_followup_audio_listen_delay INTEGER DEFAULT 5000,
            max_followup_audio_listen_delay INTEGER DEFAULT 30000,
            followup_docs_enabled BOOLEAN DEFAULT FALSE,
            followup_docs_interval INTEGER DEFAULT 5,
            -- grupos
            min_group_read_delay INTEGER DEFAULT 3000,
            max_group_read_delay INTEGER DEFAULT 15000,
            min_group_typing_delay INTEGER DEFAULT 5000,
            max_group_typing_delay INTEGER DEFAULT 20000,
            min_group_response_delay INTEGER DEFAULT 10000,
            max_group_response_delay INTEGER DEFAULT 30000,
            min_group_interval INTEGER DEFAULT 15000,
            max_group_interval INTEGER DEFAULT 45000,
            group_audio_enabled BOOLEAN DEFAULT TRUE,
            group_min_recording_delay INTEGER DEFAULT 5000,
            group_max_recording_delay INTEGER DEFAULT 15000,
            group_media_enabled BOOLEAN DEFAULT TRUE,
            group_media_interval INTEGER DEFAULT 2,
            min_group_audio_listen_delay INTEGER DEFAULT 5000,
            max_group_audio_listen_delay INTEGER DEFAULT 30000,
            group_docs_enabled BOOLEAN DEFAULT FALSE,
            group_docs_interval INTEGER DEFAULT 5,
            -- escuta de áudio recebido (genérico)
            min_audio_listen_delay INTEGER DEFAULT 5000,
            max_audio_listen_delay INTEGER DEFAULT 30000,
            -- pausas baseadas em respostas
            pause_after_n_responses INTEGER DEFAULT 0,
            pause_duration_minutes INTEGER DEFAULT 10,
            -- auto-warm
            auto_warm_enabled BOOLEAN DEFAULT FALSE,
            auto_warm_idle_minutes INTEGER DEFAULT 10,
            auto_warm_delay_min INTEGER DEFAULT 30,
            auto_warm_delay_max INTEGER DEFAULT 120,
            -- standby
            standby_enabled BOOLEAN DEFAULT FALSE,
            standby_min_interval INTEGER DEFAULT 5,
            standby_max_interval INTEGER DEFAULT 15,
            standby_min_duration INTEGER DEFAULT 10,
            standby_max_duration INTEGER DEFAULT 60,
            standby_watch_status_enabled BOOLEAN DEFAULT TRUE,
            standby_watch_status_prob INTEGER DEFAULT 70,
            standby_watch_status_min_contacts INTEGER DEFAULT 1,
            standby_watch_status_max_contacts INTEGER DEFAULT 4,
            standby_watch_status_min_delay INTEGER DEFAULT 3,
            standby_watch_status_max_delay INTEGER DEFAULT 8,
            -- vínculos / agendamento
            proxy_group_id TEXT,
            webhook_id INTEGER,
            scheduled_start_time TEXT,
            scheduled_end_time TEXT,
            FOREIGN KEY (account_id) REFERENCES ${s}.accounts(id) ON DELETE CASCADE
        )`,
        // Migrações idempotentes para tenants antigos (rodam via syncAllTenantSchemas).
        // ADD COLUMN IF NOT EXISTS preserva dados já salvos.
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS global_private_delay_minutes INTEGER DEFAULT 2`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS global_group_delay_minutes   INTEGER DEFAULT 2`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS max_message_interval INTEGER DEFAULT 60000`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS min_followup_read_delay INTEGER DEFAULT 3000`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS max_followup_read_delay INTEGER DEFAULT 15000`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS min_followup_typing_delay INTEGER DEFAULT 5000`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS max_followup_typing_delay INTEGER DEFAULT 20000`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS min_followup_response_delay INTEGER DEFAULT 10000`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS max_followup_response_delay INTEGER DEFAULT 30000`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS min_followup_interval INTEGER DEFAULT 30000`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS max_followup_interval INTEGER DEFAULT 120000`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS followup_audio_enabled BOOLEAN DEFAULT TRUE`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS followup_min_recording_delay INTEGER DEFAULT 5000`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS followup_max_recording_delay INTEGER DEFAULT 15000`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS followup_media_enabled BOOLEAN DEFAULT TRUE`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS followup_media_interval INTEGER DEFAULT 2`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS min_followup_audio_listen_delay INTEGER DEFAULT 5000`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS max_followup_audio_listen_delay INTEGER DEFAULT 30000`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS followup_docs_enabled BOOLEAN DEFAULT FALSE`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS followup_docs_interval INTEGER DEFAULT 5`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS min_group_read_delay INTEGER DEFAULT 3000`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS max_group_read_delay INTEGER DEFAULT 15000`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS min_group_typing_delay INTEGER DEFAULT 5000`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS max_group_typing_delay INTEGER DEFAULT 20000`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS min_group_response_delay INTEGER DEFAULT 10000`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS max_group_response_delay INTEGER DEFAULT 30000`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS min_group_interval INTEGER DEFAULT 15000`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS max_group_interval INTEGER DEFAULT 45000`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS group_audio_enabled BOOLEAN DEFAULT TRUE`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS group_min_recording_delay INTEGER DEFAULT 5000`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS group_max_recording_delay INTEGER DEFAULT 15000`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS group_media_enabled BOOLEAN DEFAULT TRUE`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS group_media_interval INTEGER DEFAULT 2`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS min_group_audio_listen_delay INTEGER DEFAULT 5000`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS max_group_audio_listen_delay INTEGER DEFAULT 30000`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS group_docs_enabled BOOLEAN DEFAULT FALSE`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS group_docs_interval INTEGER DEFAULT 5`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS min_audio_listen_delay INTEGER DEFAULT 5000`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS max_audio_listen_delay INTEGER DEFAULT 30000`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS pause_after_n_responses INTEGER DEFAULT 0`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS pause_duration_minutes INTEGER DEFAULT 10`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS auto_warm_enabled BOOLEAN DEFAULT FALSE`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS auto_warm_idle_minutes INTEGER DEFAULT 10`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS auto_warm_delay_min INTEGER DEFAULT 30`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS auto_warm_delay_max INTEGER DEFAULT 120`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS standby_enabled BOOLEAN DEFAULT FALSE`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS standby_min_interval INTEGER DEFAULT 5`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS standby_max_interval INTEGER DEFAULT 15`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS standby_min_duration INTEGER DEFAULT 10`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS standby_max_duration INTEGER DEFAULT 60`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS standby_watch_status_enabled BOOLEAN DEFAULT TRUE`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS standby_watch_status_prob INTEGER DEFAULT 70`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS standby_watch_status_min_contacts INTEGER DEFAULT 1`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS standby_watch_status_max_contacts INTEGER DEFAULT 4`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS standby_watch_status_min_delay INTEGER DEFAULT 3`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS standby_watch_status_max_delay INTEGER DEFAULT 8`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS proxy_group_id TEXT`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS webhook_id INTEGER`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS scheduled_start_time TEXT`,
        `ALTER TABLE ${s}.account_configs ADD COLUMN IF NOT EXISTS scheduled_end_time TEXT`,

        `CREATE TABLE IF NOT EXISTS ${s}.account_messages (
            id SERIAL PRIMARY KEY,
            account_id INTEGER NOT NULL,
            message_type TEXT NOT NULL,
            message_text TEXT NOT NULL,
            enabled BOOLEAN DEFAULT TRUE,
            FOREIGN KEY (account_id) REFERENCES ${s}.accounts(id) ON DELETE CASCADE
        )`,

        `CREATE TABLE IF NOT EXISTS ${s}.account_stats (
            account_id INTEGER PRIMARY KEY,
            messages_sent INTEGER DEFAULT 0,
            messages_received INTEGER DEFAULT 0,
            unique_contacts INTEGER DEFAULT 0,
            last_activity TIMESTAMPTZ,
            uptime_start TIMESTAMPTZ,
            FOREIGN KEY (account_id) REFERENCES ${s}.accounts(id) ON DELETE CASCADE
        )`,

        `CREATE TABLE IF NOT EXISTS ${s}.dispatch_campaigns (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            status TEXT DEFAULT 'draft',
            messages_per_account INTEGER DEFAULT 0,
            interval_min_ms INTEGER DEFAULT 30000,
            interval_max_ms INTEGER DEFAULT 60000,
            send_mode TEXT DEFAULT 'alternate',
            caption_enabled BOOLEAN DEFAULT FALSE,
            auto_reply_enabled BOOLEAN DEFAULT FALSE,
            pause_on_reply_seconds INTEGER DEFAULT 3600,
            created_at TIMESTAMPTZ DEFAULT now(),
            started_at TIMESTAMPTZ,
            finished_at TIMESTAMPTZ
        )`,

        `CREATE TABLE IF NOT EXISTS ${s}.dispatch_campaign_texts (
            id SERIAL PRIMARY KEY,
            campaign_id INTEGER REFERENCES ${s}.dispatch_campaigns(id) ON DELETE CASCADE,
            body TEXT NOT NULL,
            kind TEXT DEFAULT 'outbound'
        )`,

        `CREATE TABLE IF NOT EXISTS ${s}.dispatch_campaign_media (
            id SERIAL PRIMARY KEY,
            campaign_id INTEGER REFERENCES ${s}.dispatch_campaigns(id) ON DELETE CASCADE,
            file_path TEXT NOT NULL,
            mime_type TEXT
        )`,

        `CREATE TABLE IF NOT EXISTS ${s}.dispatch_campaign_accounts (
            campaign_id INTEGER REFERENCES ${s}.dispatch_campaigns(id) ON DELETE CASCADE,
            account_id INTEGER REFERENCES ${s}.accounts(id) ON DELETE CASCADE,
            quota INTEGER DEFAULT 0,
            PRIMARY KEY (campaign_id, account_id)
        )`,

        `CREATE TABLE IF NOT EXISTS ${s}.dispatch_contacts (
            id SERIAL PRIMARY KEY,
            campaign_id INTEGER REFERENCES ${s}.dispatch_campaigns(id) ON DELETE CASCADE,
            phone TEXT NOT NULL,
            name TEXT,
            assigned_account_id INTEGER REFERENCES ${s}.accounts(id) ON DELETE SET NULL,
            status TEXT DEFAULT 'pending',
            sent_at TIMESTAMPTZ,
            replied_at TIMESTAMPTZ,
            pause_until TIMESTAMPTZ,
            last_error TEXT
        )`,

        `CREATE INDEX IF NOT EXISTS dispatch_contacts_status_idx ON ${s}.dispatch_contacts(campaign_id, status)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS dispatch_contacts_unique ON ${s}.dispatch_contacts(campaign_id, phone)`,

        `CREATE TABLE IF NOT EXISTS ${s}.dispatch_messages (
            id BIGSERIAL PRIMARY KEY,
            campaign_id INTEGER REFERENCES ${s}.dispatch_campaigns(id) ON DELETE CASCADE,
            account_id INTEGER REFERENCES ${s}.accounts(id) ON DELETE CASCADE,
            contact_phone TEXT NOT NULL,
            direction TEXT NOT NULL,
            body TEXT,
            media_path TEXT,
            created_at TIMESTAMPTZ DEFAULT now()
        )`,

        `CREATE INDEX IF NOT EXISTS dispatch_messages_idx ON ${s}.dispatch_messages(campaign_id, account_id, created_at)`,

        `CREATE TABLE IF NOT EXISTS ${s}.webhooks (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            url TEXT NOT NULL,
            method TEXT DEFAULT 'GET',
            headers JSONB,
            body JSONB,
            created_at TIMESTAMPTZ DEFAULT now()
        )`,

        `CREATE TABLE IF NOT EXISTS ${s}.whatsapp_auth (
            account_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            key_id TEXT NOT NULL,
            value JSONB NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT now(),
            PRIMARY KEY (account_id, type, key_id),
            FOREIGN KEY (account_id) REFERENCES ${s}.accounts(id) ON DELETE CASCADE
        )`,
    ];
};

async function provisionTenantSchema(pool, schemaName) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const stmt of TENANT_DDL(schemaName)) {
            await client.query(stmt);
        }
        await client.query('COMMIT');
        console.log(`✅ Schema do tenant provisionado: ${schemaName}`);
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

async function dropTenantSchema(pool, schemaName) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schemaName)) {
        throw new Error(`schema inválido: ${schemaName}`);
    }
    await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    console.log(`🗑️  Schema removido: ${schemaName}`);
}

module.exports = { provisionTenantSchema, dropTenantSchema, quoteIdent };
