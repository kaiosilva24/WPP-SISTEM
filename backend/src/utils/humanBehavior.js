const { config } = require('../config');

/**
 * Utilitários para simular comportamento humano
 */

/**
 * Delay genérico
 */
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Gera um número aleatório entre min e max
 */
function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Gera um delay aleatório para leitura de mensagem
 * Simula o tempo que uma pessoa leva para ler uma mensagem
 */
function getReadDelay() {
    return randomBetween(config.behavior.minReadDelay, config.behavior.maxReadDelay);
}

/**
 * Gera um delay aleatório para digitação
 * Simula o tempo que uma pessoa leva para digitar
 */
function getTypingDelay() {
    return randomBetween(config.behavior.minTypingDelay, config.behavior.maxTypingDelay);
}

/**
 * Gera um delay aleatório para resposta
 * Simula o tempo entre terminar de digitar e enviar
 */
function getResponseDelay() {
    return randomBetween(config.behavior.minResponseDelay, config.behavior.maxResponseDelay);
}

/**
 * Decide se deve ignorar a mensagem (não responder imediatamente)
 * Retorna true se deve ignorar
 */
function shouldIgnoreMessage() {
    return Math.random() * 100 < config.behavior.ignoreProbability;
}

/**
 * Gera um delay baseado no comprimento do texto
 * Simula tempo de digitação mais realista
 */
function getTypingDelayForText(text) {
    const baseDelay = config.behavior.minTypingDelay;
    const charsPerSecond = 5; // Velocidade média de digitação
    const textDelay = (text.length / charsPerSecond) * 1000;

    // Adiciona variação aleatória de ±30%
    const variation = textDelay * 0.3;
    const finalDelay = textDelay + randomBetween(-variation, variation);

    // Garante que está dentro dos limites configurados
    return Math.max(
        config.behavior.minTypingDelay,
        Math.min(config.behavior.maxTypingDelay, baseDelay + finalDelay)
    );
}

/**
 * Simula padrões de atividade humana
 * Retorna um multiplicador de delay baseado na hora do dia
 */
function getActivityMultiplier() {
    const hour = new Date().getHours();

    // Horários de maior atividade (9h-22h): multiplicador menor (mais rápido)
    if (hour >= 9 && hour <= 22) {
        return randomBetween(80, 120) / 100; // 0.8x a 1.2x
    }

    // Horários de menor atividade (23h-8h): multiplicador maior (mais lento)
    return randomBetween(150, 250) / 100; // 1.5x a 2.5x
}

/**
 * Simula uma sequência completa de comportamento humano
 * Retorna objeto com todos os delays necessários
 */
function getHumanBehaviorSequence(messageText = '') {
    const multiplier = getActivityMultiplier();

    return {
        readDelay: Math.floor(getReadDelay() * multiplier),
        typingDelay: messageText
            ? Math.floor(getTypingDelayForText(messageText) * multiplier)
            : Math.floor(getTypingDelay() * multiplier),
        responseDelay: Math.floor(getResponseDelay() * multiplier),
        shouldIgnore: shouldIgnoreMessage(),
        multiplier: multiplier.toFixed(2)
    };
}

/**
 * Simula digitação gradual (envia estado de digitação em intervalos)
 */
async function simulateTyping(chat, duration) {
    const intervals = Math.floor(duration / 3000); // A cada 3 segundos

    for (let i = 0; i < intervals; i++) {
        await chat.sendStateTyping();
        await delay(3000);
    }

    // Delay final
    const remaining = duration % 3000;
    if (remaining > 0) {
        await chat.sendStateTyping();
        await delay(remaining);
    }
}

/**
 * Formata tempo em ms para string legível
 */
function formatDelay(ms) {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

module.exports = {
    delay,
    randomBetween,
    getReadDelay,
    getTypingDelay,
    getResponseDelay,
    shouldIgnoreMessage,
    getTypingDelayForText,
    getActivityMultiplier,
    getHumanBehaviorSequence,
    simulateTyping,
    formatDelay
};
