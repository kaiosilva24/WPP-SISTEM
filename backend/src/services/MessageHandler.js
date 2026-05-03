const fs = require('fs');
const path = require('path');
const db = require('../database/DatabaseManager');
const logger = require('../utils/logger');
const { delay, getHumanBehaviorSequence, simulateTyping, simulateRecording, formatDelay } = require('../utils/humanBehavior');
const { getFirstResponse, getFollowUpResponse, getGroupGreeting } = require('../utils/messageTemplates');

/**
 * Gerenciador de mensagens com comportamento humano (versão dinâmica)
 */
class MessageHandler {
    constructor() {
        // Rate limit (último envio bem-sucedido) por contato
        this.lastMessageTime = new Map();

        // Contador de interações por contato (usado pra escolher first vs followup template)
        this.interactions = new Map();

        // Blacklist de contatos
        this.blacklist = new Set();

        // ===== Fila por chat com coalescência =====
        // chatQueues: key = `${accountId}:${contactId}` → { batch: [Message...], processing: bool, lastTouched: ms }
        this.chatQueues = new Map();

        // Pausa global (após responder qualquer privado/grupo, segura próximas respostas do MESMO tipo)
        // key = accountId → epoch_ms_until
        this.globalPrivatePauseUntil = new Map();
        this.globalGroupPauseUntil   = new Map();

        // Carrega blacklist do arquivo
        this.loadBlacklist();
    }

    /**
     * Carrega blacklist de arquivo
     */
    loadBlacklist() {
        try {
            const blacklistFile = 'contatos_sair.txt';
            if (fs.existsSync(blacklistFile)) {
                const content = fs.readFileSync(blacklistFile, 'utf-8');
                const numbers = content.split('\n').map(n => n.trim()).filter(n => n.length > 0);
                numbers.forEach(n => this.blacklist.add(n));
                logger.info(null, `Blacklist carregada: ${this.blacklist.size} contatos`);
            }
        } catch (error) {
            logger.error(null, `Erro ao carregar blacklist: ${error.message}`);
        }
    }

    /**
     * Adiciona contato à blacklist
     */
    addToBlacklist(phoneNumber) {
        this.blacklist.add(phoneNumber);

        try {
            fs.appendFileSync('contatos_sair.txt', `${phoneNumber}\n`);
            logger.info(null, `Contato adicionado à blacklist: ${phoneNumber}`);
        } catch (error) {
            logger.error(null, `Erro ao salvar blacklist: ${error.message}`);
        }
    }

    /**
     * Obtém configuração da conta
     */
    getAccountConfig(session) {
        return session.config || {
            min_message_interval: 20000,
            min_read_delay: 3000,
            max_read_delay: 15000,
            min_typing_delay: 5000,
            max_typing_delay: 20000,
            min_response_delay: 10000,
            max_response_delay: 30000,
            media_enabled: true,
            media_interval: 2
        };
    }

    /**
     * Filtros baratos antes de enfileirar. ACEITAMOS msgs sem texto também — assim o drain
     * consegue marcá-las como lidas (ticket azul), mesmo que não responda.
     * Concorrência e rate-limit viraram GATES dentro do drain — não descartam mais.
     */
    _shouldEnqueue(session, contactId) {
        const myUser = session.client && session.client.info && session.client.info.wid && session.client.info.wid.user;
        if (myUser && contactId.startsWith(myUser)) {
            logger.messageIgnored(session.accountName, contactId, 'próprio número');
            return false;
        }
        const phoneNumber = contactId.split('@')[0];
        if (this.blacklist.has(phoneNumber)) {
            logger.messageIgnored(session.accountName, contactId, 'na blacklist');
            return false;
        }
        return true;
    }

    /**
     * Determina se a msg tem texto suficiente pra disparar uma resposta de template.
     */
    _hasReplyableText(message) {
        return !!(message && typeof message.body === 'string' && message.body.trim().length > 0);
    }

