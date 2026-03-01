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

                // Só processa contas que têm ambos os horários configurados
                if (!scheduled_start_time || !scheduled_end_time) continue;

                const isTimeToRun = this.isTimeInRange(currentTime, scheduled_start_time, scheduled_end_time);
                const session = sessionManager.getSession(id);
                // Se o WhatsAppSession.js pausou a conta mas o start() reinicia as variáveis, ou se status de sessionManager === paused
                const isCurrentlyActive = session && (session.status === 'ready' || session.status === 'qr' || session.status === 'authenticated') && !session.isPaused;

                // Não ativamos se a conta estiver como 'disconnected' no banco de dados
                // Isso significa que ela foi intencionalmente parada pelo usuário ou pelo reinício do sistema
                if (isTimeToRun && !isCurrentlyActive && account.status !== 'disconnected') {
                    // Está na hora de rodar as mensagens (conta deve estar ativa) -> Chama Resume / Inicializa
                    logger.info('Scheduler', `[${name}] Dentro do horário agendado (${scheduled_start_time} - ${scheduled_end_time}). Ativando...`);
                    await this.activateAccount(account);
                } else if (!isTimeToRun && isCurrentlyActive) {
                    // Fora do horário de rodar -> Pausa a Conta (Modo Avião On / Offline do WWebJS)
                    logger.info('Scheduler', `[${name}] Fora do horário agendado (${scheduled_start_time} - ${scheduled_end_time}). Pausando...`);
                    await this.pauseAccount(account);
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
        const { id, name, proxy_group_id, webhook_id } = account;

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
                    // Sessão ativa = qualquer estado exceto desconectada/pausada/erro
                    if (sess && !sess.isPaused && sess.status !== 'disconnected' && sess.status !== 'error') {
                        return true;
                    }
                }
                return false;
            });

            if (conflictAccount) {
                logger.error('Scheduler', `[${name}] INICIAÇÃO RECUSADA: O Proxy ${pIp1}:${pPort1} já está sendo utilizado pela conta "${conflictAccount.name}".`);
                return; // ABORTA O START!
            }
        }

        // Tenta acionar Webhook se configurado
        if (webhook_id) {
            await this.triggerWebhook(webhook_id, name);
        }

        try {
            if (session) {
                if (session.isPaused || session.status === 'paused') {
                    // Dispara evento resume nativo do sistema
                    session.resume();
                    logger.info('Scheduler', `[${name}] Sessão retomada.`);
                } else {
                    // Já parece rodando de alguma forma, re-conecta se preciso
                    logger.info('Scheduler', `[${name}] Tentativa de iniciar sessão já existente ignorada.`);
                }
            } else {
                // Não tem instancia ainda, cria uma nova
                await sessionManager.createSession(id, name, { visible: false });
                logger.info('Scheduler', `[${name}] Nova sessão criada.`);
            }
        } catch (error) {
            logger.error('Scheduler', `Erro ao ativar conta ${name}: ${error.message}`);
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
        try {
            const hook = await db.getWebhook(webhookId);
            if (!hook) return;

            logger.info('Scheduler', `[${accountName}] Acionando Webhook IP Change (${hook.name})...`);

            const method = hook.method ? hook.method.toUpperCase() : 'GET';
            await axios({
                method: method,
                url: hook.url,
                timeout: 5000
            });
            logger.info('Scheduler', `[${accountName}] Webhook resolvido (${hook.url}). Esperando IP estabilizar...`);

            // Aguarda alguns segundos estabilizar a rotação do IP antes de conectar o whatsapp para n derrubar QR
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            logger.error('Scheduler', `[${accountName}] Falha ao acionar Webhook de troca de IP: ${error.message}`);
        }
    }
}

// Singleton export
const schedulerManager = new SchedulerManager();
module.exports = schedulerManager;
