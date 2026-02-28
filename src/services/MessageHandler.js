const { MessageMedia } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('../database/DatabaseManager');
const logger = require('../utils/logger');
const { delay, getHumanBehaviorSequence, simulateTyping, formatDelay } = require('../utils/humanBehavior');
const { getFirstResponse, getFollowUpResponse, getGroupGreeting } = require('../utils/messageTemplates');
const { parseSpintax } = require('../utils/spintax');

// ffmpeg embutido via npm — usa execFile com caminho absoluto (evita spawn ENOENT no Windows)
const { execFile } = require('child_process');
let ffmpegBinPath = null;
try {
    const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
    const testPath = ffmpegInstaller.path;
    if (require('fs').existsSync(testPath)) {
        ffmpegBinPath = testPath;
        console.log('[ffmpeg] ✅ Binário encontrado:', ffmpegBinPath);
    } else {
        console.warn('[ffmpeg] ⚠️ Binário não existe em:', testPath);
    }
} catch (e) {
    console.warn('[ffmpeg] ⚠️ Falha ao localizar ffmpeg-installer:', e.message);
}

// Mantemos a variável ffmpeg para compatibilidade (true se disponível)
const ffmpeg = !!ffmpegBinPath;

/**
 * Converte qualquer áudio (mp3, wav, m4a) para OGG/Opus em arquivo temporário.
 * Usa execFile com caminho absoluto — funçiona no Windows mesmo com espaços no path.
 */
function convertToOggOpus(inputPath) {
    return new Promise((resolve, reject) => {
        if (!ffmpegBinPath) {
            return reject(new Error('ffmpeg binário não localizado'));
        }
        const tmpFile = path.join(os.tmpdir(), `audio_conv_${Date.now()}_${Math.random().toString(16).slice(2, 6)}.ogg`);
        execFile(ffmpegBinPath, [
            '-y',           // sobrescreve arquivo de saída sem perguntar
            '-i', inputPath,
            '-c:a', 'libopus',
            '-b:a', '32k',
            '-ac', '1',
            '-ar', '48000',
            '-vbr', 'on',
            tmpFile
        ], { timeout: 60000 }, (err, stdout, stderr) => {
            if (err) {
                return reject(new Error(`ffmpeg erro: ${err.message}`));
            }
            resolve(tmpFile);
        });
    });
}

/**
 * Envia áudio OGG/Opus como PTT (nota de voz) via Puppeteer.
 * Injeta diretamente no WhatsApp Web sem usar sendAudioAsVoice,
 * contornando o problema do AudioContext no Chromium headless sem WebRTC.
 */
async function sendPTTViaPuppeteer(session, contactId, base64Audio, mimeType, filename) {
    try {
        const result = await session.client.pupPage.evaluate(async (chatId, b64, mime, fname) => {
            try {
                const chat = await window.WWebJS.getChat(chatId, { getAsModel: false });
                if (!chat) return { ok: false, err: 'chat not found' };

                // Cria o File a partir do base64
                const bin = atob(b64);
                const arr = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                const blob = new Blob([arr], { type: mime });
                const file = new File([blob], fname, { type: mime, lastModified: Date.now() });

                // Processa como mídia com isPtt=true
                const opaqueData = await window.Store.OpaqueData.createFromData(file, mime);
                const mediaPrep = window.Store.MediaPrep.prepRawMedia(opaqueData, { isPtt: true });
                const mediaData = await mediaPrep.waitForPrep();

                // Gera waveform vazia (evita AudioContext que falha sem WebRTC)
                mediaData.waveform = new Uint8Array(64).fill(0);

                if (!(mediaData.mediaBlob instanceof window.Store.OpaqueData)) {
                    mediaData.mediaBlob = await window.Store.OpaqueData.createFromData(
                        mediaData.mediaBlob, mediaData.mediaBlob.type
                    );
                }
                mediaData.renderableUrl = mediaData.mediaBlob.url();

                const mediaObject = window.Store.MediaObject.getOrCreateMediaObject(mediaData.filehash);
                const mediaType = window.Store.MediaTypes.msgToMediaType({ type: mediaData.type, isGif: false });
                mediaObject.consolidate(mediaData.toJSON());
                mediaData.mediaBlob.autorelease();

                const uploadedMedia = await window.Store.MediaUpload.uploadMedia({
                    mimetype: mediaData.mimetype,
                    mediaObject,
                    mediaType
                });

                const entry = uploadedMedia?.mediaEntry;
                if (!entry) return { ok: false, err: 'upload failed' };

                mediaData.set({
                    clientUrl: entry.mmsUrl,
                    deprecatedMms3Url: entry.deprecatedMms3Url,
                    directPath: entry.directPath,
                    mediaKey: entry.mediaKey,
                    mediaKeyTimestamp: entry.mediaKeyTimestamp,
                    filehash: mediaObject.filehash,
                    encFilehash: entry.encFilehash,
                    uploadhash: entry.uploadHash,
                    size: mediaObject.size,
                    streamingSidecar: entry.sidecar,
                });

                const from = window.Store.User.getMaybeMePnUser();
                const newId = await window.Store.MsgKey.newId();
                const ephemeral = window.Store.EphemeralFields.getEphemeralFields(chat);
                const mediaJson = mediaData.toJSON ? mediaData.toJSON() : {};
                const msg = {
                    ...ephemeral,
                    id: new window.Store.MsgKey({ from, to: chat.id, id: newId, selfDir: 'out' }),
                    ack: 0,
                    body: '',
                    from,
                    to: chat.id,
                    local: true,
                    self: 'out',
                    t: Math.floor(Date.now() / 1000),
                    isNewMsg: true,
                    ...mediaJson,
                    // FORÇAR tipo PTT — prepRawMedia pode retornar 'audio' em Chromium headless
                    type: 'ptt',
                };

                await window.Store.SendMessage.addAndSendMsgToChat(chat, msg);
                return { ok: true };
            } catch (e) {
                return { ok: false, err: e.message };
            }
        }, contactId, base64Audio, mimeType, filename);

        return result;
    } catch (e) {
        return { ok: false, err: e.message };
    }
}

/**
 * Gerenciador de mensagens com comportamento humano (versão dinâmica)
 */
