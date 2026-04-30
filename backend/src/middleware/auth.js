const jwt = require('jsonwebtoken');
const db = require('../database/DatabaseManager');

const SECRET = process.env.JWT_SECRET || 'dev-only-secret';

function signToken(user) {
    return jwt.sign(
        {
            uid: user.id,
            role: user.role,
            tid: user.tenant_id || null
        },
        SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
}

function verifyToken(token) {
    return jwt.verify(token, SECRET);
}

function extractToken(req) {
    const h = req.headers.authorization || '';
    if (h.startsWith('Bearer ')) return h.slice(7);
    if (req.query && req.query.token) return req.query.token;
    return null;
}

async function requireAuth(req, res, next) {
    try {
        const token = extractToken(req);
        if (!token) return res.status(401).json({ error: 'Token ausente' });
        const decoded = verifyToken(token);
        const user = await db.getUserById(decoded.uid);
        if (!user) return res.status(401).json({ error: 'Usuário inválido' });

        req.user = {
            id: user.id,
            email: user.email,
            role: user.role,
            tenantId: user.tenant_id
        };

        if (user.tenant_id) {
            const tenant = await db.getTenant(user.tenant_id);
            if (tenant) {
                req.tenant = tenant;
                req.user.tenantSchema = tenant.schema_name;
            }
        }
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Token inválido', detail: e.message });
    }
}

function requireAdmin(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });
    next();
}

function requireCustomer(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
    if (req.user.role !== 'customer') return res.status(403).json({ error: 'Apenas cliente' });
    if (!req.user.tenantId) return res.status(400).json({ error: 'Cliente sem tenant' });
    next();
}

async function requireActiveSubscription(req, res, next) {
    try {
        if (!req.user || !req.user.tenantId) return res.status(400).json({ error: 'Sem tenant' });
        if (req.tenant && req.tenant.status === 'suspended') {
            return res.status(403).json({ error: 'Acesso suspenso' });
        }
        const sub = await db.getActiveSubscription(req.user.tenantId);
        if (!sub) return res.status(402).json({ error: 'Sem assinatura' });
        if (sub.status !== 'active') return res.status(402).json({ error: 'Assinatura ' + sub.status });
        if (sub.current_period_end && new Date(sub.current_period_end) < new Date()) {
            return res.status(402).json({ error: 'Assinatura vencida' });
        }
        req.subscription = sub;
        next();
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}

module.exports = {
    signToken,
    verifyToken,
    extractToken,
    requireAuth,
    requireAdmin,
    requireCustomer,
    requireActiveSubscription
};
