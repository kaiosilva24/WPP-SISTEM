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
            min_read_delay INTEGER DEFAULT 3000,
            max_read_delay INTEGER DEFAULT 15000,
            min_typing_delay INTEGER DEFAULT 5000,
            max_typing_delay INTEGER DEFAULT 20000,
            min_response_delay INTEGER DEFAULT 10000,
            max_response_delay INTEGER DEFAULT 30000,
            min_message_interval INTEGER DEFAULT 20000,
            ignore_probability INTEGER DEFAULT 20,
            media_enabled BOOLEAN DEFAULT TRUE,
            media_interval INTEGER DEFAULT 2,
            FOREIGN KEY (account_id) REFERENCES ${s}.accounts(id) ON DELETE CASCADE
        )`,

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
