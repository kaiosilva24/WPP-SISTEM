const { MessageMedia } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const db = require('../database/DatabaseManager');
const logger = require('../utils/logger');
const { delay, getHumanBehaviorSequence, simulateTyping, formatDelay } = require('../utils/humanBehavior');
const { getFirstResponse, getFollowUpResponse, getGroupGreeting } = require('../utils/messageTemplates');

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
     * Verifica se deve processar a mensagem
     */
    shouldProcessMessage(session, contactId, messageBody) {
        const config = this.getAccountConfig(session);

        // Ignora mensagens do próprio número
        if (session.client.info && contactId.startsWith(session.client.info.wid.user)) {
            logger.messageIgnored(session.accountName, contactId, 'próprio número');
            return false;
        }

        // Ignora notificações de criptografia
        if (!messageBody || messageBody.type === 'e2e_notification') {
            logger.messageIgnored(session.accountName, contactId, 'notificação de sistema');
            return false;
        }

        // Verifica blacklist
        const phoneNumber = contactId.split('@')[0];
        if (this.blacklist.has(phoneNumber)) {
            logger.messageIgnored(session.accountName, contactId, 'na blacklist');
            return false;
        }

        // Verifica se já está processando
        const processingKey = `${session.accountId}_${contactId}`;
        if (this.processing.has(processingKey)) {
            logger.messageIgnored(session.accountName, contactId, 'já processando');
            return false;
        }

        // Verifica rate limiting
        const lastTime = this.lastMessageTime.get(contactId);
        if (lastTime) {
            const timeSince = Date.now() - lastTime;
            if (timeSince < config.min_message_interval) {
                const remaining = config.min_message_interval - timeSince;
                logger.messageIgnored(session.accountName, contactId, `rate limit (aguardar ${formatDelay(remaining)})`);
                return false;
            }
        }

        return true;
    }

    /**
     * Obtém mensagem personalizada da conta ou usa padrão
     */
    async getResponseMessage(session, contactId, name, isGroup, isFirstInteraction) {
        // Tenta obter mensagens personalizadas do banco
        const messageType = isGroup ? 'group' : (isFirstInteraction ? 'first' : 'followup');
        const customMessages = await db.getAccountMessages(session.accountId, messageType);

        if (customMessages && customMessages.length > 0) {
            // Usa mensagem personalizada aleatória
            const randomMsg = customMessages[Math.floor(Math.random() * customMessages.length)];
            const firstName = name.split(' ')[0];

            // Substitui placeholders
            return randomMsg.message_text
                .replace('{nome}', firstName)
                .replace('{grupo}', name);
        }

        // Usa mensagens padrão
        if (isGroup) {
            return getGroupGreeting(name, contactId);
        } else if (isFirstInteraction) {
            return getFirstResponse(name, contactId);
        } else {
            return getFollowUpResponse(name, contactId);
        }
    }

    /**
     * Processa mensagem recebida
     */
    async handleMessage(session, message) {
        const contactId = message.from;
        const processingKey = `${session.accountId}_${contactId}`;

        try {
            // Verifica se deve processar
            if (!this.shouldProcessMessage(session, contactId, message.body)) {
                return;
            }

            // Marca como processando
            this.processing.add(processingKey);

            // Verifica comando SAIR
            if (message.body && message.body.toLowerCase().includes('sair')) {
                await this.handleExitCommand(session, contactId);
                return;
            }

            // Processa mensagem normal
            await this.processNormalMessage(session, contactId);

        } catch (error) {
            logger.error(session.accountName, `Erro ao processar mensagem de ${contactId}: ${error.message}`);
        } finally {
            // Remove do processamento
            this.processing.delete(processingKey);
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
    async processNormalMessage(session, contactId) {
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

            // Marca como lido
            await chat.sendSeen();
            await delay(2000);

            // Obtém comportamento humano com configurações da conta
            const interactionCount = this.interactions.get(contactId) || 0;
            const isFirstInteraction = interactionCount === 0;

            // Gera mensagem apropriada
            const responseText = await this.getResponseMessage(session, contactId, name, isGroup, isFirstInteraction);

            // Usa configurações da conta para delays
            const behavior = {
                readDelay: Math.floor(Math.random() * (config.max_read_delay - config.min_read_delay) + config.min_read_delay),
                typingDelay: Math.floor(Math.random() * (config.max_typing_delay - config.min_typing_delay) + config.min_typing_delay),
                responseDelay: Math.floor(Math.random() * (config.max_response_delay - config.min_response_delay) + config.min_response_delay),
                shouldIgnore: Math.random() * 100 < config.ignore_probability
            };

            // Verifica se deve ignorar (comportamento humano)
            if (behavior.shouldIgnore && !isFirstInteraction) {
                logger.behavior(session.accountName, 'Ignorando mensagem', 'probabilidade');
                return;
            }

            // Delay de leitura
            logger.behavior(session.accountName, 'Delay de leitura', formatDelay(behavior.readDelay));
            await delay(behavior.readDelay);

            // Simula digitação
            logger.behavior(session.accountName, 'Digitando', formatDelay(behavior.typingDelay));
            await simulateTyping(chat, behavior.typingDelay);

            // Delay antes de enviar
            logger.behavior(session.accountName, 'Delay de resposta', formatDelay(behavior.responseDelay));
            await delay(behavior.responseDelay);

            // Decide entre texto e mídia
            const shouldSendMedia = config.media_enabled && interactionCount > 0 && interactionCount % config.media_interval === 0;

            if (shouldSendMedia) {
                await this.sendRandomMedia(session, contactId);
            } else {
                await session.sendMessage(contactId, responseText);
                logger.messageSent(session.accountName, name, 'Texto');
            }

            // Atualiza contadores
            this.interactions.set(contactId, interactionCount + 1);
            this.lastMessageTime.set(contactId, Date.now());

            // Atualiza estatísticas no banco
            await db.updateStats(session.accountId, {
                unique_contacts: this.interactions.size
            });

        } catch (error) {
            logger.error(session.accountName, `Erro ao processar mensagem: ${error.message}`);
            throw error;
        }
    }

    /**
     * Envia mídia aleatória
     */
    async sendRandomMedia(session, contactId) {
        try {
            const mediaFolder = './media';

            if (!fs.existsSync(mediaFolder)) {
                logger.warn(session.accountName, 'Pasta de mídia não encontrada');
                return;
            }

            const mediaTypes = ['.jpg', '.png', '.mp4', '.mp3', '.webp'];
            const files = fs.readdirSync(mediaFolder)
                .filter(file => mediaTypes.some(type => file.toLowerCase().endsWith(type)));

            if (files.length === 0) {
                logger.warn(session.accountName, 'Nenhum arquivo de mídia encontrado');
                return;
            }

            const randomFile = files[Math.floor(Math.random() * files.length)];
            const mediaPath = path.join(mediaFolder, randomFile);

            const media = MessageMedia.fromFilePath(mediaPath);
            await session.sendMedia(contactId, media);

            logger.messageSent(session.accountName, contactId, `Mídia (${randomFile})`);

        } catch (error) {
            logger.error(session.accountName, `Erro ao enviar mídia: ${error.message}`);
        }
    }

    /**
     * Processa mensagens não lidas ao iniciar
     */
    async processUnreadMessages(session) {
        try {
            if (session.status !== 'ready') return;

            logger.info(session.accountName, 'Processando mensagens não lidas...');

            const chats = await session.client.getChats();
            let processedCount = 0;

            for (const chat of chats) {
                if (chat.unreadCount > 0) {
                    const messages = await chat.fetchMessages({ limit: chat.unreadCount });

                    for (const msg of messages) {
                        if (this.shouldProcessMessage(session, msg.from, msg.body)) {
                            await this.handleMessage(session, msg);
                            processedCount++;

                            // Delay entre mensagens
                            await delay(5000);
                        }
                    }
                }
            }

            logger.success(session.accountName, `${processedCount} mensagens não lidas processadas`);

        } catch (error) {
            logger.error(session.accountName, `Erro ao processar mensagens não lidas: ${error.message}`);
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
