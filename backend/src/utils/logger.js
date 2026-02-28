const fs = require('fs');
const path = require('path');
const { config } = require('../config');

/**
 * Sistema de logging com níveis e persistência
 */

const LOG_LEVELS = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3
};

const currentLevel = LOG_LEVELS[config.logs.level] || LOG_LEVELS.info;

// Cores para console
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    green: '\x1b[32m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m'
};

/**
 * Formata timestamp
 */
function getTimestamp() {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * Salva log em arquivo
 */
function saveToFile(level, sessionId, message) {
    if (!config.logs.save) return;

    try {
        const logFolder = config.logs.folder;
        if (!fs.existsSync(logFolder)) {
            fs.mkdirSync(logFolder, { recursive: true });
        }

        const date = new Date().toISOString().split('T')[0];
        const logFile = path.join(logFolder, `${date}.log`);

        const logLine = `[${getTimestamp()}] [${level.toUpperCase()}] [${sessionId || 'SYSTEM'}] ${message}\n`;
        fs.appendFileSync(logFile, logLine);
    } catch (error) {
        console.error('Erro ao salvar log:', error.message);
    }
}

/**
 * Log genérico
 */
function log(level, sessionId, message, color = colors.reset) {
    if (LOG_LEVELS[level] > currentLevel) return;

    const timestamp = getTimestamp();
    const prefix = sessionId ? `[${sessionId}]` : '[SYSTEM]';

    console.log(`${colors.gray}${timestamp}${colors.reset} ${color}${prefix}${colors.reset} ${message}`);
    saveToFile(level, sessionId, message);
}

/**
 * Métodos de log por nível
 */
const logger = {
    error: (sessionId, message) => log('error', sessionId, message, colors.red),
    warn: (sessionId, message) => log('warn', sessionId, message, colors.yellow),
    info: (sessionId, message) => log('info', sessionId, message, colors.cyan),
    debug: (sessionId, message) => log('debug', sessionId, message, colors.gray),
    success: (sessionId, message) => log('info', sessionId, message, colors.green),

    // Logs especiais
    qr: (sessionId) => log('info', sessionId, '📱 QR Code gerado! Escaneie com WhatsApp', colors.magenta),
    authenticated: (sessionId) => log('info', sessionId, '✅ Autenticado com sucesso!', colors.green),
    ready: (sessionId) => log('info', sessionId, '🚀 WhatsApp pronto!', colors.green),
    disconnected: (sessionId) => log('warn', sessionId, '⚠️  Desconectado', colors.yellow),
    reconnecting: (sessionId) => log('info', sessionId, '🔄 Reconectando...', colors.yellow),

    // Log de mensagens
    messageReceived: (sessionId, from, isGroup) => {
        const type = isGroup ? 'grupo' : 'contato';
        log('info', sessionId, `📨 Mensagem recebida de ${type}: ${from}`, colors.blue);
    },

    messageSent: (sessionId, to, type) => {
        log('info', sessionId, `📤 ${type} enviado para: ${to}`, colors.green);
    },

    messageIgnored: (sessionId, from, reason) => {
        log('debug', sessionId, `⏭️  Mensagem ignorada de ${from}: ${reason}`, colors.gray);
    },

    // Log de comportamento humano
    behavior: (sessionId, action, delay) => {
        log('debug', sessionId, `🎭 ${action}: ${delay}`, colors.magenta);
    }
};

module.exports = logger;
