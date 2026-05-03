const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const { HttpsProxyAgent } = require('https-proxy-agent');
const axios = require('axios');
const pino = require('pino');
const {
    default: makeWASocket,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers
} = require('@whiskeysockets/baileys');

const logger = require('../utils/logger');
const db = require('../database/DatabaseManager');
const { usePostgresAuthState } = require('./baileysAuthState');

const baileysLogger = pino({ level: process.env.BAILEYS_LOG_LEVEL || 'silent' });

function normalizeJid(jid) {
    if (!jid) return jid;
    if (jid.endsWith('@c.us')) return jid.replace('@c.us', '@s.whatsapp.net');
    return jid;
}

function unwrapMessage(m) {
    if (!m) return m;
    if (m.ephemeralMessage && m.ephemeralMessage.message) return unwrapMessage(m.ephemeralMessage.message);
    if (m.viewOnceMessage && m.viewOnceMessage.message) return unwrapMessage(m.viewOnceMessage.message);
    if (m.viewOnceMessageV2 && m.viewOnceMessageV2.message) return unwrapMessage(m.viewOnceMessageV2.message);
    if (m.viewOnceMessageV2Extension && m.viewOnceMessageV2Extension.message) return unwrapMessage(m.viewOnceMessageV2Extension.message);
    if (m.documentWithCaptionMessage && m.documentWithCaptionMessage.message) return unwrapMessage(m.documentWithCaptionMessage.message);
    return m;
}

function extractText(msg) {
    if (!msg || !msg.message) return '';
    const m = unwrapMessage(msg.message);
    if (!m) return '';
    if (m.conversation) return m.conversation;
    if (m.extendedTextMessage && m.extendedTextMessage.text) return m.extendedTextMessage.text;
    if (m.imageMessage && m.imageMessage.caption) return m.imageMessage.caption;
    if (m.videoMessage && m.videoMessage.caption) return m.videoMessage.caption;
    if (m.documentMessage && m.documentMessage.caption) return m.documentMessage.caption;
    if (m.buttonsResponseMessage && m.buttonsResponseMessage.selectedDisplayText) return m.buttonsResponseMessage.selectedDisplayText;
    if (m.listResponseMessage && m.listResponseMessage.title) return m.listResponseMessage.title;
    if (m.templateButtonReplyMessage && m.templateButtonReplyMessage.selectedDisplayText) return m.templateButtonReplyMessage.selectedDisplayText;
    return '';
}

function hasMediaIn(msg) {
    if (!msg || !msg.message) return false;
    const m = unwrapMessage(msg.message);
    return !!(m && (m.imageMessage || m.videoMessage || m.audioMessage || m.documentMessage || m.stickerMessage));
}

function mediaTypeFromExt(filename) {
    const ext = path.extname(filename).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) {
        return ext === '.webp' ? 'sticker' : 'image';
    }
    if (['.mp4', '.mov', '.3gp'].includes(ext)) return 'video';
    if (['.mp3', '.ogg', '.m4a', '.wav'].includes(ext)) return 'audio';
    if (ext === '.vcf') return 'vcard';
    return 'document';
}

/**
 * Sessão WhatsApp via Baileys (sem Chrome/Puppeteer).
 * Mantém a mesma superfície pública usada por SessionManager,
 * MessageHandler, DispatchEngine e DispatchAutoReply.
 */