    /**
     * Espera dentro do drain caso a pausa global do tipo (privado/grupo) esteja ativa.
     * Não descarta a msg — apenas retém até o tempo passar.
     */
    async _waitGlobalPause(session, contactId) {
        const isGroup = contactId.endsWith('@g.us');
        const map = isGroup ? this.globalGroupPauseUntil : this.globalPrivatePauseUntil;
        const until = map.get(session.accountId) || 0;
        const wait = until - Date.now();
        if (wait > 0) {
            logger.info(session.accountName,
                `⏸️  Pausa global ${isGroup ? 'grupo' : 'privado'} ativa: aguardando ${formatDelay(wait)} antes de responder a ${contactId}`);
            await delay(wait);
        }
    }

    /**
     * Aplica pausa global após resposta bem-sucedida.
     */
    _setGlobalPause(session, contactId) {
        const cfg = this.getAccountConfig(session);
        const isGroup = contactId.endsWith('@g.us');
        const minutes = isGroup
            ? (cfg.global_group_delay_minutes || 0)
            : (cfg.global_private_delay_minutes || 0);
        if (minutes > 0) {
            const map = isGroup ? this.globalGroupPauseUntil : this.globalPrivatePauseUntil;
            map.set(session.accountId, Date.now() + minutes * 60_000);
            logger.info(session.accountName,
                `⏱️  Pausa global ${isGroup ? 'grupo' : 'privado'} disparada por ${minutes} min`);
        }
    }

    /**
     * Espera o intervalo mínimo entre mensagens pro mesmo contato (rate-limit).
     * Em vez de descartar, aguarda.
     */
    async _waitRateLimit(session, contactId) {
        const cfg = this.getAccountConfig(session);
        const lastTime = this.lastMessageTime.get(contactId);
        if (!lastTime) return;
        const timeSince = Date.now() - lastTime;
        const min = cfg.min_message_interval || 20000;
        if (timeSince < min) {
            const remaining = min - timeSince;
            logger.info(session.accountName,
                `⏳ rate-limit ${contactId}: aguardando ${formatDelay(remaining)} antes de responder`);
            await delay(remaining);
        }
    }

    /**
     * Obtém mensagem personalizada da conta (tenant-scoped) ou cai pra templates padrão.
     * Em qualquer falha, sempre retorna um template — nunca lança, pra não silenciar a resposta.
     */
    async getResponseMessage(session, contactId, name, isGroup, isFirstInteraction) {
        const messageType = isGroup ? 'group' : (isFirstInteraction ? 'first' : 'followup');

        try {
            if (session.tenantId) {
                const tdb = db.tenant(session.tenantId);
                const customMessages = await tdb.getAccountMessages(session.accountId, messageType);
                if (customMessages && customMessages.length > 0) {
                    const randomMsg = customMessages[Math.floor(Math.random() * customMessages.length)];
                    const firstName = (name || 'Cliente').split(' ')[0];
                    return randomMsg.message_text
                        .replace('{nome}', firstName)
                        .replace('{grupo}', name || 'Grupo');
                }
            }
        } catch (e) {
            logger.warn(session.accountName, `Falha ao buscar mensagens custom (caindo pra templates): ${e.message}`);
        }

        if (isGroup) return getGroupGreeting(name || 'Grupo', contactId);
        if (isFirstInteraction) return getFirstResponse(name || 'Cliente', contactId);
        return getFollowUpResponse(name || 'Cliente', contactId);
    }

