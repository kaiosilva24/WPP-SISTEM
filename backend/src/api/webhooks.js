const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('../database/DatabaseManager');
const { requireAuth, requireCustomer, requireActiveSubscription } = require('../middleware/auth');

router.use(requireAuth, requireCustomer, requireActiveSubscription);

function tdb(req) { return db.tenant(req.user.tenantId); }

// GET /api/webhooks
router.get('/', async (req, res) => {
    try {
        const r = await tdb(req)._run('SELECT id, name, url, method, headers, body, created_at FROM webhooks ORDER BY id DESC');
        res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/webhooks
router.post('/', async (req, res) => {
    try {
        const { name, url, method, headers, body } = req.body || {};
        if (!name || !url) return res.status(400).json({ error: 'nome e url são obrigatórios' });
        const m = (method || 'GET').toUpperCase();
        if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(m)) {
            return res.status(400).json({ error: 'método inválido' });
        }
        const r = await tdb(req)._run(
            'INSERT INTO webhooks (name, url, method, headers, body) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, url, method, headers, body, created_at',
            [name, url, m, headers || null, body || null]
        );
        res.status(201).json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/webhooks/:id
router.delete('/:id', async (req, res) => {
    try {
        await tdb(req)._run('DELETE FROM webhooks WHERE id = $1', [req.params.id]);
        res.status(204).send();
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/webhooks/:id/execute
router.post('/:id/execute', async (req, res) => {
    try {
        const r = await tdb(req)._run('SELECT * FROM webhooks WHERE id = $1', [req.params.id]);
        const wh = r.rows[0];
        if (!wh) return res.status(404).json({ success: false, error: 'webhook não encontrado' });

        const config = {
            method: wh.method || 'GET',
            url: wh.url,
            timeout: 15000,
            validateStatus: () => true
        };
        if (wh.headers) config.headers = wh.headers;
        if (wh.body && config.method !== 'GET') config.data = wh.body;

        const resp = await axios(config);
        res.json({ success: resp.status >= 200 && resp.status < 300, status: resp.status, data: resp.data });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

module.exports = router;
