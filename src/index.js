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
    // Ignora erros esperados de browser fechando durante inject
    const reasonStr = String(reason);
    if (reasonStr.includes('TargetCloseError') || reasonStr.includes('Target closed') || reasonStr.includes('ProtocolError') || reasonStr.includes('Protocol error') || reasonStr.includes('Execution context was destroyed')) {
        // Ignorado sem poluir logs excessivamente
        return;
    }
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
        const port = process.env.PORT || 8080;
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

        // Carrega contas existentes do banco de dados
        const existingAccounts = await db.getAllAccounts();
        if (existingAccounts.length > 0) {
            logger.info(null, `Encontradas ${existingAccounts.length} contas no banco de dados.`);

            // SEGURANÇA: No deploy/restart, TODAS as contas começam como DESCONECTADAS.
            // Mas ANTES de resetar, salva quais estavam ativas para auto-reconectar depois.
            let resetCount = 0;
            const previouslyActiveIds = new Set();
            for (const account of existingAccounts) {
                if (account.status === 'ready' || account.status === 'connected' || account.status === 'initializing') {
                    previouslyActiveIds.add(account.id);
                }
                if (account.status !== 'disconnected') {
                    await db.updateAccountStatus(account.id, 'disconnected');
                    resetCount++;
                }
            }
            if (resetCount > 0) {
                logger.info(null, `🔄 ${resetCount} conta(s) foram resetadas para DESCONECTADO após restart.`);
                if (previouslyActiveIds.size > 0) {
                    logger.info(null, `📋 Contas que estavam ativas antes do restart: ${[...previouslyActiveIds].join(', ')}`);
                }
            }
            logger.info(null, '🔌 Todas as contas estão DESCONECTADAS. O Scheduler ativará as contas agendadas (ON) automaticamente.');
        } else {
            logger.info(null, 'Nenhuma conta encontrada. Use o dashboard para criar novas contas');
        }

        // Inicia o loop de rotatividade de contas (Agendamento & Procuração Proxy) AGORA QUE O BANCO ESTÁ OFF
        schedulerManager.start();

        // AUTO-RECONEXÃO: Reconecta APENAS contas que estavam ATIVAS antes do restart
        // E que têm sessão salva no PostgreSQL (para reconectar sem QR)
        if (typeof previouslyActiveIds !== 'undefined' && previouslyActiveIds.size > 0) {
            (async () => {
                try {
                    const allAccounts = await db.getAllAccounts();
                    const sessionsResult = await db.pool.query('SELECT session_id FROM wwebjs_sessions');
                    const savedSessions = new Set(sessionsResult.rows.map(r => r.session_id));

                    const accountsToReconnect = allAccounts.filter(acc => {
                        const sessionId = `RemoteAuth-account-${acc.id}`;
                        // Só reconecta se: 1) estava ativa antes E 2) tem sessão salva
                        return previouslyActiveIds.has(acc.id) && savedSessions.has(sessionId);
                    });

                    if (accountsToReconnect.length > 0) {
                        logger.info(null, `🔄 ${accountsToReconnect.length} conta(s) ativa(s) com sessão salva. Auto-reconectando...`);

                        for (let i = 0; i < accountsToReconnect.length; i++) {
                            const acc = accountsToReconnect[i];
                            // Delay escalonado entre contas (15s cada) para não sobrecarregar
                            if (i > 0) {
                                await new Promise(resolve => setTimeout(resolve, 15000));
                            }
                            try {
                                logger.info(null, `🔄 [${i + 1}/${accountsToReconnect.length}] Auto-reconectando ${acc.name} (conta ${acc.id})...`);
                                await schedulerManager.activateAccount(acc);
                                logger.info(null, `✅ [${i + 1}/${accountsToReconnect.length}] ${acc.name} — reconexão solicitada.`);
                            } catch (err) {
                                logger.error(null, `❌ Erro ao auto-reconectar ${acc.name}: ${err.message}`);
                            }
                        }
                        logger.info(null, `🔄 Auto-reconexão finalizada.`);
                    } else {
                        logger.info(null, '📭 Contas ativas anteriores não tinham sessão salva para auto-reconectar.');
                    }
                } catch (err) {
                    logger.error(null, `❌ Erro na auto-reconexão: ${err.message}`);
                }
            })();
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
