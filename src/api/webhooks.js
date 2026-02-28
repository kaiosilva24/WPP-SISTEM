const express = require('express');
const router = express.Router();
const db = require('../database/DatabaseManager');

/**
 * GET /api/webhooks
 * Lista todos os webhooks cadastrados
 */
router.get('/', async (req, res) => {
    try {
        const webhooks = await db.getAllWebhooks();
        res.json(webhooks);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/webhooks/:id
 * Obtém os dados de um webhook específico
 */
router.get('/:id', async (req, res) => {
    try {
        const webhook = await db.getWebhook(req.params.id);
        if (!webhook) {
            return res.status(404).json({ error: 'Webhook não encontrado' });
        }
        res.json(webhook);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/webhooks
 * Cria um novo webhook
 */
router.post('/', async (req, res) => {
    try {
        const { name, url, method } = req.body;
        if (!name || !url) {
            return res.status(400).json({ error: 'Nome e URL são obrigatórios' });
        }
        const webhook = await db.createWebhook(name, url, method || 'GET');
        res.status(201).json(webhook);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * PUT /api/webhooks/:id
 * Atualiza um webhook existente
 */
router.put('/:id', async (req, res) => {
    try {
        const webhook = await db.updateWebhook(req.params.id, req.body);
        if (!webhook) {
            return res.status(404).json({ error: 'Webhook não encontrado ou nenhuma alteração enviada' });
        }
        res.json(webhook);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /api/webhooks/:id
 * Remove um webhook do sistema
 */
router.delete('/:id', async (req, res) => {
    try {
        const success = await db.deleteWebhook(req.params.id);
        if (!success) {
            return res.status(404).json({ error: 'Webhook não encontrado' });
        }
        res.status(204).send();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/webhooks/:id/execute
 * Executa o webhook manualmente para teste
 */
router.post('/:id/execute', async (req, res) => {
    try {
        const webhook = await db.getWebhook(req.params.id);
        if (!webhook) {
            return res.status(404).json({ error: 'Webhook não encontrado' });
        }

        const axios = require('axios');
        const fetchOptions = {
            method: webhook.method || 'GET',
            url: webhook.url,
            timeout: 10000 // 10s fallback
        };

        const result = await axios(fetchOptions);
        res.status(200).json({ success: true, status: result.status, data: result.data });
    } catch (error) {
        // Se a requisição cair por causa do corte de rede do modo avião, consideramos sucesso prático
        if (['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH'].includes(error.code) || error.message.includes('timeout')) {
            return res.status(200).json({
                success: true,
                message: 'Webhook disparado (conexão caiu/timeout - normal ao rotacionar IP/Modo Avião)',
                code: error.code || 'TIMEOUT'
            });
        }
        res.status(500).json({ error: error.message, details: error.response?.data });
    }
});

module.exports = router;
