const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = express.Router();
const db = require('../database/DatabaseManager');
const dispatchEngine = require('../services/DispatchEngine');
const { requireAuth, requireCustomer, requireActiveSubscription } = require('../middleware/auth');

router.use(requireAuth, requireCustomer, requireActiveSubscription);

const MEDIA_BASE = path.join(__dirname, '..', '..', '..', 'media', 'dispatch');
fs.mkdirSync(MEDIA_BASE, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, _file, cb) => {
        const dir = path.join(MEDIA_BASE, `tenant_${req.user.tenantId}`, String(req.params.id));
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (_req, file, cb) => {
        const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${Date.now()}_${safe}`);
    }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

function tdb(req) { return db.tenant(req.user.tenantId); }
function tid(req) { return req.user.tenantId; }

// ========== Campanhas ==========
router.get('/campaigns', async (req, res) => {
    try {
        const list = await tdb(req).listCampaigns();
        const enriched = await Promise.all(list.map(async (c) => ({
            ...c, counts: await tdb(req).getCampaignCounts(c.id)
        })));
        res.json(enriched);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/campaigns', async (req, res) => {
    try {
        const c = await tdb(req).createCampaign(req.body || {});
        res.status(201).json(c);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/campaigns/:id', async (req, res) => {
    try {
        const c = await tdb(req).getCampaign(req.params.id);
        if (!c) return res.status(404).json({ error: 'Campanha não encontrada' });
        const [texts, media, accounts, counts] = await Promise.all([
            tdb(req).getCampaignTexts(c.id),
            tdb(req).getCampaignMedia(c.id),
            tdb(req).getCampaignAccounts(c.id),
            tdb(req).getCampaignCounts(c.id)
        ]);
        res.json({ ...c, texts, media, accounts, counts });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/campaigns/:id', async (req, res) => {
    try {
        const c = await tdb(req).updateCampaign(req.params.id, req.body || {});
        res.json(c);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/campaigns/:id', async (req, res) => {
    try {
        await tdb(req).deleteCampaign(req.params.id);
        res.status(204).send();
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== Textos ==========
router.post('/campaigns/:id/texts', async (req, res) => {
    try {
        const { body, kind } = req.body;
        if (!body) return res.status(400).json({ error: 'body obrigatório' });
        const t = await tdb(req).addCampaignText(req.params.id, body, kind || 'outbound');
        res.status(201).json(t);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/campaigns/:id/texts/:textId', async (req, res) => {
    try {
        await tdb(req).deleteCampaignText(req.params.textId);
        res.status(204).send();
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== Mídia ==========
router.post('/campaigns/:id/media', upload.array('files', 20), async (req, res) => {
    try {
        const out = [];
        for (const f of req.files || []) {
            const m = await tdb(req).addCampaignMedia(req.params.id, f.path, f.mimetype);
            out.push(m);
        }
        res.status(201).json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/campaigns/:id/media/:mediaId', async (req, res) => {
    try {
        const removed = await tdb(req).deleteCampaignMedia(req.params.mediaId);
        if (removed && removed.file_path && fs.existsSync(removed.file_path)) {
            try { fs.unlinkSync(removed.file_path); } catch (_) {}
        }
        res.status(204).send();
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== Contas atribuídas ==========
router.post('/campaigns/:id/accounts', async (req, res) => {
    try {
        const { accountId, quota } = req.body;
        if (!accountId) return res.status(400).json({ error: 'accountId obrigatório' });
        await tdb(req).upsertCampaignAccount(req.params.id, accountId, quota || 0);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/campaigns/:id/accounts/:accountId', async (req, res) => {
    try {
        await tdb(req).removeCampaignAccount(req.params.id, req.params.accountId);
        res.status(204).send();
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== Contatos ==========
router.post('/campaigns/:id/contacts', async (req, res) => {
    try {
        let { contacts, raw } = req.body;
        if (!contacts && raw) {
            contacts = String(raw).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
                const [phone, name] = line.split(',').map((p) => p && p.trim());
                return { phone, name: name || null };
            });
        }
        if (!Array.isArray(contacts) || !contacts.length) return res.status(400).json({ error: 'contacts vazio' });
        const inserted = await tdb(req).addCampaignContacts(req.params.id, contacts);
        res.status(201).json({ inserted });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/campaigns/:id/board', async (req, res) => {
    try { res.json(await tdb(req).getCampaignBoard(req.params.id)); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/campaigns/:id/messages', async (req, res) => {
    try {
        const rows = await tdb(req).getDispatchMessages({
            campaignId: req.params.id,
            accountId: req.query.accountId,
            limit: req.query.limit,
            before: req.query.before
        });
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== Controle ==========
router.post('/campaigns/:id/start', async (req, res) => {
    try {
        const c = await dispatchEngine.start(tid(req), parseInt(req.params.id, 10));
        res.json(c);
    } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/campaigns/:id/pause', async (req, res) => {
    try {
        await dispatchEngine.pause(tid(req), parseInt(req.params.id, 10));
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/campaigns/:id/resume', async (req, res) => {
    try {
        const c = await dispatchEngine.resume(tid(req), parseInt(req.params.id, 10));
        res.json(c);
    } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/campaigns/:id/stop', async (req, res) => {
    try {
        await dispatchEngine.stop(tid(req), parseInt(req.params.id, 10));
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== Inbox global do tenant ==========
router.get('/inbox', async (req, res) => {
    try {
        const rows = await tdb(req).getDispatchMessages({
            limit: req.query.limit,
            before: req.query.before
        });
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
