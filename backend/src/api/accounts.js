const express = require('express');
const router = express.Router();
const db = require('../database/DatabaseManager');
const sessionManager = require('../services/SessionManager');
const { requireAuth, requireCustomer, requireActiveSubscription } = require('../middleware/auth');

// Todas as rotas de accounts exigem cliente autenticado com assinatura válida
router.use(requireAuth, requireCustomer, requireActiveSubscription);

function tdb(req) { return db.tenant(req.user.tenantId); }
function tid(req) { return req.user.tenantId; }

/**
 * GET /api/accounts
 */
router.get('/', async (req, res) => {
    try {
        const accounts = await tdb(req).getAllAccounts();
        const enriched = await Promise.all(accounts.map(async (account) => {
            const session = sessionManager.getSession(tid(req), account.id);
            if (session) {
                const sessionInfo = await session.getInfo();
                return { ...account, qrCode: sessionInfo.qrCode, status: sessionInfo.status };
            }
            return account;
        }));
        res.json(enriched);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
    try {
        const account = await tdb(req).getAccount(req.params.id);
        if (!account) return res.status(404).json({ error: 'Conta não encontrada' });
        res.json(account);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * POST /api/accounts — cria nova conta. Bloqueia se ultrapassar plano.
 */
router.post('/', async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ error: 'Nome obrigatório' });

        const max = req.subscription && req.subscription.max_accounts;
        if (max != null) {
            const current = await tdb(req).countAccounts();
            if (current >= max) {
                return res.status(403).json({ error: `Limite do plano atingido (${current}/${max} contas)` });
            }
        }

        const existing = await tdb(req).getAccountByName(name);
        if (existing) return res.status(409).json({ error: 'Conta com este nome já existe' });

        const account = await tdb(req).createAccount(name);
        res.status(201).json(account);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id/config', async (req, res) => {
    try {
        const account = await tdb(req).getAccount(req.params.id);
        if (!account) return res.status(404).json({ error: 'Conta não encontrada' });
        await tdb(req).updateAccountConfig(req.params.id, req.body);
        const session = sessionManager.getSession(tid(req), parseInt(req.params.id, 10));
        if (session) session.updateConfig(req.body);
        const updated = await tdb(req).getAccount(req.params.id);
        res.json(updated);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id/messages', async (req, res) => {
    try {
        const messages = await tdb(req).getAccountMessages(req.params.id, req.query.type);
        res.json(messages);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/messages', async (req, res) => {
    try {
        const { message_type, message_text } = req.body;
        if (!message_type || !message_text) return res.status(400).json({ error: 'tipo/texto obrigatórios' });
        const result = await tdb(req).addAccountMessage(req.params.id, message_type, message_text);
        res.status(201).json({ id: result.lastInsertRowid });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/messages/:messageId', async (req, res) => {
    try {
        await tdb(req).deleteAccountMessage(req.params.messageId);
        res.status(204).send();
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/start', async (req, res) => {
    try {
        const { visible } = req.body || {};
        const account = await tdb(req).getAccount(req.params.id);
        if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

        const accountId = parseInt(req.params.id, 10);
        const existingSession = sessionManager.getSession(tid(req), accountId);
        if (existingSession) {
            await sessionManager.destroySession(tid(req), accountId);
            await new Promise((r) => setTimeout(r, 2000));
        }
        await sessionManager.createSession(tid(req), accountId, account.name, { visible });
        res.json({ message: 'Sessão iniciada' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/stop', async (req, res) => {
    try {
        await sessionManager.destroySession(tid(req), parseInt(req.params.id, 10));
        res.json({ message: 'Sessão encerrada' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/restart', async (req, res) => {
    try {
        const accountId = parseInt(req.params.id, 10);
        const session = sessionManager.getSession(tid(req), accountId);
        if (session) {
            await session.reconnect();
            res.json({ message: 'Sessão reiniciada' });
        } else {
            const account = await tdb(req).getAccount(req.params.id);
            if (!account) return res.status(404).json({ error: 'Conta não encontrada' });
            await sessionManager.createSession(tid(req), accountId, account.name, { visible: true });
            res.json({ message: 'Sessão iniciada' });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id/qr', (req, res) => {
    try {
        const session = sessionManager.getSession(tid(req), parseInt(req.params.id, 10));
        if (!session || !session.qrCode) return res.status(404).json({ error: 'QR não disponível' });
        res.json({ qrCode: session.qrCode });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id/mode', async (req, res) => {
    try {
        const { mode } = req.body || {};
        if (mode !== 'warmup' && mode !== 'dispatch') return res.status(400).json({ error: "mode deve ser 'warmup' ou 'dispatch'" });
        await tdb(req).updateAccountMode(req.params.id, mode);
        const updated = await tdb(req).getAccount(req.params.id);
        res.json(updated);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
    try {
        await sessionManager.destroySession(tid(req), parseInt(req.params.id, 10));
        await tdb(req).deleteAccount(req.params.id);
        res.status(204).send();
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
