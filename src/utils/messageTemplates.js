const { randomBetween } = require('./humanBehavior');

/**
 * Templates de mensagens para respostas variadas
 */

// Templates para primeira resposta
const firstResponseTemplates = [
    'Me chama no privado, bora trocar uma ideia! 💬',
    'Salve meu contato que eu salvo o seu! 📲🤝',
    'Bora galera, aquecer o chat, privado liberado! 🔥📩',
    'Manda mensagem no privado, vamos trocar uma ideia! 🗣️',
    'Chama no privado, tô te esperando! ⏳',
    'Vamos conversar no privado, só chegar! 🚶‍♂️🚶‍♀️',
    'Adiciona meu contato e me chama pra trocar uma ideia! 📲💬',
    'Salve meu número e me chama pra bater papo no privado! 💬📱',
    'Chama no privado que a conversa vai ser boa! 😎💬',
    'Vem pro privado, bora papear! 🗣️👀',
    'Manda mensagem no privado, quero te ouvir! 📝🎧',
    'Bora trocar umas mensagens no privado! 💌🔐',
    'Me chama no privado, vamos desenrolar! 🎤💬',
    'Tô no privado, chama que a gente troca uma ideia! 💬🤙',
    'Fala comigo no privado, tô te esperando! ⏳📩',
    'Aquece o privado, vem trocar umas mensagens! 🔥💌',
    'Vamos trocar umas ideias no privado, me chama! 🗣️💭',
    'Chega no privado, vamos conversar! 🗨️💬',
    'Me chama no privado que a conversa vai rolar! 🔄🗨️',
    'Privado liberado, bora bater papo! 🚀📱',
    'Chama no privado, a resenha vai ser boa! 💬🔥',
    'Já salvei teu número, bora trocar uma ideia! 📲💬',
    'Me chama no privado, não perde tempo! 🕒📲',
    'Salve meu contato e bora bater um papo! 📱👋',
    'Vamos trocar umas mensagens no privado, chega mais! 📲🗣️',
    'Me chama no privado, tô aqui pra conversar! 🗨️💬',
    'Partiu trocar umas ideias no privado? 🛸🗨️',
    'Vamos esquentar esse chat no privado! 🔥💬',
    'Salve meu número e bora trocar umas ideias! 📲💬',
    'No privado é mais divertido, chama! 🎉💌',
    'Bora continuar essa conversa no privado! 🔄📩',
    'Vamos bater um papo no privado, me chama! 🗣️📲',
    'Chama no privado, vou te responder na hora! ⏱️💬',
    'Privado liberado, bora trocar umas mensagens! 💬🔐',
    'Tô esperando sua mensagem no privado! ⏳💬',
    'Fica à vontade, chama no privado! 👀📲',
    'Não perde tempo, vem pro privado trocar uma ideia! 🕒💭',
    'Vamos desenrolar no privado, chama lá! 💬🎤',
    'Chama no privado, a conversa vai ser show! 🎬💬',
    'Adiciona meu número e bora trocar umas ideias! 📲🗣️',
    'Manda mensagem no privado, vamos bater um papo! 📝📱',
    'Vamos conversar no privado, tô te esperando! 🗨️⌛',
    'Me chama no privado, bora trocar uma ideia massa! 💬👌',
    'Salve meu número e vamos trocar mensagens no privado! 📱💬',
    'Fala comigo no privado, vamos papear! 🗣️🔥',
    'Chama no privado, tô aqui pra responder! 💬📲',
    'Me chama no privado que eu te respondo rapidinho! ⚡💬',
    'Salve o meu número e vamos pro privado trocar uma ideia! 📲🗨️',
    'Vem pro privado, bora fazer essa conversa fluir! 🌊💬',
    'Partiu bater um papo no privado, chama aí! 📲👋'
];

