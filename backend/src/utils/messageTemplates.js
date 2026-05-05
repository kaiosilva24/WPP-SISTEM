const { randomBetween } = require('./humanBehavior');

/**
 * Templates de mensagens para respostas variadas
 */

// Templates para primeira resposta
const firstResponseTemplates = [
    'Oi! Bora conversar? 💬',
    'E aí, tudo bem? 😊',
    'Me chama no privado! 📲',
    'Salva meu contato aí e me dá um oi no PV!',
    'Bora trocar uma ideia no privado?',
    'Te chamei lá no direct, dá uma olhada!',
    'Salva meu número, te salvo de volta! 🔄',
    'Bora aquecer esse número! Me chama lá.',
    'Tenho uma curiosidade pra te falar no PV... 😉',
    'Opa, tudo certo? Me chama no privado rapidinho.',
    'Salva meu contato pra gente não perder o papo!',
    'Alguém on? Me chama no PV pra gente conversar.',
    'Bora amigar? Chama lá no privado! 👋',
    'Salva aí, se salvar me avisa no PV que eu salvo aqui!',
    'Queria te perguntar uma coisa no privado, pode ser?',
    'Bora movimentar! Chama lá no PV. 🚀',
    'Passa no meu PV pra gente trocar contato!',
    'Salva meu número aí pra ver meus status! 📸',
    'E aí, bora aquecer? Me chama no privado agora.',
    'Te espero no PV pra gente conversar melhor!',
    'Salve! Me chama lá no privado pra eu te salvar.',
    'Bora fechar essa parceria no PV? 🤝',
    'Oi, tudo bem? Me manda um oi no privado!',
    'Salva meu contato que eu já te salvo de volta.',
    'Bora interagir! Me chama no privado.',
    'Tem um tempinho? Me chama no PV! 💬',
    'Salva meu número, quero te mostrar uma coisa no PV.',
    'Vamos trocar uma ideia sincera lá no privado?',
    'Me chama no PV pra gente não perder o contato!',
    'Bora aquecer os motores? Chama no privado! 🔥',
    'Salva meu contato, sou novo por aqui!',
    'Passa no meu PV pra gente se conhecer melhor.',
    'E aí, chama lá pra gente trocar uns contatos!',
    'Salva meu número e me chama que eu retribuo!',
    'Bora bater um papo no privado? 😊',
    'Me manda um "oi" no PV pra eu salvar você aqui.',
    'Quero te contar uma novidade no privado...',
    'Salva aí, te espero lá no PV agora! 🏃‍♂️',
    'Bora fazer esse número rodar? Chama no privado.',
    'Oi, tudo na paz? Me chama lá no PV.',
    'Salva meu contato pra gente trocar figurinhas no PV!',
    'Bora interagir galera! Começa chamando no meu PV.',
    'Te mandei um sinal, me chama no privado! 📡',
    'Salva meu número, vamos aumentar essa rede!',
    'Me chama no PV pra gente conversar sobre o grupo.',
    'E aí, bora de PV? Te espero lá!',
    'Salva meu contato que eu salvo o seu na hora!',
    'Quer saber um segredo? Me chama no PV. 😉',
    'Bora aquecer, chama no privado pra gente conversar.',
    'Te espero no PV pra gente trocar uma ideia rápida!',
    'Salva meu contato, me chama que eu te salvo!',
    'Bora movimentar esse privado hoje? 💥',
    'Oi, me chama lá no PV pra gente amigar! ✨',
    'Oi! Bora conversar? 💬',
    'E aí, tudo bem? 😊',
    'Me chama no privado! 📲',
    'Salva meu contato aí e me dá um oi no PV!'
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

// Saudações para grupos — mensagens "Me chama no PV" (standalone, sem placeholder de nome de grupo)
const groupGreetings = [
    'Me chama no privado! 📲',
    'Salva meu contato aí e me dá um oi no PV!',
    'Bora trocar uma ideia no privado?',
    'Te chamei lá no direct, dá uma olhada!',
    'Salva meu número, te salvo de volta! 🔄',
    'Bora aquecer esse número! Me chama lá.',
    'Tenho uma curiosidade pra te falar no PV... 😉',
    'Opa, tudo certo? Me chama no privado rapidinho.',
    'Salva meu contato pra gente não perder o papo!',
    'Alguém on? Me chama no PV pra gente conversar.',
    'Bora amigar? Chama lá no privado! 👋',
    'Salva aí, se salvar me avisa no PV que eu salvo aqui!',
    'Queria te perguntar uma coisa no privado, pode ser?',
    'Bora movimentar! Chama lá no PV. 🚀',
    'Passa no meu PV pra gente trocar contato!',
    'Salva meu número aí pra ver meus status! 📸',
    'E aí, bora aquecer? Me chama no privado agora.',
    'Te espero no PV pra gente conversar melhor!',
    'Salve! Me chama lá no privado pra eu te salvar.',
    'Bora fechar essa parceria no PV? 🤝',
    'Oi, tudo bem? Me manda um oi no privado!',
    'Salva meu contato que eu já te salvo de volta.',
    'Bora interagir! Me chama no privado.',
    'Tem um tempinho? Me chama no PV! 💬',
    'Salva meu número, quero te mostrar uma coisa no PV.',
    'Vamos trocar uma ideia sincera lá no privado?',
    'Me chama no PV pra gente não perder o contato!',
    'Bora aquecer os motores? Chama no privado! 🔥',
    'Salva meu contato, sou novo por aqui!',
    'Passa no meu PV pra gente se conhecer melhor.',
    'E aí, chama lá pra gente trocar uns contatos!',
    'Salva meu número e me chama que eu retribuo!',
    'Bora bater um papo no privado? 😊',
    'Me manda um "oi" no PV pra eu salvar você aqui.',
    'Quero te contar uma novidade no privado...',
    'Salva aí, te espero lá no PV agora! 🏃‍♂️',
    'Bora fazer esse número rodar? Chama no privado.',
    'Oi, tudo na paz? Me chama lá no PV.',
    'Salva meu contato pra gente trocar figurinhas no PV!',
    'Bora interagir galera! Começa chamando no meu PV.',
    'Te mandei um sinal, me chama no privado! 📡',
    'Salva meu número, vamos aumentar essa rede!',
    'Me chama no PV pra gente conversar sobre o grupo.',
    'E aí, bora de PV? Te espero lá!',
    'Salva meu contato que eu salvo o seu na hora!',
    'Quer saber um segredo? Me chama no PV. 😉',
    'Bora aquecer, chama no privado pra gente conversar.',
    'Te espero no PV pra gente trocar uma ideia rápida!',
    'Salva meu contato, me chama que eu te salvo!',
    'Bora movimentar esse privado hoje? 💥',
    'Oi, me chama lá no PV pra gente amigar! ✨',
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
 * Gera saudação para grupo.
 * Mensagens novas são standalone ("Me chama no PV") — não concatenamos mais o nome
 * do grupo nem um first-template, senão fica "Me chama no PV! GroupX! Oi! Bora conversar?".
 * O parâmetro groupName é mantido pra compat com chamadas antigas, mas é ignorado.
 */
function getGroupGreeting(groupName, contactId) {
    return selectUniqueMessage(groupGreetings, contactId, 'group');
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
