const db = require('../database/DatabaseManager');
const logger = require('../utils/logger');
const sessionManager = require('./SessionManager');
const axios = require('axios');

class SchedulerManager {
    constructor() {
        this.checkInterval = null;
        this.isRunning = false;
        // Tempo em ms para checar a agenda
        this.POLL_INTERVAL = 60000;
        // Evita spam de log de erro de webhook — guarda última falha por conta
        this.lastWebhookError = new Map();
        // Evita ativação simultânea da mesma conta (duplo clique na UI gerando 2 webhooks)
        this.activatingAccounts = new Set();
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.checkInterval = setInterval(() => this.checkSchedules(), this.POLL_INTERVAL);
        logger.info('Scheduler', 'Motor de Agendamento iniciado.');
        // Executa a primeira checagem imediatamente
        this.checkSchedules();
    }

    stop() {
        if (!this.isRunning) return;
        this.isRunning = false;
        clearInterval(this.checkInterval);
        logger.info('Scheduler', 'Motor de Agendamento parado.');
    }

    /**
     * Verifica todas as contas ativas do banco e transiciona estado baseado nos agendamentos.
     */
    async checkSchedules() {
        try {
            const accounts = await db.getAllAccounts();
            if (!accounts || accounts.length === 0) return;

            const now = new Date();
            // Garante que o horário extraído seja sempre o de Brasília (America/Sao_Paulo)
            const formatter = new Intl.DateTimeFormat('pt-BR', {
                timeZone: 'America/Sao_Paulo',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
            const currentTime = formatter.format(now); // Formato HH:mm

            for (const account of accounts) {
                const { id, name, scheduled_start_time, scheduled_end_time, proxy_group_id, webhook_id } = account;

                // Só processa contas que têm agendamento ATIVADO e ambos os horários configurados
                if (!account.schedule_enabled) continue;
                if (!scheduled_start_time || !scheduled_end_time) continue;

                const isTimeToRun = this.isTimeInRange(currentTime, scheduled_start_time, scheduled_end_time);
                const session = sessionManager.getSession(id);
                // Se o WhatsAppSession.js pausou a conta mas o start() reinicia as variáveis, ou se status de sessionManager === paused
                const isCurrentlyActive = session && (session.status === 'ready' || session.status === 'qr' || session.status === 'authenticated') && !session.isPaused;

                // ✅ Se a sessão JÁ está ready e rodando, não faz nada (evita loop infinito de webhook)
                if (isTimeToRun && isCurrentlyActive) {
                    // Conta já ativa e no horário — nada a fazer
                    continue;
                }

                // Não ativamos se está em estado de 'error' (ex: proxy derrubado)
                // Contas 'disconnected' com schedule_enabled DEVEM ser ativadas normalmente
                if (isTimeToRun && !isCurrentlyActive && account.status !== 'error') {
                    // Está na hora de rodar as mensagens (conta deve estar ativa) -> Chama Resume / Inicializa
                    logger.info('Scheduler', `[${name}] Dentro do horário agendado (${scheduled_start_time} - ${scheduled_end_time}). Ativando...`);
                    try {
                        await this.activateAccount(account);
                    } catch (e) {
                        logger.error('Scheduler', `[${name}] Falha na ativação agendada: ${e.message}`);
                    }
                } else if (!isTimeToRun && isCurrentlyActive) {
                    // Fora do horário de rodar -> Pausa a Conta (Modo Avião On / Offline do WWebJS)
                    logger.info('Scheduler', `[${name}] Fora do horário agendado (${scheduled_start_time} - ${scheduled_end_time}). Pausando...`);
                    try {
                        await this.pauseAccount(account);
                    } catch (e) {
                        logger.error('Scheduler', `[${name}] Falha na pausa agendada: ${e.message}`);
                    }
                }
            }
        } catch (error) {
            logger.error('Scheduler', `Erro na checagem de agenda: ${error.message}`);
        }
    }

    /**
     * Compara strings no formato HH:mm. Lida com virada da meia-noite.
     */
    isTimeInRange(currentTime, startTime, endTime) {
        if (startTime === endTime) return true; // Conta roda 24h

        if (startTime < endTime) {
            // Horário normal (ex: 08:00 às 18:00)
            return currentTime >= startTime && currentTime < endTime;
        } else {
            // Virada da meia-noite (ex: 22:00 às 06:00)
            return currentTime >= startTime || currentTime < endTime;
        }
    }

    /**
     * Função auxiliar para Ativar uma Conta e disparar IP Change do Grupo Proxy.
     */
    async activateAccount(account) {
        if (this.activatingAccounts.has(account.id)) {
            logger.warn('Scheduler', `[${account.name}] Inicialização / disparo de webhook ignorado, já em andamento...`);
            return;
        }
        this.activatingAccounts.add(account.id);

        const { id, name, proxy_group_id, webhook_id } = account;

        try {
            // Se a conta já tiver sessão no SessionManager e não estiver destruída, usaremos session.resume().
            // Caso contrário, sessionManager.createSession().
            const session = sessionManager.getSession(id);

            // Checa conflito de proxy: bloqueia APENAS quando outra conta usa o MESMO IP:Porta
            // Contas com proxy_group_id igual mas IPs diferentes podem rodar simultaneamente
            if (account.proxy_ip) {
                const allAccounts = await db.getAllAccounts();

                const pIp1 = (account.proxy_ip || '').trim();
                const pPort1 = String(account.proxy_port || '').trim();

                const conflictAccount = allAccounts.find(a => {
                    if (a.id === id) return false;

                    const pIp2 = (a.proxy_ip || '').trim();
                    const pPort2 = String(a.proxy_port || '').trim();

                    // Só bloqueia se o IP E Porta forem exatamente iguais
                    const hasSameIpPort = pIp1 && pIp2 && pIp1 === pIp2 && pPort1 === pPort2;

                    if (hasSameIpPort) {
                        const sess = sessionManager.getSession(a.id);
                        // Sessão ativa = qualquer estado exceto desconectada/pausada/erro/destroyed
                        if (sess && !sess.isPaused && !['disconnected', 'error', 'destroyed'].includes(sess.status)) {
                            return true;
                        }
                    }
                    return false;
                });

                if (conflictAccount) {
                    logger.error('Scheduler', `[${name}] INICIAÇÃO RECUSADA: O Proxy ${pIp1}:${pPort1} já está sendo utilizado pela conta "${conflictAccount.name}".`);
                    throw new Error(`Proxy bloqueado pela conta ${conflictAccount.name}`); // ABORTA O START
                }
            }

            const isSessionAlreadyReady = session && (session.status === 'ready' || session.status === 'authenticated') && !session.isPaused;

            if (session && session.isInitializing) {
                logger.warn('Scheduler', `[${name}] Sessão já está em processo de inicialização. Abortando ativação simultânea para evitar colisões no Webhook do Proxy.`);
                return;
            }

            let targetWebhookId = webhook_id;

            // Se a conta não tem webhook_id explícito, mas TEM proxy, tentamos "copiar" o webhook de outra conta 
            // que use esse exato mesmo proxy. Assim o usuário não precisa configurar o webhook 1 por 1 se esquecer.
            if (!targetWebhookId && account.proxy_ip) {
                const allAccounts = await db.getAllAccounts();
                const peerAccount = allAccounts.find(a =>
                    a.proxy_ip === account.proxy_ip &&
                    String(a.proxy_port) === String(account.proxy_port) &&
                    a.webhook_id
                );

                if (peerAccount) {
                    targetWebhookId = peerAccount.webhook_id;
                    logger.info('Scheduler', `[${name}] Conta sem Webhook vinculado diretamente. Herdando Webhook da conta "${peerAccount.name}" (pois dividem o Proxy ${account.proxy_ip}:${account.proxy_port}).`);
                }
            }

            if (targetWebhookId && !isSessionAlreadyReady) {
                if (account.proxy_ip) {
                    await this.triggerWebhook(targetWebhookId, name);
                } else {
                    logger.info('Scheduler', `[${name}] Webhook ignorado (Conta NÃO possui Proxy configurado). Iniciando direto...`);
                }
            } else if (!targetWebhookId && account.proxy_ip && !isSessionAlreadyReady) {
                logger.warn('Scheduler', `[${name}] ALERTA: Conta possui Proxy, mas NENHUM webhook de rotação foi encontrado no sistema para este proxy.`);
            }

            if (session) {
                if (session.status === 'disconnected' || session.status === 'destroyed' || session.status === 'error') {
                    // Sessão existe mas o client/browser morreu. Precisa reinicializar do zero.
                    logger.info('Scheduler', `[${name}] Inicializando sessão...`);
                    try {
                        // Emite evento global de inicialização para travar o botão Iniciar nas UIs web
                        const io = logger.getIO ? logger.getIO() : null;
                        if (io) {
                            io.emit('account:initializing', { accountId: account.id });
                        }
                    } catch (e) {
                        logger.error('Scheduler', `[${name}] Erro ao emitir evento account:initializing: ${e.message}`);
                    }
                    
                    // (WPP-SISTEM FIX): Catch na chamada assíncrona solta para impedir 
                    // Unhandled Promise Rejection do Node.js quando o Proxy cai.
                    session.initialize().catch(err => {
                        logger.error('Scheduler', `[${name}] Erro pego pelo Catch do initialize(): ${err.message}`);
                    });
                } else if (session.isPaused || session.status === 'paused') {
                    // Sessão está viva, apenas com o proxy/rede pausado
                    session.resume();
                    logger.info('Scheduler', `[${name}] Sessão retomada.`);
                } else {
                    // Já parece rodando de alguma forma, re-conecta se preciso
                    logger.info('Scheduler', `[${name}] Tentativa de iniciar sessão já existente ignorada (Status: ${session.status}).`);
                }
            } else {
                // Não tem instancia ainda, cria uma nova
                try {
                    // Emite evento global de inicialização para travar o botão Iniciar nas UIs web
                    const io = logger.getIO ? logger.getIO() : null;
                    if (io) {
                        io.emit('account:initializing', { accountId: account.id });
                    }
                } catch (e) {
                    logger.error('Scheduler', `[${name}] Erro ao emitir evento account:initializing: ${e.message}`);
                }
                await sessionManager.createSession(id, name, { visible: false });
                logger.info('Scheduler', `[${name}] Nova sessão criada.`);
            }
        } catch (error) {
            logger.error('Scheduler', `Erro ao ativar conta ${name}: ${error.message}`);

            // Corrige o estado no Frontend quando houver falha (ex: timeout the proxy)
            const io = logger.getIO ? logger.getIO() : null;
            if (io) {
                io.emit('session:error', { accountName: name, error: error.message });
            }
            throw error; // Transmite o erro para cima, seja no /start API ou monitorSchedules()
        } finally {
            this.activatingAccounts.delete(account.id);
        }
    }

    /**
     * Pausa de fato a conta para liberar o IP para os companheiros do mesmo proxy_group.
     */
    async pauseAccount(account) {
        const { id, name } = account;
        const session = sessionManager.getSession(id);

        if (session) {
            session.pause(); // Método de pausa adicionado à sessão
            logger.info('Scheduler', `[${name}] Sessão colocada em pausa agendada.`);
        }
    }

    /**
     * Pausa todas as contas de um mesmo Grupo Proxy ou mesmo IP/Porta, exceto o excludeAccountId.
     */
    async pauseGroupAccounts(groupId, proxyIp, proxyPort, excludeAccountId) {
        try {
            const accounts = await db.getAllAccounts();

            // Filtra contas que compartilham o mesmo proxy_group_id OU o mesmo proxy_ip:proxy_port
            const sameGroup = accounts.filter(a => {
                if (a.id === excludeAccountId) return false;

                const hasSameGroupId = groupId && a.proxy_group_id === groupId;

                // Trata as flags booleanas e undefined, convertendo pra string se existirem pra comparação estrita
                const pIp1 = proxyIp || '';
                const pPort1 = proxyPort || '';
                const pIp2 = a.proxy_ip || '';
                const pPort2 = a.proxy_port || '';

                const hasSameIpPort = pIp1 && pIp1 === pIp2 && pPort1 === pPort2;

                return hasSameGroupId || hasSameIpPort;
            });

            for (const acc of sameGroup) {
                const sess = sessionManager.getSession(acc.id);
                if (sess && !sess.isPaused && (sess.status === 'ready' || sess.status === 'authenticated' || sess.status === 'qr')) {
                    logger.info('Scheduler', `[Proxy Conflito] Conta secundária '${acc.name}' pausada por estar no mesmo Proxy ou Grupo.`);
                    sess.pause();
                }
            }
        } catch (error) {
            logger.error('Scheduler', `Erro ao pausar grupo do proxy: ${error.message}`);
        }
    }

    /**
     * Executa trigger do Webhook do modo avião
     */
    async triggerWebhook(webhookId, accountName) {
        let hook;
        try {
            hook = await db.getWebhook(webhookId);
            if (!hook) return;

            logger.info('Scheduler', `[${accountName}] Acionando Webhook IP Change (${hook.name})... Aguardando até 20s pelo bloqueio 4G.`);

            const fetchOptions = {
                method: hook.method ? hook.method.toUpperCase() : 'GET',
                url: hook.url.trim(),
                timeout: 20000 // 20s - limite razoável para o aparelho iniciar o proxy sem travar o log principal
            };

            try {
                const response = await axios(fetchOptions);
                logger.info('Scheduler', `[${accountName}] Webhook executado com sucesso. Status HTTP: ${response.status}. Rotacionando IP!`);
            } catch (reqErr) {
                // Erros de timeout (ECONNABORTED) ou rede caindo (ECONNRESET) indicam que o comando possivelmente chegou e a rede desligou imediatamente.
                if (['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH'].includes(reqErr.code) || reqErr.message.includes('timeout')) {
                    logger.warn('Scheduler', `[${accountName}] Webhook finalizado (conexão caiu/timeout: ${reqErr.code || reqErr.message}). Normal ao rotacionar IP do Dongle.`);
                } else if (reqErr.response) {
                    // Se o proxy retornar 500 ou 400, não usamos validateStatus para disfarçar o erro HTTP no axios 
                    // a fim de mantermos o mesmo comportamento que o disparo manual (/execute) da API de webhooks.
                    logger.warn('Scheduler', `[${accountName}] Webhook retornou status ${reqErr.response.status}: ${JSON.stringify(reqErr.response.data || '')}`);
                } else {
                    throw reqErr; // Erros genuínos de DNS ou URL inválida repassamos
                }
            }

            logger.info('Scheduler', `[${accountName}] Webhook resolvido ou forçado ao reset (${hook.url.trim()}). Esperando IP estabilizar...`);
            // Limpa flag de erro anterior se o webhook funcionou
            this.lastWebhookError.delete(accountName);

            // Aguarda alguns segundos estabilizar a rotação do IP antes de conectar o whatsapp para não derrubar QR
            await new Promise(resolve => setTimeout(resolve, 8000));
        } catch (error) {
            this.lastWebhookError.set(accountName, Date.now());
            const safeUrl = hook ? hook.url.substring(0, 30) + '...' : 'Unknown';
            const msg = `Falha Crítica no Webhook de Troca de IP (${safeUrl}): ${error.message}. Segurança anti-ban acionada: Abortando inicialização da conta para evitar rodar no IP antigo!`;
            logger.error('Scheduler', `[${accountName}] ${msg}`);
            
            // ARREMESSA o erro para matar o bloco try{} principal do activateAccount(), 
            // impedindo de chamar o session.initialize() ou createSession().
            throw new Error(`Falha no Webhook de Proxy 4G. Conta bloqueada por segurança.`);
        }
    }
}

// Singleton export
const schedulerManager = new SchedulerManager();
module.exports = schedulerManager;
