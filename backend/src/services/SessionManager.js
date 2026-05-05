const EventEmitter = require('events');
const WhatsAppSession = require('./WhatsAppSession');
const db = require('../database/DatabaseManager');
const logger = require('../utils/logger');

/**
 * Gerenciador multi-tenant de sessões WhatsApp.
 * Sessões são namespaced por tenantId: Map<tenantId, Map<accountId, WhatsAppSession>>.
 * Eventos emitidos sempre incluem `tenantId` para roteamento.
 */
class SessionManager extends EventEmitter {
    constructor() {
        super();
        this.tenantSessions = new Map(); // tenantId -> Map<accountId, WhatsAppSession>
    }

    _bucket(tenantId) {
        if (!this.tenantSessions.has(tenantId)) {
            this.tenantSessions.set(tenantId, new Map());
        }
        return this.tenantSessions.get(tenantId);
    }

    async createSession(tenantId, accountId, accountName, options = {}) {
        try {
            const bucket = this._bucket(tenantId);
            if (bucket.has(accountId)) {
                logger.warn(null, `Sessão ${accountName} (tenant ${tenantId} acc ${accountId}) já existe`);
                return bucket.get(accountId);
            }

            const tdb = db.tenant(tenantId);
            const account = await tdb.getAccount(accountId);
            if (!account) throw new Error(`Conta ${accountId} não encontrada no tenant ${tenantId}`);

            const session = new WhatsAppSession(accountId, accountName, account, tenantId);
            if (options) session.setRuntimeOptions(options);

            session.on('qr', (qr) => {
                this.emit('session:qr', {
                    tenantId, accountId, accountName, qr,
                    publicIP: session.publicIP, isp: session.isp
                });
            });

            session.on('authenticated', async () => {
                await tdb.updateAccountStatus(accountId, 'authenticated');
                this.emit('session:authenticated', { tenantId, accountId, accountName });
            });

            session.on('ready', async (info) => {
                await tdb.updateAccountStatus(accountId, 'ready', info.wid.user);
                await tdb.updateStats(accountId, { uptime_start: new Date().toISOString() });
                this.emit('session:ready', { tenantId, accountId, accountName, info });
            });

            session.on('disconnected', async (reason) => {
                await tdb.updateAccountStatus(accountId, 'disconnected');
                this.emit('session:disconnected', { tenantId, accountId, accountName, reason });
            });

            session.on('message', async (msg) => {
                await tdb.updateStats(accountId, { messages_received: 1 });
                this.emit('session:message', { tenantId, accountId, accountName, message: msg });
            });

            session.on('message:sent', async () => {
                await tdb.updateStats(accountId, { messages_sent: 1 });
            });

            session.on('error', (error) => {
                this.emit('session:error', { tenantId, accountId, accountName, error });
            });

            bucket.set(accountId, session);
            try {
                await session.initialize();
            } catch (initErr) {
                // FIX (resume bug): se initialize() falhou (ex.: proxy caiu durante a pausa),
                // remove a sessão quebrada do bucket. Sem isso, próximas chamadas a
                // createSession caem no early-return de bucket.has(accountId) e devolvem
                // o objeto inválido com status='error' e sock=null pra sempre.
                bucket.delete(accountId);
                try { await session.destroy(); } catch (_) {}
                try { await db.tenant(tenantId).updateAccountStatus(accountId, 'error'); } catch (_) {}
                logger.error(null, `🧹 sessão tenant=${tenantId} acc=${accountId} removida do bucket após falha em initialize()`);
                throw initErr;
            }
            return session;
        } catch (error) {
            logger.error(null, `Erro ao criar sessão tenant=${tenantId} acc=${accountName}: ${error.message}`);
            throw error;
        }
    }

    getSession(tenantId, accountId) {
        const bucket = this.tenantSessions.get(tenantId);
        return bucket ? bucket.get(accountId) : null;
    }

    /**
     * Lookup por accountId em todos os tenants. Útil para handlers de eventos onde só temos o accountId.
     * Retorna { tenantId, session } ou null.
     */
    findSession(accountId) {
        for (const [tenantId, bucket] of this.tenantSessions) {
            if (bucket.has(accountId)) return { tenantId, session: bucket.get(accountId) };
        }
        return null;
    }

    /**
     * Lookup por accountName (logger usa accountName como sessionId).
     */
    findSessionByName(accountName) {
        if (!accountName) return null;
        for (const [tenantId, bucket] of this.tenantSessions) {
            for (const session of bucket.values()) {
                if (session.accountName === accountName) {
                    return { tenantId, session };
                }
            }
        }
        return null;
    }

    getTenantSessions(tenantId) {
        const bucket = this.tenantSessions.get(tenantId);
        return bucket ? Array.from(bucket.values()) : [];
    }

    async getAllSessionsInfo(tenantId) {
        const sessions = [];
        const bucket = this.tenantSessions.get(tenantId);
        if (!bucket) return sessions;
        const tdb = db.tenant(tenantId);
        for (const [accountId, session] of bucket) {
            const account = await tdb.getAccount(accountId);
            const sessionInfo = await session.getInfo();
            sessions.push({ ...sessionInfo, ...account });
        }
        return sessions;
    }

    async getGlobalStats(tenantId) {
        const tdb = db.tenant(tenantId);
        const allAccounts = await tdb.getAllAccounts();
        const bucket = this.tenantSessions.get(tenantId) || new Map();
        const stats = {
            totalAccounts: allAccounts.length,
            activeSessions: bucket.size,
            ready: 0, qr: 0, disconnected: 0,
            totalMessagesSent: 0, totalMessagesReceived: 0, totalUniqueContacts: 0
        };
        for (const a of allAccounts) {
            if (a.status === 'ready') stats.ready++;
            else if (a.status === 'qr') stats.qr++;
            else if (a.status === 'disconnected') stats.disconnected++;
            stats.totalMessagesSent += a.messages_sent || 0;
            stats.totalMessagesReceived += a.messages_received || 0;
            stats.totalUniqueContacts += a.unique_contacts || 0;
        }
        return stats;
    }

    async destroySession(tenantId, accountId) {
        const bucket = this.tenantSessions.get(tenantId);
        if (!bucket) return;
        const session = bucket.get(accountId);
        if (session) {
            await session.destroy();
            bucket.delete(accountId);
            await db.tenant(tenantId).updateAccountStatus(accountId, 'disconnected');
            logger.info(null, `Sessão tenant=${tenantId} acc=${accountId} removida`);
        }
    }

    async destroyTenantSessions(tenantId) {
        const bucket = this.tenantSessions.get(tenantId);
        if (!bucket) return;
        const promises = Array.from(bucket.values()).map((s) => s.destroy());
        await Promise.allSettled(promises);
        bucket.clear();
    }

    async destroyAll() {
        logger.info(null, 'Destruindo todas as sessões de todos os tenants...');
        for (const [tenantId] of this.tenantSessions) {
            await this.destroyTenantSessions(tenantId);
        }
        this.tenantSessions.clear();
        logger.success(null, 'Todas as sessões destruídas');
    }
}

const sessionManager = new SessionManager();
module.exports = sessionManager;
