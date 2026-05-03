const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const TenantDb = require('./TenantDb');
const Tenancy = require('./Tenancy');

/**
 * Gerenciador global do banco. Mantém pool, opera em schema 'public' (tabelas globais)
 * e expõe `db.tenant(tenantIdOrSchema)` para acesso isolado por tenant.
 */
class DatabaseManager {
    constructor() {
        this.pool = new Pool({
            user: process.env.DB_USER,
            host: process.env.DB_HOST,
            database: process.env.DB_NAME,
            password: process.env.DB_PASS,
            port: process.env.DB_PORT || 5432,
        });
        this.pool.on('error', (err) => console.error('Unexpected pool error', err));
        this._tenantCache = new Map(); // schema_name -> TenantDb
    }

    /**
     * Inicializa tabelas globais em schema public (users, tenants, plans, subscriptions).
     */
    async initGlobalTables() {
        const client = await this.pool.connect();
        try {
            await client.query(`
                CREATE TABLE IF NOT EXISTS tenants (
                    id SERIAL PRIMARY KEY,
                    name TEXT NOT NULL,
                    schema_name TEXT UNIQUE NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    created_at TIMESTAMPTZ DEFAULT now()
                )
            `);

            await client.query(`
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    email TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL,
                    tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
                    created_at TIMESTAMPTZ DEFAULT now()
                )
            `);

            await client.query(`
                CREATE TABLE IF NOT EXISTS plans (
                    id SERIAL PRIMARY KEY,
                    code TEXT UNIQUE NOT NULL,
                    name TEXT NOT NULL,
                    max_accounts INTEGER NOT NULL,
                    monthly_price NUMERIC(10,2) DEFAULT 0
                )
            `);

            await client.query(`
                CREATE TABLE IF NOT EXISTS subscriptions (
                    id SERIAL PRIMARY KEY,
                    tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
                    plan_id INTEGER REFERENCES plans(id),
                    status TEXT NOT NULL DEFAULT 'active',
                    current_period_end TIMESTAMPTZ,
                    payment_provider TEXT,
                    external_subscription_id TEXT,
                    created_at TIMESTAMPTZ DEFAULT now()
                )
            `);

            // Seed dos 3 planos
            await client.query(`
                INSERT INTO plans (code, name, max_accounts) VALUES
                  ('basic','Básico',5),
                  ('medium','Médio',10),
                  ('max','Máximo',20)
                ON CONFLICT (code) DO NOTHING
            `);

            console.log('✅ Global tables initialized (public schema)');
        } finally {
            client.release();
        }
    }

    /**
     * Re-aplica o DDL do tenant em todos os schemas existentes (idempotente,
     * usa CREATE TABLE IF NOT EXISTS). Garante que tenants antigos recebam
     * tabelas novas adicionadas em Tenancy.TENANT_DDL.
     */
    async syncAllTenantSchemas() {
        try {
            const r = await this.pool.query("SELECT schema_name FROM tenants WHERE status != 'deleted'");
            for (const row of r.rows) {
                try {
                    await Tenancy.provisionTenantSchema(this.pool, row.schema_name);
                } catch (e) {
                    console.error(`⚠️  Falha ao sincronizar schema ${row.schema_name}: ${e.message}`);
                }
            }
        } catch (e) {
            console.error(`⚠️  syncAllTenantSchemas falhou: ${e.message}`);
        }
    }

    /**
     * Atalho ao tenant DB.
     */
    tenant(tenantOrSchema) {
        if (!tenantOrSchema) throw new Error('tenant() requer tenantId ou schema_name');
        let schema;
        if (typeof tenantOrSchema === 'string' && tenantOrSchema.startsWith('tenant_')) {
            schema = tenantOrSchema;
        } else {
            schema = `tenant_${tenantOrSchema}`;
        }
        if (this._tenantCache.has(schema)) return this._tenantCache.get(schema);
        const t = new TenantDb(this.pool, schema);
        this._tenantCache.set(schema, t);
        return t;
    }

    // ==================== TENANTS ====================

    async createTenant(name) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const r = await client.query('INSERT INTO tenants (name, schema_name) VALUES ($1, $2) RETURNING *', [name, 'placeholder']);
            const t = r.rows[0];
            const schemaName = `tenant_${t.id}`;
            await client.query('UPDATE tenants SET schema_name = $1 WHERE id = $2', [schemaName, t.id]);
            await client.query('COMMIT');
            await Tenancy.provisionTenantSchema(this.pool, schemaName);
            return { ...t, schema_name: schemaName };
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    async getTenant(id) {
        const r = await this.pool.query('SELECT * FROM tenants WHERE id = $1', [id]);
        return r.rows[0];
    }

