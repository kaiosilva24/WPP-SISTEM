const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('../database/DatabaseManager');
const { signToken, requireAuth } = require('../middleware/auth');

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body || {};
        if (!email || !password) return res.status(400).json({ error: 'email e password obrigatórios' });
        const user = await db.getUserByEmail(email);
        if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });
        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) return res.status(401).json({ error: 'Credenciais inválidas' });

        // Bloqueia se tenant suspenso (apenas customer)
        if (user.role === 'customer') {
            const tenant = await db.getTenant(user.tenant_id);
            if (!tenant || tenant.status === 'suspended') {
                return res.status(403).json({ error: 'Acesso suspenso' });
            }
        }

        const token = signToken(user);
        res.json({
            token,
            user: { id: user.id, email: user.email, role: user.role, tenantId: user.tenant_id }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/me', requireAuth, async (req, res) => {
    res.json({ user: req.user, tenant: req.tenant || null });
});

router.post('/change-password', requireAuth, async (req, res) => {
    try {
        const { current_password, new_password } = req.body || {};
        if (!current_password || !new_password || new_password.length < 6) {
            return res.status(400).json({ error: 'senha atual e nova (>=6 chars) obrigatórias' });
        }
        const user = await db.getUserByEmail(req.user.email);
        const ok = await bcrypt.compare(current_password, user.password_hash);
        if (!ok) return res.status(401).json({ error: 'Senha atual incorreta' });
        const hash = await bcrypt.hash(new_password, 10);
        await db.updateUserPassword(user.id, hash);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
