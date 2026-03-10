const { Client, RemoteAuth } = require('whatsapp-web.js');
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
        this.intentionalStop = false; // Flag para parada intencional (evita reconexão automática)
        this.isPaused = false; // Flag para Pausa Manual (Standby sem destruir conexão)
        this.standbyTimeout = null;

        // Registra mapeamento do nome pra envio dos logs React
        logger.setAccountId(accountName, accountId);

        // Configurações da conta
        this.config = {
            proxy_enabled: config.proxy_enabled || false,
            proxy_ip: config.proxy_ip,
            proxy_port: config.proxy_port,
            proxy_username: config.proxy_username,
            proxy_password: config.proxy_password,

            // Delays básicos (Primeiro Contato)
            min_read_delay: config.min_read_delay || 3000,
            max_read_delay: config.max_read_delay || 15000,
            min_typing_delay: config.min_typing_delay || 5000,
            max_typing_delay: config.max_typing_delay || 20000,
            min_response_delay: config.min_response_delay || 10000,
            max_response_delay: config.max_response_delay || 30000,
            min_message_interval: config.min_message_interval || 20000,
            max_message_interval: config.max_message_interval || 60000,

            // Delays Follow-up
            min_followup_read_delay: config.min_followup_read_delay || config.min_read_delay || 3000,
            max_followup_read_delay: config.max_followup_read_delay || config.max_read_delay || 15000,
            min_followup_typing_delay: config.min_followup_typing_delay || config.min_typing_delay || 5000,
            max_followup_typing_delay: config.max_followup_typing_delay || config.max_typing_delay || 20000,
            min_followup_response_delay: config.min_followup_response_delay || config.min_response_delay || 10000,
            max_followup_response_delay: config.max_followup_response_delay || config.max_response_delay || 30000,
            min_followup_interval: config.min_followup_interval || 30000,
            max_followup_interval: config.max_followup_interval || 120000,

            // Delays Grupo
            min_group_read_delay: config.min_group_read_delay || config.min_read_delay || 3000,
            max_group_read_delay: config.max_group_read_delay || config.max_read_delay || 15000,
            min_group_typing_delay: config.min_group_typing_delay || config.min_typing_delay || 5000,
            max_group_typing_delay: config.max_group_typing_delay || config.max_typing_delay || 20000,
            min_group_response_delay: config.min_group_response_delay || config.min_response_delay || 10000,
            max_group_response_delay: config.max_group_response_delay || config.max_response_delay || 30000,
            min_group_interval: config.min_group_interval || 15000,
            max_group_interval: config.max_group_interval || 45000,

            // Áudio / Gravação
            followup_audio_enabled: !!config.followup_audio_enabled,
            followup_min_recording_delay: config.followup_min_recording_delay || 5000,
            followup_max_recording_delay: config.followup_max_recording_delay || 15000,
            group_audio_enabled: !!config.group_audio_enabled,
            group_min_recording_delay: config.group_min_recording_delay || 5000,
            group_max_recording_delay: config.group_max_recording_delay || 15000,

            // Mídia
            media_enabled: config.media_enabled !== undefined ? config.media_enabled : true,
            media_interval: config.media_interval || 2,
            followup_media_enabled: config.followup_media_enabled !== undefined ? config.followup_media_enabled : true,
            followup_media_interval: config.followup_media_interval || 3,
            group_media_enabled: config.group_media_enabled !== undefined ? config.group_media_enabled : true,
            group_media_interval: config.group_media_interval || 3,

            // Documentos
            followup_docs_enabled: !!config.followup_docs_enabled,
            followup_docs_interval: config.followup_docs_interval || 5,
            group_docs_enabled: !!config.group_docs_enabled,
            group_docs_interval: config.group_docs_interval || 5,

            // Antigo (compat)
            ignore_probability: config.ignore_probability || 0,

            // Pausa automática
            pause_after_n_responses: config.pause_after_n_responses || 0,
            pause_duration_minutes: config.pause_duration_minutes || 10,

            // Auto-aquecimento
            auto_warm_enabled: config.auto_warm_enabled || false,
            auto_warm_idle_minutes: config.auto_warm_idle_minutes || 10,
            auto_warm_delay_min: config.auto_warm_delay_min || 30,
            auto_warm_delay_max: config.auto_warm_delay_max || 120,

            // Grupos
            group_enabled: config.group_enabled !== false && config.group_enabled !== 0,

            // Delay de ouvir áudio recebido
            min_audio_listen_delay: config.min_audio_listen_delay || 5000,
            max_audio_listen_delay: config.max_audio_listen_delay || 30000,
            min_followup_audio_listen_delay: config.min_followup_audio_listen_delay || config.min_audio_listen_delay || 5000,
            max_followup_audio_listen_delay: config.max_followup_audio_listen_delay || config.max_audio_listen_delay || 30000,
            min_group_audio_listen_delay: config.min_group_audio_listen_delay || config.min_audio_listen_delay || 5000,
            max_group_audio_listen_delay: config.max_group_audio_listen_delay || config.max_audio_listen_delay || 30000,

            // Pausa Global Automática
            global_group_delay_minutes: config.global_group_delay_minutes || 0,
            global_private_delay_minutes: config.global_private_delay_minutes || 0,

            // Standby
            standby_enabled: config.standby_enabled === 1 || config.standby_enabled === true,
            standby_min_interval: config.standby_min_interval || 5,
            standby_max_interval: config.standby_max_interval || 15,
            standby_min_duration: config.standby_min_duration || 10,
            standby_max_duration: config.standby_max_duration || 60,
        };

        this.stats = {
            messagesSent: 0,
            messagesReceived: 0,
            uniqueContacts: new Set(),
            startTime: null,
            lastActivity: null
        };

        this.runtimeOptions = {}; // Opções de tempo de execução (não salvas no banco)
        this.unsavedContactsCount = 0; // Armazena contatos não salvos temporariamente
    }

    /**
     * Define opções de tempo de execução (ex: visible)
     */
    setRuntimeOptions(options) {
        this.runtimeOptions = { ...this.runtimeOptions, ...options };
    }

    /**
     * Marca a sessão como parada intencionalmente (impede reconexão automática)
     */
    setIntentionalStop(value = true) {
        this.intentionalStop = value;
    }

    /**
     * Atualiza configuração
     */
    updateConfig(newConfig) {
        Object.assign(this.config, newConfig);
        logger.info(this.accountName, 'Configuração atualizada');

        // Reinicia o standby se o status for ready
        if (this.status === 'ready') {
            this.startStandbyLoop();
        }
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
        if (this.isInitializing) {
            logger.warn(this.accountName, `Sessão já está inicializando! Bloqueando chamada simultânea.`);
            return;
        }

        try {
            this.isInitializing = true;
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
                try {
                    // Evita travamento infinito caso o proxy abra a porta mas retenha conexões SSL (TCP Blackhole)
                    anonymizedProxyUrl = await Promise.race([
                        proxyChain.anonymizeProxy(proxyUrl),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout de 15s excedido ao criar o proxy local.')), 15000))
                    ]);
                } catch (err) {
                    this.status = 'error';
                    throw new Error(`Falha ao criar proxy anônimo: ${err.message}`);
                }
                this.anonymizedProxyUrl = anonymizedProxyUrl; // Salva para cleanup
                this.originalProxyUrl = proxyUrl;
                this.anonymizedProxyPort = new URL(anonymizedProxyUrl).port;
                logger.info(this.accountName, `✅ Proxy local criado: ${anonymizedProxyUrl}`);

                agent = new HttpsProxyAgent(proxyUrl);
            }

            // 3. Configuração do Cliente
            const startVisible = this.runtimeOptions && this.runtimeOptions.visible;

            const dataPath = path.join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.wwebjs_auth_aquecimento');

            // === CRITICO: Limpa lock files do Chromium antes de iniciar ==
            // RemoteAuth usa: dataPath/RemoteAuth-account-{id} como userDataDir
            const remoteAuthDir = path.join(dataPath, `RemoteAuth-account-${this.accountId}`);
            await this.cleanUserDataDir(remoteAuthDir);

            // Conecta ao pool PostgreSQL para salvar sessão
            const db = require('../database/DatabaseManager');
            const PostgresSessionStore = require('./PostgresSessionStore');
            const store = new PostgresSessionStore(db.pool);

            const clientConfig = {
                authStrategy: new RemoteAuth({
                    clientId: `account-${this.accountId}`,
                    dataPath: dataPath,
                    store: store,
                    backupSyncIntervalMs: 300000 // Salva sessão no PostgreSQL a cada 5 minutos
                }),
                requestTimeout: 120000,  // 2 minutos para ambientes cloud
                puppeteer: {
                    // Em produção (Linux), força headless. Remove executablePath para usar bundled Chromium
                    headless: process.platform === 'linux' ? true : !startVisible,
                    // Adiciona single-process para ambientes com recursos limitados
                    bypassCSP: true,
                    protocolTimeout: 600000,  // 10 minutos — o inject WAPI é muito pesado no Discloud
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-extensions',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--no-first-run',
                        '--no-zygote',
                        // '--single-process', // <-- REMOVIDO: Comprovado ser o causador do DEADLOCK do WhatsappWeb na Discloud (Trava de Thread Unica)
                        '--disable-backgrounding-occluded-windows', // Otimização extrema para Linux em Headless
                        '--disable-renderer-backgrounding',         // Impede o Chrome de congelar a injeção do JS por "estar em segundo plano"
                        '--disable-ipc-flooding-protection',        // Impede a V8 de dropar mensagens grandes do IndexedDB pro Main Thread
                        '--js-flags="--max-old-space-size=1024 --expose-gc"', // Libera mais RAM para o limite da aba isolada do V8
                        '--memory-pressure-off',
                        '--no-recovery-component',
                        '--disable-session-crashed-bubble',
                        '--disable-background-timer-throttling',
                        '--disable-hang-monitor',                   // Impede o Chrome de fechar a aba se o DB ler muito devagar
                        '--disable-prompt-on-repost',
                        '--disable-web-security',                   // Reduz verificações de CORS locais
                        '--disable-site-isolation-trials',          // Desativa isolamento de RAM estrito por site
                        '--disable-gpu',
                        '--disable-software-rasterizer',
                        '--disable-background-networking',
                        '--disable-default-apps',
                        '--disable-sync',
                        '--disable-translate',
                        '--metrics-recording-only',
                        '--mute-audio',
                        '--no-default-browser-check',
                        '--no-experiments',
                        '--safebrowsing-disable-auto-update',
                        '--renderer-process-limit=1',               // Força 1 único processo de renderização
                        '--disable-features=IsolateOrigins,site-per-process,CrossSiteDocumentBlockingIfIsolating,CrossSiteDocumentBlockingAlways,AudioServiceOutOfProcess',

                        // RemoteAuth gerencia o --user-data-dir internamente

                        // === CORREÇÃO DO VAZAMENTO WEBRTC E PIDs (CRÍTICOS!) ===
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
            this.isInitializing = false;

        } catch (error) {
            const errMsg = error?.message || error?.toString?.() || JSON.stringify(error) || 'Erro desconhecido';
            logger.error(this.accountName, `Erro fatal na inicialização: ${errMsg}`);
            try {
                require('fs').writeFileSync(path.join(__dirname, '..', '..', 'error_launch.log'), `Error: ${errMsg}\nStack: ${error?.stack || 'N/A'}\nFull: ${JSON.stringify(error, Object.getOwnPropertyNames(error || {}), 2)}\n`);
            } catch (e) { /* ignore write errors */ }

            // Tratamento de Timeouts (Rede / Disco Local)
            const errStr = String(errMsg).toLowerCase();
            if (errStr.includes('auth timeout') || errStr.includes('auth_timeout')) {
                logger.warn(this.accountName, `⚠️ Auth timeout. O WhatsApp Web demorou muito para autenticar (pode ser proxy lento).`);
                logger.info(this.accountName, `💡 Sessão preservada no Banco de Dados para a próxima tentativa.`);
            } else if (errStr.includes('timeout crítico') || errStr.includes('descompactar')) {
                logger.warn(this.accountName, `⚠️ Falha ao extrair arquivos da sessão (Gargalo de Disco/CPU).`);
                logger.info(this.accountName, `💡 Tentaremos novamente no próximo reinício sem apagar a sessão no banco.`);
            }

            this.status = 'error';
            this.isInitializing = false;

            // PREVENÇÃO DE MEMORY LEAK (DISCLOUD ZOMBIE PROCESSES)
            // Se o client falhar ao inicializar (e.g. timeout de página ou timeout no inject do WWebJS),
            // a instância do Puppeteer ficaria aberta para sempre consumindo ~200MB de RAM.
            try {
                if (this.client) {
                    logger.warn(this.accountName, `🧹 Fechando aba do navegador Chromium corrompida para liberar RAM...`);
                    await this.client.destroy();
                }
            } catch (destroyErr) {
                logger.error(this.accountName, `Falha ao tentar destruir cliente corrompido: ${destroyErr.message}`);
            }

            this.emit('error', error);
            throw error;
        }
    }

    /**

    /**
     * Limpa arquivos de lock do Chromium para evitar travamento em reinicializacoes
     * O SingletonLock impede o Chromium de iniciar se existir de uma sessao anterior
     */
    async cleanUserDataDir(profilePath) {
        const fs = require('fs');
        const p = require('path');
        const targets = [
            p.join(profilePath, 'SingletonLock'),
            p.join(profilePath, 'SingletonSocket'),
            p.join(profilePath, 'SingletonCookie'),
            p.join(profilePath, 'Default', 'lockfile'),
            p.join(profilePath, 'Default', 'Service Worker'),
            p.join(profilePath, 'Default', 'Cache'),
            p.join(profilePath, 'Default', 'Code Cache')
        ];
        for (const target of targets) {
            try {
                if (fs.existsSync(target) || (fs.lstatSync && fs.lstatSync(target))) {
                    fs.rmSync(target, { recursive: true, force: true });
                    console.log('[CHROMIUM] Target removido (Lock/Cache):', p.basename(target));
                }
            } catch (e) { /* target não existe — ok */ }
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

            const proxyUrl = this.config.proxy_username && this.config.proxy_password
                ? `http://${this.config.proxy_username}:${this.config.proxy_password}@${this.config.proxy_ip}:${this.config.proxy_port}`
                : `http://${this.config.proxy_ip}:${this.config.proxy_port}`;

            const agent = new HttpsProxyAgent(proxyUrl);

            // 3 Tentativas para lidar com rotação de IP demorada (Painéis 3G/4G ressetando placa GSM)
            let lastError = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    if (attempt > 1) {
                        logger.info(this.accountName, `Tentativa ${attempt}/3 de validação do proxy. Aguardando 5s...`);
                        await new Promise(r => setTimeout(r, 5000));
                    }

                    // Força corte brusco após 15s (O timeout do axios não encerra conexões TCP presas no CONNECT)
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 15000);

                    const response = await axios.get('https://api.ipify.org?format=json', {
                        httpsAgent: agent,
                        timeout: 15000,
                        signal: controller.signal
                    });

                    clearTimeout(timeoutId);

                    if (response.data && response.data.ip) {
                        this.publicIP = response.data.ip;
                        this.isp = 'Desconhecido';
                        this.country = 'Desconhecido';
                        this.city = 'Desconhecido';

                        logger.info(this.accountName, `Proxy validado. IP Externo: ${this.publicIP}`);
                        return true;
                    }
                } catch (err) {
                    lastError = err;
                    logger.warn(this.accountName, `Falha na tentativa ${attempt} do proxy: ${err.message}`);
                }
            }

            logger.error(this.accountName, `Erro validação proxy após 3 tentativas: ${lastError?.message}`);
            return false;
        } catch (error) {
            logger.error(this.accountName, `Erro estrutural validação proxy: ${error.message}`);
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

            // DIAGNÓSTICO + AUTO-FIX: Monitora estado interno do WhatsApp Web a cada 5s
            // Se detectar CONNECTED+hasSynced=true mas inject não completou, tenta re-inject IMEDIATAMENTE!
            if (this._diagnosticInterval) clearInterval(this._diagnosticInterval);
            if (this._diagnosticTimeout) clearTimeout(this._diagnosticTimeout);
            this._connectedSyncedCount = 0;
            this._pageErrorCount = 0;
            this._diagRunning = false;

            const runDiagnostic = async () => {
                if (this._diagRunning) return; // Evita sobreposição simples
                if (this._diagPending) {
                    // Já existe uma Promessa Presa no Puppeteer
                    this._evalTimeoutCount = (this._evalTimeoutCount || 0) + 1;
                    logger.warn(this.accountName, `⏳ [DIAG] O WhatsApp Web está ocupado e bloqueando o Puppeteer (${this._evalTimeoutCount}x). Aguardando liberação...`);

                    if (this._evalTimeoutCount >= 60) {
                        logger.error(this.accountName, `🚨 [DIAG] Deadlock persistente detectado (5 mins)! A página do WhatsApp congelou na VPS. Dando F5 (reload) forçado na aba...`);
                        this._evalTimeoutCount = 0;
                        this._diagPending = false;
                        try {
                            await this.client.pupPage.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
                            logger.info(this.accountName, `🔄 [DIAG] F5 executado com sucesso!`);
                        } catch (e) {
                            logger.error(this.accountName, `Erro ao dar F5 na aba travada: ${e.message}`);
                        }
                    }
                    return;
                }

                if (this.status !== 'authenticated' || !this.client?.pupPage) {
                    if (this._diagnosticInterval) { clearInterval(this._diagnosticInterval); this._diagnosticInterval = null; }
                    return;
                }

                this._diagRunning = true;
                this._diagPending = true;
                try {
                    const diag = await Promise.race([
                        this.client.pupPage.evaluate(() => {
                            const result = {};
                            try { result.appState = window.AuthStore?.AppState?.state || 'N/A'; } catch (e) { result.appState = 'ERRO'; }
                            try { result.hasSynced = window.AuthStore?.AppState?.hasSynced; } catch (e) { result.hasSynced = 'ERRO'; }
                            try { result.wwebjsReady = !!(window.WWebJS && window.WWebJS.sendMessage); } catch (e) { result.wwebjsReady = false; }
                            return result;
                        }).catch(() => ({ appState: 'PAGE_ERROR', hasSynced: '?', wwebjsReady: false })),
                        new Promise(resolve => setTimeout(() => resolve({ appState: 'EVAL_TIMEOUT', hasSynced: '?', wwebjsReady: false }), 10000))
                    ]);

                    // Só tira a pendência se NÃO for EVAL_TIMEOUT falso 
                    // (porque se deu timeout, a promise ali em cima evaluate ainda ta rodando no fundo)
                    if (diag.appState !== 'EVAL_TIMEOUT') {
                        this._diagPending = false;
                    }

                    logger.info(this.accountName, `🔬 [DIAG] AppState=${diag.appState} | hasSynced=${diag.hasSynced} | WWebJS=${diag.wwebjsReady}`);

                    // CASO 1: EVAL_TIMEOUT — página bloqueada, provável carregamento pesado
                    if (diag.appState === 'EVAL_TIMEOUT') {
                        this._evalTimeoutCount = (this._evalTimeoutCount || 0) + 1;
                        logger.warn(this.accountName, `⏳ [DIAG] O WhatsApp Web está ocupado e bloqueando o Puppeteer (${this._evalTimeoutCount}x). Aguardando liberação...`);
                        this._pageErrorCount = 0;

                        if (this._evalTimeoutCount >= 60) { // 5 minutos de espera para carregamento extremo na Discloud
                            logger.error(this.accountName, `🚨 [DIAG] Deadlock persistente detectado (5 mins)! A página do WhatsApp congelou na VPS. Dando F5 (reload) forçado na aba...`);
                            this._evalTimeoutCount = 0;
                            try {
                                await this.client.pupPage.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
                                logger.info(this.accountName, `🔄 [DIAG] F5 executado com sucesso!`);
                            } catch (e) {
                                logger.error(this.accountName, `Erro ao dar F5 na aba travada: ${e.message}`);
                            }
                        }
                    }
                    // CASO 2: PAGE_ERROR — página com certeza crashou internamente
                    else if (diag.appState === 'PAGE_ERROR' || diag.appState === 'ERRO') {
                        this._evalTimeoutCount = 0;
                        this._pageErrorCount++;
                        if (this._pageErrorCount >= 4) { // 20s confirmação
                            logger.error(this.accountName, `💀 [DIAG] Página crashou (${this._pageErrorCount}x). Recarregando a página (F5) para tentar recuperar...`);
                            this._pageErrorCount = 0;
                            try {
                                await this.client.pupPage.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
                            } catch (e) {
                                logger.error(this.accountName, `Erro ao recarregar a aba crashada: ${e.message}`);
                            }
                        }
                    }
                    // CASO 2: CONNECTED + hasSynced mas WWebJS ausente → re-inject
                    else if (diag.appState === 'CONNECTED' && diag.hasSynced === true && !diag.wwebjsReady) {
                        this._evalTimeoutCount = 0;
                        this._connectedSyncedCount++;
                        this._pageErrorCount = 0;
                        logger.warn(this.accountName, `🔄 [AUTO-FIX] CONECTADO sem WWebJS (${this._connectedSyncedCount}x). Re-injetando...`);
                        try {
                            await this.client.inject();
                            logger.info(this.accountName, `✅ [AUTO-FIX] Re-inject OK! Evento ready deve disparar.`);
                            this._connectedSyncedCount = 0;
                        } catch (injectErr) {
                            logger.warn(this.accountName, `⚠️ [AUTO-FIX] Re-inject falhou (${this._connectedSyncedCount}x): ${injectErr.message}`);
                            if (this._connectedSyncedCount >= 3) {
                                logger.error(this.accountName, `❌ 3 re-injects falharam. Aguardando recovery...`);
                                this._connectedSyncedCount = 0;
                            }
                        }
                    }
                    // CASO 4: WWebJS presente na página mas o Evento 'ready' nunca disparou no Node.js (Vítima de Navigation / Context Destroyed)
                    else if (diag.appState === 'CONNECTED' && diag.hasSynced === true && diag.wwebjsReady === true) {
                        this._evalTimeoutCount = 0;
                        this._readyWaitCount = (this._readyWaitCount || 0) + 1;
                        if (this._readyWaitCount >= 4) { // 20 segundos travado esperando o ready
                            logger.warn(this.accountName, `🚨 [AUTO-FIX] Contexto JS travou durante o Inject (Navigation). Recarregando a página para destrancar a lib...`);
                            this._readyWaitCount = 0;
                            try {
                                await this.client.pupPage.reload({ waitUntil: 'domcontentloaded' });
                            } catch (e) {
                                logger.error(this.accountName, `Erro ao recarregar a página no FIX: ${e.message}`);
                            }
                        }
                    }
                    // CASO 5: Qualquer outro estado → reset contadores
                    else {
                        this._evalTimeoutCount = 0;
                        this._connectedSyncedCount = 0;
                        this._pageErrorCount = 0;
                        this._readyWaitCount = 0;
                    }
                } catch (e) {
                    logger.warn(this.accountName, `🔬 [DIAG] Erro: ${e.message}`);
                } finally {
                    this._diagRunning = false;
                }
            };
            // Primeira verificação em 3s, depois a cada 5s
            this._diagnosticTimeout = setTimeout(() => runDiagnostic(), 3000);
            this._diagnosticInterval = setInterval(() => runDiagnostic(), 5000);

            // FALLBACK RECOVERY: Se nada funcionou em 60s, força recovery
            if (this._injectRecoveryTimeout) clearTimeout(this._injectRecoveryTimeout);
            if (!this._injectFailCount) this._injectFailCount = 0;
            this._injectRecoveryTimeout = setTimeout(async () => {
                if (this._diagnosticInterval) { clearInterval(this._diagnosticInterval); this._diagnosticInterval = null; }
                if (this.status === 'authenticated') {
                    this._injectFailCount++;
                    const db = require('../database/DatabaseManager');

                    if (this._injectFailCount >= 5) {
                        logger.warn(this.accountName, `⚠️ Inject falhou ${this._injectFailCount}x por gargalo extremo (delay > 360s) ou falha grave.`);
                        try {
                            await this.destroy(false);
                            logger.warn(this.accountName, `💡 Sessão preservada! Tentaremos recomeçar a conexão do zero, inicie a conta no painel.`);
                            await db.updateAccountStatus(this.accountId, 'disconnected');
                            this._injectFailCount = 0;
                        } catch (err) { logger.error(this.accountName, `Erro recovery: ${err.message}`); }
                    } else {
                        logger.warn(this.accountName, `⚠️ Inject preso por 360s (tentativa ${this._injectFailCount}/5). Preservando sessão e recomeçando...`);
                        try {
                            await this.destroy(false);
                            await db.updateAccountStatus(this.accountId, 'disconnected');
                            logger.info(this.accountName, `💡 Sessão preservada. Reconectando...`);
                            if (!this.intentionalStop) {
                                setTimeout(() => this.reconnect(), 5000);
                            }
                        } catch (err) { logger.error(this.accountName, `Erro recovery: ${err.message}`); }
                    }
                    this.emit('inject_timeout');
                }
            }, 360000); // 360 segundos (6 minutos) tolerância máxima para VPS super lentas
        });

        // Pronto
        this.client.on('ready', async () => {
            // Cancela o auto-recovery e diagnósticos — o inject completou com sucesso!
            if (this._injectRecoveryTimeout) {
                clearTimeout(this._injectRecoveryTimeout);
                this._injectRecoveryTimeout = null;
            }
            if (this._diagnosticInterval) {
                clearInterval(this._diagnosticInterval);
                this._diagnosticInterval = null;
            }

            this.status = 'ready';
            this._injectFailCount = 0; // Reset contador — sessão funcionou!
            this._reconnectAttempts = 0; // Reset reconexões — tudo ok!
            this.qrCode = null;
            this.qrTimestamp = null; // Limpa o timestamp
            this.stats.startTime = Date.now();
            this.stats.lastActivity = Date.now();

            logger.ready(this.accountName);

            // Obtém informações da conta
            const info = this.client.info;
            logger.info(this.accountName, `Conectado como: ${info.pushname} (${info.wid.user})`);

            this.emit('ready', info);

            // Se estava pausada, marca como ready mas não inicia loops (resume() cuidará disso)
            if (this.isPaused) {
                logger.info(this.accountName, `Ready recebido durante pausa. Loops serão iniciados ao retomar.`);
                return;
            }

            // Inicia Presence Keep-Alive constante e simulação ociosa se ativada
            this.startPresenceLoop();
            this.startStandbyLoop();
            this.startContactSyncLoop(); // 🔴 LOOP V-CARD INICIAR! 
        });

        // Desconectado
        this.client.on('disconnected', (reason) => {
            if (this.isPaused) {
                logger.info(this.accountName, `Desconexão ignorada (Modo Avião/Pausa ativo). Razão WWebjs: ${reason}`);
                return; // Impede ciclo infinito de reinicialização da instância
            }

            this.status = 'disconnected';
            this.stopPresenceLoop();
            this.stopStandbyLoop();
            this.stopContactSyncLoop();

            logger.disconnected(this.accountName);
            logger.warn(this.accountName, `Razão: ${reason}`);

            this.emit('disconnected', reason);

            // Só reconecta automaticamente se NÃO foi uma parada intencional
            if (!this.intentionalStop) {
                logger.info(this.accountName, 'Desconexão inesperada. Reconectando em 10s...');
                setTimeout(() => this.reconnect(), 10000);
            } else {
                logger.info(this.accountName, 'Parada intencional. Sem reconexão automática.');
            }
        });

        // Erro de autenticação
        this.client.on('auth_failure', (msg) => {
            this.status = 'auth_failure';

            logger.error(this.accountName, `Falha na autenticação: ${msg}`);
            this.emit('auth_failure', msg);
        });

        // Mensagem recebida
        this.client.on('message', async (msg) => {
            if (this.isPaused) return; // Ignora se a conta estiver pausada manualmente

            this.stats.messagesReceived++;
            this.stats.lastActivity = Date.now();
            this.stats.uniqueContacts.add(msg.from);

            this.emit('message', msg);
        });
    }

    /**
     * Tenta reconectar com limite de tentativas e backoff exponencial
     * Máx 3 tentativas. Delay: 30s → 60s → 120s
     */
    async reconnect() {
        // Guard contra chamadas concorrentes
        if (this._reconnecting) {
            logger.info(this.accountName, 'Reconexão já em andamento, ignorando chamada duplicada.');
            return;
        }

        // Limite de tentativas
        if (!this._reconnectAttempts) this._reconnectAttempts = 0;
        this._reconnectAttempts++;

        if (this._reconnectAttempts > 3) {
            logger.error(this.accountName, `❌ Máximo de 3 tentativas de reconexão atingido. Parando.`);
            this.status = 'disconnected';
            this._reconnectAttempts = 0;
            this.emit('disconnected', 'max_reconnect_attempts');
            return;
        }

        const delay = Math.min(30000 * Math.pow(2, this._reconnectAttempts - 1), 120000);

        this._reconnecting = true;
        try {
            logger.reconnecting(this.accountName);
            logger.info(this.accountName, `Tentativa ${this._reconnectAttempts}/3...`);

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
            this._reconnectAttempts = 0; // Reset no sucesso
        } catch (error) {
            logger.error(this.accountName, `Erro ao reconectar (${this._reconnectAttempts}/3): ${error.message}`);

            if (this._reconnectAttempts < 3) {
                logger.info(this.accountName, `Próxima tentativa em ${delay / 1000}s...`);
                setTimeout(() => this.reconnect(), delay);
            } else {
                logger.error(this.accountName, `❌ 3 tentativas falharam. Conta marcada como desconectada.`);
                this.status = 'disconnected';
                this._reconnectAttempts = 0;
                this.emit('disconnected', 'reconnect_failed');
            }
        } finally {
            this._reconnecting = false;
        }
    }

    /**
     * Motor de Simulação de Ociosidade (Standby)
     */
    startStandbyLoop() {
        this.stopStandbyLoop();
        if (!this.config.standby_enabled) return;

        logger.info(this.accountName, `🔋 Modo Standby (Ocioso) ativado. Iniciando ciclos simulados...`);
        this.scheduleNextStandby();
    }

    stopStandbyLoop() {
        if (this.standbyTimeout) {
            clearTimeout(this.standbyTimeout);
            this.standbyTimeout = null;
        }
    }

    /**
     * Motor de Presence Keep-Alive + HEALTH CHECKER (Detecta morte silenciosa)
     * A cada 10s tenta sendPresenceAvailable(). Se falhar 6x seguidas (60s),
     * verifica estado real da conexão e força reconexão se necessário.
     */
    startPresenceLoop() {
        this.stopPresenceLoop();
        logger.info(this.accountName, '🟢 Keep-Alive de Presença (Online) iniciado.');
        this._presenceFailCount = 0;
        this._lastHealthCheck = Date.now();

        // Força IMEDIATAMENTE antes de aguardar o loop
        if (this.client && this.status === 'ready' && !this.isPaused) {
            try { this.client.sendPresenceAvailable(); } catch (e) { }
        }

        this.presenceInterval = setInterval(async () => {
            if (this.status !== 'ready' || this.isPaused || !this.client) return;

            try {
                await this.client.sendPresenceAvailable();
                this._presenceFailCount = 0; // Reset - conexão OK
            } catch (e) {
                this._presenceFailCount++;

                if (this._presenceFailCount >= 6) { // 60 segundos de falhas consecutivas
                    logger.warn(this.accountName, `⚠️ [HEALTH] sendPresenceAvailable falhou ${this._presenceFailCount}x seguidas. Verificando conexão...`);

                    // Verifica estado real da conexão via page evaluate
                    try {
                        const state = await this.client.pupPage.evaluate(() => {
                            try { return window.AuthStore?.AppState?.state || 'UNKNOWN'; } catch (e) { return 'PAGE_ERROR'; }
                        }).catch(() => 'PAGE_CRASH');

                        if (state !== 'CONNECTED') {
                            logger.error(this.accountName, `💀 [HEALTH] Conexão MORTA! AppState=${state}. Forçando reconexão...`);
                            this._presenceFailCount = 0;
                            this.stopPresenceLoop();
                            this.stopStandbyLoop();
                            this.stopContactSyncLoop();
                            this.status = 'disconnected';
                            this.emit('disconnected', 'silent_death');
                            if (!this.intentionalStop) {
                                setTimeout(() => this.reconnect(), 5000);
                            }
                            return;
                        } else {
                            // Conexão ok mas presença falhou — pode ser transitório
                            logger.info(this.accountName, `🔍 [HEALTH] AppState=CONNECTED mas presença falhou. Monitorando...`);
                            this._presenceFailCount = 3; // Reduz contador mas mantém alerta
                        }
                    } catch (evalErr) {
                        logger.error(this.accountName, `💀 [HEALTH] Página do Chrome não responde! Forçando reconexão...`);
                        this._presenceFailCount = 0;
                        this.stopPresenceLoop();
                        this.stopStandbyLoop();
                        this.stopContactSyncLoop();
                        this.status = 'disconnected';
                        this.emit('disconnected', 'page_unresponsive');
                        if (!this.intentionalStop) {
                            setTimeout(() => this.reconnect(), 5000);
                        }
                        return;
                    }
                }
            }

            // DEEP HEALTH CHECK a cada 5 minutos — verifica se a página responde
            const now = Date.now();
            if (now - this._lastHealthCheck >= 300000) { // 5 min
                this._lastHealthCheck = now;
                try {
                    const healthResult = await Promise.race([
                        this.client.pupPage.evaluate(() => {
                            return {
                                appState: window.AuthStore?.AppState?.state || 'N/A',
                                hasSynced: window.AuthStore?.AppState?.hasSynced,
                                online: navigator.onLine,
                                wwebjsReady: !!(window.WWebJS && window.WWebJS.sendMessage)
                            };
                        }),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
                    ]);

                    if (healthResult.appState !== 'CONNECTED' || !healthResult.wwebjsReady) {
                        logger.warn(this.accountName, `⚠️ [DEEP-HEALTH] AppState=${healthResult.appState} | WWebJS=${healthResult.wwebjsReady} | Online=${healthResult.online}`);

                        if (healthResult.appState !== 'CONNECTED') {
                            logger.error(this.accountName, `💀 [DEEP-HEALTH] Conexão perdida silenciosamente! Reconectando...`);
                            this.stopPresenceLoop();
                            this.stopStandbyLoop();
                            this.stopContactSyncLoop();
                            this.status = 'disconnected';
                            this.emit('disconnected', 'deep_health_failed');
                            if (!this.intentionalStop) {
                                setTimeout(() => this.reconnect(), 5000);
                            }
                            return;
                        }
                    }
                } catch (healthErr) {
                    logger.warn(this.accountName, `⚠️ [DEEP-HEALTH] Verificação falhou: ${healthErr.message}`);
                }
            }
        }, 10000);
    }

    stopPresenceLoop() {
        if (this.presenceInterval) {
            clearInterval(this.presenceInterval);
            this.presenceInterval = null;
            logger.info(this.accountName, '🔴 Keep-Alive de Presença finalizado.');
        }
    }

    scheduleNextStandby() {
        if (this.status !== 'ready' || !this.client) return;

        const min = this.config.standby_min_interval;
        const max = this.config.standby_max_interval;
        const nextIntervalMinutes = Math.floor(Math.random() * (max - min + 1)) + min;

        logger.info(this.accountName, `🔋 Próxima "espiadinha" ociosa (Standby) programada para daqui a ${nextIntervalMinutes} minutos.`);

        this.standbyTimeout = setTimeout(async () => {
            await this.executeStandbyCycle();
            // Agenda o próximo após terminar
            if (this.config.standby_enabled) this.scheduleNextStandby();
        }, nextIntervalMinutes * 60 * 1000);
    }

    async executeStandbyCycle() {
        try {
            // Verifica de novo se ainda estamos 'ready'
            if (this.status !== 'ready' || !this.client) return;

            // Se o bot estiver respondendo/processando mensagens recentes (menos de 60s), ignora o standby
            const timeSinceLastMsg = Date.now() - this.stats.lastActivity;
            if (timeSinceLastMsg < 60000) {
                logger.info(this.accountName, `🔋 Standby ignorado temporariamente: a conta esteve ativamente processando algo há menos de 1 min.`);
                return;
            }

            const min = this.config.standby_min_duration;
            const max = this.config.standby_max_duration;
            const durationSeconds = Math.floor(Math.random() * (max - min + 1)) + min;

            logger.info(this.accountName, `👀 Bisbilhotando WhatsApp (Standby)... Status Online ativado por ${durationSeconds} segundos.`);
            await this.client.sendPresenceAvailable();

            // wwebjs precisa renovar a presença a cada ~10s para não cair caso ocioso
            const keepOnlineInterval = setInterval(async () => {
                if (this.status === 'ready' && this.client) {
                    try { await this.client.sendPresenceAvailable(); } catch (e) { }
                }
            }, 10000);

            // === Lógica de Ler Status (Stories) ===
            // Usa as configurações de probabilidade do painel
            const watchEnabled = this.config.standby_watch_status_enabled;
            const watchProb = (this.config.standby_watch_status_prob || 70) / 100;
            const shouldWatchStatus = watchEnabled && (Math.random() < watchProb);

            let timeSpentViewingGlobal = 0;

            if (shouldWatchStatus) {
                try {
                    // Chat oficial do Status no wweb.js
                    const statusChat = await this.client.getChatById('status@broadcast');
                    if (statusChat && statusChat.unreadCount > 0) {
                        const statusMsgs = await statusChat.fetchMessages({ limit: 50 });

                        // Filtra status que as pessoas mandaram e não foram visualizados ainda
                        let unreadStatus = statusMsgs.filter(m => !m.fromMe && m.ack < 3);

                        // Se existe status não lido disponível...
                        if (unreadStatus.length > 0) {
                            // Sorteia quantos contatos vai olhar (min_contacts a max_contacts)
                            const minContacts = this.config.standby_watch_status_min_contacts || 1;
                            const maxContacts = this.config.standby_watch_status_max_contacts || 4;
                            const viewLimit = Math.floor(Math.random() * (maxContacts - minContacts + 1)) + minContacts;

                            // Embaralha array pra não ver na exata ordem do WhatsApp
                            unreadStatus = unreadStatus.sort(() => 0.5 - Math.random());

                            const toView = unreadStatus.slice(0, viewLimit);

                            logger.info(this.accountName, `📸 [Standby] Assistindo aos Status... (${toView.length} novas atualizações)`);

                            let timeSpentViewing = 0;
                            // Loop entre cada story sorteado
                            for (const stMsg of toView) {
                                // Se o tempo já passou muito do limite, encerra antes
                                if (timeSpentViewing >= durationSeconds * 1000) break;

                                const viewerName = stMsg._data?.notifyName || stMsg.author?.replace('@c.us', '') || 'Contato';

                                // Simula ver a foto/video com delay randomizado definido no painel
                                const minDelayMs = (this.config.standby_watch_status_min_delay || 3) * 1000;
                                const maxDelayMs = (this.config.standby_watch_status_max_delay || 8) * 1000;
                                const viewingDelay = Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1)) + minDelayMs;

                                logger.info(this.accountName, `👀 Vendo Story de ${viewerName}... (${(viewingDelay / 1000).toFixed(1)}s)`);

                                // O humano abre e passa o olho. Em seguida, manda sinal de visto (sendSeen) 
                                await new Promise(resolve => setTimeout(resolve, viewingDelay));
                                try {
                                    // A lib pede o chat para marcar seen. Na broadcast, a unreadCount é global. 
                                    const senderChat = await this.client.getChatById(stMsg.author);
                                    if (senderChat) await senderChat.sendSeen();
                                } catch (e) { /* ignore individual seen error*/ }

                                timeSpentViewing += viewingDelay;
                            }
                            timeSpentViewingGlobal = timeSpentViewing;
                        }
                    }
                } catch (statusErr) {
                    if (statusErr.message.includes('detached Frame') || statusErr.message.includes('Target closed')) {
                        // Ignorado, página deve ter caído ou está em processo de reboot
                    } else {
                        logger.warn(this.accountName, `⚠️ Erro ao bisbilhotar Status: ${statusErr.message}`);
                    }
                }
            } // <- FECHA O if (shouldWatchStatus)

            // Espera o resto da duração restante inicial, se houver
            const remainingTime = (durationSeconds * 1000) - timeSpentViewingGlobal;
            if (remainingTime > 0) {
                await new Promise(resolve => setTimeout(resolve, remainingTime));
            }

            // Para de forçar o online repetitivo
            clearInterval(keepOnlineInterval);

            // Verifica se não conectou e desconectou nesse meio tempo
            if (this.status !== 'ready' || !this.client) return;

            logger.info(this.accountName, `💨 Fim da bisbilhotada (Standby)... Voltando a ficar oculto (visto por último).`);
            await this.client.sendPresenceUnavailable();
        } catch (error) {
            if (error.message?.includes('detached Frame') || error.message?.includes('Target closed') || error.message?.includes('Session closed')) {
                // Ignore silently as the page is likely navigating or closed
            } else {
                logger.warn(this.accountName, `Erro no ciclo Standby: ${error.message}`);
            }
        }
    }

    /**
     * Sincronizador de Contatos V-CARD (Background)
     */
    startContactSyncLoop() {
        this.stopContactSyncLoop();

        // Faz a primeira checagem em 5 segundos
        this.contactSyncTimeout = setTimeout(() => this.executeContactSync(), 5000);
    }

    stopContactSyncLoop() {
        if (this.contactSyncTimeout) {
            clearTimeout(this.contactSyncTimeout);
            this.contactSyncTimeout = null;
        }
    }

    async executeContactSync() {
        try {
            if (this.status !== 'ready' || !this.client) return;

            // Extrai numeros diretamente dos chats
            const chats = await this.client.getChats();

            // Conta chats privados cujo nome parece numero de telefone (= nao salvo)
            const count = chats.filter(chat => {
                if (chat.isGroup) return false;
                if (!chat.id || chat.id._serialized?.includes('broadcast')) return false;
                const chatName = chat.name || '';
                const digits = chatName.replace(/[^\d]/g, '');
                const hasEnoughDigits = digits.length >= 10 && digits.length <= 15;
                const hasNoLetters = !/[a-zA-Z\u00C0-\u024F]/.test(chatName);
                return hasEnoughDigits && hasNoLetters;
            }).length;

            // Só loga quando o count muda (evita spam nos logs)
            if (this.unsavedContactsCount !== count) {
                logger.info(this.accountName, `📱 vCard: ${count} contato(s) não salvos nos chats.`);
            }
            this.unsavedContactsCount = count;

        } catch (error) {
            logger.warn(this.accountName, `Falha na sincronização silenciosa de contatos: ${error.message}`);
        } finally {
            // Repete a cada 5 a 8 minutos (intervalo maior para não sobrecarregar Puppeteer)
            if (this.status === 'ready') {
                const nextDelay = Math.floor(Math.random() * (480000 - 300000 + 1)) + 300000;
                this.contactSyncTimeout = setTimeout(() => this.executeContactSync(), nextDelay);
            }
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

        // Calcula contagem de contatos nao salvos ao vivo
        let unsavedContactsCount = this.unsavedContactsCount; // fallback para o cache
        if (this.status === 'ready' && this.client) {
            try {
                const chats = await this.client.getChats();
                // Conta chats privados cujo nome parece numero de telefone (= nao salvo na agenda)
                unsavedContactsCount = chats.filter(chat => {
                    if (chat.isGroup) return false;
                    if (!chat.id || chat.id._serialized?.includes('broadcast')) return false;
                    const chatName = chat.name || '';
                    const digits = chatName.replace(/[^\d]/g, '');
                    const hasEnoughDigits = digits.length >= 10 && digits.length <= 15;
                    const hasNoLetters = !/[a-zA-Z\u00C0-\u024F]/.test(chatName);
                    return hasEnoughDigits && hasNoLetters;
                }).length;
                this.unsavedContactsCount = unsavedContactsCount; // atualiza o cache
            } catch (e) {
                // usa o cache em caso de erro
            }
        }

        return {
            accountId: this.accountId,
            accountName: this.accountName,
            status: this.status,
            isPaused: this.isPaused, // exportando controle de pausa manual
            qrCode: qrCodeImage,
            qrTimestamp: this.qrTimestamp, // Timestamp de quando o QR foi gerado
            publicIP: this.publicIP,
            isp: this.isp,
            proxy: this.config.proxy_enabled ? {
                ip: this.config.proxy_ip,
                port: this.config.proxy_port
            } : null,
            config: this.config,
            unsavedContactsCount,
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
     * Pausa/Congela as interações temporariamente e Saca a conexão WAN (Proxy liberação)
     */
    async pause() {
        if (this.status !== 'ready') return false;

        try {
            // Emula perda de sinal / Modo Avião cortando a rede do Puppeteer
            if (this.client && this.client.pupPage) {
                await this.client.pupPage.setOfflineMode(true);
                logger.info(this.accountName, '🔌 Rede Puppeteer Desconectada (Modo Avião).');
            }

            // GARANTIA TOTAL: Derruba a ponte TCP do Proxy para matar WebSockets reticentes do WhatsApp Web!
            if (this.anonymizedProxyUrl) {
                await proxyChain.closeAnonymizedProxy(this.anonymizedProxyUrl, true);
                logger.info(this.accountName, `🔌 Servidor de Proxy Local Desligado FISICAMENTE. Tráfego cortado 100%.`);
            }
        } catch (e) {
            logger.warn(this.accountName, `Aviso ao pausar rede: ${e.message}`);
        }

        this.isPaused = true;
        this.status = 'paused'; // Adotamos o status visual paused

        this.stopPresenceLoop();
        try { if (this.client) await this.client.sendPresenceUnavailable(); } catch (e) { }

        logger.info(this.accountName, '❄️ Conta em PAUSA (Standby). Nenhuma mensagem será processada.');
        this.emit('status', 'paused');
        return true;
    }

    /**
     * Retoma as interações e devolve a conexão de Rede (WAN)
     */
    async resume() {
        if (this.status !== 'paused') return false;

        try {
            // Devolve o sinal de rede / Desativa Modo Avião
            if (this.client && this.client.pupPage) {
                await this.client.pupPage.setOfflineMode(false);
                logger.info(this.accountName, '🔌 Rede Puppeteer Restaurada.');
            }

            // Religa a ponte TCP do Proxy Local NA MESMA PORTA para que o Chrome possa trafegar denovo sem precisar reiniciar a page
            if (this.originalProxyUrl && this.anonymizedProxyPort) {
                await proxyChain.anonymizeProxy({
                    url: this.originalProxyUrl,
                    port: parseInt(this.anonymizedProxyPort)
                });
                logger.info(this.accountName, `🔌 Servidor Proxy Local Re-Ligado! Chrome reconectando portas...`);
            }
        } catch (e) {
            logger.warn(this.accountName, `Aviso ao retornar rede: ${e.message}`);
        }

        this.isPaused = false;
        this.status = 'ready'; // Retorna ao fluxo normal

        // Reinicia TODOS os loops (não só presença)
        this.startPresenceLoop();
        this.startStandbyLoop();
        this.startContactSyncLoop();

        logger.info(this.accountName, '▶️ Conta RETOMADA. Interações online (todos os loops ativos).');
        this.emit('status', 'ready');
        return true;
    }

    /**
     * Destrói a sessão com timeouts em TODAS as operações
     * @param {boolean} clearAuth - Se true, faz logout e apaga o token
     */
    async destroy(clearAuth = false) {
        try {
            this.stopPresenceLoop();
            this.stopStandbyLoop();
            this.stopContactSyncLoop();

            // Limpa diagnósticos e recovery pendentes
            if (this._diagnosticInterval) { clearInterval(this._diagnosticInterval); this._diagnosticInterval = null; }
            if (this._diagnosticTimeout) { clearTimeout(this._diagnosticTimeout); this._diagnosticTimeout = null; }
            if (this._injectRecoveryTimeout) { clearTimeout(this._injectRecoveryTimeout); this._injectRecoveryTimeout = null; }

            if (this.client) {
                logger.info(this.accountName, `Encerrando instância local temporariamente... (clearAuth: ${clearAuth})`);

                // Salva referência ao browser ANTES de qualquer operação
                const browser = this.client.pupBrowser;
                const browserPid = browser?.process?.()?.pid;

                // Logout com timeout de 10s (pode travar se página morta)
                if (clearAuth) {
                    try {
                        await Promise.race([
                            this.client.logout(),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('logout timeout')), 10000))
                        ]);
                        logger.info(this.accountName, 'Logout realizado — token apagado.');
                    } catch (e) {
                        logger.warn(this.accountName, `Logout falhou/timeout (${e.message}) — prosseguindo...`);
                    }
                } else {
                    logger.info(this.accountName, 'Sem logout — token preservado para reconexão futura.');
                }

                // Destroy do cliente com timeout de 10s
                try {
                    await Promise.race([
                        this.client.destroy(),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('destroy timeout')), 10000))
                    ]);
                } catch (e) {
                    logger.warn(this.accountName, `Destroy falhou/timeout (${e.message})`);
                }

                // Fecha browser com timeout de 5s
                try {
                    if (browser) {
                        await Promise.race([
                            browser.close(),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('browser close timeout')), 5000))
                        ]);
                    }
                } catch (e) {
                    logger.warn(this.accountName, `Browser close falhou (${e.message})`);
                    // FORCE KILL: Se nada funcionou, mata o processo do Chrome
                    if (browserPid) {
                        try {
                            process.kill(browserPid, 'SIGKILL');
                            logger.warn(this.accountName, `🔪 Browser force-killed (PID: ${browserPid})`);
                        } catch (killErr) { /* processo já morreu */ }
                    }
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
