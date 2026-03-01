const express = require('express');
const router = express.Router();
const db = require('../database/DatabaseManager');
const sessionManager = require('../services/SessionManager');
const { firstResponseTemplates, followUpTemplates, groupGreetings } = require('../utils/messageTemplates');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const schedulerManager = require('../services/SchedulerManager');

// Pasta de mídia (relativa à raiz do projeto) — subpastas por categoria
const MEDIA_FOLDER = path.join(__dirname, '..', '..', 'media');
const MEDIA_CATEGORIES = {
    images: { exts: ['.jpg', '.jpeg', '.png', '.gif'], label: 'Imagens' },
    videos: { exts: ['.mp4'], label: 'Vídeos' },
    stickers: { exts: ['.webp'], label: 'Figurinhas' },
    audio: { exts: ['.mp3', '.ogg'], label: 'Áudio' },
    docs: { exts: ['.pdf', '.doc', '.docx'], label: 'Documentos' },
    vcards: { exts: ['.vcf'], label: 'vCards' }
};

// Cria todas as subpastas
for (const cat of Object.keys(MEDIA_CATEGORIES)) {
    const dir = path.join(MEDIA_FOLDER, cat);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Configuração do multer para upload de mídia — rota dinâmica por categoria
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const cat = req.params.category;
        if (!MEDIA_CATEGORIES[cat]) return cb(new Error('Categoria inválida'));
        cb(null, path.join(MEDIA_FOLDER, cat));
    },
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, unique + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

/**
 * GET /api/accounts
 * Lista todas as contas
 */