    /**
     * Ponto de entrada: enfileira a mensagem na fila do chat correspondente.
     * Múltiplas msgs do mesmo chat coalescem — uma resposta única por rajada.
     */
    handleMessage(session, message) {
        const contactId = message.from;

        if (!this._shouldEnqueue(session, contactId)) return;

        const key = `${session.accountId}:${contactId}`;
        let q = this.chatQueues.get(key);
        if (!q) {
            q = { batch: [], processing: false, lastTouched: Date.now() };
            this.chatQueues.set(key, q);
        }
        q.batch.push(message);
        q.lastTouched = Date.now();

        const status = q.processing ? '(em processamento, agrupando)' : '(novo, vai drenar)';
        const bodyPreview = this._hasReplyableText(message)
            ? `body="${message.body.slice(0, 40)}"`
            : `(sem texto, será só lida)`;
        logger.info(session.accountName, `📋 ${contactId} batch=${q.batch.length} ${status} ${bodyPreview}`);

        // Snapshot global da fila pra essa sessão
        this._logQueueSnapshot(session);

        if (!q.processing) {
            q.processing = true;
            this._drainChat(session, contactId, q)
                .catch((e) => logger.error(session.accountName, `Drain ${contactId} crashou: ${e.message}`))
                .finally(() => {
                    q.processing = false;
                    // GC: se ficou idle e batch vazio, marca pra possível remoção
                    if (q.batch.length === 0) {
                        // remove se não for tocada em 30 min (evita memória crescer indefinidamente)
                        setTimeout(() => {
                            const cur = this.chatQueues.get(key);
                            if (cur && !cur.processing && cur.batch.length === 0 && (Date.now() - cur.lastTouched) > 30 * 60_000) {
                                this.chatQueues.delete(key);
                            }
                        }, 30 * 60_000).unref?.();
                    }
                });
        }
    }

    /**
     * Loga um snapshot da fila pra essa sessão: lista de chats com msgs pendentes.
     * Aparece nos "Terminais Ao Vivo" toda vez que uma msg chega ou é respondida.
     */
    _logQueueSnapshot(session) {
        const lines = [];
        let totalQueued = 0;
        let active = 0;
        const prefix = `${session.accountId}:`;
        for (const [key, q] of this.chatQueues.entries()) {
            if (!key.startsWith(prefix)) continue;
            if (q.batch.length === 0 && !q.processing) continue;
            const chatId = key.slice(prefix.length);
            const flag = q.processing ? '🔄' : '⏳';
            const isGroup = chatId.endsWith('@g.us') ? '[grupo]' : '[priv]';
            lines.push(`   ${flag} ${isGroup} ${chatId}: ${q.batch.length} pendente(s)`);
            totalQueued += q.batch.length;
            if (q.processing) active++;
        }
        if (lines.length === 0) {
            logger.info(session.accountName, '📊 Fila vazia');
            return;
        }
        logger.info(session.accountName,
            `📊 Fila (${this.chatQueues.size} chat(s) total, ${active} processando, ${totalQueued} pendente(s)):\n${lines.join('\n')}`);
    }

