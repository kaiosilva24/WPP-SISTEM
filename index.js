// Wrapper para DisCloud - Configura o caminho dos módulos antes de iniciar
process.env.NODE_PATH = __dirname + '/node_modules';
require('module').Module._initPaths();

// Inicia o backend
require('./backend/src/index.js');
