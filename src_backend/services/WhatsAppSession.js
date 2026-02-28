const { Client, LocalAuth } = require('whatsapp-web.js');
const path = require('path');
const { HttpsProxyAgent } = require('https-proxy-agent');
const proxyChain = require('proxy-chain');
const qrcode = require('qrcode-terminal');
const EventEmitter = require('events');
const logger = require('../utils/logger');

/**
 * Gerenciador de uma sessão WhatsApp individual (versão dinâmica)
 */
class WhatsAppSession extends EventEmitter {
    constructor(accountId, accountName, config) {
        super();

        this.accountId = accountId;
        this.accountName = accountName;
        this.client = null;
        this.status = 'disconnected';
        this.qrCode = null;

        // Configurações da conta
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
            media_interval: config.media_interval || 2
        };

        this.stats = {
            messagesSent: 0,
            messagesReceived: 0,
            uniqueContacts: new Set(),
            startTime: null,
            lastActivity: null
        };

        this.runtimeOptions = {}; // Opções de tempo de execução (não salvas no banco)
    }

    /**
     * Define opções de tempo de execução (ex: visible)
     */
    setRuntimeOptions(options) {
        this.runtimeOptions = { ...this.runtimeOptions, ...options };
    }

    /**
     * Atualiza configuração
     */
    updateConfig(newConfig) {
        Object.assign(this.config, newConfig);
        logger.info(this.accountName, 'Configuração atualizada');
    }

    /**
     * Obtém URL do proxy
     */
    getProxyUrl() {
        if (!this.config.proxy_enabled) return null;

        const { proxy_ip, proxy_port, proxy_username, proxy_password } = this.config;

        if (!proxy_ip || !proxy_port) return null;

        if (proxy_username && proxy_password) {
            return `http://${proxy_username}:${proxy_password}@${proxy_ip}:${proxy_port}`;
        }

        return `http://${proxy_ip}:${proxy_port}`;
    }

    /**
     * Inicializa a sessão
     */
    async initialize() {
        try {
            this.status = 'initializing';

            // 1. Validação do Proxy (Obrigatória se habilitado)
            if (this.config.proxy_enabled) {
                logger.info(this.accountName, `Validando proxy ${this.config.proxy_ip}:${this.config.proxy_port}...`);

                const proxyValid = await this.validateProxyConnection();
                if (!proxyValid) {
                    this.status = 'error';
                    throw new Error('Falha ao conectar no Proxy. Verifique IP, Porta e Credenciais.');
                }

                logger.info(this.accountName, `✅ Proxy validado! IP: ${this.publicIP}`);
            } else {
                await this.detectPublicIP();
                logger.info(this.accountName, `Usando conexão direta (Local). IP: ${this.publicIP}`);
            }

            // 2. Configuração do Proxy usando proxy-chain (cria proxy local anônimo)
            let agent;
            let anonymizedProxyUrl = null;

            if (this.config.proxy_enabled) {
                // URL do proxy com autenticação
                const proxyUrl = this.config.proxy_username && this.config.proxy_password
                    ? `http://${this.config.proxy_username}:${this.config.proxy_password}@${this.config.proxy_ip}:${this.config.proxy_port}`
                    : `http://${this.config.proxy_ip}:${this.config.proxy_port}`;

                // Cria proxy local anônimo que encaminha para o proxy real
                // Isso elimina a necessidade de autenticação no navegador!
                logger.info(this.accountName, 'Criando proxy local anônimo...');
                anonymizedProxyUrl = await proxyChain.anonymizeProxy(proxyUrl);
                this.anonymizedProxyUrl = anonymizedProxyUrl; // Salva para cleanup
                logger.info(this.accountName, `✅ Proxy local criado: ${anonymizedProxyUrl}`);

                agent = new HttpsProxyAgent(proxyUrl);
            }

            // 3. Configuração do Cliente
            const startVisible = this.runtimeOptions && this.runtimeOptions.visible;

            const clientConfig = {
                authStrategy: new LocalAuth({
                    clientId: `account-${this.accountId}`,
                    // Linux (DisCloud): HOME, Windows: USERPROFILE
                    dataPath: path.join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.wwebjs_auth_aquecimento')
                }),
                requestTimeout: 60000,
                puppeteer: {
                    // Em produção (Linux), força headless. Remove executablePath para usar bundled Chromium
                    headless: process.platform === 'linux' ? true : !startVisible,
                    // Adiciona single-process para ambientes com recursos limitados
                    bypassCSP: true,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-extensions',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--no-first-run',
                        '--no-zygote',
                        '--disable-gpu',
                        '--disable-features=IsolateOrigins,site-per-process',

                        // === CORREÇÃO DO VAZAMENTO WEBRTC (CRÍTICO!) ===
                        '--disable-webrtc',
                        '--disable-webrtc-hw-decoding',
                        '--disable-webrtc-hw-encoding',
                        '--disable-webrtc-multiple-routes-enabled',
                        '--enforce-webrtc-ip-permission-check',
                        '--force-webrtc-ip-handling-policy=default_public_interface_only',
                        '--disable-rtc-smoothness-algorithm',
                        '--disable-gl-drawing-for-tests',

                        // === ANTI-FINGERPRINTING ADICIONAL ===
                        '--disable-blink-features=AutomationControlled',
                        '--disable-infobars',

                        // USA O PROXY LOCAL ANÔNIMO (sem autenticação!)
                        ...(anonymizedProxyUrl ? [`--proxy-server=${anonymizedProxyUrl.replace('http://', '')}`] : [])
                    ]
                },
                // User-Agent consistente (Windows Chrome - mais comum e menos suspeito)
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                agent: agent
            };

            this.client = new Client(clientConfig);

            // Eventos do cliente
            this.setupClientEvents();

            logger.info(this.accountName, 'Iniciando cliente WhatsApp...');

            // Inicia a injeção do bloqueio WebRTC em paralelo (não bloqueia)
            this.injectWebRTCBlocker();

            await this.client.initialize();

        } catch (error) {
            logger.error(this.accountName, `Erro fatal na inicialização: ${error.message}`);
            require('fs').writeFileSync(path.join(__dirname, '..', '..', 'error_launch.log'), `Error: ${error.message}\nStack: ${error.stack}\n`);
            this.status = 'error';
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Configura autenticação ANTES da navegação começar (BLOCKING)
     */
    async setupProxyAuthBeforeNavigation() {
        return new Promise((resolve, reject) => {
            logger.info(this.accountName, 'Aguardando navegador para configurar autenticação...');
            let attempts = 0;
            const maxAttempts = 600; // 60 segundos

            const checkInterval = setInterval(async () => {
                attempts++;

                if (this.client && this.client.pupBrowser) {
                    clearInterval(checkInterval);
                    try {
                        const browser = this.client.pupBrowser;
                        logger.info(this.accountName, 'Navegador detectado! Configurando autenticação PRÉ-NAVEGAÇÃO...');

                        // Função de autenticação
                        const auth = async (page) => {
                            try {
                                await page.authenticate({
                                    username: this.config.proxy_username,
                                    password: this.config.proxy_password
                                });
                            } catch (e) {
                                logger.warn(this.accountName, `Erro ao autenticar página: ${e.message}`);
                            }
                        };

                        // 1. Autentica páginas existentes
                        const pages = await browser.pages();
                        logger.info(this.accountName, `Autenticando ${pages.length} página(s) existente(s)...`);
                        for (const page of pages) {
                            await auth(page);
                        }

                        // 2. Monitora novas páginas
                        browser.on('targetcreated', async (target) => {
                            try {
                                const page = await target.page();
                                if (page) {
                                    logger.info(this.accountName, 'Nova página detectada, autenticando...');
                                    await auth(page);
                                }
                            } catch (e) { }
                        });

                        logger.info(this.accountName, '✅ Autenticação configurada! Prosseguindo com inicialização...');
                        resolve();

                    } catch (error) {
                        logger.error(this.accountName, `Erro ao configurar autenticação: ${error.message}`);
                        reject(error);
                    }
                } else if (attempts >= maxAttempts) {
                    clearInterval(checkInterval);
                    const err = new Error('Timeout aguardando navegador');
                    logger.error(this.accountName, err.message);
                    reject(err);
                } else if (!this.client) {
                    clearInterval(checkInterval);
                    reject(new Error('Cliente destruído durante setup'));
                }
            }, 100);
        });
    }

    /**
     * Injeta script para bloquear COMPLETAMENTE o WebRTC (previne vazamento de IP)
     * Isso é executado em paralelo com initialize() e injeta assim que o browser estiver disponível
     */
    async injectWebRTCBlocker() {
        const checkInterval = setInterval(async () => {
            // Verifica se o browser já está disponível
            if (this.client && this.client.pupBrowser) {
                clearInterval(checkInterval);

                try {
                    const browser = this.client.pupBrowser;
                    const pages = await browser.pages();

                    // Script para desabilitar completamente WebRTC
                    const webrtcBlockScript = `
                        // Bloqueia RTCPeerConnection completamente
                        Object.defineProperty(window, 'RTCPeerConnection', {
                            value: undefined,
                            writable: false,
                            configurable: false
                        });
                        Object.defineProperty(window, 'webkitRTCPeerConnection', {
                            value: undefined,
                            writable: false,
                            configurable: false
                        });
                        Object.defineProperty(window, 'mozRTCPeerConnection', {
                            value: undefined,
                            writable: false,
                            configurable: false
                        });
                        
                        // Bloqueia RTCDataChannel
                        Object.defineProperty(window, 'RTCDataChannel', {
                            value: undefined,
                            writable: false,
                            configurable: false
                        });
                        
                        // Bloqueia RTCSessionDescription
                        Object.defineProperty(window, 'RTCSessionDescription', {
                            value: undefined,
                            writable: false,
                            configurable: false
                        });
                        
                        // Bloqueia RTCIceCandidate
                        Object.defineProperty(window, 'RTCIceCandidate', {
                            value: undefined,
                            writable: false,
                            configurable: false
                        });
                        
                        // Bloqueia navigator.mediaDevices (opcional, pode afetar funcionalidades)
                        if (navigator.mediaDevices) {
                            navigator.mediaDevices.getUserMedia = () => Promise.reject(new Error('WebRTC disabled'));
                            navigator.mediaDevices.getDisplayMedia = () => Promise.reject(new Error('WebRTC disabled'));
                        }
                        
                        console.log('[ANTI-DETECT] WebRTC APIs bloqueadas com sucesso');
                    `;

                    // Injeta em todas as páginas existentes
                    for (const page of pages) {
                        try {
                            // Injeta script que será executado ANTES de qualquer outro script da página
                            await page.evaluateOnNewDocument(webrtcBlockScript);
                            // Também executa imediatamente se a página já carregou
                            await page.evaluate(webrtcBlockScript);
                        } catch (e) {
                            // Ignora erros em páginas que já fecharam
                        }
                    }

                    // Monitora novas páginas para injetar o script
                    browser.on('targetcreated', async (target) => {
                        try {
                            const page = await target.page();
                            if (page) {
                                await page.evaluateOnNewDocument(webrtcBlockScript);
                                await page.evaluate(webrtcBlockScript);
                            }
                        } catch (e) {
                            // Ignora erros
                        }
                    });

                    logger.info(this.accountName, '🛡️ WebRTC Blocker ativo - IP protegido!');

                } catch (error) {
                    logger.warn(this.accountName, `Erro ao injetar WebRTC blocker: ${error.message}`);
                }
            } else if (!this.client) {
                clearInterval(checkInterval);
            }
        }, 50); // Verifica a cada 50ms para ser rápido
    }

    async validateProxyConnection() {
        try {
            const axios = require('axios');

            logger.info(this.accountName, `Validando proxy ${this.config.proxy_ip}:${this.config.proxy_port}...`);

            // Constrói URL do proxy
            const proxyUrl = this.config.proxy_username && this.config.proxy_password
                ? `http://${this.config.proxy_username}:${this.config.proxy_password}@${this.config.proxy_ip}:${this.config.proxy_port}`
                : `http://${this.config.proxy_ip}:${this.config.proxy_port}`;

            // Cria o agente
            const agent = new HttpsProxyAgent(proxyUrl);

            // Testa conexão usando o agente (semelhante ao puppeteer)
            const response = await axios.get('http://ip-api.com/json/', {
                httpsAgent: agent, // Para URLs HTTPS (se usasse https://ip-api.com)
                httpAgent: agent,  // Para URLs HTTP
                timeout: 10000
            });

            if (response.data && response.data.query) {
                this.publicIP = response.data.query;
                this.isp = response.data.isp || response.data.org || 'Desconhecido';
                this.country = response.data.country || 'Desconhecido';
                this.city = response.data.city || 'Desconhecido';

                logger.info(this.accountName, `Proxy validado. IP Externo: ${this.publicIP} - ISP: ${this.isp}`);
                return true;
            }

            return false;
        } catch (error) {
            logger.error(this.accountName, `Erro validação proxy: ${error.message}`);
            return false;
        }
    }

    /**
     * Detecta IP público e informações do ISP
     */
    async detectPublicIP() {
        try {
            const axios = require('axios');

            // Só usa agent se estiver configurado (embora detectPublicIP geralmente seja usado sem proxy)
            // Mantendo lógica original mas corrigindo instanciacao se necessário, 
            // no entanto, se proxy_enabled é true, usamos validateProxyConnection.
            // Aqui é fallback para conexão direta.

            const response = await axios.get('http://ip-api.com/json/', {
                timeout: 10000
            });

            if (response.data && response.data.status === 'success') {
                this.publicIP = response.data.query;
                this.isp = response.data.isp || response.data.org || 'Desconhecido';
                this.country = response.data.country;
                this.city = response.data.city;

                logger.info(this.accountName, `IP público: ${this.publicIP} (${this.isp})`);
            }
        } catch (error) {
            logger.warn(this.accountName, `Não foi possível detectar IP público: ${error.message}`);
            this.publicIP = null;
            this.isp = null;
        }
    }

    /**
     * Configura eventos do cliente WhatsApp
     */
    setupClientEvents() {
        // QR Code
        this.client.on('qr', (qr) => {
            this.status = 'qr';
            this.qrCode = qr;
            this.qrTimestamp = Date.now(); // Registra quando o QR foi gerado

            logger.qr(this.accountName);
            qrcode.generate(qr, { small: true });

            this.emit('qr', qr);
        });

        // Autenticado
        this.client.on('authenticated', () => {
            this.status = 'authenticated';
            this.qrCode = null;
            this.qrTimestamp = null; // Limpa o timestamp

            logger.authenticated(this.accountName);
            this.emit('authenticated');
        });

        // Pronto
        this.client.on('ready', async () => {
            this.status = 'ready';
            this.qrCode = null;
            this.qrTimestamp = null; // Limpa o timestamp
            this.stats.startTime = Date.now();
            this.stats.lastActivity = Date.now();

            logger.ready(this.accountName);

            // Obtém informações da conta
            const info = this.client.info;
            logger.info(this.accountName, `Conectado como: ${info.pushname} (${info.wid.user})`);

            this.emit('ready', info);
        });

        // Desconectado
        this.client.on('disconnected', (reason) => {
            this.status = 'disconnected';

            logger.disconnected(this.accountName);
            logger.warn(this.accountName, `Razão: ${reason}`);

            this.emit('disconnected', reason);

            // Tenta reconectar após 5 segundos
            setTimeout(() => this.reconnect(), 5000);
        });

        // Erro de autenticação
        this.client.on('auth_failure', (msg) => {
            this.status = 'auth_failure';

            logger.error(this.accountName, `Falha na autenticação: ${msg}`);
            this.emit('auth_failure', msg);
        });

        // Mensagem recebida
        this.client.on('message', async (msg) => {
            this.stats.messagesReceived++;
            this.stats.lastActivity = Date.now();
            this.stats.uniqueContacts.add(msg.from);

            this.emit('message', msg);
        });
    }

    /**
     * Tenta reconectar
     */
    async reconnect() {
        // Force restart even if ready, because user explicitly requested it via button
        // if (this.status === 'ready') return; 

        try {
            logger.reconnecting(this.accountName);

            // Destrói cliente anterior se existir para liberar recursos e locks
            if (this.client) {
                try {
                    logger.info(this.accountName, 'Limpando instância anterior do cliente...');
                    await this.client.destroy();
                } catch (e) {
                    logger.warn(this.accountName, `Erro ao limpar cliente anterior: ${e.message}`);
                }
                this.client = null;
            }

            await this.initialize();
        } catch (error) {
            logger.error(this.accountName, `Erro ao reconectar: ${error.message}`);

            // Tenta novamente após 30 segundos
            setTimeout(() => this.reconnect(), 30000);
        }
    }

    /**
     * Envia mensagem
     */
    async sendMessage(to, content) {
        if (this.status !== 'ready') {
            throw new Error('Cliente não está pronto');
        }

        await this.client.sendMessage(to, content);
        this.stats.messagesSent++;
        this.stats.lastActivity = Date.now();
        this.emit('message:sent');
    }

    /**
     * Envia mídia
     */
    async sendMedia(to, media) {
        if (this.status !== 'ready') {
            throw new Error('Cliente não está pronto');
        }

        await this.client.sendMessage(to, media);
        this.stats.messagesSent++;
        this.stats.lastActivity = Date.now();
        this.emit('message:sent');
    }

    /**
     * Obtém chat
     */
    async getChat(chatId) {
        return await this.client.getChatById(chatId);
    }

    /**
     * Obtém contato
     */
    async getContact(contactId) {
        return await this.client.getContactById(contactId);
    }

    /**
     * Retorna informações da sessão
     */
    async getInfo() {
        const QRCode = require('qrcode');

        // Converte QR code para base64 se existir
        let qrCodeImage = null;
        if (this.qrCode) {
            try {
                qrCodeImage = await QRCode.toDataURL(this.qrCode);
            } catch (error) {
                logger.error(this.accountName, `Erro ao converter QR para base64: ${error.message}`);
            }
        }

        return {
            accountId: this.accountId,
            accountName: this.accountName,
            status: this.status,
            qrCode: qrCodeImage,
            qrTimestamp: this.qrTimestamp, // Timestamp de quando o QR foi gerado
            publicIP: this.publicIP,
            isp: this.isp,
            proxy: this.config.proxy_enabled ? {
                ip: this.config.proxy_ip,
                port: this.config.proxy_port
            } : null,
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

    /**
     * Destrói a sessão
     */
    async destroy() {
        try {
            if (this.client) {
                logger.info(this.accountName, 'Destruindo sessão...');

                // Tenta deslogar primeiro
                try {
                    await this.client.logout();
                } catch (e) {
                    logger.warn(this.accountName, 'Erro ao fazer logout (ignorado)');
                }

                // Destrói o cliente (fecha o navegador)
                try {
                    await this.client.destroy();
                } catch (e) {
                    logger.warn(this.accountName, 'Erro ao destruir cliente (ignorado)');
                }

                // Tenta fechar o navegador via puppeteer
                try {
                    if (this.client.pupBrowser) {
                        await this.client.pupBrowser.close();
                    }
                } catch (e) {
                    logger.warn(this.accountName, 'Erro ao fechar navegador (ignorado)');
                }

                this.client = null;
            }

            // Cleanup do proxy-chain
            if (this.anonymizedProxyUrl) {
                try {
                    await proxyChain.closeAnonymizedProxy(this.anonymizedProxyUrl, true);
                    logger.info(this.accountName, 'Proxy local fechado');
                } catch (e) {
                    logger.warn(this.accountName, 'Erro ao fechar proxy local (ignorado)');
                }
                this.anonymizedProxyUrl = null;
            }

            this.status = 'destroyed';
            this.qrCode = null;
            logger.success(this.accountName, 'Sessão destruída com sucesso');
        } catch (error) {
            logger.error(this.accountName, `Erro ao destruir sessão: ${error.message}`);
            // Força limpeza mesmo com erro
            this.client = null;
            this.status = 'destroyed';
        }
    }
}

module.exports = WhatsAppSession;
