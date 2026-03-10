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
        this._locks = new Map();   // accountId => Promise (lock de create/destroy)
    }

    /**
     * Aguarda lock existente e cria um novo para a conta
     * Impede create/destroy simultâneos na mesma conta
     */
    async _acquireLock(accountId) {
        const key = String(accountId);
        // Espera o lock anterior terminar (se existir)
        while (this._locks.has(key)) {
            try { await this._locks.get(key); } catch (e) { /* ignore */ }
        }
        // Cria um novo lock (promise que será resolvida quando a operação terminar)
        let releaseLock;
        const lockPromise = new Promise(resolve => { releaseLock = resolve; });
        this._locks.set(key, lockPromise);
        return releaseLock;
    }

    _releaseLock(accountId, releaseFn) {
        this._locks.delete(String(accountId));
        releaseFn();
    }

    /**
     * Cria uma nova sessão
     */
    async createSession(accountId, accountName, options = {}) {
        const releaseLock = await this._acquireLock(accountId);
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

            // FILA GLOBAL DE INICIALIZAÇÃO (DISCLOUD PID LIMIT FIX)
            // Impede que 20 contas abram Chromium exatamente no mesmo segundo e estourem o limite (EAGAIN 11)
            const prevInit = this.globalInitLock || Promise.resolve();
            let releaseGlobal;
            this.globalInitLock = new Promise(resolve => { releaseGlobal = resolve; });

            await prevInit.catch(() => { }); // Espera a anterior
            try {
                // Inicializa a sessão com exclusividade de boot na CPU
                logger.info(null, `[Fila Global] Iniciando boot do navegador para a conta ${accountName}...`);
                await session.initialize();
            } finally {
                releaseGlobal();
            }

            return session;

        } catch (error) {
            logger.error(null, `Erro ao criar sessão ${accountName}: ${error?.message || error}`);
            throw error;
        } finally {
            this._releaseLock(accountId, releaseLock);
        }
    }

    /**
     * Obtém uma sessão específica
     */
    getSession(accountId) {
        // Uniformiza p/ String, já que pode vir como Integer do BD ou String do Params
        if (!accountId) return null;
        for (const [key, value] of this.sessions.entries()) {
            if (String(key) === String(accountId)) {
                return value;
            }
        }
        return null;
    }

    /**
     * Obtém todas as sessões
     */
    getAllSessions() {
        return Array.from(this.sessions.values());
    }

    /**
     * Obtém sessões conectadas e prontas
     */
    getActiveSessions() {
        return Array.from(this.sessions.values()).filter(s => s.status === 'ready');
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
                ...account,
                ...sessionInfo, // sessionInfo (Em memória real) prevalece sobre os dados estáticos do banco
                status: sessionInfo.isPaused ? 'paused' : sessionInfo.status
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
     * @param {string|number} accountId
     * @param {object} options
     * @param {boolean} options.intentional - Se true, marca como parada intencional (sem reconexão)
     * @param {boolean} options.clearAuth  - Se true, faz logout e apaga o token (ao deletar conta)
     */
    async destroySession(accountId, { intentional = true, clearAuth = false } = {}) {
        const releaseLock = await this._acquireLock(accountId);
        try {
            const session = this.getSession(accountId); // Typecast proof
            if (session) {
                session.intentionalStop = intentional;
                await session.destroy(clearAuth);

                // Procura a chave exata para deletar do Map
                for (const key of this.sessions.keys()) {
                    if (String(key) === String(accountId)) {
                        this.sessions.delete(key);
                        break;
                    }
                }
                await db.updateAccountStatus(accountId, 'disconnected');
                logger.info(null, `Sessão ${accountId} removida`);
            }
        } finally {
            this._releaseLock(accountId, releaseLock);
        }
    }

    /**
     * Destrói todas as sessões (ex: ao encerrar o servidor)
     * Não faz logout para preservar os tokens salvos em disco.
     */
    async destroyAll() {
        logger.info(null, 'Destruindo todas as sessões...');

        // Marca todas como parada intencional para não tentar reconectar
        for (const session of this.sessions.values()) {
            session.setIntentionalStop(true);
        }

        const promises = Array.from(this.sessions.values()).map(session => session.destroy(false));
        await Promise.allSettled(promises);

        this.sessions.clear();
        logger.success(null, 'Todas as sessões destruídas');
    }

    /**
     * Retorna todas as sessões ativas (status ready) com config carregada
     */
    getActiveSessions() {
        return Array.from(this.sessions.values()).filter(s => s.status === 'ready' || s.isReady);
    }
}

// Singleton
const sessionManager = new SessionManager();

module.exports = sessionManager;
