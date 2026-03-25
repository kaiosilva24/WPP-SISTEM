const EventEmitter = require('events');
const { makeWASocket, DisconnectReason, Browsers, fetchLatestBaileysVersion, isJidGroup } = require('@whiskeysockets/baileys');
const usePostgresAuthState = require('./PostgresBaileysAuth');
const dbManager = require('../database/DatabaseManager');
const logger = require('../utils/logger');
const { HttpsProxyAgent } = require('https-proxy-agent');
const MessageHandler = require('./MessageHandler');
const axios = require('axios');

// Fila global para inicialização suave, evitando saltos de IO no banco
let globalInitPromise = Promise.resolve();

// Cache local superleve p/ manter compatibilidade com rotas frontend (/vcard, /groups)
function createSimpleStore() {
    return {
        chats: {},
        contacts: {},
        groupMetadata: {},
        bind: function(ev) {
            ev.on('chats.set', ({ chats }) => {
                for (const c of chats) this.chats[c.id] = c;
            });
            ev.on('chats.upsert', chats => {
                for (const c of chats) this.chats[c.id] = { ...(this.chats[c.id] || {}), ...c };
            });
            ev.on('contacts.upsert', contacts => {
                for (const c of contacts) this.contacts[c.id] = { ...(this.contacts[c.id] || {}), ...c };
            });
            ev.on('messaging-history.set', ({ chats, contacts }) => {
                for (const c of chats) this.chats[c.id] = c;
                for (const c of contacts) this.contacts[c.id] = c;
            });
            ev.on('groups.upsert', groups => {
                for (const g of groups) this.groupMetadata[g.id] = g;
            });
        }
    };
}

class WhatsAppSession extends EventEmitter {
    constructor(account) {
        super();
        this.accountId = account.id;
        this.accountName = account.name;
        this.status = account.status || 'disconnected';
        this.config = account;
        this.isPaused = false;
        
        // Registra o ID mapeado ao nome para garantir Logs em tempo real via Socket.IO
        logger.setAccountId(this.accountName, this.accountId);

        this.client = null; // Socket do Baileys
        this.store = null;
        
        this.qrCode = null;
        this.qrTimestamp = null;
        this.publicIP = '127.0.0.1'; // Para proxy IP info
        this.isp = 'ISP Oculto';
        
        this._reconnectAttempts = 0;
        this.isInitializing = false;
        this.intentionalStop = false;
        
        // Stats estruturado igual à DB
        this.stats = {
            uptimeStart: Date.now(),
            messagesSent: 0,
            messagesReceived: 0,
            uniqueContacts: new Set(),
            lastActivity: Date.now(),
            privText: 0, privImage: 0, privAudio: 0, privSticker: 0,
            groupText: 0, groupImage: 0, groupAudio: 0, groupSticker: 0
        };
        this.unsavedContactsCount = 0;
        
        this._saveDBStatsInterval = setInterval(() => this.flushStatsToDB(), 60000);
    }

