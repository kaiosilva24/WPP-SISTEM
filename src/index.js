const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const logger = require('./utils/logger');
const sessionManager = require('./services/SessionManager');
const messageHandler = require('./services/MessageHandler');
const WebServer = require('./web/server');
const db = require('./database/DatabaseManager');
const schedulerManager = require('./services/SchedulerManager');

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
        // Prioritize process.env.PORT or WEB_PORT (DisCloud/Cloud)
        const port = process.env.PORT || process.env.WEB_PORT || 8080;
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
                logger.info(accountName, '⏳ Aguardando sincronização de chats silenciosa do WhatsApp...');
                // Aguarda 15 segundos para garantir que o wwebjs já tem a contagem de mensagens de Bolinha Verde corretas
                setTimeout(() => {
                    const latestSession = sessionManager.getSession(accountId);
                    if (latestSession && latestSession.status === 'ready') {
                        logger.info(accountName, 'Sessão ponta e Sincronizada. Iniciando varredura (Bolinhas Verdes)...');
                        messageHandler.processUnreadMessages(latestSession);
                    }
                }, 15000);
            }
        });

        // Inicia o agendador de auto-aquecimento entre contas
        messageHandler.startAutoWarmScheduler(sessionManager);

        // O Scheduler só iniciará DEPOIS que garantirmos que o banco está off

        // Carrega contas existentes do banco de dados e as gerencia conforme seu último status
        const existingAccounts = await db.getAllAccounts();
        if (existingAccounts.length > 0) {
            logger.info(null, `Encontradas ${existingAccounts.length} contas no banco de dados. Analisando status...`);

            const accountsToResume = [];

            for (const account of existingAccounts) {
                // Se estava conectada ou autenticada antes, devemos retomar
                if (account.status === 'ready' || account.status === 'authenticated') {
                    accountsToResume.push(account);
                } else {
                    // Qualquer outro estado (erro, qr, paused, disconnected) vai para OFF (disconnected)
                    // Para que o sistema inicie limpo e elas não subam sem querer
                    if (account.status !== 'disconnected') {
                        await db.updateAccountStatus(account.id, 'disconnected');
                    }
                }
            }

            if (accountsToResume.length > 0) {
                logger.info(null, `🔄 Retomando ${accountsToResume.length} sessão(ões) previamente ativas...`);

                for (const account of accountsToResume) {
                    try {
                        logger.info(null, `  ▶ Retomando sessão: ${account.name} (ID: ${account.id})...`);
                        // Pequeno delay entre inicializações para não sobrecarregar recursos
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        await sessionManager.createSession(account.id, account.name, { visible: false });
                    } catch (err) {
                        logger.warn(null, `  ⚠ Falha ao retomar ${account.name}: ${err.message}`);
                        await db.updateAccountStatus(account.id, 'disconnected');
                    }
                }
            } else {
                logger.info(null, '🔌 Nenhuma sessão conectada anteriormente. As contas estão no estado DESCONECTADO.');
            }
        } else {
            logger.info(null, 'Nenhuma conta encontrada. Use o dashboard para criar novas contas');
        }

        // Inicia o loop de rotatividade de contas (Agendamento & Procuração Proxy) AGORA QUE O BANCO ESTÁ OFF
        schedulerManager.start();

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