    /**
     * Drena a fila de UM chat. Para cada rajada (snapshot do batch atual):
     *   1. readDelay aleatório — comportamento humano: "ainda não vi a mensagem"
     *   2. markRead em todas as msgs do snapshot — ticket azul
     *   3. (se houver msg com texto) → processNormalMessage com o alvo mais recente
     *   4. (se não houver texto) → loga "lidas, sem texto pra responder"
     *
     * Se durante a resposta chegarem mais msgs no batch, faz outra rodada (nova rajada).
     */
    async _drainChat(session, contactId, q) {
        const cfg = this.getAccountConfig(session);

        while (q.batch.length > 0) {
            const snapshot = q.batch.slice();
            q.batch.length = 0;

            // Comando SAIR — atende imediatamente, ignora coalescência (mas ainda respeita read delay)
            const sair = snapshot.find((m) => m.body && m.body.toLowerCase().includes('sair'));
            if (sair) {
                try {
                    const rd = this._randomBetween(cfg.min_read_delay, cfg.max_read_delay);
                    logger.info(session.accountName, `🕒 readDelay ${formatDelay(rd)} antes de abrir chat ${contactId}`);
                    await delay(rd);
                    if (sair._raw) await session.markRead(sair._raw);
                    logger.info(session.accountName, `👁️  Lida (ticket azul) — comando SAIR de ${contactId}`);
                    await this.handleExitCommand(session, contactId);
                } catch (e) {
                    logger.error(session.accountName, `handleExitCommand falhou: ${e.message}`);
                }
                this._logQueueSnapshot(session);
                continue;
            }

            // 1) readDelay aleatório ANTES de marcar como lido (humano não vê na hora)
            const readDelay = this._randomBetween(cfg.min_read_delay, cfg.max_read_delay);
            logger.info(session.accountName,
                `🕒 readDelay ${formatDelay(readDelay)} antes de abrir chat ${contactId} (${snapshot.length} msg(s) na rajada)`);
            await delay(readDelay);

            // 2) Marca TODAS as msgs do snapshot como lidas (ticket azul real, agora sim)
            let readOk = 0;
            for (const m of snapshot) {
                try {
                    if (m._raw) {
                        await session.markRead(m._raw);
                        readOk++;
                    }
                } catch (_) {}
            }
            logger.info(session.accountName, `👁️  Lidas (ticket azul) ${readOk}/${snapshot.length} msg(s) de ${contactId}`);

            // 3) Pequeno delay "absorvendo" o conteúdo (1-3s)
            await delay(1000 + Math.floor(Math.random() * 2000));

            // 4) Escolhe alvo: a mais recente COM texto. Se não houver, só ficou marcado como lido.
            snapshot.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            const replyable = snapshot.filter((m) => this._hasReplyableText(m));
            if (replyable.length === 0) {
                logger.info(session.accountName,
                    `📭 ${contactId}: ${snapshot.length} msg(s) lida(s), sem texto pra responder (provável mídia/figurinha)`);
                this._logQueueSnapshot(session);
                continue;
            }
            const target = replyable[replyable.length - 1];

            // Gates de pausa global e rate-limit (seguram, não descartam)
            await this._waitGlobalPause(session, contactId);
            await this._waitRateLimit(session, contactId);

            try {
                await this.processNormalMessage(session, contactId, target);
            } catch (e) {
                logger.error(session.accountName, `Falha drenando ${contactId}: ${e.message}\n${e.stack || ''}`);
            }

            // Após cada resposta, snapshot atualizado
            this._logQueueSnapshot(session);
        }
    }

    _randomBetween(min, max) {
        const lo = Number(min) || 0;
        const hi = Number(max) || lo;
        if (hi <= lo) return lo;
        return Math.floor(Math.random() * (hi - lo) + lo);
    }

    /**
     * Processa comando SAIR
     */
    async handleExitCommand(session, contactId) {
        try {
            const contact = await session.getContact(contactId);
            const phoneNumber = contact.number;

            // Adiciona à blacklist
            this.addToBlacklist(phoneNumber);

            // Envia mensagem de despedida
            const config = this.getAccountConfig(session);
            const behavior = {
                typingDelay: Math.floor((config.min_typing_delay + config.max_typing_delay) / 2)
            };

            logger.behavior(session.accountName, 'Delay de digitação', formatDelay(behavior.typingDelay));
            await delay(behavior.typingDelay);

            await session.sendMessage(contactId, '🛞 OBGD, A SPACE TIRE AGRADECE! 🛞');
            logger.messageSent(session.accountName, contactId, 'Despedida');

        } catch (error) {
            logger.error(session.accountName, `Erro ao processar comando SAIR: ${error.message}`);
        }
    }

