require('dotenv').config();
const logger = require('./utils/logger');
const sessionManager = require('./services/SessionManager');
const messageHandler = require('./services/MessageHandler');
const WebServer = require('./web/server');
const db = require('./database/DatabaseManager');

/**
 * Sistema de Aquecimento WhatsApp v2.0
 * Gerenciamento dinâmico de contas com configuração individual
 */

// Global Error Handlers
process.on('uncaughtException', (err) => {
    logger.error(null, `Uncaught Exception: ${err.message}`);
    console.error(err);
    // Não encerra o processo, apenas loga
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error(null, `Unhandled Rejection: ${reason}`);
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Não encerra o processo, apenas loga
});

async function main() {
    try {
        // Banner
        console.log('\n' + '='.repeat(60));
        console.log('🔥 SISTEMA DE AQUECIMENTO WHATSAPP v2.0');
        console.log('='.repeat(60) + '\n');

        // Inicializa o banco de dados
        logger.info(null, 'Inicializando banco de dados...');
        await db.initTables();

        // Inicia servidor web
        logger.info(null, 'Iniciando servidor backend API...');
        const webServer = new WebServer();
        // Prioritize process.env.PORT (DisCloud/Cloud)
        const port = process.env.PORT || 3000;
        await webServer.start(port);

        // Conecta message handler com session manager
        sessionManager.on('session:message', ({ accountId, accountName, message }) => {
            const session = sessionManager.getSession(accountId);
            if (session) {
                messageHandler.handleMessage(session, message);
            }
        });

        // Processa mensagens não lidas quando sessão ficar pronta
        sessionManager.on('session:ready', async ({ accountId, accountName }) => {
            const session = sessionManager.getSession(accountId);
            if (session) {
                // Aguarda 5 segundos antes de processar mensagens não lidas
                setTimeout(() => {
                    messageHandler.processUnreadMessages(session);
                }, 5000);
            }
        });

        // Carrega contas existentes do banco de dados
        const existingAccounts = await db.getAllAccounts();
        if (existingAccounts.length > 0) {
            logger.info(null, `Encontradas ${existingAccounts.length} contas no banco de dados`);
            logger.info(null, 'Use o dashboard para iniciar as sessões');
        } else {
            logger.info(null, 'Nenhuma conta encontrada. Use o dashboard para criar novas contas');
        }

        logger.success(null, 'Backend API iniciado com sucesso!');
        logger.info(null, `🔗 API rodando em: http://localhost:${port}`);
        logger.info(null, `🌐 Frontend deve rodar em: http://localhost:5173`);
        console.log('\n' + '='.repeat(60));
        console.log('📡 BACKEND API PRONTO');
        console.log('🔌 Aguardando conexões do frontend...');
        console.log('='.repeat(60) + '\n');

        // Graceful shutdown
        process.on('SIGINT', async () => {
            logger.info(null, '\nEncerrando sistema...');

            await sessionManager.destroyAll();
            await webServer.stop();
            await db.close();

            logger.success(null, 'Sistema encerrado com sucesso!');
            process.exit(0);
        });

    } catch (error) {
        logger.error(null, `Erro fatal: ${error.message}`);
        console.error(error);
        process.exit(1);
    }
}

// Inicia o sistema
main();