// Templates para respostas subsequentes
const followUpTemplates = [
    'E aí, como tá? 😊',
    'Tudo certo por aí? 👍',
    'Beleza? 🤙',
    'Fala! O que tá rolando? 🗣️',
    'Opa! Tudo tranquilo? ✌️',
    'E aí, firmeza? 💪',
    'Salve! Como vai? 👋',
    'Tudo na paz? ☮️',
    'Fala comigo! 📱',
    'Oi! Tudo bem? 😄',
    'E aí, beleza? 😎',
    'Opa! Tudo certo? ✅',
    'Fala! Tudo joia? 💎',
    'E aí, suave? 🌊',
    'Oi! Como anda? 🚶',
    'Beleza total? 🌟',
    'Fala! Tudo ok? 👌',
    'E aí, de boa? 😌',
    'Opa! Firmeza? 🔥',
    'Salve! Tudo tranquilo? 🙏',
    'E aí, show? 🎉',
    'Oi! Tudo certo aí? 📍',
    'Fala! Como tá indo? 🏃',
    'E aí, massa? 🎨',
    'Opa! Tudo nos conformes? 📊',
    'Beleza? Tudo em ordem? 📋',
    'E aí, parceiro? 🤝',
    'Oi! Tudo suave? 🍃',
    'Fala! Tá de boa? 🆒',
    'E aí, top? 🔝'
];

// Saudações para grupos
const groupGreetings = [
    'Olá galera do',
    'E aí pessoal do',
    'Fala turma do',
    'Salve galera do',
    'Opa pessoal do',
    'E aí time do',
    'Olá membros do',
    'Fala grupo'
];

/**
 * Histórico de mensagens enviadas para cada contato
 * Evita repetir a mesma mensagem
 */
const messageHistory = new Map();

/**
 * Seleciona uma mensagem aleatória que não foi usada recentemente
 */
function selectUniqueMessage(templates, contactId, historyKey) {
    const key = `${contactId}_${historyKey}`;
    const history = messageHistory.get(key) || [];

    // Se já usamos todas as mensagens, limpa o histórico
    if (history.length >= templates.length * 0.8) {
        messageHistory.set(key, []);
        history.length = 0;
    }

    // Filtra mensagens não usadas recentemente
    const availableTemplates = templates.filter((_, index) => !history.includes(index));

    // Seleciona uma mensagem aleatória
    const selectedIndex = templates.indexOf(
        availableTemplates[randomBetween(0, availableTemplates.length - 1)]
    );

    // Adiciona ao histórico
    history.push(selectedIndex);
    messageHistory.set(key, history);

    return templates[selectedIndex];
}

/**
 * Gera primeira resposta personalizada com nome
 */
function getFirstResponse(name, contactId) {
    const firstName = name.split(' ')[0];
    const template = selectUniqueMessage(firstResponseTemplates, contactId, 'first');

    return `Oi ${firstName}! ${template}`;
}

/**
 * Gera resposta de follow-up
 */
function getFollowUpResponse(name, contactId) {
    const firstName = name.split(' ')[0];
    const template = selectUniqueMessage(followUpTemplates, contactId, 'followup');

    // 50% de chance de incluir o nome
    if (Math.random() > 0.5) {
        return `${firstName}, ${template}`;
    }

    return template;
}

/**
 * Gera saudação para grupo
 */
function getGroupGreeting(groupName, contactId) {
    const greeting = selectUniqueMessage(groupGreetings, contactId, 'group');
    const template = selectUniqueMessage(firstResponseTemplates, contactId, 'first');

    return `${greeting} ${groupName}! ${template}`;
}

/**
 * Limpa histórico de mensagens de um contato
 */
function clearContactHistory(contactId) {
    const keys = Array.from(messageHistory.keys()).filter(key => key.startsWith(contactId));
    keys.forEach(key => messageHistory.delete(key));
}

/**
 * Obtém estatísticas de uso de templates
 */
function getTemplateStats() {
    return {
        totalContacts: new Set(Array.from(messageHistory.keys()).map(k => k.split('_')[0])).size,
        totalMessages: messageHistory.size,
        firstResponsesAvailable: firstResponseTemplates.length,
        followUpResponsesAvailable: followUpTemplates.length,
        groupGreetingsAvailable: groupGreetings.length
    };
}

module.exports = {
    getFirstResponse,
    getFollowUpResponse,
    getGroupGreeting,
    clearContactHistory,
    getTemplateStats,
    firstResponseTemplates,
    followUpTemplates,
    groupGreetings
};