    /**
     * Processa UMA resposta (a mensagem alvo da rajada). Já chega com:
     *  - todas as msgs da rajada lidas (ticket azul) pelo `_drainChat`
     *  - readDelay já consumido pelo `_drainChat` (humano abriu o chat)
     *  - gates de pausa global e rate-limit já liberados
     *
     * Aqui acontece: pré-escolha do que vai enviar (texto ou mídia + kind),
     * presença adequada (digitando OU gravando), responseDelay, envio.
     */
    async processNormalMessage(session, contactId, message = null) {
        const t0 = Date.now();
        try {
            const config = this.getAccountConfig(session);
            const chat = await session.getChat(contactId);
            const isGroup = contactId.includes('@g.us');

            // Nome do contato/grupo
            let name = 'Cliente';
            if (isGroup) {
                name = (chat && chat.name) || 'Grupo';
            } else if (message && message.pushName) {
                name = message.pushName;
            } else {
                try {
                    const contact = await session.getContact(contactId);
                    name = contact.pushname || contact.name || 'Cliente';
                } catch (_) {}
            }

            const targetBody = (message && message.body || '').slice(0, 60);
            logger.info(session.accountName,
                `▶️  processNormalMessage chat=${contactId} isGroup=${isGroup} alvo="${targetBody}" status=${session.status}`);

            const interactionCount = this.interactions.get(contactId) || 0;
            const isFirstInteraction = interactionCount === 0;

            const responseText = await this.getResponseMessage(session, contactId, name, isGroup, isFirstInteraction);

            // Delays randomizados (readDelay foi consumido no drain)
            const typingDelay   = this._randomBetween(config.min_typing_delay,   config.max_typing_delay);
            const responseDelay = this._randomBetween(config.min_response_delay, config.max_response_delay);
            const shouldIgnore  = Math.random() * 100 < (config.ignore_probability || 0);

            // Comportamento humano: probabilidade de ignorar (não na primeira interação)
            if (shouldIgnore && !isFirstInteraction) {
                logger.info(session.accountName,
                    `🙈 ignorando "${targetBody}" (ignore_probability=${config.ignore_probability}%)`);
                return;
            }

            // Pré-escolhe se vai enviar mídia E qual tipo (pra escolher a presença certa)
            const shouldSendMedia = !!config.media_enabled
                && interactionCount > 0
                && (interactionCount % (config.media_interval || 1) === 0);

            let mediaPick = null;
            if (shouldSendMedia) {
                mediaPick = this.pickRandomMedia(session);
                if (!mediaPick) {
                    logger.warn(session.accountName, 'media_enabled=true mas não há arquivos disponíveis — caindo pra texto');
                }
            }

            const willSendAudio = !!(mediaPick && mediaPick.kind === 'audio');
            const presenceKind = willSendAudio ? 'gravando' : 'digitando';

            logger.info(session.accountName,
                `🎭 typingDelay ${formatDelay(typingDelay)} | responseDelay ${formatDelay(responseDelay)} | ação=${willSendAudio ? 'áudio' : (mediaPick ? mediaPick.kind : 'texto')}`);

            // Presença: digitando OU gravando, durante typingDelay
            logger.info(session.accountName, `⌨️  ${presenceKind} por ${formatDelay(typingDelay)}`);
            try {
                if (willSendAudio) {
                    await simulateRecording(chat, typingDelay);
                } else {
                    await simulateTyping(chat, typingDelay);
                }
            } catch (e) {
                logger.warn(session.accountName, `simulate ${presenceKind}: ${e.message}`);
            }

            // Limpa estado de presença (paused) — sutileza humana
            try { if (chat.clearState) await chat.clearState(); } catch (_) {}

            // Delay final antes do envio
            await delay(responseDelay);

            // Envia
            if (mediaPick) {
                logger.info(session.accountName, `📤 → ${contactId}: [${mediaPick.kind}] ${path.basename(mediaPick.path)}`);
                try {
                    await session.sendMedia(contactId, mediaPick.path);
                } catch (e) {
                    logger.error(session.accountName, `Falha enviando mídia, caindo pra texto: ${e.message}`);
                    logger.info(session.accountName, `📤 → ${contactId}: "${responseText}"`);
                    await session.sendMessage(contactId, responseText);
                }
            } else {
                logger.info(session.accountName, `📤 → ${contactId}: "${responseText}"`);
                await session.sendMessage(contactId, responseText);
            }

            const elapsed = Date.now() - t0;
            logger.info(session.accountName, `✅ resposta enviada em ${formatDelay(elapsed)} pra ${name}`);

            // Atualiza contadores
            this.interactions.set(contactId, interactionCount + 1);
            this.lastMessageTime.set(contactId, Date.now());

            // Dispara pausa global do tipo (privado/grupo) conforme config
            this._setGlobalPause(session, contactId);

            // Atualiza estatísticas no banco (tenant-scoped, nunca quebra o fluxo)
            try {
                if (session.tenantId) {
                    await db.tenant(session.tenantId).updateStats(session.accountId, {
                        unique_contacts: this.interactions.size
                    });
                }
            } catch (e) {
                logger.warn(session.accountName, `Falha ao atualizar stats: ${e.message}`);
            }

        } catch (error) {
            logger.error(session.accountName, `Erro ao processar mensagem: ${error.message}`);
            throw error;
        }
    }

