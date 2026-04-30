const db = require('../database/DatabaseManager');
const sessionManager = require('./SessionManager');
const dispatchEngine = require('./DispatchEngine');
const logger = require('../utils/logger');
const { delay, simulateTyping, formatDelay } = require('../utils/humanBehavior');

/**
 * Auto-reply restrito: apenas para contatos em campanha de disparo do mesmo tenant.
 */
class DispatchAutoReply {
    constructor() {
        this.attached = false;
    }

    attach() {
        if (this.attached) return;
        this.attached = true;

        sessionManager.on('session:message', async ({ tenantId, accountId, accountName, message }) => {
            try {
                if (!tenantId) return; // segurança: ignora se sem tenant
                await this.handle(tenantId, accountId, accountName, message);
            } catch (e) {
                logger.error(accountName, `DispatchAutoReply erro: ${e.message}`);
            }
        });
    }

    async handle(tenantId, accountId, accountName, message) {
        if (!message || !message.from) return;
        if (message.from.endsWith('@g.us')) return;
        const phone = message.from.split('@')[0];

        const tdb = db.tenant(tenantId);
        const contact = await tdb.findActiveContactForAccount(accountId, phone);
        if (!contact) return;
        if (contact.status === 'failed') return;

        const inbound = await tdb.logDispatchMessage({
            campaign_id: contact.campaign_id_join,
            account_id: accountId,
            contact_phone: phone,
            direction: 'in',
            body: message.body || null,
            media_path: null
        });
        dispatchEngine.emit('message', { tenantId, ...inbound });

        const pauseSec = contact.pause_on_reply_seconds || 3600;
        const pauseUntil = new Date(Date.now() + pauseSec * 1000);
        await tdb.setContactStatus(contact.id, 'replied', {
            replied_at: new Date(),
            pause_until: pauseUntil
        });
        dispatchEngine.emit('contact:update', {
            tenantId,
            campaignId: contact.campaign_id_join,
            accountId,
            contactId: contact.id,
            status: 'replied'
        });

        if (!contact.auto_reply_enabled) return;

        const session = sessionManager.getSession(tenantId, accountId);
        if (!session || session.status !== 'ready') return;

        const replyTexts = await tdb.getCampaignTexts(contact.campaign_id_join, 'reply');
        if (!replyTexts.length) return;

        const accountRow = await tdb.getAccount(accountId);
        const cfg = accountRow || {};

        const readDelay = this.rand(cfg.min_read_delay || 3000, cfg.max_read_delay || 15000);
        const typingDelay = this.rand(cfg.min_typing_delay || 5000, cfg.max_typing_delay || 20000);
        const responseDelay = this.rand(cfg.min_response_delay || 10000, cfg.max_response_delay || 30000);

        try {
            const chat = await session.getChat(message.from);
            await chat.sendSeen();
            await delay(readDelay);
            logger.behavior(accountName, 'Disparo reply: digitando', formatDelay(typingDelay));
            await simulateTyping(chat, typingDelay);
            await delay(responseDelay);

            const release = await dispatchEngine.acquireProxyLock(tenantId, accountRow);
            try {
                const text = replyTexts[Math.floor(Math.random() * replyTexts.length)].body;
                await session.sendMessage(message.from, text);
                const logged = await tdb.logDispatchMessage({
                    campaign_id: contact.campaign_id_join,
                    account_id: accountId,
                    contact_phone: phone,
                    direction: 'out',
                    body: text,
                    media_path: null
                });
                dispatchEngine.emit('message', { tenantId, ...logged });
            } finally {
                release();
            }
        } catch (e) {
            logger.error(accountName, `Falha auto-reply disparo: ${e.message}`);
        }
    }

    rand(min, max) {
        if (max <= min) return min;
        return Math.floor(Math.random() * (max - min) + min);
    }
}

const dispatchAutoReply = new DispatchAutoReply();
module.exports = dispatchAutoReply;
