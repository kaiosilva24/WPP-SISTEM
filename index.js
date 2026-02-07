// Wrapper para DisCloud - Carrega .env e configura módulos antes de iniciar
const fs = require('fs');
const path = require('path');

// Debug: verificar se .env existe
const envPath = path.join(__dirname, '.env');
console.log('📁 Checking .env file:');
console.log('   Path:', envPath);
console.log('   Exists:', fs.existsSync(envPath));

if (fs.existsSync(envPath)) {
    console.log('   Content preview:', fs.readFileSync(envPath, 'utf8').substring(0, 200));
}

// Carrega dotenv
const result = require('dotenv').config({ path: envPath });
console.log('   dotenv result:', result.error ? result.error.message : 'OK - loaded');

// Configura caminho dos módulos
process.env.NODE_PATH = __dirname + '/node_modules';
require('module').Module._initPaths();

// Debug das variáveis de ambiente
console.log('📁 ROOT INDEX - ENV DEBUG:');
console.log('DB_HOST:', process.env.DB_HOST || 'NOT SET');
console.log('DB_PORT:', process.env.DB_PORT || 'NOT SET');

// Inicia o servidor (agora em src/ na raiz)
require('./src/index.js');