    async listTenants() {
        const r = await this.pool.query(`
            SELECT t.*, p.name AS plan_name, p.code AS plan_code, p.max_accounts,
                   s.id AS subscription_id, s.status AS subscription_status, s.current_period_end,
                   u.email AS owner_email, u.id AS owner_user_id
            FROM tenants t
            LEFT JOIN LATERAL (
                SELECT * FROM subscriptions WHERE tenant_id = t.id ORDER BY id DESC LIMIT 1
            ) s ON true
            LEFT JOIN plans p ON p.id = s.plan_id
            LEFT JOIN LATERAL (
                SELECT id, email FROM users WHERE tenant_id = t.id AND role = 'customer' ORDER BY id ASC LIMIT 1
            ) u ON true
            ORDER BY t.id DESC
        `);
        return r.rows;
    }

    async updateTenantStatus(id, status) {
        if (!['active','suspended'].includes(status)) throw new Error('status inválido');
        await this.pool.query('UPDATE tenants SET status = $1 WHERE id = $2', [status, id]);
    }

    async deleteTenant(id) {
        const t = await this.getTenant(id);
        if (!t) return;
        await Tenancy.dropTenantSchema(this.pool, t.schema_name);
        await this.pool.query('DELETE FROM tenants WHERE id = $1', [id]);
        this._tenantCache.delete(t.schema_name);
    }

    // ==================== USERS ====================

    async createUser({ email, passwordHash, role, tenantId = null }) {
        const r = await this.pool.query(
            'INSERT INTO users (email, password_hash, role, tenant_id) VALUES ($1,$2,$3,$4) RETURNING id, email, role, tenant_id, created_at',
            [email.toLowerCase(), passwordHash, role, tenantId]
        );
        return r.rows[0];
    }

    async getUserByEmail(email) {
        const r = await this.pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
        return r.rows[0];
    }

    async getUserById(id) {
        const r = await this.pool.query('SELECT id, email, role, tenant_id, created_at FROM users WHERE id = $1', [id]);
        return r.rows[0];
    }

    async updateUserPassword(id, passwordHash) {
        await this.pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, id]);
    }

    async getTenantOwner(tenantId) {
        const r = await this.pool.query(
            "SELECT id, email, role, tenant_id FROM users WHERE tenant_id = $1 AND role = 'customer' ORDER BY id ASC LIMIT 1",
            [tenantId]
        );
        return r.rows[0];
    }

    // ==================== PLANS ====================

    async listPlans() {
        const r = await this.pool.query('SELECT * FROM plans ORDER BY max_accounts ASC');
        return r.rows;
    }

    async getPlanByCode(code) {
        const r = await this.pool.query('SELECT * FROM plans WHERE code = $1', [code]);
        return r.rows[0];
    }

    async getPlan(id) {
        const r = await this.pool.query('SELECT * FROM plans WHERE id = $1', [id]);
        return r.rows[0];
    }

    // ==================== SUBSCRIPTIONS ====================

    async createSubscription({ tenantId, planId, currentPeriodEnd = null }) {
        const r = await this.pool.query(
            'INSERT INTO subscriptions (tenant_id, plan_id, current_period_end) VALUES ($1,$2,$3) RETURNING *',
            [tenantId, planId, currentPeriodEnd]
        );
        return r.rows[0];
    }

    async getActiveSubscription(tenantId) {
        const r = await this.pool.query(
            "SELECT s.*, p.code AS plan_code, p.name AS plan_name, p.max_accounts FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.tenant_id = $1 ORDER BY s.id DESC LIMIT 1",
            [tenantId]
        );
        return r.rows[0];
    }

    async updateSubscription(id, { planId, status, currentPeriodEnd }) {
        const fields = [];
        const values = [];
        let i = 1;
        if (planId !== undefined) { fields.push(`plan_id = $${i++}`); values.push(planId); }
        if (status !== undefined) { fields.push(`status = $${i++}`); values.push(status); }
        if (currentPeriodEnd !== undefined) { fields.push(`current_period_end = $${i++}`); values.push(currentPeriodEnd); }
        if (!fields.length) return;
        values.push(id);
        await this.pool.query(`UPDATE subscriptions SET ${fields.join(', ')} WHERE id = $${i}`, values);
    }

    async listExpiredSubscriptions() {
        const r = await this.pool.query(
            "SELECT s.*, t.id AS tenant_id, t.schema_name FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id WHERE s.status = 'active' AND s.current_period_end IS NOT NULL AND s.current_period_end < now()"
        );
        return r.rows;
    }

    // ==================== LEGACY DETECTION ====================

    /**
     * Detecta se 'accounts' está em public (modo legado pré-multi-tenant).
     */
    async isLegacy() {
        const r = await this.pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'accounts'
            ) AS exists
        `);
        return r.rows[0].exists === true;
    }

    async close() {
        await this.pool.end();
    }
}

const dbManager = new DatabaseManager();
module.exports = dbManager;