class WhatsAppSession extends EventEmitter {
    constructor(accountId, accountName, config, tenantId = null) {
        super();
        this.accountId = accountId;
        this.accountName = accountName;
        this.tenantId = tenantId;
        this.sock = null;
        this.status = 'disconnected';
        this.qrCode = null;
        this.qrTimestamp = null;
        this.publicIP = null;
        this.isp = null;
        this.country = null;
        this.city = null;
        this._authState = null;
        this._reconnectTimer = null;
        this._intentionalClose = false;
        this._self = { id: null, user: null, name: null };

        this.config = {
            proxy_enabled: config.proxy_enabled || false,
            proxy_ip: config.proxy_ip,
            proxy_port: config.proxy_port,
            proxy_username: config.proxy_username,
            proxy_password: config.proxy_password,
            min_read_delay: config.min_read_delay || 3000,
            max_read_delay: config.max_read_delay || 15000,
            min_typing_delay: config.min_typing_delay || 5000,
            max_typing_delay: config.max_typing_delay || 20000,
            min_response_delay: config.min_response_delay || 10000,
            max_response_delay: config.max_response_delay || 30000,
            min_message_interval: config.min_message_interval || 20000,
            ignore_probability: config.ignore_probability || 20,
            media_enabled: config.media_enabled !== undefined ? config.media_enabled : true,
            media_interval: config.media_interval || 2,
            global_private_delay_minutes: config.global_private_delay_minutes != null ? config.global_private_delay_minutes : 2,
            global_group_delay_minutes:   config.global_group_delay_minutes   != null ? config.global_group_delay_minutes   : 2
        };

        this.stats = {
            messagesSent: 0,
            messagesReceived: 0,
            uniqueContacts: new Set(),
            startTime: null,
            lastActivity: null
        };

        // Dedup de message ids (append + notify após reconnect entregam o mesmo msg.id duplicado).
        // Ring buffer simples: Set + array LIFO pra manter os últimos N ids.
        this._seenMsgIds = new Set();
        this._seenMsgOrder = [];
        this._seenMsgCap = 200;

        this.runtimeOptions = {};

        // Compat com código legado que lia `session.client.info.wid.user`.
        this.client = {
            info: { wid: { user: null } },
            sendMessage: (jid, content, opts) => this._sendCompat(jid, content, opts),
            getChats: async () => []
        };
    }

    setRuntimeOptions(options) {
        this.runtimeOptions = { ...this.runtimeOptions, ...options };
    }

    updateConfig(newConfig) {
        Object.assign(this.config, newConfig);
        logger.info(this.accountName, 'Configuração atualizada');
    }

    getProxyUrl() {
        if (!this.config.proxy_enabled) return null;
        const { proxy_ip, proxy_port, proxy_username, proxy_password } = this.config;
        if (!proxy_ip || !proxy_port) return null;
        if (proxy_username && proxy_password) {
            return `http://${proxy_username}:${proxy_password}@${proxy_ip}:${proxy_port}`;
        }
        return `http://${proxy_ip}:${proxy_port}`;
    }

    async initialize() {
        try {
            this.status = 'initializing';
            this._intentionalClose = false;

            if (this.config.proxy_enabled) {
                logger.info(this.accountName, `Validando proxy ${this.config.proxy_ip}:${this.config.proxy_port}...`);
                const ok = await this.validateProxyConnection();
                if (!ok) {
                    this.status = 'error';
                    throw new Error('Falha ao conectar no Proxy. Verifique IP, Porta e Credenciais.');
                }
                logger.info(this.accountName, `✅ Proxy validado! IP: ${this.publicIP}`);
            } else {
                await this.detectPublicIP();
                logger.info(this.accountName, `Usando conexão direta. IP: ${this.publicIP}`);
            }

            const proxyUrl = this.getProxyUrl();
            const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

            const tdb = db.tenant(this.tenantId);
            this._authState = await usePostgresAuthState(tdb, this.accountId);

            const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

            this.sock = makeWASocket({
                version,
                auth: this._authState.state,
                logger: baileysLogger,
                printQRInTerminal: false,
                browser: Browsers.macOS('Desktop'),
                syncFullHistory: false,
                generateHighQualityLinkPreview: false,
                markOnlineOnConnect: false,
                agent,
                fetchAgent: agent
            });

            this.sock.ev.on('creds.update', this._authState.saveCreds);
            this.sock.ev.on('connection.update', (u) => this._onConnectionUpdate(u));
            this.sock.ev.on('messages.upsert', (u) => this._onMessagesUpsert(u));

            logger.info(this.accountName, 'Cliente Baileys inicializado, aguardando conexão...');
        } catch (error) {
            logger.error(this.accountName, `Erro fatal na inicialização: ${error.message}`);
            this.status = 'error';
            this.emit('error', error);
            throw error;
        }
    }

    async _onConnectionUpdate(update) {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            this.status = 'qr';
            this.qrCode = qr;
            this.qrTimestamp = Date.now();
            logger.info(this.accountName, 'QR Code gerado');
            this.emit('qr', qr);
        }

        if (connection === 'connecting') {
            // Só marca 'connecting' se ainda não conectou. Baileys oscila durante reconexões
            // internas — não queremos derrubar o status 'ready' que destrava sendMessage.
            if (this.status !== 'ready') this.status = 'connecting';
            logger.info(this.accountName, 'Baileys: connecting...');
        }