class MessageHandler {
    constructor() {
        // Controle de rate limiting por contato
        this.lastMessageTime = new Map();

        // Controle de processamento em andamento
        this.processing = new Set();

        // Contador de interações por contato
        this.interactions = new Map();

        // Blacklist de contatos
        this.blacklist = new Set();

        // Contador de respostas enviadas por conta (para pausa)
        this.responseCount = new Map(); // accountId -> count

        // Pausa ativa por conta: accountId -> timestamp até quando pausar
        this.pauseUntil = new Map();

        // Última vez que recebeu mensagem por conta (para auto-warm)
        this.lastReceivedTime = new Map(); // accountId -> Date.now()

        // Controle de cooldown global de grupos: accountId -> timestamp até quando ignorar TODOS os grupos
        this.globalGroupCooldown = new Map();

        // Trava para processar apenas UM grupo por vez na conta
        this.globalGroupProcessing = new Set(); // contêm accountIds que estão processando um grupo ativamente

        // Controle de cooldown global de contatos privados (1 a 1): accountId -> timestamp
        this.globalPrivateCooldown = new Map();

        // Trava para processar apenas UM contato privado por vez na conta
        this.globalPrivateProcessing = new Set();

        // **Novo Sistema de Fila Inteligente (Queue)**
        // accountId -> { private: [{ session, message, contactId }], group: [...] }
        this.globalQueue = new Map();

        // Carrega blacklist do arquivo
        this.loadBlacklist();

        // Inicia o processador de fila
        this.startQueueProcessor();
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
     * Força a interface do WhatsApp Web a remover a bolinha verde (marcar como lido)
     * Usando uma combinação de sendSeen e clique na UI como fallback caso a engine do WWebJS falhe
     */
    async forceMarkRead(session, contactId) {
        if (!session || !session.client || !session.client.pupPage) return;

        try {
            await session.client.pupPage.evaluate(async (chatId) => {
                try {
                    // Tenta o método interno injetado pelo whatsapp-web.js para forçar a marcação de lido
                    if (window.WWebJS && typeof window.WWebJS.sendSeen === 'function') {
                        await window.WWebJS.sendSeen(chatId);
                    }

                    // Fallback visual extremo: Tenta clicar no chat na lista lateral se a bolinha ainda existir
                    // O formato do chatId no DOM costuma ter o número ou ID parcial
                    setTimeout(() => {
                        const unreadBadges = document.querySelectorAll('span[aria-label*="não lida"], span[aria-label*="unread"]');
                        unreadBadges.forEach(badge => {
                            // Se a div pai deste badge tiver o número do contato, clica nela para forçar a leitura
                            const chatRow = badge.closest('[role="listitem"]');
                            if (chatRow && chatRow.innerHTML.includes(chatId.split('@')[0])) {
                                chatRow.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                                chatRow.click();
                            }
                        });
                    }, 500); // Aguarda meio segundo pro React atualizar o DOM

                } catch (e) {
                    // Ignora silenciosamente
                }
            }, contactId);
        } catch (e) {
            logger.warn(session.accountName, `⚠️ Falha ao forçar bolinha verde para lido: ${e.message}`);
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
     * Verifica bloqueios PRIMÁRIOS (Scams, Blacklist, Próprio Número, etc)
     * Retorna false APENAS para mensagens que devem ser definitivamente ignoradas e NUNCA respondidas
     */
    shouldProcessMessage(session, contactId, messageBody) {
        const config = this.getAccountConfig(session);

        // Ignora mensagens do próprio número
        if (session.client.info && contactId.startsWith(session.client.info.wid.user)) {
            logger.messageIgnored(session.accountName, contactId, 'próprio número');
            return false;
        }

        // Ignora notificações de sistema (nunca têm body nem tipo de mídia)
        // Áudio, imagem, vídeo e figurinha têm body vazio mas NÃO são notificação
        const SYSTEM_TYPES = ['e2e_notification', 'notification_template', 'notification', 'call_log', 'protocol', 'gp2'];
        if (messageBody && SYSTEM_TYPES.includes(messageBody.type)) {
            logger.messageIgnored(session.accountName, contactId, `notificação de sistema`);
            return false;
        }

        // Verifica blacklist
        const phoneNumber = contactId.split('@')[0];
        if (this.blacklist.has(phoneNumber)) {
            logger.messageIgnored(session.accountName, contactId, 'na blacklist');
            return false;
        }

        // Verifica se grupos estão desativados para esta conta
        if (contactId.includes('@g.us')) {
            if (config.group_enabled === false) {
                logger.info(session.accountName, `🚫 Grupos desativados — ignorando mensagem de ${contactId}`);
                return false;
            }
        }

        return true; // Mensagem válida para ir para a Fila Pessoal ou Processamento
    }

    /**
     * Motor da Fila de Espera (Queue Processor)
     * Roda a cada 5 segundos verificando se as contas estão livres para processar novas mensagens
     */
    startQueueProcessor() {
        setInterval(async () => {
            for (const [accountId, queues] of this.globalQueue.entries()) {
                // Tenta processar Grupo
                if (queues.group.length > 0) {
                    if (!this.globalGroupProcessing.has(accountId)) {
                        const cooldownEnd = this.globalGroupCooldown.get(accountId);
                        if (!cooldownEnd || Date.now() >= cooldownEnd) {
                            // Conta livre! Desenfileira e processa
                            const item = queues.group.shift();
                            this.globalGroupProcessing.add(accountId);
                            // Processa de forma síncrona/segura o release do lock para não prender a fila
                            (async () => {
                                try {
                                    await this.executeQueueItem(item, true);
                                } catch (e) {
                                    logger.error(accountId, `Erro não tratado na fila de grupos: ${e.message}`);
                                } finally {
                                    this.globalGroupProcessing.delete(accountId);
                                }
                            })();
                        }
                    }
                }

                // Tenta processar Privado
                if (queues.private.length > 0) {
                    if (!this.globalPrivateProcessing.has(accountId)) {
                        const cooldownEnd = this.globalPrivateCooldown.get(accountId);
                        if (!cooldownEnd || Date.now() >= cooldownEnd) {
                            // Conta livre! Desenfileira e processa
                            const item = queues.private.shift();
                            this.globalPrivateProcessing.add(accountId);
                            // Processa de forma síncrona/segura o release do lock para não prender a fila
                            (async () => {
                                try {
                                    await this.executeQueueItem(item, false);
                                } catch (e) {
                                    logger.error(accountId, `Erro não tratado na fila privada: ${e.message}`);
                                } finally {
                                    this.globalPrivateProcessing.delete(accountId);
                                }
                            })();
                        }
                    }
                }
            }
        }, 5000);
    }

    /**
     * Executa a mensagem que foi tirada da fila
     */
    async executeQueueItem(item, isGroup) {
        const { session, message, contactId } = item;
        const processingKey = `${session.accountId}_${contactId}`;

        try {
            this.processing.add(processingKey);

            // Loga tipo da mensagem sendo desenfileirada
            const msgTypeLabel = message.type || 'chat';
            const bodyPreview = message.body ? `"${message.body.substring(0, 40)}"` : `[📲 ${msgTypeLabel}]`;
            logger.info(session.accountName, `📥 Desenfileirando: ${bodyPreview} de ${contactId}`);

            await this.processNormalMessage(session, contactId, message);
        } catch (error) {
            logger.error(session.accountName, `Erro ao processar mensagem da fila para ${contactId}: ${error.message}`);
        } finally {
            this.processing.delete(processingKey);
        }
    }

    /**
     * Obtém mensagem personalizada da conta ou usa padrão
     */
    async getResponseMessage(session, contactId, name, isGroup, isFirstInteraction) {
        // Tenta obter mensagens personalizadas do banco
        const messageType = isGroup ? 'group' : (isFirstInteraction ? 'first' : 'followup');
        const customMessages = await db.getAccountMessages(session.accountId, messageType);

        let responseText = '';

        if (customMessages && customMessages.length > 0) {
            // Usa mensagem personalizada aleatória
            const randomMsg = customMessages[Math.floor(Math.random() * customMessages.length)];
            const firstName = name.split(' ')[0];

            // Substitui placeholders
            responseText = randomMsg.message_text
                .replace('{nome}', firstName)
                .replace('{grupo}', name);
        } else {
            // Usa mensagens padrão
            if (isGroup) {
                responseText = getGroupGreeting(name, contactId);
            } else if (isFirstInteraction) {
                responseText = getFirstResponse(name, contactId);
            } else {
                responseText = getFollowUpResponse(name, contactId);
            }
        }

        // Aplica Spintax ({Opção A|Opção B})
        return parseSpintax(responseText);
    }

    /**
     * Aplica o Cooldown Global após responder
     */
    applyGlobalCooldown(session, isGroup) {
        const config = this.getAccountConfig(session);
        if (isGroup) {
            const globalGroupDelayMinutes = config.global_group_delay_minutes || 0;
            if (globalGroupDelayMinutes > 0) {
                this.globalGroupCooldown.set(session.accountId, Date.now() + (globalGroupDelayMinutes * 60 * 1000));
                logger.info(session.accountName, `⏱️ Pausa Global: ${globalGroupDelayMinutes} min para Grupos ativada com sucesso`);
            }
        } else {
            const globalPrivateDelayMinutes = config.global_private_delay_minutes || 0;
            if (globalPrivateDelayMinutes > 0) {
                this.globalPrivateCooldown.set(session.accountId, Date.now() + (globalPrivateDelayMinutes * 60 * 1000));
                logger.info(session.accountName, `⏱️ Pausa Global: ${globalPrivateDelayMinutes} min para Privados ativada com sucesso`);
            }
        }
    }

    /**
     * Tenta processar rate limiting antes da fila
     */
    checkRateLimit(session, contactId) {
        const lastTime = this.lastMessageTime.get(contactId);
        if (lastTime) {
            const config = this.getAccountConfig(session);
            const timeSince = Date.now() - lastTime;
            const isGroup = contactId.includes('@g.us');
            const interactionCount = this.interactions.get(contactId) || 0;
            const isFirstInteraction = interactionCount === 0;

            const minInterval = isGroup
                ? (config.group_min_message_interval || 20000)
                : (config.min_message_interval || 20000);

            // Permite bypass do rate limit se for mensagem sequencial dentro da mesma sessão de interação (primeira vez)
            // Se já interagiu antes e o contato mandou msg rápida demais, ignora pra não parecer bot
            if (timeSince < minInterval && !isFirstInteraction) {
                logger.messageIgnored(session.accountName, contactId, `muito rápido (${formatDelay(timeSince)} < ${formatDelay(minInterval)})`);
                return false;
            }
        }
        return true;
    }

    /**
     * Enfileira ou Recusa a mensagem recebida baseando-se no Lock de Fila
     */
    async handleMessage(session, message, isHistory = false) {
        const contactId = message.from;

        try {
            // 1. Filtros Absolutos (Bots, Grupos Desativados, Próprio Número)
            if (!this.shouldProcessMessage(session, contactId, message)) {
                return;
            }

            // 2. Filtros de Velocidade (Spam/Flood) - Se rodar na Fila, estoura a fila com flood
            if (!isHistory && !this.checkRateLimit(session, contactId)) {
                return;
            }

            // Verifica comando SAIR
            if (message.body && message.body.toLowerCase().includes('sair')) {
                await this.handleExitCommand(session, contactId);
                return;
            }

            // Verifica se é um contato não salvo para exportação (Dashboard vCard)
            const isGroupNow = contactId.includes('@g.us');
            if (!isGroupNow) {
                try {
                    const contact = await message.getContact();
                    if (contact && contact.isMyContact === false) {
                        const pushname = contact.pushname || contact.name || 'Novo Lead';
                        // salva o contato no banco usando phoneNumber formatado e nome
                        await db.saveNewContact(session.accountId, contactId, pushname);
                    }
                } catch (contactErr) {
                    logger.warn(session.accountName, `Erro ao obter detalhes do contato para salvar lead: ${contactErr.message}`);
                }
            }

            // Garante inicialização da fila para a conta
            if (!this.globalQueue.has(session.accountId)) {
                this.globalQueue.set(session.accountId, { private: [], group: [] });
            }

            const queue = this.globalQueue.get(session.accountId);

            // Previne Fila Duplicada do mesmo contato que manda 10 msgs na sequência enquanto em pausa
            const processingKey = `${session.accountId}_${contactId}`;
            if (this.processing.has(processingKey)) {
                return; // Já tá sendo processado!
            }

            const isAlreadyInQueue = isGroupNow
                ? queue.group.some(i => i.contactId === contactId)
                : queue.private.some(i => i.contactId === contactId);

            if (isAlreadyInQueue) {
                // Silenciado logs massivos de sobreposição pois assustou o cliente
                return;
            }

            // Loga enfileiramento com dados do Timestamp original
            const msgTime = new Date(message.timestamp * 1000).toLocaleTimeString('pt-BR');
            logger.info(session.accountName, `📦 Fila ${isGroupNow ? '[Grupo]' : '[Privado]'} - Add Msg de ${msgTime} de ${contactId}...`);

            // Adiciona na Fila e Ordena cronologicamente por hora do recebimento oficial do WhastApp (Mais velho = Posição 0)
            if (isGroupNow) {
                queue.group.push({ session, message, contactId });
                queue.group.sort((a, b) => a.message.timestamp - b.message.timestamp);
            } else {
                queue.private.push({ session, message, contactId });
                queue.private.sort((a, b) => a.message.timestamp - b.message.timestamp);
            }

        } catch (error) {
            logger.error(session.accountName, `Erro crítico ao enfileirar mensagem de ${contactId}: ${error.message}`);
        }
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
     * Processa mensagem normal
     */
    async processNormalMessage(session, contactId, message = {}) {
        try {
            const config = this.getAccountConfig(session);
            const chat = await session.getChat(contactId);
            const isGroup = contactId.includes('@g.us');

            // Obtém nome do contato/grupo
            let name = 'Cliente';
            if (isGroup) {
                name = chat.name || 'Grupo';
            } else {
                const contact = await session.getContact(contactId);
                name = contact.pushname || contact.name || 'Cliente';
            }

            logger.messageReceived(session.accountName, name, isGroup);

            // Obtém comportamento humano com configurações da conta
            const interactionCount = this.interactions.get(contactId) || 0;
            const isFirstInteraction = interactionCount === 0;

            // Gera mensagem apropriada
            const responseText = await this.getResponseMessage(session, contactId, name, isGroup, isFirstInteraction);

            // Usa configurações da conta para delays — por tipo
            let minRead, maxRead, minTyping, maxTyping, minResponse, maxResponse;

            if (isGroup) {
                minRead = config.min_group_read_delay || config.min_read_delay;
                maxRead = config.max_group_read_delay || config.max_read_delay;
                minTyping = config.min_group_typing_delay || config.min_typing_delay;
                maxTyping = config.max_group_typing_delay || config.max_typing_delay;
                minResponse = config.min_group_response_delay || config.min_response_delay;
                maxResponse = config.max_group_response_delay || config.max_response_delay;
            } else if (!isFirstInteraction) {
                minRead = config.min_followup_read_delay || config.min_read_delay;
                maxRead = config.max_followup_read_delay || config.max_read_delay;
                minTyping = config.min_followup_typing_delay || config.min_typing_delay;
                maxTyping = config.max_followup_typing_delay || config.max_typing_delay;
                minResponse = config.min_followup_response_delay || config.min_response_delay;
                maxResponse = config.max_followup_response_delay || config.max_response_delay;
            } else {
                // Primeiro contato — usa delays básicos configurados
                minRead = config.min_read_delay;
                maxRead = config.max_read_delay;
                minTyping = config.min_typing_delay;
                maxTyping = config.max_typing_delay;
                minResponse = config.min_response_delay;
                maxResponse = config.max_response_delay;
            }

            const behavior = {
                readDelay: Math.floor(Math.random() * (maxRead - minRead) + minRead),
                typingDelay: Math.floor(Math.random() * (maxTyping - minTyping) + minTyping),
                responseDelay: minResponse > 0 ? Math.floor(Math.random() * (maxResponse - minResponse) + minResponse) : 0,
            };

            const readDelaySec = (behavior.readDelay / 1000).toFixed(1);
            const typingDelaySec = (behavior.typingDelay / 1000).toFixed(1);
            const responseDelaySec = (behavior.responseDelay / 1000).toFixed(1);
            const interactionLabel = isFirstInteraction ? 'Primeiro contato' : `Interação #${interactionCount + 1}`;
            const typeTag = isGroup ? '[👥 Grupo]' : isFirstInteraction ? '[👤 1º Contato]' : '[🔄 Follow-up]';

            logger.info(session.accountName, `📨 ${typeTag} ${name} — ${interactionLabel}`);

            // Determina se é áudio (ptt = push-to-talk / nota de voz, audio = arquivo de áudio)
            const msgType = message.type || message._data?.type || '';
            const msgMime = message._data?.mimetype || message.mimetype || '';
            const isAudioMessage = msgType === 'ptt' || msgType === 'audio' ||
                msgMime.startsWith('audio/') || message.hasMedia === true && (
                    msgMime.includes('ogg') || msgMime.includes('opus') || msgMime.includes('mpeg')
                );
            logger.info(session.accountName, `🔎 [Diagnóstico] type="${msgType}" mime="${msgMime}" isAudio=${isAudioMessage}`);


            // --- DELAY DE LEITURA / ESCUTA ---
            if (isAudioMessage) {
                // ================================================================
                // FLUXO HUMANO PARA ÁUDIO:
                // 1) Abre a conversa → delay de leitura → tick azul (sendSeen)
                // 2) "Ouve" o áudio → delay de escuta → player fica azul (played)
                // ================================================================

                // [1/6] Abre a conversa — delay de leitura normal (simula abrir o chat com o áudio)
                logger.info(session.accountName, `⏳ [1/6] Abrindo conversa: ${readDelaySec}s (simulando abrir o chat com o áudio)`);
                await delay(behavior.readDelay);

                // [2/6] sendSeen — tick azul de leitura (conversa aberta, áudio visto mas não ouvido ainda)
                logger.info(session.accountName, `👁️ [2/6] Marcando conversa como aberta (tick azul)...`);
                try {
                    await Promise.race([
                        chat.sendSeen(),
                        new Promise(res => setTimeout(res, 5000))
                    ]);
                    logger.info(session.accountName, `✅ Conversa marcada como lida (tick azul)`);
                } catch (seenErr) {
                    logger.warn(session.accountName, `⚠️ Erro ao marcar como lido (ignorado): ${seenErr.message}`);
                }

                // [3/6] Delay de escuta — simula ouvir o áudio
                let minListen, maxListen;
                if (isGroup) {
                    minListen = config.min_group_audio_listen_delay || config.min_audio_listen_delay || 5000;
                    maxListen = config.max_group_audio_listen_delay || config.max_audio_listen_delay || 30000;
                } else if (!isFirstInteraction) {
                    minListen = config.min_followup_audio_listen_delay || config.min_audio_listen_delay || 5000;
                    maxListen = config.max_followup_audio_listen_delay || config.max_audio_listen_delay || 30000;
                } else {
                    minListen = config.min_audio_listen_delay || 5000;
                    maxListen = config.max_audio_listen_delay || 30000;
                }
                const listenDelay = Math.floor(Math.random() * (maxListen - minListen) + minListen);
                const listenSec = (listenDelay / 1000).toFixed(1);
                const ctxLabel = isGroup ? 'Grupo' : isFirstInteraction ? '1º Contato' : 'Follow-up';
                logger.info(session.accountName, `🎧 [3/6] Ouvindo áudio (${ctxLabel}): ${listenSec}s`);
                await delay(listenDelay);

                // [4/6] Marca o áudio como "played" → ícone do player fica AZUL para quem enviou
                logger.info(session.accountName, `🔵 [4/6] Marcando áudio como ouvido (player azul)...`);
                try {
                    const msgId = message.id?._serialized || message._data?.id?._serialized;
                    if (msgId && session.client?.pupPage) {
                        const playedResult = await session.client.pupPage.evaluate(async (serializedMsgId) => {
                            try {
                                const S = window.Store;
                                const msg = S.Msg.get(serializedMsgId);
                                if (!msg) return 'NO_MSG';

                                const remoteJid = typeof msg.id.remote === 'object'
                                    ? msg.id.remote._serialized : String(msg.id.remote);
                                const msgServerId = msg.id.id;

                                // === 1) Store.Socket (WADeprecatedSendIq) — dump imediato de todas as fns ===
                                // Não tenta chamar nada — só retorna o que existe para diagnóstico rápido
                                try {
                                    const socketMod = window.Store.Socket || window.require('WADeprecatedSendIq');
                                    if (socketMod) {
                                        const allSocketFns = Object.keys(socketMod);
                                        // Procura funções relevantes para receipt/played
                                        const receiptFns = allSocketFns.filter(k => {
                                            const fl = k.toLowerCase();
                                            return fl.includes('receipt') || fl.includes('played') ||
                                                fl.includes('ack') || fl.includes('read') || fl.includes('seen');
                                        });
                                        if (receiptFns.length > 0) {
                                            // Tenta apenas funções de receipt
                                            for (const fn of receiptFns) {
                                                if (typeof socketMod[fn] !== 'function') continue;
                                                try {
                                                    const { makeWapNode } = window.require('WAWap');
                                                    const node = makeWapNode('receipt', {
                                                        type: 'played', id: msgServerId, to: remoteJid,
                                                        t: String(Math.floor(Date.now() / 1000))
                                                    }, null);
                                                    const r = socketMod[fn](node);
                                                    if (r && typeof r.then === 'function') {
                                                        await Promise.race([r, new Promise(res => setTimeout(res, 3000))]);
                                                    }
                                                    return 'OK:Socket.' + fn;
                                                } catch (_) { }
                                            }
                                            return 'SOCKET_RECEIPT_FNS:' + receiptFns.join(',');
                                        }
                                        // Sem receipt fns — retorna TODAS as fns para diagnóstico
                                        return 'SOCKET_ALL_FNS:' + allSocketFns.join(',');
                                    }
                                } catch (_) { }

                                // === 2) Chunk scan limitado — só 1 chunk, max 100 módulos ===
                                try {
                                    const registry = window.webpackChunkwhatsapp_web_client;
                                    if (registry && registry.length) {
                                        let scanned = 0;
                                        outer: for (const chunk of registry) {
                                            const mods = chunk[1] || {};
                                            for (const modId of Object.keys(mods)) {
                                                if (++scanned > 100) break outer;
                                                try {
                                                    const m = window.require(modId);
                                                    if (!m || typeof m !== 'object') continue;
                                                    const playedFns = Object.keys(m).filter(k =>
                                                        k.toLowerCase().includes('played') && typeof m[k] === 'function'
                                                    );
                                                    if (playedFns.length > 0) {
                                                        return 'CHUNK_FOUND:' + modId + ':' + playedFns.join(',');
                                                    }
                                                } catch (_) { }
                                            }
                                        }
                                        return 'CHUNK_100_DONE:NO_PLAYED';
                                    }
                                } catch (chunkErr) {
                                    return 'CHUNK_ERR:' + chunkErr.message;
                                }

                                return 'ALL_FAILED';
                            } catch (e) {
                                return 'exception:' + e.message;
                            }
                        }, msgId);

                        // Log do resultado para diagnóstico
                        if (playedResult?.startsWith('OK:')) {
                            logger.info(session.accountName, `✅ [4/6] Player azul enviado — ${playedResult}`);
                        } else {
                            logger.warn(session.accountName, `🔍 [4/6] Diagnóstico played: ${playedResult}`);
                        }
                    } else {
                        await chat.sendSeen();
                        logger.warn(session.accountName, `⚠️ pupPage indisponível — fallback sendSeen`);
                    }
                } catch (playedErr) {
                    logger.warn(session.accountName, `⚠️ Erro ao marcar áudio como played: ${playedErr.message}`);
                }

            } else {
                // Texto/imagem/figurinha etc.: delay de leitura normal
                logger.info(session.accountName, `⏳ [1/5] Delay de leitura: ${readDelaySec}s (simulando tempo de abrir a mensagem)`);
                await delay(behavior.readDelay);

                // --- VISUALIZANDO (TICK AZUL) ---
                logger.info(session.accountName, `👁️ [2/5] Visualizando mensagem — enviando tick azul...`);
                try {
                    await Promise.race([
                        chat.sendSeen(),
                        new Promise(res => setTimeout(res, 5000))
                    ]);
                    logger.info(session.accountName, `✅ Mensagem marcada como lida (tick azul enviado)`);
                } catch (seenErr) {
                    logger.warn(session.accountName, `⚠️ Erro ao marcar como lido (ignorado): ${seenErr.message}`);
                }
            }

            // Decide tipo de envio ANTES do delay de digitação para não digitar se for mídia
            let mediaEnabled, mediaInterval, audioEnabled, minRecDelay, maxRecDelay;
            if (isGroup) {
                mediaEnabled = config.group_media_enabled !== undefined ? config.group_media_enabled : config.media_enabled;
                mediaInterval = config.group_media_interval || config.media_interval || 3;
                audioEnabled = !!config.group_audio_enabled;
                minRecDelay = config.group_min_recording_delay || 5000;
                maxRecDelay = config.group_max_recording_delay || 15000;
            } else if (!isFirstInteraction) {
                mediaEnabled = config.followup_media_enabled !== undefined ? config.followup_media_enabled : config.media_enabled;
                mediaInterval = config.followup_media_interval || config.media_interval || 3;
                audioEnabled = !!config.followup_audio_enabled;
                minRecDelay = config.followup_min_recording_delay || 5000;
                maxRecDelay = config.followup_max_recording_delay || 15000;
            } else {
                mediaEnabled = config.media_enabled;
                mediaInterval = config.media_interval || 3;
                audioEnabled = true; // áudio sempre permitido se arquivo existir
                minRecDelay = 3000;  // delay de gravação padrão para primeiro contato
                maxRecDelay = 8000;
            }

            const shouldSendMedia = mediaEnabled && interactionCount > 0 && interactionCount % mediaInterval === 0;

            let docsEnabled = false, docsInterval = 5;
            if (isGroup) {
                docsEnabled = !!config.group_docs_enabled;
                docsInterval = config.group_docs_interval || 5;
            } else if (!isFirstInteraction) {
                docsEnabled = !!config.followup_docs_enabled;
                docsInterval = config.followup_docs_interval || 5;
            }
            const shouldSendDoc = docsEnabled && interactionCount > 0 && interactionCount % docsInterval === 0;

            const willSendMedia = shouldSendMedia || shouldSendDoc;

            // --- DELAY DE DIGITAÇÃO (apenas para texto) ---
            const totalSteps = isAudioMessage ? 6 : 5;
            const typStep = isAudioMessage ? 5 : 3;
            const respStep = isAudioMessage ? 5 : 4;
            const sendStep = isAudioMessage ? 6 : 5;
            if (!willSendMedia) {
                logger.info(session.accountName, `⌨️ [${typStep}/${totalSteps}] Delay de digitação: ${typingDelaySec}s (simulando digitando...)`);
                try {
                    await simulateTyping(chat, behavior.typingDelay);
                    logger.info(session.accountName, `✏️ Fim da digitação`);
                } catch (typingErr) {
                    logger.warn(session.accountName, `⚠️ Erro ao simular digitação (ignorado): ${typingErr.message}`);
                }
            } else {
                logger.info(session.accountName, `⏭️ [${typStep}/${totalSteps}] Digitação ignorada — envio de mídia não digita`);
            }

            // --- DELAY DE RESPOSTA ---
            if (behavior.responseDelay > 0) {
                logger.info(session.accountName, `⏳ [${respStep}/${totalSteps}] Delay de resposta: ${responseDelaySec}s (aguardando antes de enviar)`);
                await delay(behavior.responseDelay);
            } else {
                logger.info(session.accountName, `⚡ [${respStep}/${totalSteps}] Sem delay de resposta (primeiro contato)`);
            }

            // --- ENVIO ---
            logger.info(session.accountName, `🚀 [${sendStep}/${totalSteps}] Preparando envio...`);

            if (shouldSendMedia && shouldSendDoc) {
                const triggerNumber = Math.floor(interactionCount / mediaInterval);
                if (triggerNumber % 2 === 1) {
                    logger.info(session.accountName, `🎥 Alternando: enviando mídia (trigger #${triggerNumber})`);
                    await this.sendRandomMedia(session, contactId, { audioEnabled, minRecDelay, maxRecDelay, isGroup });
                } else {
                    logger.info(session.accountName, `📄 Alternando: enviando documento (trigger #${triggerNumber})`);
                    await this.sendRandomDoc(session, contactId);
                }
            } else if (shouldSendMedia) {
                logger.info(session.accountName, `🎥 Tipo: Mídia (interação #${interactionCount} é múltiplo de ${mediaInterval})`);
                await this.sendRandomMedia(session, contactId, { audioEnabled, minRecDelay, maxRecDelay, isGroup });
            } else if (shouldSendDoc) {
                logger.info(session.accountName, `📄 Tipo: Documento/vCard (interação #${interactionCount} é múltiplo de ${docsInterval})`);
                await this.sendRandomDoc(session, contactId);
            } else {
                const preview = responseText.length > 60 ? responseText.substring(0, 60) + '...' : responseText;
                logger.info(session.accountName, `📤 Tipo: Texto — "${preview}"`);
                await session.sendMessage(contactId, responseText);
                logger.info(session.accountName, `✅ Mensagem de texto enviada para ${name}`);
                // Registra stat de texto (privado ou grupo) — sem duplicar messages_sent (o evento message:sent já faz isso)
                const textCol = isGroup ? 'group_text' : 'priv_text';
                try { await db.updateStats(session.accountId, { [textCol]: 1 }); } catch (_) { }
            }

            // Aplica Cooldown Global independentemente do tipo de mensagem enviada
            this.applyGlobalCooldown(session, isGroup);

            // Atualiza contadores
            this.interactions.set(contactId, interactionCount + 1);
            this.lastMessageTime.set(contactId, Date.now());

            // Auto Aquecimento - Apenas respostas enviadas ou interações VERDADEIRAS resetam o timer.
            // O usuário solicitou que apenas "responder no privado" zere os 10 minutos.
            if (!isGroup) {
                this.lastReceivedTime.set(session.accountId, Date.now());
            }

            // Conta respostas enviadas e verifica pausa
            const pauseN = config.pause_after_n_responses || 0;
            if (pauseN > 0) {
                const prevCount = this.responseCount.get(session.accountId) || 0;
                const newCount = prevCount + 1;
                this.responseCount.set(session.accountId, newCount);

                if (newCount >= pauseN) {
                    const durationMs = (config.pause_duration_minutes || 10) * 60 * 1000;
                    this.pauseUntil.set(session.accountId, Date.now() + durationMs);
                    this.responseCount.set(session.accountId, 0);
                    logger.warn(session.accountName, `⏸️ Pausa automática ativada após ${newCount} respostas. Retoma em ${config.pause_duration_minutes || 10} min.`);
                }
            }

            // Atualiza estatísticas no banco
            await db.updateStats(session.accountId, {
                unique_contacts: this.interactions.size
            });

            // Força a remoção da bolinha verde de não lido na interface para esse chat
            await this.forceMarkRead(session, contactId);

        } catch (error) {
            logger.error(session.accountName, `Erro ao processar mensagem: ${error.message}`);
            throw error;
        }
    }

    /**
     * Envia mídia aleatória com randomização de bytes para evitar detecção de duplicata
     */
    async sendRandomMedia(session, contactId, opts = {}) {
        try {
            const mediaFolder = './media';

            // Lê de subpastas categorizadas
            const mediaCats = ['images', 'videos', 'stickers', 'audio'];
            let allFiles = [];
            for (const cat of mediaCats) {
                const dir = path.join(mediaFolder, cat);
                if (!fs.existsSync(dir)) continue;
                const catFiles = fs.readdirSync(dir)
                    .filter(f => !f.startsWith('.'))
                    .map(f => ({ name: f, path: path.join(dir, f), cat }));
                allFiles = allFiles.concat(catFiles);
            }

            if (allFiles.length === 0) {
                logger.warn(session.accountName, 'Nenhum arquivo de mídia encontrado nas subpastas');
                return;
            }

            logger.info(session.accountName, `🔍 Randomizando mídia — ${allFiles.length} arquivo(s) disponível(is)`);
            // Escolhe arquivo aleatório
            const chosen = allFiles[Math.floor(Math.random() * allFiles.length)];
            logger.info(session.accountName, `🗂️ Arquivo selecionado: ${chosen.name} (${chosen.cat})`);
            const mediaPath = chosen.path;
            const ext = path.extname(chosen.name).toLowerCase();

            // Lê o arquivo original
            const fileBuffer = fs.readFileSync(mediaPath);

            // Determina se é áudio (por extensão ou pasta)
            const isAudioExt = ['.mp3', '.ogg', '.wav', '.m4a'].includes(ext);
            const isAudio = isAudioExt || chosen.cat === 'audio';

            // Para imagens/vídeos/figurinhas: randomiza bytes para evitar detecção de duplicata
            // Para áudio: NÃO randomiza (corromperia o container)
            let sendBuffer = fileBuffer;
            if (!isAudio) {
                logger.info(session.accountName, `🔀 Randomizando bytes (imagem/vídeo) para evitar detecção de duplicata...`);
                const randomBytes = Buffer.alloc(4 + Math.floor(Math.random() * 12));
                for (let i = 0; i < randomBytes.length; i++) {
                    randomBytes[i] = Math.floor(Math.random() * 256);
                }
                sendBuffer = Buffer.concat([fileBuffer, randomBytes]);
            }

            // === CONVERSÃO DE ÁUDIO PARA OGG/OPUS (evita corrupção no PTT) ===
            // O WhatsApp exige OGG/Opus para PTT. MP3/WAV/M4A enviados com
            // sendAudioAsVoice:true sem conversão chegam corrompidos ao destinatário.
            let finalMimetype;
            let finalExt = ext;
            let tmpOggPath = null;

            if (isAudio) {
                if (ext !== '.ogg' && ffmpeg) {
                    // Precisa converter para OGG/Opus
                    try {
                        logger.info(session.accountName, `🔄 Convertendo ${ext} → OGG/Opus para envio como PTT...`);
                        tmpOggPath = await convertToOggOpus(mediaPath);
                        sendBuffer = fs.readFileSync(tmpOggPath);
                        finalMimetype = 'audio/ogg; codecs=opus';
                        finalExt = '.ogg';
                        logger.info(session.accountName, `✅ Conversão OGG/Opus concluída`);
                    } catch (convErr) {
                        logger.warn(session.accountName, `⚠️ Falha na conversão de áudio (enviando original): ${convErr.message}`);
                        // Fallback: envia o original sem sendAudioAsVoice para não corromper
                        finalMimetype = 'audio/mpeg';
                        tmpOggPath = null;
                    }
                } else if (ext === '.ogg') {
                    finalMimetype = 'audio/ogg; codecs=opus';
                } else {
                    // ffmpeg não disponível — envia como arquivo de áudio simples
                    logger.warn(session.accountName, `⚠️ ffmpeg indisponível. Enviando ${ext} sem conversão (pode corromper PTT).`);
                    const mimeMapFallback = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4' };
                    finalMimetype = mimeMapFallback[ext] || 'audio/mpeg';
                }
            } else {
                const mimeMap = {
                    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
                    '.mp4': 'video/mp4', '.webp': 'image/webp'
                };
                finalMimetype = mimeMap[ext] || 'application/octet-stream';
            }

            const shouldSimulateRecording = isAudio && opts.minRecDelay > 0;

            if (shouldSimulateRecording) {
                const recMin = opts.minRecDelay || 5000;
                const recMax = opts.maxRecDelay || 15000;
                const recordingDelay = Math.floor(Math.random() * (recMax - recMin) + recMin);
                const recDelaySec = (recordingDelay / 1000).toFixed(1);
                logger.info(session.accountName, `🎤 Simulando gravação de áudio: ${recDelaySec}s (aparecendo foto de perfil gravando...)`);
                try {
                    const recordingChat = await session.client.getChatById(contactId);
                    await recordingChat.sendStateRecording();
                } catch (recErr) {
                    logger.warn(session.accountName, `⚠️ Erro ao simular gravação (ignorado): ${recErr.message}`);
                }
                await delay(recordingDelay);
                // Para o estado de gravação explicitamente antes de enviar
                try {
                    const recordingChat = await session.client.getChatById(contactId);
                    await recordingChat.clearState();
                } catch (_) { }
                logger.info(session.accountName, `✅ Fim da simulação de gravação`);
            }

            // Converte para base64
            const base64Data = sendBuffer.toString('base64');

            logger.info(session.accountName, `🚀 Enviando mídia para WhatsApp... [mime: ${finalMimetype}]`);
            const uniqueId = Math.random().toString(16).slice(2, 6);
            const dynamicName = isAudio
                ? `audio_${Date.now()}_${uniqueId}${finalExt}`
                : `media_${Date.now()}${finalExt}`;

            // Determina opções de envio
            const sendOptions = {};
            if (ext === '.webp') {
                sendOptions.sendMediaAsSticker = true;
            }

            if (isAudio && finalMimetype === 'audio/ogg; codecs=opus') {
                // Envia como nota de voz (PTT) via sendAudioAsVoice:true
                // Isso mostra a foto de perfil como se fosse gravado diretamente no WhatsApp
                logger.info(session.accountName, `🎙️ Enviando PTT com foto de perfil (sendAudioAsVoice)...`);
                const media = new MessageMedia(finalMimetype, base64Data, dynamicName);
                try {
                    await session.client.sendMessage(contactId, media, { sendAudioAsVoice: true });
                    logger.info(session.accountName, `✅ PTT enviado com sucesso (nota de voz com foto de perfil)`);
                } catch (pttErr) {
                    logger.warn(session.accountName, `⚠️ Falha sendAudioAsVoice (${pttErr.message}) — tentando via Puppeteer...`);
                    // Fallback: injeção via Puppeteer
                    const pttResult = await sendPTTViaPuppeteer(session, contactId, base64Data, finalMimetype, dynamicName);
                    if (pttResult?.ok) {
                        logger.info(session.accountName, `✅ PTT enviado via Puppeteer (fallback)`);
                    } else {
                        logger.warn(session.accountName, `⚠️ PTT Puppeteer também falhou (${pttResult?.err}) — enviando como áudio normal`);
                        const mediaFallback = new MessageMedia(finalMimetype, base64Data, dynamicName);
                        await session.client.sendMessage(contactId, mediaFallback);
                    }
                }
            } else {
                const media = new MessageMedia(finalMimetype, base64Data, dynamicName);
                await session.client.sendMessage(contactId, media, sendOptions);
            }

            session.stats.messagesSent++;
            session.stats.lastActivity = Date.now();
            session.emit('message:sent');

            // Apaga arquivo temp de conversão OGG (se criado)
            if (tmpOggPath) {
                try { fs.unlinkSync(tmpOggPath); } catch (_) { }
            }

            const typeLabel = ext === '.webp' ? 'Figurinha' : isAudio ? 'Áudio PTT (nota de voz)' : ext === '.mp4' ? 'Vídeo' : 'Imagem';
            logger.info(session.accountName, `✅ ${typeLabel} enviada: ${chosen.name} → nome único: ${dynamicName}`);
            // Registra stat por tipo e contexto (privado/grupo)
            const ctx = opts.isGroup ? 'group' : 'priv';
            const mediaTypeCol = ext === '.webp' ? `${ctx}_sticker`
                : isAudio ? `${ctx}_audio`
                    : `${ctx}_image`; // jpg, png, mp4 = imagem/vídeo
            try { await db.updateStats(session.accountId, { [mediaTypeCol]: 1 }); } catch (_) { }

            this.applyGlobalCooldown(session, opts.isGroup);

        } catch (error) {
            logger.error(session.accountName, `Erro ao enviar mídia: ${error.message}`);
        }
    }

    /**
     * Envia documento ou vCard aleatório da pasta /docs
     */
    async sendRandomDoc(session, contactId) {
        try {
            const docsDir = './media/docs';
            const vcardsDir = './media/vcards';

            // Coleta docs e vcards das subpastas
            let allFiles = [];
            if (fs.existsSync(docsDir)) {
                allFiles = allFiles.concat(
                    fs.readdirSync(docsDir).filter(f => !f.startsWith('.')).map(f => ({ name: f, path: path.join(docsDir, f) }))
                );
            }
            if (fs.existsSync(vcardsDir)) {
                allFiles = allFiles.concat(
                    fs.readdirSync(vcardsDir).filter(f => !f.startsWith('.')).map(f => ({ name: f, path: path.join(vcardsDir, f) }))
                );
            }

            if (allFiles.length === 0) {
                logger.warn(session.accountName, 'Nenhum doc/vCard encontrado em media/docs ou media/vcards');
                return;
            }

            const chosen = allFiles[Math.floor(Math.random() * allFiles.length)];
            const filePath = chosen.path;
            const ext = path.extname(chosen.name).toLowerCase();

            if (ext === '.vcf') {
                // Envia como vCard
                const vcfContent = fs.readFileSync(filePath, 'utf8');
                const vcard = new MessageMedia('text/vcard', Buffer.from(vcfContent).toString('base64'), chosen.name);
                await session.client.sendMessage(contactId, vcard);
                session.stats.messagesSent++;
                session.stats.lastActivity = Date.now();
                session.emit('message:sent');
                logger.messageSent(session.accountName, contactId, `vCard (${chosen.name})`);
            } else {
                // Envia como documento com bytes randomizados
                let fileBuffer = fs.readFileSync(filePath);

                const randomBytes = Buffer.alloc(4 + Math.floor(Math.random() * 12));
                for (let i = 0; i < randomBytes.length; i++) {
                    randomBytes[i] = Math.floor(Math.random() * 256);
                }
                fileBuffer = Buffer.concat([fileBuffer, randomBytes]);

                const mimeMap = {
                    '.pdf': 'application/pdf',
                    '.doc': 'application/msword',
                    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                };
                const mimetype = mimeMap[ext] || 'application/octet-stream';
                const base64Data = fileBuffer.toString('base64');

                const media = new MessageMedia(mimetype, base64Data, `doc_${Date.now()}${ext}`);
                await session.client.sendMessage(contactId, media, { sendMediaAsDocument: true });
                session.stats.messagesSent++;
                session.stats.lastActivity = Date.now();
                session.emit('message:sent');
                logger.messageSent(session.accountName, contactId, `Documento (${chosen.name}) [bytes randomizados]`);
            }

            this.applyGlobalCooldown(session, contactId.includes('@g.us'));

        } catch (error) {
            logger.error(session.accountName, `Erro ao enviar doc/vCard: ${error.message}`);
        }
    }

    // Código duplicado desativado

    /**
     * Inicia agendador de auto-aquecimento entre contas
     * Verificação a cada 60 segundos
     */
    startAutoWarmScheduler(sessionManager) {
        logger.info(null, '🔥 Auto-aquecimento agendado (verificação a cada 60s)');

        setInterval(async () => {
            try {
                const activeSessions = sessionManager.getActiveSessions();
                if (activeSessions.length < 2) return; // Precisa de pelo menos 2 contas

                for (const session of activeSessions) {
                    const config = this.getAccountConfig(session);
                    if (!config.auto_warm_enabled) {
                        // logger.info(session.accountName, `🔥 IGNORADO: Auto-aquecimento desativado no painel`);
                        continue;
                    }

                    const idleMinutes = config.auto_warm_idle_minutes || 10;

                    // Se lastRcv for indefinido, define e GRAVA no map com um atraso base.
                    // configurando de uma forma que falte ~1 minuto ou o tempo real, para não bugar.
                    if (!this.lastReceivedTime.has(session.accountId)) {
                        const startDelayTime = Date.now() - (idleMinutes * 60 * 1000 - 62000); // Ex: Faltam ~1 min pra rodar a primeira vez
                        this.lastReceivedTime.set(session.accountId, startDelayTime);
                    }

                    const lastRcv = this.lastReceivedTime.get(session.accountId);
                    const idleMs = Date.now() - lastRcv;

                    if (idleMs < idleMinutes * 60 * 1000) {
                        logger.info(session.accountName, `🔥 IGNORADO: Faltam ${Math.ceil((idleMinutes * 60 * 1000 - idleMs) / 60000)} min para ativar aquecimento`);
                        continue; // Ainda não está idle
                    }

                    // Verifica se está processando msg ou em pausa de cooldown real
                    const isBusyOrPaused = () => {
                        if (this.globalGroupProcessing.has(session.accountId) || this.globalPrivateProcessing.has(session.accountId)) return true;
                        if (this.pauseUntil.get(session.accountId) && Date.now() < this.pauseUntil.get(session.accountId)) return true;
                        if (this.globalPrivateCooldown.get(session.accountId) && Date.now() < this.globalPrivateCooldown.get(session.accountId)) return true;
                        if (this.globalGroupCooldown.get(session.accountId) && Date.now() < this.globalGroupCooldown.get(session.accountId)) return true;
                        return false;
                    };

                    if (isBusyOrPaused()) {
                        logger.info(session.accountName, '⏳ Auto-aquecimento adiado: Conta Ocupada ou em Loop Temporário');
                        continue;
                    }

                    // Escolhe aleatoriamente outra sessão ativa como destino
                    const others = activeSessions.filter(s => s.accountId !== session.accountId);
                    if (others.length === 0) {
                        logger.info(session.accountName, `🔥 IGNORADO: Nenhuma outra aba ativa no sistema para servir de alvo`);
                        continue;
                    }

                    const target = others[Math.floor(Math.random() * others.length)];
                    const targetPhone = target.client && target.client.info && target.client.info.wid
                        ? `${target.client.info.wid.user}@c.us`
                        : null;

                    if (!targetPhone) continue;

                    // Obtém mensagem aleatória da conta origem, ou usa fallbacks genéricos se não houver no banco
                    const msgs = await db.getAccountMessages(session.accountId, 'first');
                    let warmText = '';

                    if (!msgs || msgs.length === 0) {
                        const fallbacks = [
                            "Opa sumido! Tudo bom?",
                            "Lembra daquele contato que passei ontem?",
                            "Bora tomar um café qualquer dia desses",
                            "Consegue me ajudar a revisar um documento mais tarde?",
                            "Tô tentando lembrar o nome daquela loja que vc mandou",
                            "E aí, conseguiu resolver aquilo do sistema?",
                            "Passando só pra dar um alô!",
                            "Como estão as coisas por aí na {nome}?"
                        ];
                        const randomFallback = fallbacks[Math.floor(Math.random() * fallbacks.length)];
                        warmText = randomFallback.replace('{nome}', target.accountName);
                    } else {
                        const randomMsg = msgs[Math.floor(Math.random() * msgs.length)];
                        warmText = randomMsg.message_text
                            .replace('{nome}', target.accountName)
                            .replace('{grupo}', target.accountName);
                    }

                    // Delay aleatório antes de enviar
                    const minD = (config.auto_warm_delay_min || 30) * 1000;
                    const maxD = (config.auto_warm_delay_max || 120) * 1000;
                    const waitMs = Math.floor(Math.random() * (maxD - minD) + minD);

                    logger.info(session.accountName, `🔥 Auto-warm → ${target.accountName} (em ${Math.round(waitMs / 1000)}s)`);
                    await delay(waitMs);

                    // Revalida antes de enviar para garantir que não recebeu mensagem nem entrou em pausa durante a espera
                    if (isBusyOrPaused()) {
                        logger.info(session.accountName, `🔥 Auto-warm → ${target.accountName} cancelado (Conta ocupada ou Pausada)`);
                        continue;
                    }

                    const newIdleMs = Date.now() - (this.lastReceivedTime.get(session.accountId) || 0);
                    if (newIdleMs < idleMinutes * 60 * 1000) {
                        logger.info(session.accountName, `🔥 Auto-warm → ${target.accountName} cancelado (Recebeu msg real)`);
                        continue;
                    }

                    try {
                        const targetChat = await session.client.getChatById(targetPhone);

                        // Delays para simular aquecimento
                        const minTyping = config.min_followup_typing_delay || config.min_typing_delay || 5000;
                        const maxTyping = config.max_followup_typing_delay || config.max_typing_delay || 20000;
                        const minResponse = config.min_followup_response_delay || config.min_response_delay || 10000;
                        const maxResponse = config.max_followup_response_delay || config.max_response_delay || 30000;

                        const typingTime = Math.floor(Math.random() * (maxTyping - minTyping) + minTyping);
                        const responseTime = minResponse > 0 ? Math.floor(Math.random() * (maxResponse - minResponse) + minResponse) : 0;

                        logger.info(session.accountName, `👁️ [1/3] Abrindo conversa com ${target.accountName} (Auto-warm)...`);
                        try {
                            const targetChat = await session.client.getChatById(targetPhone);
                            await targetChat.sendSeen();
                            await delay(Math.floor(Math.random() * 2000) + 2000); // Aguarda de 2 a 4s com chat aberto simulando ler

                            logger.info(session.accountName, `⌨️ [2/3] Digitando mensagem para ${target.accountName}: ${(typingTime / 1000).toFixed(1)}s`);
                            await simulateTyping(targetChat, typingTime);
                        } catch (e) {
                            // Ignorar silenciosamente erro de Detached Frame do WWebJS
                            // logger.warn(session.accountName, `Falha ignorada na simulação visual (Auto-warm): ${e.message}`);
                        }

                        if (responseTime > 0) {
                            logger.info(session.accountName, `⏳ [3/3] Aguardando para enviar: ${(responseTime / 1000).toFixed(1)}s`);
                            await delay(responseTime);
                        }

                        // Revalidação final antes do SEND final
                        if (isBusyOrPaused()) {
                            logger.warn(session.accountName, `🔥 Auto-warm cancelado no último segundo (Conta sendo usada)`);
                            continue;
                        }

                        try {
                            await session.sendMessage(targetPhone, warmText);
                            logger.success(session.accountName, `🔥 Mensagem de aquecimento enviada para ${target.accountName}`);
                            // Atualiza lastReceivedTime para não disparar de novo imediatamente
                            this.lastReceivedTime.set(session.accountId, Date.now());

                            // Força a remoção da bolinha verde após o auto-warm
                            await this.forceMarkRead(session, targetPhone);
                        } catch (sendError) {
                            if (sendError.message.includes('detached Frame') || sendError.message.includes('Target closed')) {
                                // logger.warn(session.accountName, `Sessão engasgou (Disconnected Frame). Ignorando envio auto-warm.`);
                            } else {
                                logger.error(session.accountName, `Erro final no auto-warm para ${target.accountName}: ${sendError.message}`);
                            }
                        }
                    } catch (sendErr) {
                        if (sendErr.message?.includes('detached Frame') || sendErr.message?.includes('Target closed') || sendErr.message?.includes('Session closed')) {
                            // Ignore silently as the frame was detached during navigation or close
                        } else {
                            logger.error(session.accountName, `Erro fatal no engine do auto-warm: ${sendErr.message}`);
                        }
                    }
                }
            } catch (err) {
                logger.error(null, `Erro no scheduler de auto-warm: ${err.message}`);
            }
        }, 60 * 1000);
    }

    /**
     * Processa mensagens não lidas na inicialização (pendentes offline)
     */
    async processUnreadMessages(session) {
        try {
            logger.info(session.accountName, 'Buscando chats com mensagens não lidas...');
            // Pode demorar um pouco dependendo da quantidade de conversas no aparelho
            const chats = await session.client.getChats();
            const unreadChats = chats.filter(c => c.unreadCount > 0);

            if (unreadChats.length === 0) {
                logger.info(session.accountName, 'Nenhuma mensagem pendente encontrada.');
                return;
            }

            logger.info(session.accountName, `Encontrado(s) ${unreadChats.length} chat(s) com mensagens não lidas. Iniciando Queue Handler...`);

            // Garante a ordem histórica (Mais antigas primeiro) para não deixar atrasados no fundo da fila
            for (const chat of unreadChats.reverse()) {
                try {
                    // Buscar um RANGE MAIOR de mensagens (buffer +5) porque limit igual ao unreadCount falha se houverem msgs deletadas ou do sistema misturadas
                    const messages = await chat.fetchMessages({ limit: Math.max(15, chat.unreadCount + 5) });
                    logger.info(session.accountName, `Chat ${chat.id.user}: ${chat.unreadCount} unread. fetched ${messages ? messages.length : 0} msgs.`);

                    if (messages && messages.length > 0) {
                        // Varre do mais recente pro mais antigo procurando a Última Mensagem Válida (que o Cliente nos Enviou)
                        const SYSTEM_TYPES = ['e2e_notification', 'notification_template', 'notification', 'call_log', 'protocol', 'gp2'];
                        const validMsgs = messages.filter(m => !m.fromMe && !SYSTEM_TYPES.includes(m.type));

                        if (validMsgs.length > 0) {
                            const lastUserMsg = validMsgs[validMsgs.length - 1]; // Pega a última na ordem cronológica (a mais nova que ele mandou)

                            // Adiciona ela à Queue Oficial sinalizando ser Histórico
                            logger.info(session.accountName, `=> Alvo Resgatado ID: ${lastUserMsg.id.id} | Timestamp: ${lastUserMsg.timestamp}`);
                            await this.handleMessage(session, lastUserMsg, true);
                        } else {
                            logger.warn(session.accountName, `Chat ${chat.id.user} marcado como unread, mas nehuma mensagem válida de usuário encontrada no buffer!`);
                        }
                    }
                } catch (err) {
                    logger.error(session.accountName, `Erro ao processar chat pendente ${chat.id.user}: ${err.message}`);
                }
            }
            logger.success(session.accountName, 'Envio para Queue de pendências concluído com sucesso!');
        } catch (error) {
            logger.error(session.accountName, `Erro ao buscar chats pendentes: ${error.message}`);
        }
    }

    /**
     * Obtém estatísticas
     */
    getStats() {
        return {
            totalInteractions: this.interactions.size,
            blacklistSize: this.blacklist.size,
            processingNow: this.processing.size
        };
    }
}

// Singleton
const messageHandler = new MessageHandler();

module.exports = messageHandler;
