const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database/DatabaseManager');

const JWT_SECRET = process.env.JWT_SECRET || 'wpp_sistem_secret_key_2026_aquecimento';
const DEFAULT_ADMIN_EMAIL = 'admin@aquecimento.com';
const DEFAULT_ADMIN_PASSWORD = 'admin552446';

/**
 * Garante que o administrador padrão existe no banco de dados ao iniciar.
 */
async function seedDefaultAdmin() {
    try {
        const existing = await db.getSystemUserByEmail(DEFAULT_ADMIN_EMAIL);
        if (!existing) {
            const hash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
            await db.createSystemUser(DEFAULT_ADMIN_EMAIL, hash, 'admin');
            console.log('✅ [Auth] Admin padrão criado:', DEFAULT_ADMIN_EMAIL);
        }
    } catch (err) {
        console.error('❌ [Auth] Erro ao verificar admin padrão:', err.message);
    }
}

// Middleware para verificar JWT
function authMiddleware(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Sem autorização' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch {
        return res.status(401).json({ error: 'Token inválido ou expirado' });
    }
}

// Middleware para verificar se é admin
function adminOnly(req, res, next) {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Acesso restrito a administradores' });
    }
    next();
}

/**
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });
    }

    try {
        const user = await db.getSystemUserByEmail(email);
        if (!user) return res.status(401).json({ error: 'E-mail ou senha inválidos' });

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(401).json({ error: 'E-mail ou senha inválidos' });

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/auth/me — verifica token e retorna dados do usuário
 */
router.get('/me', authMiddleware, (req, res) => {
    res.json({ user: req.user });
});

/**
 * GET /api/auth/users — lista todos os usuários (admin only)
 */
router.get('/users', authMiddleware, adminOnly, async (req, res) => {
    try {
        const users = await db.getAllSystemUsers();
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/auth/users — cria novo usuário (admin only)
 */
router.post('/users', authMiddleware, adminOnly, async (req, res) => {
    const { email, password, role } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });
    }

    const userRole = role === 'admin' ? 'admin' : 'user';

    try {
        const existing = await db.getSystemUserByEmail(email);
        if (existing) return res.status(409).json({ error: 'E-mail já cadastrado' });

        const hash = await bcrypt.hash(password, 10);
        const user = await db.createSystemUser(email, hash, userRole);
        res.status(201).json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * DELETE /api/auth/users/:id — deleta usuário (admin only, não pode deletar a si mesmo)
 */
router.delete('/users/:id', authMiddleware, adminOnly, async (req, res) => {
    const targetId = parseInt(req.params.id);
    if (targetId === req.user.id) {
        return res.status(400).json({ error: 'Você não pode excluir sua própria conta' });
    }

    try {
        const deleted = await db.deleteSystemUser(targetId);
        if (!deleted) return res.status(404).json({ error: 'Usuário não encontrado' });
        res.status(204).send();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = { router, seedDefaultAdmin };
