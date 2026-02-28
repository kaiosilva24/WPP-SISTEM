require('dotenv').config();

/**
 * Configuração centralizada do sistema
 */
const config = {
  // Servidor Web
  web: {
    port: parseInt(process.env.WEB_PORT) || 3000,
    password: process.env.DASHBOARD_PASSWORD || null,
  },

  // Contas WhatsApp
  accounts: (process.env.ACCOUNTS || 'conta1,conta2,conta3,conta4,conta5,conta6,conta7,conta8,conta9,conta10')
    .split(',')
    .map(id => id.trim())
    .filter(id => id.length > 0),

  // Proxies
  proxies: (process.env.PROXIES || '')
    .split(',')
    .map(proxy => proxy.trim())
    .filter(proxy => proxy.length > 0)
    .map(proxy => {
      const parts = proxy.split(':');
      if (parts.length === 4) {
        const [ip, port, username, password] = parts;
        return {
          raw: proxy,
          url: `http://${username}:${password}@${ip}:${port}`,
          ip,
          port,
          username,
          password
        };
      }
      return null;
    })
    .filter(proxy => proxy !== null),

  // Comportamento Humano
  behavior: {
    minReadDelay: parseInt(process.env.MIN_READ_DELAY) || 3000,
    maxReadDelay: parseInt(process.env.MAX_READ_DELAY) || 15000,
    minTypingDelay: parseInt(process.env.MIN_TYPING_DELAY) || 5000,
    maxTypingDelay: parseInt(process.env.MAX_TYPING_DELAY) || 20000,
    minResponseDelay: parseInt(process.env.MIN_RESPONSE_DELAY) || 10000,
    maxResponseDelay: parseInt(process.env.MAX_RESPONSE_DELAY) || 30000,
    minMessageInterval: parseInt(process.env.MIN_MESSAGE_INTERVAL) || 20000,
    ignoreProbability: parseInt(process.env.IGNORE_PROBABILITY) || 20,
  },

  // Mídia
  media: {
    folder: process.env.MEDIA_FOLDER || './media',
    interval: parseInt(process.env.MEDIA_INTERVAL) || 2,
  },

  // Logs
  logs: {
    level: process.env.LOG_LEVEL || 'info',
    save: process.env.SAVE_LOGS === 'true',
    folder: process.env.LOG_FOLDER || './logs',
  },

  // Caminhos
  paths: {
    edgeBrowser: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    authFolder: './.wwebjs_auth',
  }
};

/**
 * Valida a configuração
 */
function validateConfig() {
  const errors = [];

  if (config.accounts.length === 0) {
    errors.push('Nenhuma conta configurada! Defina ACCOUNTS no .env');
  }

  if (config.proxies.length > 0 && config.proxies.length < config.accounts.length) {
    console.warn(`⚠️  Atenção: ${config.proxies.length} proxies para ${config.accounts.length} contas. Algumas contas compartilharão proxies.`);
  }

  if (config.proxies.length === 0) {
    console.warn('⚠️  Nenhum proxy configurado. Todas as contas usarão o IP local.');
  }

  if (errors.length > 0) {
    throw new Error('Erros na configuração:\n' + errors.join('\n'));
  }

  return true;
}

/**
 * Obtém o proxy para uma conta específica
 */
function getProxyForAccount(accountIndex) {
  if (config.proxies.length === 0) {
    return null;
  }
  
  // Distribui proxies ciclicamente entre as contas
  const proxyIndex = accountIndex % config.proxies.length;
  return config.proxies[proxyIndex];
}

/**
 * Exibe resumo da configuração
 */
function displayConfig() {
  console.log('\n' + '='.repeat(60));
  console.log('📋 CONFIGURAÇÃO DO SISTEMA DE AQUECIMENTO');
  console.log('='.repeat(60));
  console.log(`🌐 Servidor Web: http://localhost:${config.web.port}`);
  console.log(`📱 Contas configuradas: ${config.accounts.length}`);
  console.log(`🔒 Proxies configurados: ${config.proxies.length}`);
  console.log(`🎭 Comportamento humano: Ativado`);
  console.log(`   - Delay de leitura: ${config.behavior.minReadDelay}ms - ${config.behavior.maxReadDelay}ms`);
  console.log(`   - Delay de digitação: ${config.behavior.minTypingDelay}ms - ${config.behavior.maxTypingDelay}ms`);
  console.log(`   - Delay de resposta: ${config.behavior.minResponseDelay}ms - ${config.behavior.maxResponseDelay}ms`);
  console.log(`📁 Pasta de mídia: ${config.media.folder}`);
  console.log('='.repeat(60) + '\n');
}

module.exports = {
  config,
  validateConfig,
  getProxyForAccount,
  displayConfig
};
