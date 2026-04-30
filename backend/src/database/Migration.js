/**
 * Migração single-tenant -> multi-tenant.
 * Detecta tabelas legadas em public e move para schema do tenant default.
 */

const TENANT_TABLES = [
    'accounts',
    'account_configs',
    'account_messages',
    'account_stats',
    'dispatch_campaigns',
    'dispatch_campaign_texts',
    'dispatch_campaign_media',
    'dispatch_campaign_accounts',
    'dispatch_contacts',
    'dispatch_messages'
];

async function tableExists(client, schema, table) {
    const r = await client.query(
        `SELECT EXISTS(SELECT FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2) AS exists`,
        [schema, table]
    );
    return r.rows[0].exists;
}

async function isLegacyDeployment(pool) {
    const client = await pool.connect();
    try {
        return await tableExists(client, 'public', 'accounts');
    } finally {
        client.release();
    }
}

/**
 * Move tabelas legadas de public para tenant_<id>.
 * Pré-condição: schema do tenant já existe (provisionado vazio).
 * Estratégia: dropa tabelas vazias do schema novo (que foram criadas no provision)
 * e move as legacy via ALTER TABLE SET SCHEMA. Mantém os dados.
 */
async function migrateLegacyToTenant(pool, schemaName) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const tbl of TENANT_TABLES) {
            const legacyExists = await tableExists(client, 'public', tbl);
            if (!legacyExists) continue;
            // remove tabela vazia do schema novo se existir
            await client.query(`DROP TABLE IF EXISTS "${schemaName}"."${tbl}" CASCADE`);
            // move a tabela legada com seus dados
            await client.query(`ALTER TABLE public."${tbl}" SET SCHEMA "${schemaName}"`);
            console.log(`  ↳ public.${tbl} -> ${schemaName}.${tbl}`);
        }
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

module.exports = { isLegacyDeployment, migrateLegacyToTenant, TENANT_TABLES };
