// Wrapper para DisCloud - Carrega .env e configura módulos antes de iniciar
require('dotenv').config(); // .env está na raiz junto com este index.js

// Configura caminho dos módulos
process.env.NODE_PATH = __dirname + '/node_modules';
require('module').Module._initPaths();

// Debug das variáveis de ambiente
console.log('📁 ROOT INDEX - ENV DEBUG:');
console.log('DB_HOST:', process.env.DB_HOST || 'NOT SET');
console.log('DB_PORT:', process.env.DB_PORT || 'NOT SET');
console.log('__dirname:', __dirname);

// Inicia o servidor (agora em src/ na raiz)
require('./src/index.js');
