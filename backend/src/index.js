require('dotenv').config();
const bcrypt = require('bcryptjs');
const logger = require('./utils/logger');
const sessionManager = require('./services/SessionManager');
const messageHandler = require('./services/MessageHandler');
const WebServer = require('./web/server');
const db = require('./database/DatabaseManager');
const Tenancy = require('./database/Tenancy');
const Migration = require('./database/Migration');

process.on('uncaughtException', (err) => {
    logger.error(null, `Uncaught Exception: ${err.message}`);
    console.error(err);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error(null, `Unhandled Rejection: ${reason}`);
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

async function seedAdminFromEnv() {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) {
        logger.warn(null, 'ADMIN_EMAIL/ADMIN_PASSWORD ausentes no .env — admin não criado');
        return;
    }
    const existing = await db.getUserByEmail(email);
    const hash = await bcrypt.hash(password, 10);
    if (existing) {
        // mantém role admin e atualiza senha (idempotente)
        if (existing.role !== 'admin') {
            logger.warn(null, `Usuário ${email} existe mas role não é admin (role=${existing.role}); pulando seed`);
            return;
        }
        await db.updateUserPassword(existing.id, hash);
        logger.info(null, `Admin do .env atualizado: ${email}`);
    } else {
        await db.createUser({ email, passwordHash: hash, role: 'admin', tenantId: null });
        logger.success(null, `Admin criado a partir do .env: ${email}`);
    }
}

async function migrateLegacyIfNeeded() {
    const legacy = await Migration.isLegacyDeployment(db.pool);
    if (!legacy) return;
    logger.warn(null, '⚠️  Detectada instalação legada (tabelas em public). Iniciando migração para multi-tenant...');

    // Cria tenant Default
    const tenant = await db.createTenant('Default');
    logger.info(null, `Tenant Default criado: id=${tenant.id} schema=${tenant.schema_name}`);

    // Move tabelas
    await Migration.migrateLegacyToTenant(db.pool, tenant.schema_name);

    // Subscription com Plano Máximo, sem vencimento
    const planMax = await db.getPlanByCode('max');
    await db.createSubscription({ tenantId: tenant.id, planId: planMax.id, currentPeriodEnd: null });
    logger.success(null, `Tenant Default migrado com plano "${planMax.name}" sem vencimento`);
}

async function expirySweep() {
    try {
        const expired = await db.listExpiredSubscriptions();
        for (const sub of expired) {
            await db.updateSubscription(sub.id, { status: 'past_due' });
            await sessionManager.destroyTenantSessions(sub.tenant_id);
            logger.warn(null, `Tenant ${sub.tenant_id} (${sub.schema_name}) marcado past_due e sessões encerradas`);
        }
    } catch (e) {
        logger.error(null, `Erro no sweep de expirações: ${e.message}`);
    }
}

// Marca de versão usada no boot pra confirmar qual build está realmente rodando.
const BUILD_TAG = 'logs-limpos-2026-05-03i';

async function main() {
    try {
        console.log('\n' + '='.repeat(60));
        console.log('🔥 SISTEMA WPP MULTI-TENANT v3.0');
        console.log(`   build: ${BUILD_TAG}`);
        console.log('='.repeat(60) + '\n');

        logger.info(null, 'Inicializando schema global (public)...');
        await db.initGlobalTables();

        await migrateLegacyIfNeeded();
        await db.syncAllTenantSchemas();
        await seedAdminFromEnv();

        logger.info(null, 'Iniciando servidor backend API...');
        const webServer = new WebServer();
        const port = process.env.PORT || 3000;
        await webServer.start(port);

        // Conecta MessageHandler (warmup) — receber mensagens do tenant correto
        sessionManager.on('session:message', ({ tenantId, accountId, message }) => {
            const session = sessionManager.getSession(tenantId, accountId);
            if (session) messageHandler.handleMessage(session, message);
        });

        sessionManager.on('session:ready', async ({ tenantId, accountId }) => {
            const session = sessionManager.getSession(tenantId, accountId);
            if (session) {
                setTimeout(() => messageHandler.processUnreadMessages(session), 5000);
            }
        });

        // Sweep de expirações (a cada 5 min)
        await expirySweep();
        setInterval(expirySweep, 5 * 60 * 1000);

        logger.success(null, 'Backend API iniciado!');
        logger.info(null, `🔗 API: http://localhost:${port}`);
        console.log('\n' + '='.repeat(60));
        console.log('📡 BACKEND API PRONTO');
        console.log('='.repeat(60) + '\n');

        process.on('SIGINT', async () => {
            logger.info(null, 'Encerrando...');
            await sessionManager.destroyAll();
            await webServer.stop();
            await db.close();
            process.exit(0);
        });
    } catch (error) {
        logger.error(null, `Erro fatal: ${error.message}`);
        console.error(error);
        process.exit(1);
    }
}

main();
