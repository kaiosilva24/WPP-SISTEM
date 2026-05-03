const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../database/DatabaseManager');
const sessionManager = require('../services/SessionManager');
const messageTemplates = require('../utils/messageTemplates');
const { requireAuth, requireCustomer, requireActiveSubscription } = require('../middleware/auth');

// Todas as rotas de accounts exigem cliente autenticado com assinatura válida
router.use(requireAuth, requireCustomer, requireActiveSubscription);

function tdb(req) { return db.tenant(req.user.tenantId); }
function tid(req) { return req.user.tenantId; }

// =========================== MEDIA LIBRARY ===========================
const MEDIA_CATEGORIES = ['images', 'videos', 'stickers', 'audio', 'docs', 'vcards'];
const MEDIA_ROOT = path.join(__dirname, '..', '..', '..', 'media');

function tenantMediaDir(req, category) {
    const tenant = `tenant-${req.user.tenantId}`;
    return path.join(MEDIA_ROOT, tenant, category);
}

function defaultMediaDir(category) {
    return path.join(MEDIA_ROOT, category);
}

function ensureDir(dir) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
}

function readEntries(dir, urlPrefix, isDefault) {
    try {
        return fs.readdirSync(dir)
            .filter((f) => !f.startsWith('.'))
            .filter((f) => {
                try { return fs.statSync(path.join(dir, f)).isFile(); } catch (_) { return false; }
            })
            .map((f) => {
                const full = path.join(dir, f);
                let size = 0;
                try { size = fs.statSync(full).size; } catch (_) {}
                return { name: f, size, url: `${urlPrefix}/${encodeURIComponent(f)}`, isDefault: !!isDefault };
            });
    } catch (_) { return []; }
}

function listMediaCategory(req, category) {
    const tenantDir = tenantMediaDir(req, category);
    ensureDir(tenantDir);
    const tenantFiles = readEntries(tenantDir, `/media/tenant-${req.user.tenantId}/${category}`, false);
    const defaults = readEntries(defaultMediaDir(category), `/media/${category}`, true);
    const seen = new Set(tenantFiles.map((e) => e.name));
    const merged = tenantFiles.concat(defaults.filter((e) => !seen.has(e.name)));
    return merged;
}

const mediaUpload = multer({
    storage: multer.diskStorage({
        destination: (req, _file, cb) => {
            const cat = req.params.category;
            if (!MEDIA_CATEGORIES.includes(cat)) return cb(new Error('categoria inválida'));
            const dir = tenantMediaDir(req, cat);
            ensureDir(dir);
            cb(null, dir);
        },
        filename: (_req, file, cb) => {
            const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
            cb(null, `${Date.now()}_${safe}`);
        }
    }),
    limits: { fileSize: 50 * 1024 * 1024 }
});

router.get('/media/library', (req, res) => {
    try {
        const out = {};
        for (const cat of MEDIA_CATEGORIES) out[cat] = listMediaCategory(req, cat);
        res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/media/upload/:category', mediaUpload.array('files', 20), (req, res) => {
    try {
        if (!MEDIA_CATEGORIES.includes(req.params.category)) {
            return res.status(400).json({ error: 'categoria inválida' });
        }
        res.json({ count: (req.files || []).length });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/media/clear/:category', (req, res) => {
    try {
        if (!MEDIA_CATEGORIES.includes(req.params.category)) {
            return res.status(400).json({ error: 'categoria inválida' });
        }
        const dir = tenantMediaDir(req, req.params.category);
        let deleted = 0;
        try {
            for (const f of fs.readdirSync(dir)) {
                try { fs.unlinkSync(path.join(dir, f)); deleted++; } catch (_) {}
            }
        } catch (_) {}
        res.json({ deleted });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/media/:category/:filename', (req, res) => {
    try {
        if (!MEDIA_CATEGORIES.includes(req.params.category)) {
            return res.status(400).json({ error: 'categoria inválida' });
        }
        const filename = path.basename(req.params.filename);
        const target = path.join(tenantMediaDir(req, req.params.category), filename);
        if (!fs.existsSync(target)) return res.status(404).json({ error: 'arquivo não encontrado' });
        fs.unlinkSync(target);
        res.status(204).send();
    } catch (e) { res.status(500).json({ error: e.message }); }
});

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

// POST /api/accounts/:id/messages/seed — popula com templates padrão
router.post('/:id/messages/seed', async (req, res) => {
    try {
        const account = await tdb(req).getAccount(req.params.id);
        if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

        const accountId = parseInt(req.params.id, 10);
        const force = !!(req.body && req.body.force);

        if (!force) {
            const existing = await tdb(req).getAccountMessages(accountId);
            if (existing && existing.length > 0) {
                return res.json({ inserted: 0, skipped: existing.length, reason: 'Já possui mensagens' });
            }
        }

        const buckets = [
            { type: 'first', items: messageTemplates.firstResponseTemplates },
            { type: 'followup', items: messageTemplates.followUpTemplates },
            { type: 'group', items: messageTemplates.groupGreetings }
        ];

        let inserted = 0;
        for (const bucket of buckets) {
            for (const text of bucket.items) {
                await tdb(req).addAccountMessage(accountId, bucket.type, text);
                inserted++;
            }
        }

        res.json({ inserted });
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
