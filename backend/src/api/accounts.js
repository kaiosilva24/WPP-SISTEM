const express = require('express');
const router = express.Router();
const db = require('../database/DatabaseManager');
const sessionManager = require('../services/SessionManager');

/**
 * GET /api/accounts
 * Lista todas as contas
 */
router.get('/', async (req, res) => {
    try {
        const accounts = await db.getAllAccounts();

        // Mescla com dados da sessão (qrCode, etc)
        const accountsWithSession = await Promise.all(accounts.map(async (account) => {
            const session = sessionManager.getSession(account.id);
            if (session) {
                const sessionInfo = await session.getInfo();
                return {
                    ...account,
                    qrCode: sessionInfo.qrCode,
                    status: sessionInfo.status
                };
            }
            return account;
        }));

        res.json(accountsWithSession);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/accounts/:id
 * Obtém uma conta específica
 */
router.get('/:id', async (req, res) => {
    try {
        const account = await db.getAccount(req.params.id);
        if (!account) {
            return res.status(404).json({ error: 'Conta não encontrada' });
        }
        res.json(account);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/accounts
 * Cria uma nova conta
 */
router.post('/', async (req, res) => {
    try {
        const { name } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Nome da conta é obrigatório' });
        }

        // Verifica se já existe
        const existing = await db.getAccountByName(name);
        if (existing) {
            return res.status(409).json({ error: 'Conta com este nome já existe' });
        }

        // Cria conta no banco (sem iniciar sessão automaticamente)
        const account = await db.createAccount(name);

        res.status(201).json(account);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * PUT /api/accounts/:id/config
 * Atualiza configuração da conta
 */
router.put('/:id/config', async (req, res) => {
    try {
        console.log(`[API] Atualizando config para conta ${req.params.id}:`, req.body);

        const account = await db.getAccount(req.params.id);
        if (!account) {
            console.error(`[API] Conta ${req.params.id} não encontrada`);
            return res.status(404).json({ error: 'Conta não encontrada' });
        }

        await db.updateAccountConfig(req.params.id, req.body);
        console.log(`[API] Config atualizada no banco para conta ${req.params.id}`);

        // Atualiza sessão se estiver ativa
        const session = sessionManager.getSession(req.params.id);
        if (session) {
            console.log(`[API] Atualizando config na sessão ativa para conta ${req.params.id}`);
            session.updateConfig(req.body);
        }

        const updated = await db.getAccount(req.params.id);
        console.log(`[API] Config salva com sucesso para conta ${req.params.id}`);
        res.json(updated);
    } catch (error) {
        console.error(`[API] Erro ao atualizar config:`, error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/accounts/:id/messages
 * Obtém mensagens personalizadas da conta
 */
router.get('/:id/messages', async (req, res) => {
    try {
        const { type } = req.query;
        const messages = await db.getAccountMessages(req.params.id, type);
        res.json(messages);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/accounts/:id/messages
 * Adiciona mensagem personalizada
 */
router.post('/:id/messages', async (req, res) => {
    try {
        const { message_type, message_text } = req.body;

        if (!message_type || !message_text) {
            return res.status(400).json({ error: 'Tipo e texto da mensagem são obrigatórios' });
        }

        const result = await db.addAccountMessage(req.params.id, message_type, message_text);
        res.status(201).json({ id: result.lastInsertRowid });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /api/accounts/:id/messages/:messageId
 * Remove mensagem personalizada
 */
router.delete('/:id/messages/:messageId', async (req, res) => {
    try {
        await db.deleteAccountMessage(req.params.messageId);
        res.status(204).send();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/accounts/:id/start
 * Inicia sessão da conta
 */
router.post('/:id/start', async (req, res) => {
    try {
        const { visible } = req.body;
        const account = await db.getAccount(req.params.id);
        if (!account) {
            return res.status(404).json({ error: 'Conta não encontrada' });
        }

        console.log(`[API] Iniciando sessão para conta ${account.id} (${account.name}) [Visible: ${visible}]`);

        // Se sessão já existe, destrói primeiro
        const existingSession = sessionManager.getSession(account.id);
        if (existingSession) {
            console.log(`[API] Destruindo sessão existente para conta ${account.id}`);
            await sessionManager.destroySession(account.id);
            // Aguarda um pouco para garantir que foi destruída
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        // Cria nova sessão
        console.log(`[API] Criando nova sessão para conta ${account.id}`);
        await sessionManager.createSession(account.id, account.name, { visible });
        console.log(`[API] Sessão criada com sucesso para conta ${account.id}`);

        res.json({ message: 'Sessão iniciada' });
    } catch (error) {
        console.error(`[API] Erro ao iniciar sessão:`, error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/accounts/:id/stop
 * Para sessão da conta
 */
router.post('/:id/stop', async (req, res) => {
    try {
        await sessionManager.destroySession(req.params.id);
        res.json({ message: 'Sessão encerrada' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/accounts/:id/restart
 * Reinicia sessão da conta
 */
router.post('/:id/restart', async (req, res) => {
    try {
        const session = sessionManager.getSession(req.params.id);
        if (session) {
            console.log(`[API] Reiniciando sessão existente para conta ${req.params.id}`);
            await session.reconnect();
            res.json({ message: 'Sessão reiniciada' });
        } else {
            // Se não existe sessão, cria uma nova
            console.log(`[API] Sessão não encontrada para reiniciar (conta ${req.params.id}), criando nova...`);
            const account = await db.getAccount(req.params.id);
            if (!account) {
                return res.status(404).json({ error: 'Conta não encontrada' });
            }
            await sessionManager.createSession(account.id, account.name, { visible: true }); // Restart geralmente implica querer ver o que houve
            res.json({ message: 'Sessão iniciada' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/accounts/:id/qr
 * Obtém QR code da conta
 */
router.get('/:id/qr', (req, res) => {
    try {
        const session = sessionManager.getSession(req.params.id);
        if (!session || !session.qrCode) {
            return res.status(404).json({ error: 'QR Code não disponível' });
        }

        res.json({ qrCode: session.qrCode });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /api/accounts/:id
 * Deleta uma conta
 */
router.delete('/:id', async (req, res) => {
    try {
        // Para sessão se estiver ativa
        await sessionManager.destroySession(req.params.id);

        // Remove do banco
        await db.deleteAccount(req.params.id);

        res.status(204).send();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
