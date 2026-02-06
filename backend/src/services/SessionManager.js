const EventEmitter = require('events');
const WhatsAppSession = require('./WhatsAppSession');
const db = require('../database/DatabaseManager');
const logger = require('../utils/logger');

/**
 * Gerenciador de múltiplas sessões WhatsApp (versão dinâmica)
 */
class SessionManager extends EventEmitter {
    constructor() {
        super();
        this.sessions = new Map(); // accountId => WhatsAppSession
    }

    /**
     * Cria uma nova sessão
     */
    async createSession(accountId, accountName, options = {}) {
        try {
            if (this.sessions.has(accountId)) {
                logger.warn(null, `Sessão ${accountName} (ID: ${accountId}) já existe`);
                return this.sessions.get(accountId);
            }

            // Obtém configuração do banco
            const account = await db.getAccount(accountId);
            if (!account) {
                throw new Error(`Conta ${accountId} não encontrada no banco de dados`);
            }

            const session = new WhatsAppSession(accountId, accountName, account);
            if (options) {
                session.setRuntimeOptions(options);
            }

            // Propaga eventos da sessão
            session.on('qr', (qr) => {
                this.emit('session:qr', {
                    accountId,
                    accountName,
                    qr,
                    publicIP: session.publicIP,
                    isp: session.isp
                });
            });

            session.on('authenticated', async () => {
                await db.updateAccountStatus(accountId, 'authenticated');
                this.emit('session:authenticated', { accountId, accountName });
            });

            session.on('ready', async (info) => {
                await db.updateAccountStatus(accountId, 'ready', info.wid.user);
                await db.updateStats(accountId, { uptime_start: new Date().toISOString() });
                this.emit('session:ready', { accountId, accountName, info });
            });

            session.on('disconnected', async (reason) => {
                await db.updateAccountStatus(accountId, 'disconnected');
                this.emit('session:disconnected', { accountId, accountName, reason });
            });

            session.on('message', async (msg) => {
                await db.updateStats(accountId, { messages_received: 1 });
                this.emit('session:message', { accountId, accountName, message: msg });
            });

            session.on('message:sent', async () => {
                await db.updateStats(accountId, { messages_sent: 1 });
            });

            session.on('error', (error) => {
                this.emit('session:error', { accountId, accountName, error });
            });

            this.sessions.set(accountId, session);

            // Inicializa a sessão
            await session.initialize();

            return session;

        } catch (error) {
            logger.error(null, `Erro ao criar sessão ${accountName}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Obtém uma sessão específica
     */
    getSession(accountId) {
        return this.sessions.get(accountId);
    }

    /**
     * Obtém todas as sessões
     */
    getAllSessions() {
        return Array.from(this.sessions.values());
    }

    /**
     * Obtém informações de todas as sessões
     */
    /**
     * Obtém informações de todas as sessões
     */
    async getAllSessionsInfo() {
        const sessions = [];
        for (const [accountId, session] of this.sessions) {
            const account = await db.getAccount(accountId);
            const sessionInfo = await session.getInfo();
            sessions.push({
                ...sessionInfo,
                ...account
            });
        }
        return sessions;
    }

    /**
     * Obtém estatísticas gerais
     */
    async getGlobalStats() {
        const allAccounts = await db.getAllAccounts();

        const stats = {
            totalAccounts: allAccounts.length,
            activeSessions: this.sessions.size,
            ready: 0,
            qr: 0,
            disconnected: 0,
            totalMessagesSent: 0,
            totalMessagesReceived: 0,
            totalUniqueContacts: 0
        };

        allAccounts.forEach(account => {
            if (account.status === 'ready') stats.ready++;
            else if (account.status === 'qr') stats.qr++;
            else if (account.status === 'disconnected') stats.disconnected++;

            stats.totalMessagesSent += account.messages_sent || 0;
            stats.totalMessagesReceived += account.messages_received || 0;
            stats.totalUniqueContacts += account.unique_contacts || 0;
        });

        return stats;
    }

    /**
     * Destrói uma sessão específica
     */
    async destroySession(accountId) {
        const session = this.sessions.get(accountId);
        if (session) {
            await session.destroy();
            this.sessions.delete(accountId);
            await db.updateAccountStatus(accountId, 'disconnected');
            logger.info(null, `Sessão ${accountId} removida`);
        }
    }

    /**
     * Destrói todas as sessões
     */
    async destroyAll() {
        logger.info(null, 'Destruindo todas as sessões...');

        const promises = Array.from(this.sessions.values()).map(session => session.destroy());
        await Promise.allSettled(promises);

        this.sessions.clear();
        logger.success(null, 'Todas as sessões destruídas');
    }
}

// Singleton
const sessionManager = new SessionManager();

module.exports = sessionManager;