        if (connection === 'open') {
            this.status = 'ready';
            this.qrCode = null;
            this.qrTimestamp = null;
            this.stats.startTime = Date.now();
            this.stats.lastActivity = Date.now();

            const me = this.sock.user || {};
            const userPart = (me.id || '').split(':')[0].split('@')[0];
            this._self = { id: me.id, user: userPart, name: me.name || me.verifiedName || me.notify || null };
            this.client.info.wid.user = userPart;
            this.client.info.pushname = this._self.name;

            logger.info(this.accountName, `Conectado como: ${this._self.name || 'sem nome'} (${userPart})`);

            // emite no formato esperado pelo SessionManager (info.wid.user)
            this.emit('authenticated');
            this.emit('ready', { wid: { user: userPart }, pushname: this._self.name });
        }

        if (connection === 'close') {
            const reason = lastDisconnect && lastDisconnect.error
                ? (lastDisconnect.error.output && lastDisconnect.error.output.statusCode) || lastDisconnect.error.message
                : 'unknown';
            const loggedOut = reason === DisconnectReason.loggedOut;

            this.status = loggedOut ? 'logged_out' : 'disconnected';
            logger.warn(this.accountName, `Conexão fechada (reason=${reason})`);
            this.emit('disconnected', String(reason));

            if (loggedOut) {
                logger.warn(this.accountName, 'Sessão deslogada — limpando credenciais persistidas');
                try { if (this._authState) await this._authState.clearAll(); } catch (_) {}
                return;
            }

            if (!this._intentionalClose) {
                if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
                this._reconnectTimer = setTimeout(() => this.reconnect(), 5000);
            }
        }
    }

    _markMsgSeen(id) {
        if (!id) return false;
        if (this._seenMsgIds.has(id)) return true;
        this._seenMsgIds.add(id);
        this._seenMsgOrder.push(id);
        if (this._seenMsgOrder.length > this._seenMsgCap) {
            const old = this._seenMsgOrder.shift();
            this._seenMsgIds.delete(old);
        }
        return false;
    }

    _adaptBaileysMessage(m) {
        return {
            from: m.key.remoteJid,
            body: extractText(m),
            pushName: m.pushName || null,
            participant: m.key.participant || null,
            timestamp: typeof m.messageTimestamp === 'number' ? m.messageTimestamp : Number(m.messageTimestamp || 0),
            hasMedia: hasMediaIn(m),
            _raw: m
        };
    }

    async _onMessagesUpsert({ messages, type }) {
        logger.info(this.accountName, `📥 messages.upsert (type=${type}, count=${messages ? messages.length : 0})`);
        if (type !== 'notify' && type !== 'append') {
            logger.debug(this.accountName, `⏭️  ignorando upsert type=${type}`);
            return;
        }

        const HORIZON_SEC = 24 * 60 * 60; // 24h pra histórico
        const nowSec = Math.floor(Date.now() / 1000);
        let emitted = 0;

        for (const m of messages) {
            if (!m || !m.message) {
                logger.debug(this.accountName, '⏭️  msg sem .message (provável protocol/notification)');
                continue;
            }
            if (m.key && m.key.fromMe) {
                logger.debug(this.accountName, `⏭️  fromMe (jid=${m.key.remoteJid})`);
                continue;
            }
            // Dedup append+notify
            const seen = this._markMsgSeen(m.key && m.key.id);
            if (seen) {
                logger.debug(this.accountName, `⏭️  msg id já vista: ${m.key.id}`);
                continue;
            }
            // Janela de 24h só pra histórico (append)
            if (type === 'append' && m.messageTimestamp && (nowSec - Number(m.messageTimestamp)) > HORIZON_SEC) {
                logger.debug(this.accountName, `⏭️  append antigo ignorado (jid=${m.key.remoteJid})`);
                continue;
            }

            const adapted = this._adaptBaileysMessage(m);
            logger.info(this.accountName,
                `📨 [${type}] ${adapted.from} pushName="${adapted.pushName}" body="${(adapted.body || '').slice(0, 60)}" hasMedia=${adapted.hasMedia}`);
            this.stats.messagesReceived++;
            this.stats.lastActivity = Date.now();
            this.stats.uniqueContacts.add(adapted.from);
            this.emit('message', adapted);
            emitted++;
        }

        if (type === 'append') {
            logger.info(this.accountName, `📜 histórico: ${messages.length} msgs sync, ${emitted} entregues à fila`);
        }
    }

    /**
     * Marca uma mensagem como lida (ticket azul).
     * Aceita o objeto Baileys completo OU só a `key`.
     */
    async markRead(keyOrMsg) {
        if (!this.sock) return;
        const key = keyOrMsg && keyOrMsg.key ? keyOrMsg.key : keyOrMsg;
        if (!key || !key.remoteJid) return;
        try {
            await this.sock.readMessages([key]);
        } catch (e) {
            logger.warn(this.accountName, `markRead falhou: ${e.message}`);
        }
    }

    async reconnect() {
        try {
            logger.info(this.accountName, 'Reconectando...');
            if (this.sock) {
                try { this.sock.ev.removeAllListeners(); } catch (_) {}
                try { this.sock.end(undefined); } catch (_) {}
                this.sock = null;
            }
            await this.initialize();
        } catch (error) {
            logger.error(this.accountName, `Erro ao reconectar: ${error.message}`);
            if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
            this._reconnectTimer = setTimeout(() => this.reconnect(), 30000);
        }
    }

    _ensureReady() {
        if (!this.sock) throw new Error('Cliente não está pronto (sem socket)');
        if (this.status !== 'ready') throw new Error(`Cliente não está pronto (status=${this.status})`);
    }

    async _sendCompat(jid, content, opts = {}) {
        // compat para chamadas legadas no formato whatsapp-web.js:
        // session.client.sendMessage(to, media, { caption })
        if (typeof content === 'string') return this.sendMessage(jid, content);
        if (content && typeof content === 'object') {
            // objeto Baileys já formatado
            if (content.image || content.video || content.audio || content.document || content.sticker || content.text) {
                this._ensureReady();
                return this.sock.sendMessage(normalizeJid(jid), content);
            }
            // objeto MessageMedia legado (mediaPath em filePath)
            if (content.filePath || content.path) {
                return this.sendMedia(jid, content.filePath || content.path, opts.caption);
            }
        }
        throw new Error('Formato de mensagem não suportado em sendMessage compat');
    }

    async sendMessage(to, content) {
        this._ensureReady();
        const jid = normalizeJid(to);
        if (typeof content === 'string') {
            await this.sock.sendMessage(jid, { text: content });
        } else {
            await this.sock.sendMessage(jid, content);
        }
        this.stats.messagesSent++;
        this.stats.lastActivity = Date.now();
        this.emit('message:sent');
    }

    async sendMedia(to, mediaOrPath, caption) {
        this._ensureReady();
        const jid = normalizeJid(to);
        const filePath = typeof mediaOrPath === 'string'
            ? mediaOrPath
            : (mediaOrPath && (mediaOrPath.filePath || mediaOrPath.path));
        if (!filePath || !fs.existsSync(filePath)) {
            throw new Error(`Arquivo de mídia não encontrado: ${filePath}`);
        }
        const buf = fs.readFileSync(filePath);
        const filename = path.basename(filePath);
        const kind = mediaTypeFromExt(filename);

        // fileName aleatório a cada envio: disfarça reenvio do mesmo arquivo.
        const ext = path.extname(filename).toLowerCase();
        const randomFileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;

        // Mimetype correto por extensão
        const audioMime =
            ext === '.ogg' ? 'audio/ogg; codecs=opus' :
            ext === '.m4a' ? 'audio/mp4' :
            ext === '.wav' ? 'audio/wav' :
            'audio/mpeg'; // mp3 default

        let payload;
        switch (kind) {
            case 'image':   payload = { image: buf, caption: caption || undefined, fileName: randomFileName }; break;
            case 'video':   payload = { video: buf, caption: caption || undefined, fileName: randomFileName }; break;
            // PTT (voice note): aparece com a foto do perfil + waveform, sem nome de arquivo.
            // SEM fileName no payload — PTT não exibe nome.
            case 'audio':   payload = { audio: buf, mimetype: audioMime, ptt: true }; break;
            case 'sticker': payload = { sticker: buf, fileName: randomFileName }; break;
            case 'vcard':   payload = { document: buf, mimetype: 'text/vcard', fileName: randomFileName }; break;
            default:        payload = { document: buf, mimetype: 'application/octet-stream', fileName: randomFileName, caption: caption || undefined };
        }

        const aliasLabel = kind === 'audio' ? `(PTT, mime=${audioMime})` : `(alias=${randomFileName})`;
        logger.info(this.accountName, `🎵 mídia → ${jid}: ${filename} (kind=${kind}) ${aliasLabel}`);

        await this.sock.sendMessage(jid, payload);
        this.stats.messagesSent++;
        this.stats.lastActivity = Date.now();
        this.emit('message:sent');
    }

    /**
     * Compat: retorna um proxy de "chat" com sendSeen / sendStateTyping.
     * Resolve nome de grupo via groupMetadata quando aplicável.
     */
    async getChat(chatId) {
        const jid = normalizeJid(chatId);
        const sock = this.sock;
        const accountName = this.accountName;
        const isGroup = jid.endsWith('@g.us');

        let groupName = null;
        if (isGroup) {
            try {
                const meta = await sock.groupMetadata(jid);
                groupName = (meta && meta.subject) || null;
            } catch (_) {}
        }

        return {
            id: { _serialized: jid },
            name: groupName,
            isGroup,
            sendSeen: async () => {
                try { await sock.sendPresenceUpdate('available', jid); } catch (_) {}
            },
            sendStateTyping: async () => {
                try { await sock.sendPresenceUpdate('composing', jid); } catch (_) {}
            },
            sendStateRecording: async () => {
                try { await sock.sendPresenceUpdate('recording', jid); } catch (_) {}
            },
            clearState: async () => {
                try { await sock.sendPresenceUpdate('paused', jid); } catch (_) {}
            },
            fetchMessages: async () => []
        };
    }

    /**
     * Compat: retorna um "contato" superficial.
     */
    async getContact(contactId) {
        const jid = normalizeJid(contactId);
        const number = jid.split('@')[0];
        let pushname = null;
        try {
            // Não há getContactById direto; usa store fictício/null
            const onWhats = await this.sock.onWhatsApp(number).catch(() => null);
            if (onWhats && onWhats[0]) pushname = onWhats[0].verifiedName || null;
        } catch (_) {}
        return {
            id: { _serialized: jid, user: number },
            number,
            pushname,
            name: null
        };
    }

    async validateProxyConnection() {
        try {
            const proxyUrl = this.getProxyUrl();
            if (!proxyUrl) return false;
            const agent = new HttpsProxyAgent(proxyUrl);
            const response = await axios.get('http://ip-api.com/json/', {
                httpAgent: agent, httpsAgent: agent, timeout: 10000
            });
            if (response.data && response.data.query) {
                this.publicIP = response.data.query;
                this.isp = response.data.isp || response.data.org || 'Desconhecido';
                this.country = response.data.country || null;
                this.city = response.data.city || null;
                logger.info(this.accountName, `Proxy validado. IP: ${this.publicIP} - ISP: ${this.isp}`);
                return true;
            }
            return false;
        } catch (error) {
            logger.error(this.accountName, `Erro validação proxy: ${error.message}`);
            return false;
        }
    }

    async detectPublicIP() {
        try {
            const response = await axios.get('http://ip-api.com/json/', { timeout: 10000 });
            if (response.data && response.data.status === 'success') {
                this.publicIP = response.data.query;
                this.isp = response.data.isp || response.data.org || 'Desconhecido';
                this.country = response.data.country;
                this.city = response.data.city;
            }
        } catch (error) {
            logger.warn(this.accountName, `Não foi possível detectar IP público: ${error.message}`);
        }
    }

    async getInfo() {
        const QRCode = require('qrcode');
        let qrCodeImage = null;
        if (this.qrCode) {
            try { qrCodeImage = await QRCode.toDataURL(this.qrCode); } catch (_) {}
        }
        return {
            accountId: this.accountId,
            accountName: this.accountName,
            status: this.status,
            qrCode: qrCodeImage,
            qrTimestamp: this.qrTimestamp,
            publicIP: this.publicIP,
            isp: this.isp,
            proxy: this.config.proxy_enabled ? { ip: this.config.proxy_ip, port: this.config.proxy_port } : null,
            config: this.config,
            stats: {
                messagesSent: this.stats.messagesSent,
                messagesReceived: this.stats.messagesReceived,
                uniqueContacts: this.stats.uniqueContacts.size,
                uptime: this.stats.startTime ? Date.now() - this.stats.startTime : 0,
                lastActivity: this.stats.lastActivity
            }
        };
    }

    async destroy() {
        try {
            this._intentionalClose = true;
            if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
            if (this.sock) {
                try { this.sock.ev.removeAllListeners(); } catch (_) {}
                try { await this.sock.logout().catch(() => {}); } catch (_) {}
                try { this.sock.end(undefined); } catch (_) {}
                this.sock = null;
            }
            this.status = 'destroyed';
            this.qrCode = null;
            logger.success(this.accountName, 'Sessão destruída');
        } catch (error) {
            logger.error(this.accountName, `Erro ao destruir sessão: ${error.message}`);
            this.status = 'destroyed';
        }
    }
}

module.exports = WhatsAppSession;