router.get('/', async (req, res) => {
    try {
        const [accounts, unsavedCounts] = await Promise.all([
            db.getAllAccounts(),
            db.getUnsavedContactsCount()
        ]);

        // Mescla com dados da sessão (qrCode, etc)
        const accountsWithSession = await Promise.all(accounts.map(async (account) => {
            const session = sessionManager.getSession(account.id);
            if (session) {
                const sessionInfo = await session.getInfo();
                return {
                    ...account,
                    ...sessionInfo, // Fornecer isPaused e outras estatisticas
                    unsaved_contacts: sessionInfo.unsavedContactsCount !== undefined ? sessionInfo.unsavedContactsCount : (unsavedCounts[account.id] || 0),
                    qrCode: sessionInfo.qrCode,
                    status: sessionInfo.isPaused ? 'paused' : sessionInfo.status // Força o Status PAUSED a sobrepor na UI
                };
            }
            return {
                ...account,
                unsaved_contacts: unsavedCounts[account.id] || 0
            };
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

// ROTA DE DIAGNÓSTICO TEMPORÁRIA
router.get('/:id/debug-chats', async (req, res) => {
    try {
        const session = sessionManager.getSession(req.params.id);
        if (!session || session.status !== 'ready' || !session.client) {
            return res.json({ error: 'Sessão não pronta', status: session?.status });
        }
        const chats = await session.client.getChats();
        const sample = chats.slice(0, 15).map(c => ({
            isGroup: c.isGroup,
            isBroadcast: c.isBroadcast,
            idServer: c.id?.server,
            idUser: c.id?.user,
            name: c.name,
            serialized: c.id?._serialized
        }));
        res.json({ total: chats.length, sample });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /api/accounts/:id/unsaved-vcard
 * Exporta contatos de conversas individuais - abordagem hibrida robusta
 */
router.get('/:id/unsaved-vcard', async (req, res) => {
    try {
        const session = sessionManager.getSession(req.params.id);
        if (!session || session.status !== 'ready' || !session.client) {
            return res.status(400).send('Sessão do WhatsApp não está pronta. Conecte a conta primeiro.');
        }

        const chats = await session.client.getChats();

        // Filtra chats privados (nao grupos, nao broadcast)
        const privateChats = chats.filter(chat => !chat.isGroup && chat.id && !chat.id._serialized?.includes('broadcast'));

        const exportList = [];
        const seen = new Set();

        // Extrai apenas digitos de uma string
        const digitsOnly = (str) => (str || '').replace(/[^\d]/g, '');

        // Processa cada chat privado
        for (const chat of privateChats) {
            const chatName = chat.name || '';
            const nameDigits = digitsOnly(chatName);

            // ESTRATEGIA 1: Nome do chat parece um numero de telefone
            // Numeros br: 10 ou 11 digitos. Com codigo pais: 12 ou 13 digitos (55 + 10 ou 11)
            // Se o nome tem so digitos e simbolos de telefone e comprimento certo: e numero
            const hasEnoughDigits = nameDigits.length >= 10 && nameDigits.length <= 15;
            const hasNoLetters = !/[a-zA-Z\u00C0-\u024F]/.test(chatName); // sem letras incluindo acentos

            if (hasEnoughDigits && hasNoLetters) {
                if (!seen.has(nameDigits)) {
                    seen.add(nameDigits);
                    exportList.push({ name: '', phone: nameDigits });
                }
                continue;
            }

            // ESTRATEGIA 2: Contato salvo - tentar via getContact()
            try {
                const contact = await chat.getContact();
                if (contact && !contact.isMe) {
                    const phone = digitsOnly(contact.number);
                    if (phone && phone.length >= 10 && !seen.has(phone)) {
                        seen.add(phone);
                        const name = contact.name || contact.pushname || contact.verifiedName || chatName || '';
                        exportList.push({ name, phone });
                    }
                }
            } catch (e) { /* ignora */ }
        }

        if (exportList.length === 0) {
            return res.status(404).send('Nenhum contato encontrado nos chats.');
        }

        console.log(`[vCard] Exportando ${exportList.length} contatos da conta ${req.params.id}`);

        // Gera o arquivo .vcf com quebras de linha reais (CRLF)
        const CRLF = String.fromCharCode(13, 10);
        const vcardLines = [];
        exportList.forEach(c => {
            vcardLines.push('BEGIN:VCARD');
            vcardLines.push('VERSION:3.0');
            vcardLines.push('FN:' + (c.name || '+' + c.phone));
            vcardLines.push('TEL;TYPE=CELL:+' + c.phone);
            vcardLines.push('END:VCARD');
        });
        const vcardContent = vcardLines.join(CRLF) + CRLF;
        res.setHeader('Content-disposition', `attachment; filename=wpp_contatos_${req.params.id}_${Date.now()}.vcf`);
        res.setHeader('Content-type', 'text/vcard; charset=utf-8');
        res.send(vcardContent);
    } catch (error) {
        console.error('[vCard] Erro:', error.message);
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

        // Se a conta atualizada tem um proxy e tiver sessão rodando, força a verificação de exclusividade
        if ((updated.proxy_group_id || updated.proxy_ip) && session && session.status === 'ready' && !session.isPaused) {
            console.log(`[API] Conta ${updated.id} teve proxy alterado e está ativa, pausando conflitantes...`);
            await schedulerManager.pauseGroupAccounts(updated.proxy_group_id, updated.proxy_ip, updated.proxy_port, updated.id);
        }

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
 * POST /api/accounts/:id/messages/seed
 * Insere as mensagens padrão do bot para a conta
 */
router.post('/:id/messages/seed', async (req, res) => {
    try {
        const accountId = req.params.id;
        const { force } = req.body;

        const existing = await db.getAccountMessages(accountId);
        if (existing.length > 0 && !force) {
            return res.json({ inserted: 0, skipped: true, message: 'Já possui mensagens.' });
        }

        if (force) {
            for (const msg of existing) {
                await db.deleteAccountMessage(msg.id);
            }
        }

        let inserted = 0;

        for (const text of firstResponseTemplates) {
            await db.addAccountMessage(accountId, 'first', `Oi {nome}! ${text}`);
            inserted++;
        }

        for (const text of followUpTemplates) {
            await db.addAccountMessage(accountId, 'followup', text);
            inserted++;
        }

        const groupMessages = [
            'Olá galera! {nome} aqui, bora trocar uma ideia no privado! 💬🔥',
            'E aí pessoal! Me chama no privado, vamos papear! 🗣️📲',
            'Fala turma! Quem quiser trocar uma ideia é só chamar no privado! 💌',
            'Salve galera! Me chama no privado que a conversa vai ser boa! 😎💬',
            'Opa pessoal! Privado liberado, bora bater papo! 🚀📱',
            'E aí time! Me manda mensagem no privado, tô esperando! ⏳💬',
            'Olá membros! Vamos conversar no privado, só chegar! 🚶‍♂️💬',
            'Fala grupo! Chama no privado que a resenha vai ser boa! 🔥📩'
        ];
        for (const text of groupMessages) {
            await db.addAccountMessage(accountId, 'group', text);
            inserted++;
        }

        res.json({ inserted, message: `${inserted} mensagens padrão inseridas!` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/accounts/media/library
 * Lista todos os arquivos agrupados por categoria
 */
router.get('/media/library', (req, res) => {
    try {
        const library = {};
        for (const [cat, meta] of Object.entries(MEDIA_CATEGORIES)) {
            const dir = path.join(MEDIA_FOLDER, cat);
            if (!fs.existsSync(dir)) { library[cat] = []; continue; }
            library[cat] = fs.readdirSync(dir).map(name => {
                const stat = fs.statSync(path.join(dir, name));
                return { name, size: stat.size, modified: stat.mtime };
            });
        }
        res.json(library);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Retrocompatibilidade — lista flat (antigo)
router.get('/media/list', (req, res) => {
    try {
        const all = [];
        for (const cat of Object.keys(MEDIA_CATEGORIES)) {
            const dir = path.join(MEDIA_FOLDER, cat);
            if (!fs.existsSync(dir)) continue;
            fs.readdirSync(dir).forEach(name => {
                const stat = fs.statSync(path.join(dir, name));
                all.push({ name, category: cat, size: stat.size, modified: stat.mtime });
            });
        }
        res.json(all);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/accounts/media/upload/:category
 * Upload multi-arquivo para categoria específica
 */
router.post('/media/upload/:category', (req, res) => {
    if (!MEDIA_CATEGORIES[req.params.category]) {
        return res.status(400).json({ error: 'Categoria inválida' });
    }
    upload.any()(req, res, (err) => {
        if (err) {
            console.error('Multer error:', err.message);
            return res.status(400).json({ error: err.message });
        }
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado' });
        }
        const uploaded = req.files.map(f => ({
            name: f.filename, originalName: f.originalname, size: f.size
        }));
        res.json({ uploaded, count: uploaded.length });
    });
});

/**
 * DELETE /api/accounts/media/clear/:category
 * Deleta TODOS os arquivos de uma categoria
 */
router.delete('/media/clear/:category', (req, res) => {
    try {
        const { category } = req.params;
        if (!MEDIA_CATEGORIES[category]) return res.status(400).json({ error: 'Categoria inválida' });
        const dir = path.join(MEDIA_FOLDER, category);
        if (!fs.existsSync(dir)) return res.json({ deleted: 0 });
        const files = fs.readdirSync(dir).filter(f => !f.startsWith('.'));
        files.forEach(f => fs.unlinkSync(path.join(dir, f)));
        res.json({ deleted: files.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /api/accounts/media/:category/:filename
 * Deleta arquivo de categoria
 */
router.delete('/media/:category/:filename', (req, res) => {
    try {
        const { category, filename } = req.params;
        if (!MEDIA_CATEGORIES[category]) return res.status(400).json({ error: 'Categoria inválida' });
        const filePath = path.join(MEDIA_FOLDER, category, filename);
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Arquivo não encontrado' });
        const resolved = path.resolve(filePath);
        if (!resolved.startsWith(path.resolve(MEDIA_FOLDER))) {
            return res.status(403).json({ error: 'Acesso negado' });
        }
        fs.unlinkSync(filePath);
        res.status(204).send();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Retrocompatibilidade — delete antigo (flat)
router.delete('/media/:filename', (req, res) => {
    try {
        // Procura o arquivo em todas as categorias
        for (const cat of Object.keys(MEDIA_CATEGORIES)) {
            const filePath = path.join(MEDIA_FOLDER, cat, req.params.filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                return res.status(204).send();
            }
        }
        return res.status(404).json({ error: 'Arquivo não encontrado' });
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

        // Se sessão já existe e está pronta, não destrói
        const existingSession = sessionManager.getSession(account.id);
        if (existingSession) {
            if (existingSession.status === 'ready') {
                console.log(`[API] Sessão já está ativa para conta ${account.id}`);
                return res.json({ message: 'Sessão já está ativa' });
            }
            // Destrói só se não estiver pronta (ex: em erro, qr pendente)
            console.log(`[API] Destruindo sessão em estado ${existingSession.status} para conta ${account.id}`);
            await sessionManager.destroySession(account.id, { intentional: true, clearAuth: false });
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        // Verificação de Conflito de Proxy
        if (account.proxy_ip && account.proxy_port) {
            const allAccounts = await db.getAllAccounts();
            const conflictingAccount = allAccounts.find(a =>
                a.id !== account.id &&
                a.proxy_ip === account.proxy_ip &&
                a.proxy_port === account.proxy_port
            );

            if (conflictingAccount) {
                // Checar se a sessão da conta conflitante está ativa no momento (sem estar pausada)
                const conflictingSession = sessionManager.getSession(conflictingAccount.id);
                // Bloqueia qualquer sessão que exista e não esteja pausada/desconectada intencionalmente
                if (conflictingSession && !conflictingSession.isPaused && conflictingSession.status !== 'disconnected') {
                    console.log(`[API] Conta ${account.id} bloqueada: O Proxy ${account.proxy_ip}:${account.proxy_port} já está em uso pela conta ${conflictingAccount.id} (${conflictingAccount.name}). (Status atual: ${conflictingSession.status})`);
                    return res.status(409).json({
                        error: `🚨 ATENÇÃO!\nO Proxy que você tentou usar já está ATIVO na conta "${conflictingAccount.name}".\n\nDesconecte a outra ou mude o Proxy para iniciar!`
                    });
                }
            }
        }

        // Usa o SchedulerManager para ativação segura (verifica Proxies conflitantes antes)
        console.log(`[API] Solicitando inicialização via SchedulerManager para conta ${account.id}`);
        await schedulerManager.activateAccount(account);
        console.log(`[API] Comando de Sessão enviado para conta ${account.id}`);

        res.json({ message: 'Sessão iniciada/agendada' });
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
        // Parada intencional: preserva token, não reconecta
        await sessionManager.destroySession(req.params.id, { intentional: true, clearAuth: false });
        res.json({ message: 'Sessão encerrada' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/accounts/:id/pause
 * Coloca a sessão da conta em modo Pausa (Standby manual sem desconexão web)
 */
router.post('/:id/pause', async (req, res) => {
    try {
        const session = sessionManager.getSession(req.params.id);
        if (session) {
            console.log(`[API] Pausando conta e Desconectando WAN: ${req.params.id}`);
            await session.pause();

            // Força atualização no React
            const webServer = req.app.get('webServer');
            if (webServer) webServer.broadcastUpdate();

            res.json({ message: 'Conta em modo Standby e Rede Isolada' });
        } else {
            return res.status(404).json({ error: 'Nenhuma sessão ativa encontrada' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/accounts/:id/resume
 * Retira a sessão da Pausa
 */
router.post('/:id/resume', async (req, res) => {
    try {
        const account = await db.getAccount(req.params.id);
        const session = sessionManager.getSession(req.params.id);

        if (session && account) {
            console.log(`[API] Retomando conta via SchedulerManager: ${req.params.id}`);
            await schedulerManager.activateAccount(account);

            // Força atualização no React
            const webServer = req.app.get('webServer');
            if (webServer) webServer.broadcastUpdate();

            res.json({ message: 'Conta retomou o Serviço com internet (Sujeito a Wait do IP)' });
        } else {
            return res.status(404).json({ error: 'Nenhuma sessão ativa encontrada ou Conta Inexistente' });
        }
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
        // Ao deletar: faz logout para apagar token de autenticação
        await sessionManager.destroySession(req.params.id, { intentional: true, clearAuth: true });

        // Remove do banco
        await db.deleteAccount(req.params.id);

        res.status(204).send();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