    /**
     * Coleta arquivos de mídia disponíveis pra essa conta (tenant + defaults).
     * Estrutura: media/[tenant-N/]{images,videos,stickers,audio}/<arquivo>
     */
    _collectMediaCandidates(session) {
        const baseRoot = path.join(__dirname, '..', '..', '..', 'media');
        const tenantSegment = session.tenantId ? `tenant-${session.tenantId}` : null;
        const candidates = [];
        const subcats = ['images', 'videos', 'stickers', 'audio'];
        const exts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.mov', '.mp3', '.ogg', '.m4a'];

        const collect = (dir) => {
            if (!fs.existsSync(dir)) return;
            for (const f of fs.readdirSync(dir)) {
                if (f.startsWith('.')) continue;
                const full = path.join(dir, f);
                try {
                    if (fs.statSync(full).isFile() && exts.some((e) => f.toLowerCase().endsWith(e))) {
                        candidates.push(full);
                    }
                } catch (_) {}
            }
        };
        for (const cat of subcats) {
            if (tenantSegment) collect(path.join(baseRoot, tenantSegment, cat));
            collect(path.join(baseRoot, cat));
        }
        return candidates;
    }

    _kindOfMedia(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        if (['.jpg', '.jpeg', '.png', '.gif'].includes(ext)) return 'image';
        if (ext === '.webp') return 'sticker';
        if (['.mp4', '.mov'].includes(ext)) return 'video';
        if (['.mp3', '.ogg', '.m4a'].includes(ext)) return 'audio';
        return 'document';
    }

    /**
     * Sorteia uma mídia aleatória. Retorna { path, kind } ou null se não houver.
     */
    pickRandomMedia(session) {
        const candidates = this._collectMediaCandidates(session);
        if (candidates.length === 0) return null;
        const chosen = candidates[Math.floor(Math.random() * candidates.length)];
        return { path: chosen, kind: this._kindOfMedia(chosen) };
    }

    /**
     * Envia mídia aleatória (façade — usado fora do drain quando não precisa pré-saber kind).
     */
    async sendRandomMedia(session, contactId) {
        const pick = this.pickRandomMedia(session);
        if (!pick) {
            logger.warn(session.accountName, 'Nenhum arquivo de mídia encontrado');
            return;
        }
        try {
            await session.sendMedia(contactId, pick.path);
            logger.messageSent(session.accountName, contactId, `Mídia (${path.basename(pick.path)})`);
        } catch (error) {
            logger.error(session.accountName, `Erro ao enviar mídia: ${error.message}`);
        }
    }

    /**
     * Processa mensagens não lidas ao iniciar
     */
    async processUnreadMessages(session) {
        // Baileys não fornece histórico de chats sem um store persistente.
        // Mensagens novas são tratadas pelo handler de `messages.upsert` em tempo real.
        if (session.status !== 'ready') return;
        logger.info(session.accountName, 'Pronto para receber novas mensagens (Baileys)');
    }

    /**
     * Obtém estatísticas
     */
    getStats() {
        let queued = 0;
        let processing = 0;
        for (const q of this.chatQueues.values()) {
            queued += q.batch.length;
            if (q.processing) processing++;
        }
        return {
            totalInteractions: this.interactions.size,
            blacklistSize: this.blacklist.size,
            chatsWithQueue: this.chatQueues.size,
            queued,
            processing
        };
    }
}

// Singleton
const messageHandler = new MessageHandler();

module.exports = messageHandler;
