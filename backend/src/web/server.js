const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const QRCode = require('qrcode');
const logger = require('../utils/logger');
const sessionManager = require('../services/SessionManager');
const messageHandler = require('../services/MessageHandler');
const accountsRouter = require('../api/accounts');

/**
 * Servidor backend API (porta 3000)
 */
class WebServer {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);

        // Configuração CORS para Socket.IO
        this.io = socketIO(this.server, {
            cors: {
                origin: process.env.FRONTEND_URL || 'http://localhost:5173',
                methods: ['GET', 'POST', 'PUT', 'DELETE'],
                credentials: true
            }
        });

        this.setupMiddleware();
        this.setupRoutes();
        this.setupSocketIO();
    }

    /**
     * Configura middleware
     */
    setupMiddleware() {
        const path = require('path');

        // CORS para requisições HTTP (suporta desenvolvimento e produção)
        const allowedOrigins = [
            process.env.FRONTEND_URL || 'http://localhost:5173',
            'http://localhost:3000',
            'https://wpp.discloud.app',
            'https://wpp-aquecimento.discloud.app'
        ];

        this.app.use(cors({
            origin: function (origin, callback) {
                // Permite requests sem origin (como mobile apps ou curl)
                if (!origin) return callback(null, true);
                if (allowedOrigins.indexOf(origin) !== -1) {
                    callback(null, true);
                } else {
                    callback(null, true); // Permite todos em produção para simplificar
                }
            },
            credentials: true
        }));

        this.app.use(express.json());

        // Serve arquivos estáticos do frontend (produção)
        const frontendPath = path.join(__dirname, '..', '..', '..', 'frontend', 'dist');
        this.app.use(express.static(frontendPath));
        logger.info(null, `📂 Servindo arquivos estáticos de: ${frontendPath}`);
    }

    /**
     * Configura rotas
     */
    setupRoutes() {
        // Health check
        this.app.get('/api/health', (req, res) => {
            res.json({ status: 'ok', message: 'Backend API rodando' });
        });

        // API de contas
        this.app.use('/api/accounts', accountsRouter);

        // API: Estatísticas globais
        this.app.get('/api/stats', async (req, res) => {
            const globalStats = await sessionManager.getGlobalStats();
            const handlerStats = messageHandler.getStats();

            res.json({
                ...globalStats,
                ...handlerStats
            });
        });

        // API: Testar proxy
        this.app.post('/api/test-proxy', async (req, res) => {
            const { ip, port, username, password } = req.body;

            try {
                const { HttpsProxyAgent } = require('https-proxy-agent');
                const axios = require('axios');

                // Monta URL do proxy
                let proxyUrl = `http://`;
                if (username && password) {
                    proxyUrl += `${username}:${password}@`;
                }
                proxyUrl += `${ip}:${port}`;

                const agent = new HttpsProxyAgent(proxyUrl);

                // Testa fazendo uma requisição
                const response = await axios.get('https://api.ipify.org?format=json', {
                    httpsAgent: agent,
                    timeout: 10000
                });

                res.json({
                    success: true,
                    ip: response.data.ip,
                    message: 'Proxy funcionando!'
                });
            } catch (error) {
                res.json({
                    success: false,
                    error: error.message
                });
            }
        });

        // SPA Fallback - Serve index.html para todas as rotas não-API
        const path = require('path');
        this.app.get('*', (req, res) => {
            // Se não é uma rota de API, serve o frontend
            if (!req.path.startsWith('/api') && !req.path.startsWith('/socket.io')) {
                const frontendPath = path.join(__dirname, '..', '..', '..', 'frontend', 'dist', 'index.html');
                res.sendFile(frontendPath);
            }
        });
    }

    /**
     * Configura Socket.IO para atualizações em tempo real
     */
    setupSocketIO() {
        this.io.on('connection', (socket) => {
            logger.info(null, `Cliente conectado ao backend: ${socket.id}`);

            // Envia estado inicial
            (async () => {
                const sessions = await sessionManager.getAllSessionsInfo();
                socket.emit('initial-state', {
                    sessions,
                    stats: await sessionManager.getGlobalStats()
                });
            })();

            socket.on('disconnect', () => {
                logger.debug(null, `Cliente desconectado: ${socket.id}`);
            });
        });

        // Eventos do SessionManager
        sessionManager.on('session:qr', async ({ accountId, accountName, qr, publicIP, isp }) => {
            try {
                const qrImage = await QRCode.toDataURL(qr);
                this.io.emit('session:qr', { accountId, accountName, qr: qrImage, publicIP, isp });
            } catch (error) {
                logger.error(null, `Erro ao gerar QR Code: ${error.message}`);
            }
        });

        sessionManager.on('session:authenticated', ({ accountId, accountName }) => {
            this.io.emit('session:authenticated', { accountId, accountName });
            this.broadcastUpdate();
        });

        sessionManager.on('session:ready', ({ accountId, accountName, info }) => {
            this.io.emit('session:ready', { accountId, accountName, info });
            this.broadcastUpdate();
        });

        sessionManager.on('session:disconnected', ({ accountId, accountName, reason }) => {
            this.io.emit('session:disconnected', { accountId, accountName, reason });
            this.broadcastUpdate();
        });

        sessionManager.on('session:message', ({ accountId, accountName, message }) => {
            this.io.emit('session:message', {
                accountId,
                accountName,
                from: message.from,
                body: message.body,
                timestamp: message.timestamp
            });
            this.broadcastUpdate();
        });

        sessionManager.on('session:error', ({ accountId, accountName, error }) => {
            this.io.emit('session:error', { accountId, accountName, error: error.message });
            this.broadcastUpdate();
        });
    }

    /**
     * Envia atualização de estado para todos os clientes
     */
    async broadcastUpdate() {
        const sessions = await sessionManager.getAllSessionsInfo();
        this.io.emit('update', {
            sessions,
            stats: await sessionManager.getGlobalStats()
        });
    }

    /**
     * Inicia o servidor
     */
    start(port = 3000) {
        return new Promise((resolve) => {
            this.server.listen(port, () => {
                logger.success(null, `🚀 Backend API rodando em http://localhost:${port}`);
                logger.info(null, `🔗 CORS habilitado para: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
                resolve();
            });
        });
    }

    /**
     * Para o servidor
     */
    stop() {
        return new Promise((resolve) => {
            this.server.close(() => {
                logger.info(null, 'Servidor backend encerrado');
                resolve();
            });
        });
    }
}

module.exports = WebServer;
