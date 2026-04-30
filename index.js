// Wrapper de bootstrap para DisCloud.
// Aponta para o backend multi-tenant em backend/src/index.js.
//
// No DisCloud, configure as variáveis pelo dashboard (NÃO confiar em .env).
// As mesmas variáveis funcionam local via backend/.env.

const path = require('path');
const fs = require('fs');

// Carrega backend/.env se existir (modo local). DisCloud injeta via process.env já populado.
const envPath = path.join(__dirname, 'backend', '.env');
if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
}

// Defaults seguros para PORT (DisCloud sobrescreve via env)
if (!process.env.PORT) {
    process.env.PORT = process.env.WEB_PORT || '8080';
}

// Sanidade: variáveis essenciais
const required = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASS', 'DB_NAME', 'JWT_SECRET', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
    console.error('❌ Variáveis de ambiente obrigatórias ausentes:', missing.join(', '));
    console.error('   No DisCloud, configure-as no dashboard.');
    console.error('   Localmente, edite backend/.env');
    process.exit(1);
}

console.log('🚀 Bootstrap WPP multi-tenant');
console.log('   PORT:', process.env.PORT);
console.log('   DB_HOST:', process.env.DB_HOST);

// Inicia o backend (que serve API + frontend estático)
require('./backend/src/index.js');
