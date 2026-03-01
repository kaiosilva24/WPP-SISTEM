// Wrapper para DisCloud - Carrega .env e configura módulos antes de iniciar
const fs = require('fs');
const path = require('path');

// Debug: verificar se .env existe
const envPath = path.join(__dirname, '.env');
console.log('📁 Checking .env file:');
console.log('   Path:', envPath);
console.log('   Exists:', fs.existsSync(envPath));

if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    console.log('   Size:', envContent.length, 'bytes');
    console.log('   Content preview:', envContent.substring(0, 200));
}

// Carrega dotenv
const result = require('dotenv').config({ path: envPath });
console.log('   dotenv result:', result.error ? result.error.message : 'OK - loaded');

// === FALLBACK: Se .env estiver vazio (DisCloud), define variáveis hardcoded ===
if (!process.env.DB_HOST) {
    console.log('⚠️  DB_HOST não definido pelo .env — aplicando fallback hardcoded');
    process.env.DB_HOST = '129.80.149.224';
    process.env.DB_PORT = '8080';
    process.env.DB_USER = 'admin';
    process.env.DB_PASS = 'SecurePass_WhatsApp_2026!';
    process.env.DB_NAME = 'whatsapp_warming';
}

if (!process.env.FRONTEND_URL) {
    process.env.FRONTEND_URL = 'https://wpp-advanced.discloud.app';
}

// Configura caminho dos módulos
process.env.NODE_PATH = __dirname + '/node_modules';
require('module').Module._initPaths();

// Debug das variáveis de ambiente
console.log('📁 ROOT INDEX - ENV DEBUG:');
console.log('DB_HOST:', process.env.DB_HOST || 'NOT SET');
console.log('DB_PORT:', process.env.DB_PORT || 'NOT SET');

// Inicia o servidor (agora em src/ na raiz)
require('./src/index.js');
