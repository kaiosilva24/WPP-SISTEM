const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const QRCode = require('qrcode');
const path = require('path');
const logger = require('../utils/logger');
const sessionManager = require('../services/SessionManager');
const accountsRouter = require('../api/accounts');
const dispatchRouter = require('../api/dispatch');
const authRouter = require('../api/auth');
const adminRouter = require('../api/admin');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const dispatchEngine = require('../services/DispatchEngine');
const dispatchAutoReply = require('../services/DispatchAutoReply');
const db = require('../database/DatabaseManager');
const { verifyToken, requireAuth } = require('../middleware/auth');

class WebServer {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = socketIO(this.server, {
            cors: {
                origin: process.env.FRONTEND_URL || 'http://localhost:5173',
                methods: ['GET','POST','PUT','DELETE'],
                credentials: true
            }
        });
        this.setupMiddleware();
        this.setupRoutes();
        this.setupSocketIO();
    }

    setupMiddleware() {
        const allowedOrigins = [
            process.env.FRONTEND_URL || 'http://localhost:5173',
            'http://localhost:3000',
            'https://wpp.discloud.app',
            'https://wpp-aquecimento.discloud.app'
        ];
        this.app.use(cors({
            origin: (origin, cb) => cb(null, true),
            credentials: true
        }));
        this.app.use(express.json());
        const frontendPath = path.join(__dirname, '..', '..', '..', 'frontend', 'dist');
        this.app.use(express.static(frontendPath));
        logger.info(null, `📂 Servindo arquivos estáticos de: ${frontendPath}`);
    }

    setupRoutes() {
        this.app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

        // públicas
        this.app.use('/api/auth', authRouter);

        // POST /api/test-proxy — valida proxy via ip-api.com (qualquer usuário autenticado)
        this.app.post('/api/test-proxy', requireAuth, async (req, res) => {
            try {
                const { ip, port, username, password } = req.body || {};
                if (!ip || !port) {
                    return res.status(400).json({ success: false, error: 'IP e porta obrigatórios' });
                }
                const auth = (username && password) ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : '';
                const proxyUrl = `http://${auth}${ip}:${port}`;
                const agent = new HttpsProxyAgent(proxyUrl);
                const response = await axios.get('http://ip-api.com/json/', {
                    httpAgent: agent,
                    httpsAgent: agent,
                    timeout: 10000
                });
                if (response.data && response.data.status === 'success') {
                    return res.json({
                        success: true,
                        ip: response.data.query,
                        isp: response.data.isp || response.data.org || null,
                        country: response.data.country || null,
                        city: response.data.city || null
                    });
                }
                return res.json({ success: false, error: (response.data && response.data.message) || 'Falha ao validar proxy' });
            } catch (e) {
                return res.json({ success: false, error: e.message });
            }
        });

        // protegidas
        this.app.use('/api/admin', adminRouter);
        this.app.use('/api/accounts', accountsRouter);
        this.app.use('/api/dispatch', dispatchRouter);

        // SPA fallback
        this.app.get('*', (req, res) => {
            if (!req.path.startsWith('/api') && !req.path.startsWith('/socket.io')) {
                const frontendPath = path.join(__dirname, '..', '..', '..', 'frontend', 'dist', 'index.html');
                res.sendFile(frontendPath);
            }
        });
    }

    setupSocketIO() {
        // Auth no handshake
        this.io.use(async (socket, next) => {
            try {
                const token = (socket.handshake.auth && socket.handshake.auth.token)
                    || (socket.handshake.query && socket.handshake.query.token);
                if (!token) return next(new Error('Token ausente'));
                const decoded = verifyToken(token);
                const user = await db.getUserById(decoded.uid);
                if (!user) return next(new Error('Usuário inválido'));
                socket.user = user;
                next();
            } catch (e) {
                next(new Error('Token inválido: ' + e.message));
            }
        });

        this.io.on('connection', async (socket) => {
            const u = socket.user;
            logger.info(null, `Cliente Socket.IO conectado: ${socket.id} user=${u.email} role=${u.role}`);

            if (u.role === 'admin') {
                socket.join('admin');
            } else if (u.role === 'customer' && u.tenant_id) {
                socket.join(`tenant:${u.tenant_id}`);
                // Estado inicial do tenant
                try {
                    const sessions = await sessionManager.getAllSessionsInfo(u.tenant_id);
                    socket.emit('initial-state', {
                        sessions,
                        stats: await sessionManager.getGlobalStats(u.tenant_id)
                    });
                } catch (_) {}
            }

            socket.on('disconnect', () => {
                logger.debug(null, `Socket.IO desconectado: ${socket.id}`);
            });
        });

        // Eventos do SessionManager — broadcast só para a room do tenant
        sessionManager.on('session:qr', async ({ tenantId, accountId, accountName, qr, publicIP, isp }) => {
            try {
                const qrImage = await QRCode.toDataURL(qr);
                this.io.to(`tenant:${tenantId}`).emit('session:qr', { accountId, accountName, qr: qrImage, publicIP, isp });
            } catch (e) { logger.error(null, `QR error: ${e.message}`); }
        });

        sessionManager.on('session:authenticated', ({ tenantId, accountId, accountName }) => {
            this.io.to(`tenant:${tenantId}`).emit('session:authenticated', { accountId, accountName });
            this.broadcastTenantUpdate(tenantId);
        });

        sessionManager.on('session:ready', ({ tenantId, accountId, accountName, info }) => {
            this.io.to(`tenant:${tenantId}`).emit('session:ready', { accountId, accountName, info });
            this.broadcastTenantUpdate(tenantId);
        });

        sessionManager.on('session:disconnected', ({ tenantId, accountId, accountName, reason }) => {
            this.io.to(`tenant:${tenantId}`).emit('session:disconnected', { accountId, accountName, reason });
            this.broadcastTenantUpdate(tenantId);
        });

        sessionManager.on('session:message', ({ tenantId, accountId, accountName, message }) => {
            this.io.to(`tenant:${tenantId}`).emit('session:message', {
                accountId, accountName, from: message.from, body: message.body, timestamp: message.timestamp
            });
            this.broadcastTenantUpdate(tenantId);
        });

        sessionManager.on('session:error', ({ tenantId, accountId, accountName, error }) => {
            this.io.to(`tenant:${tenantId}`).emit('session:error', { accountId, accountName, error: error.message });
            this.broadcastTenantUpdate(tenantId);
        });

        // Disparo
        dispatchAutoReply.attach();
        dispatchEngine.on('contact:update', (p) => {
            if (p.tenantId) this.io.to(`tenant:${p.tenantId}`).emit('dispatch:contact:update', p);
        });
        dispatchEngine.on('message', (p) => {
            if (p.tenantId) this.io.to(`tenant:${p.tenantId}`).emit('dispatch:message', p);
        });
        dispatchEngine.on('campaign:update', (p) => {
            if (p.tenantId) this.io.to(`tenant:${p.tenantId}`).emit('dispatch:campaign:update', p);
        });
    }

    async broadcastTenantUpdate(tenantId) {
        try {
            const sessions = await sessionManager.getAllSessionsInfo(tenantId);
            this.io.to(`tenant:${tenantId}`).emit('update', {
                sessions,
                stats: await sessionManager.getGlobalStats(tenantId)
            });
        } catch (_) {}
    }

    start(port = 3000) {
        return new Promise((resolve) => {
            this.server.listen(port, () => {
                logger.success(null, `🚀 Backend API rodando em http://localhost:${port}`);
                resolve();
            });
        });
    }

    stop() {
        return new Promise((resolve) => {
            this.server.close(() => {
                logger.info(null, 'Servidor encerrado');
                resolve();
            });
        });
    }
}

module.exports = WebServer;