    async flushStatsToDB() {
        if (!this.stats.messagesSent && !this.stats.messagesReceived) return;
        try {
            await dbManager.updateStats(this.accountId, {
                messages_sent: this.stats.messagesSent,
                messages_received: this.stats.messagesReceived,
                unique_contacts: this.stats.uniqueContacts.size,
                priv_text: this.stats.privText, priv_image: this.stats.privImage, priv_audio: this.stats.privAudio, priv_sticker: this.stats.privSticker,
                group_text: this.stats.groupText, group_image: this.stats.groupImage, group_audio: this.stats.groupAudio, group_sticker: this.stats.groupSticker
            });
            // Reset diário de count na RAM (já está totalizado no BD)
            this.stats.messagesSent = 0;
            this.stats.messagesReceived = 0;
            this.stats.privText = 0; this.stats.privImage = 0; this.stats.privAudio = 0; this.stats.privSticker = 0;
            this.stats.groupText = 0; this.stats.groupImage = 0; this.stats.groupAudio = 0; this.stats.groupSticker = 0;
        } catch (e) {
            // silent
        }
    }

    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        logger.info(this.accountName, `🔄 Configuração recarregada em tempo real na sessão.`);
    }

    async getProxyAgent() {
        if (!this.config.proxy_enabled || !this.config.proxy_ip || !this.config.proxy_port) {
            return undefined; // direct connection
        }
        logger.info(this.accountName, `Usando Proxy Nativo (Socket): ${this.config.proxy_ip}:${this.config.proxy_port}`);
        const proxyUrl = this.config.proxy_username && this.config.proxy_password
            ? `http://${this.config.proxy_username}:${this.config.proxy_password}@${this.config.proxy_ip}:${this.config.proxy_port}`
            : `http://${this.config.proxy_ip}:${this.config.proxy_port}`;
        
        // Descobre IP via Axios pela mesma rota para logs frontend
        try {
            const axios = require('axios');
            const res = await axios.get('https://api.ipify.org?format=json', {
                httpsAgent: new HttpsProxyAgent(proxyUrl),
                timeout: 10000
            });
            this.publicIP = res.data.ip;
        } catch (e) {
            logger.warn(this.accountName, `⚠️ Falha ao verificar IP do Proxy: ${e.message}`);
        }
        
        return new HttpsProxyAgent(proxyUrl);
    }

    async initialize(retryCount = 0) {
        if (this.isInitializing) return;
        this.isInitializing = true;
        this.intentionalStop = false;
        
        const myInitPromise = globalInitPromise.then(async () => {
            if (this.status === 'destroyed') return;
            try {
                this.status = 'initializing';
                this.emit('initializing');
                
                await this._connectBaileys();
                
                // Delay Global para não lotar rede/banco
                await new Promise(r => setTimeout(r, 3000));
            } catch (err) {
                logger.error(this.accountName, `Falha na inicialização via Fila: ${err.message}`);
                this.status = 'error';
                setTimeout(() => this.reconnect(), 5000);
            }
        }).catch(err => {
             logger.error(this.accountName, `Erro globalInitPromise: ${err.message}`);
        }).finally(() => {
             this.isInitializing = false;
        });
        
        globalInitPromise = myInitPromise;
        return myInitPromise;
    }

    async _connectBaileys() {
        // STORE CUSTOMIZADO: Inicializa e reconecta o micro store de Contatos e Chats p/ UI
        if (!this.store) {
            this.store = createSimpleStore();
        }

        const agent = await this.getProxyAgent();
        const { state, saveCreds, clearState } = await usePostgresAuthState(this.accountId, dbManager);
        this.clearStateDB = clearState; // expõe para logout manual
        
        const { version } = await fetchLatestBaileysVersion();
        logger.info(this.accountName, `🚀 Subindo Sockets do WhatsApp (Baileys v${version.join('.')})`);
        
        this.client = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            agent: agent,
            browser: Browsers.windows('Desktop'),
            syncFullHistory: false, // Menos poluição em contas aquecidas
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: false // Otimização performance
        });

        // Conecta o cache de contatos
        this.store.bind(this.client.ev);

        // [EVENTOS DO BAILEYS]
        this.client.ev.on('creds.update', saveCreds);

        this.client.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                logger.info(this.accountName, `📱 Novo QR Code gerado!`);
                this.qrCode = qr;
                this.qrTimestamp = Date.now();
                this.status = 'qr';
                this.emit('qr', qr);
            }
            
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                logger.warn(this.accountName, `🔴 Conexão WebSockets fechada. Status: ${statusCode}. Reconectar? ${shouldReconnect}`);
                
                if (shouldReconnect) {
                    this.status = 'disconnected';
                    if (!this.intentionalStop) {
                        setTimeout(() => this.reconnect(), 5000);
                    }
                } else {
                    logger.error(this.accountName, `❌ Aparelho deslogado do WhatsApp (Sessão revogada)!`);
                    this.status = 'disconnected';
                    this.emit('disconnected', 'logged_out');
                    await this.clearStateDB(); // Limpa as credenciais inválidas do PostgreSQL
                    await dbManager.updateAccountStatus(this.accountId, 'disconnected');
                }
            }
            
            if (connection === 'open') {
                logger.info(this.accountName, `✅ Conectado via WebSocket Puro! (0% RAM/CPU do Chrome)🎉`);
                
                // Validação e Print do IP/Provedor
                (async () => {
                    try {
                        const agent = await this.getProxyAgent();
                        const res = await axios.get('http://ip-api.com/json/', {
                            httpAgent: agent,
                            httpsAgent: agent,
                            timeout: 10000
                        });
                        if (res.data && res.data.query) {
                            logger.info(this.accountName, `🌐 ISP WhatsApp Conectado via: ${res.data.query} (Provedor: ${res.data.isp})`);
                        }
                    } catch (err) {
                        logger.warn(this.accountName, `🌐 ISP WhatsApp: Não foi possível obter provedor via IP-API (${err.message}).`);
                    }
                })();

                this.status = this.isPaused ? 'paused' : 'ready';
                // Removemos this.isPaused = false para que a conta não se "despause" sozinha
                // caso o WebSocket caia (ex: por causa de uma rotação de proxy de outra conta) e reconecte.
                this._reconnectAttempts = 0;
                this.qrCode = null;
                await dbManager.updateAccountStatus(this.accountId, this.status);
                
                this.emit('authenticated');
                this.emit('ready', this.client.user);
                
                if (!this.isPaused) {
                    this.startPresenceLoop();
                    this.startStandbyLoop();
                }

                // Varredura de Backlog (Mensagens Não Lidas enquanto estava Offline)
                setTimeout(async () => {
                    if (this.status === 'ready' && this.store?.chats) {
                        try {
                            const chats = Object.values(this.store.chats).filter(c => (c.unreadCount || 0) > 0);
                            if (chats.length > 0) {
                                // Ordena os chats do mais antigo para o mais novo (pelo timestamp do último msg)
                                chats.sort((a, b) => (a.conversationTimestamp || 0) - (b.conversationTimestamp || 0));
                                logger.info(this.accountName, `Sessão ponta e Sincronizada. Iniciando varredura (Bolinhas Verdes)...`);
                                logger.info(this.accountName, `📬 Backlog: ${chats.length} chats com mensagens não lidas. Enfileirando do mais antigo para o mais novo...`);
                                
                                for (const chat of chats) {
                                    // Tenta obter as mensagens em memória desse chat
                                    const msgs = this.store.messages?.[chat.id];
                                    if (msgs && msgs.array && msgs.array.length > 0) {
                                        // Filtra apenas mensagens recebidas (não enviadas pelo bot) e ordena cronologicamente
                                        const unreadMsgs = msgs.array
                                            .filter(m => !m.key?.fromMe)
                                            .sort((a, b) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0));
                                        
                                        if (unreadMsgs.length > 0) {
                                            // Enfileira apenas a mensagem mais antiga do chat — a fila vai agrupá-las automaticamente
                                            // (o campo batchedMessages lida com as demais mensagens do mesmo contato)
                                            const oldestMsg = unreadMsgs[0];
                                            await MessageHandler.handleMessage(this, oldestMsg, true);
                                        }
                                    } else {
                                        // Fallback: não tem msgs em memória — usa a última msg do chat diretamente
                                        if (chat.messages && chat.messages.length > 0) {
                                            const fallbackMsgs = chat.messages
                                                .filter(m => !m.key?.fromMe)
                                                .sort((a, b) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0));
                                            if (fallbackMsgs.length > 0) {
                                                await MessageHandler.handleMessage(this, fallbackMsgs[0], true);
                                            }
                                        }
                                    }
                                }
                                logger.info(this.accountName, `✅ Backlog: ${chats.length} chats enfileirados para resposta (ordem: mais antigo → mais novo).`);
                            } else {
                                logger.info(this.accountName, `Sessão ponta e Sincronizada. Iniciando varredura (Bolinhas Verdes)...`);
                            }
                        } catch (e) {
                            logger.warn(this.accountName, `Erro ao processar Backlog: ${e.message}`);
                        }
                    }
                }, 15000); // 15 Segundos para dar tempo de o Baileys processar o messaging-history.set
            }
        });

        // Handlers de Mensagem
        this.client.ev.on('messages.upsert', async m => {
            if (m.type !== 'notify') return;
            for (const msg of m.messages) {
                try {
                    await MessageHandler.handleMessage(this, msg);
                } catch(e) {
                    logger.error(this.accountName, `Erro processando mensagem no Handler: ${e.message}`);
                }
            }
        });
    }

    /**
     * Equivalente da Extinção local da sessão
     */
    async destroy(clearAuth = false) {
        this.intentionalStop = true;
        this.stopStandbyLoop();
        this.stopPresenceLoop();
        
        if (this.client) {
            try {
                if (clearAuth) {
                    await this.client.logout(); 
                    await this.clearStateDB();
                } else {
                    this.client.end(new Error('Intentional stop'));
                }
            } catch (e) {
                logger.warn(this.accountName, `Aviso ao finalizar Socket: ${e.message}`);
            }
        }
        this.client = null;
        this.status = 'destroyed';
        logger.info(this.accountName, `🛑 Sessão Websocket destruída com sucesso (clearAuth: ${clearAuth})`);
    }

    async reconnect(clearAuth = false) {
        if (this._reconnecting) return;
        this._reconnecting = true;
        logger.info(this.accountName, `🔄 Tentando reconexão...`);
        
        await this.destroy(clearAuth);
        this.status = 'disconnected';
        
        await new Promise(r => setTimeout(r, 2000));
        await this.initialize();
        this._reconnecting = false;
    }

    async pause() {
        this.isPaused = true;
        logger.info(this.accountName, `⏸️ Conta em PAUSA DE AQUECIMENTO (Standby). Derrubando conexão WebSocket para liberar totalmente o IP/Proxy...`);
        await this.destroy(false);
        this.status = 'paused';
        await dbManager.updateAccountStatus(this.accountId, 'paused');
    }

    async resume() {
        this.isPaused = false;
        if (!this.client || this.status === 'destroyed' || this.status === 'disconnected' || this.status === 'paused') {
            logger.info(this.accountName, `▶️ Conta RETOMADA. Subindo conexão WebSocket novamente...`);
            this.status = 'initializing';
            await dbManager.updateAccountStatus(this.accountId, 'initializing');
            this.initialize();
        } else {
            this.status = 'ready';
            this.startPresenceLoop();
            logger.info(this.accountName, `▶️ Conta RETOMADA! Processará filas normalmente.`);
            await dbManager.updateAccountStatus(this.accountId, 'ready');
        }
    }

    /**
     * Interface padronizada para o Frontend listar estatísticas e QR
     */
    async getInfo() {
        let qrCodeImage = null;
        if (this.qrCode) {
            try { qrCodeImage = await QRCode.toDataURL(this.qrCode); } catch (e) {}
        }
        
        // Baileys não precisa de `getChats` pesado, pois temos a Store em memória
        if (this.status === 'ready' && this.store) {
            try {
                // Chats onde o ID não é grupo e parece ser telefone
                this.unsavedContactsCount = Object.values(this.store.chats || {}).filter(chat => {
                    const jid = chat.id;
                    if (isJidGroup(jid) || jid.includes('broadcast') || jid.includes('status')) return false;
                    const contact = this.store.contacts[jid] || {};
                    // Se o nome do contato for número, ele não foi salvo!
                    const chatName = contact.name || contact.notify || chat.name || '';
                    const digits = chatName.replace(/[^\\d]/g, '');
                    return digits.length > 8 && !/[a-zA-Z\\u00C0-\\u024F]/.test(chatName);
                }).length;
            } catch (e) {}
        }

        return {
            accountId: this.accountId,
            accountName: this.accountName,
            status: this.status,
            isPaused: this.isPaused,
            qrCode: qrCodeImage,
            qrTimestamp: this.qrTimestamp,
            publicIP: this.publicIP,
            isp: this.isp,
            proxy: this.config.proxy_enabled ? { ip: this.config.proxy_ip, port: this.config.proxy_port } : null,
            config: this.config,
            unsavedContactsCount: this.unsavedContactsCount,
            stats: this.stats
        };
    }

    async getContact(contactId) {
        if (!this.store) return null;
        return this.store.contacts[contactId] || null;
    }

    /**
     * Funções adaptadas para disparo seguro de Sockets (Presence / Envio Puros)
     */
    async sendPresenceAvailable() {
        if (!this.client || this.status !== 'ready' || this.isPaused) return;
        try {
            await this.client.sendPresenceUpdate('available');
        } catch(e) {}
    }

    startPresenceLoop() {
        this.stopPresenceLoop();
        this.presenceInterval = setInterval(() => this.sendPresenceAvailable(), 30000); // Mais seguro
    }

    stopPresenceLoop() {
        if (this.presenceInterval) clearInterval(this.presenceInterval);
        this.presenceInterval = null;
    }

    startStandbyLoop() {
        this.stopStandbyLoop();
        if (!this.config.standby_enabled) return;
        this.scheduleNextStandby();
    }

    stopStandbyLoop() {
        if (this.standbyTimeout) clearTimeout(this.standbyTimeout);
        this.standbyTimeout = null;
    }

    scheduleNextStandby() {
        if (this.status !== 'ready' || !this.client) return;
        const min = this.config.standby_min_interval;
        const max = this.config.standby_max_interval;
        const nextMin = Math.floor(Math.random() * (max - min + 1)) + min;
        
        logger.info(this.accountName, `🔋 Próximo Status 'Online' Simulado (Standby) daqui a ${nextMin} minutos.`);
        
        this.standbyTimeout = setTimeout(async () => {
            await this.executeStandbyCycle();
            if (this.config.standby_enabled) this.scheduleNextStandby();
        }, nextMin * 60000);
    }

    async executeStandbyCycle() {
        if (this.status !== 'ready' || !this.client) return;
        try {
            const ms = Math.floor(Math.random() * (this.config.standby_max_duration - this.config.standby_min_duration + 1) * 1000) + (this.config.standby_min_duration * 1000);
            logger.info(this.accountName, `🔋 Iniciando espiadinha simulada e lendo Mensagens Antigas (Duração: ${Math.round(ms/1000)}s)`);
            await this.client.sendPresenceUpdate('available');
            
            // Fica online o tempo estipulado simulando leitura
            setTimeout(async () => {
                if (this.client) {
                    await this.client.sendPresenceUpdate('unavailable');
                    logger.info(this.accountName, `🔋 Espiadinha Standby Finalizada. Voltando a ficar invisível.`);
                }
            }, ms);
        } catch (e) { }
    }
}

module.exports = WhatsAppSession;
