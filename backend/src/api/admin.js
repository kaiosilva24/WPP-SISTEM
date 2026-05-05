const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('../database/DatabaseManager');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Todas as rotas exigem admin
router.use(requireAuth, requireAdmin);

// ========== PLANOS ==========
router.get('/plans', async (_req, res) => {
    try {
        res.json(await db.listPlans());
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== TENANTS (CLIENTES) ==========

router.get('/tenants', async (_req, res) => {
    try {
        const tenants = await db.listTenants();
        const enriched = await Promise.all(tenants.map(async (t) => {
            let accountsInUse = 0;
            try { accountsInUse = await db.tenant(t.schema_name).countAccounts(); } catch (_) {}
            return { ...t, accounts_in_use: accountsInUse };
        }));
        res.json(enriched);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * Cria novo cliente.
 * body: { name, owner_email, owner_password, plan_code, current_period_end }
 */
router.post('/tenants', async (req, res) => {
    try {
        const { name, owner_email, owner_password, plan_code, current_period_end } = req.body || {};
        if (!name || !owner_email || !owner_password || !plan_code) {
            return res.status(400).json({ error: 'name, owner_email, owner_password, plan_code obrigatórios' });
        }
        if (owner_password.length < 6) return res.status(400).json({ error: 'senha mínimo 6 chars' });

        const existingUser = await db.getUserByEmail(owner_email);
        if (existingUser) return res.status(409).json({ error: 'Email já cadastrado' });

        const plan = await db.getPlanByCode(plan_code);
        if (!plan) return res.status(400).json({ error: 'plan_code inválido' });

        // 1. Cria tenant + provisiona schema
        const tenant = await db.createTenant(name);

        // 2. Cria subscription
        const sub = await db.createSubscription({
            tenantId: tenant.id,
            planId: plan.id,
            currentPeriodEnd: current_period_end || null
        });

        // 3. Cria usuário owner (customer)
        const hash = await bcrypt.hash(owner_password, 10);
        const user = await db.createUser({
            email: owner_email,
            passwordHash: hash,
            role: 'customer',
            tenantId: tenant.id
        });

        res.status(201).json({ tenant, subscription: sub, user: { id: user.id, email: user.email } });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.put('/tenants/:id/status', async (req, res) => {
    try {
        const { status } = req.body || {};
        if (!['active','suspended'].includes(status)) return res.status(400).json({ error: 'status inválido' });
        await db.updateTenantStatus(req.params.id, status);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * Atualiza plano e/ou vencimento da subscription do tenant.
 * body: { plan_code?, status?, current_period_end? }
 */
router.put('/tenants/:id/subscription', async (req, res) => {
    try {
        const sub = await db.getActiveSubscription(req.params.id);
        if (!sub) return res.status(404).json({ error: 'Sem assinatura' });
        const updates = {};
        if (req.body.plan_code) {
            const plan = await db.getPlanByCode(req.body.plan_code);
            if (!plan) return res.status(400).json({ error: 'plan_code inválido' });
            updates.planId = plan.id;
        }
        if (req.body.status) {
            if (!['active','past_due','canceled'].includes(req.body.status)) return res.status(400).json({ error: 'status inválido' });
            updates.status = req.body.status;
        }
        if (req.body.current_period_end !== undefined) {
            updates.currentPeriodEnd = req.body.current_period_end || null;
        }
        await db.updateSubscription(sub.id, updates);
        const updated = await db.getActiveSubscription(req.params.id);
        res.json(updated);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/tenants/:id', async (req, res) => {
    try {
        await db.deleteTenant(req.params.id);
        res.status(204).send();
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * Cria owner (customer) para um tenant existente que ficou sem.
 * body: { email, password }
 */
router.post('/tenants/:id/owner', async (req, res) => {
    try {
        const { email, password } = req.body || {};
        if (!email || !password || password.length < 6) {
            return res.status(400).json({ error: 'email e password (>=6) obrigatórios' });
        }
        const tenant = await db.getTenant(req.params.id);
        if (!tenant) return res.status(404).json({ error: 'Tenant não encontrado' });
        const existing = await db.getUserByEmail(email);
        if (existing) return res.status(409).json({ error: 'Email já cadastrado' });
        const existingOwner = await db.getTenantOwner(tenant.id);
        if (existingOwner) return res.status(409).json({ error: 'Tenant já tem owner: ' + existingOwner.email });

        const hash = await bcrypt.hash(password, 10);
        const user = await db.createUser({ email, passwordHash: hash, role: 'customer', tenantId: tenant.id });
        res.status(201).json({ id: user.id, email: user.email });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/users/:id/reset-password', async (req, res) => {
    try {
        const { new_password } = req.body || {};
        if (!new_password || new_password.length < 6) return res.status(400).json({ error: 'senha mínimo 6 chars' });
        const user = await db.getUserById(req.params.id);
        if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
        const hash = await bcrypt.hash(new_password, 10);
        await db.updateUserPassword(user.id, hash);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * Reseta todas as pausas de contatos de um tenant
 * POST /admin/tenants/:tenantId/reset-pauses
 */
router.post('/tenants/:tenantId/reset-pauses', async (req, res) => {
    try {
        const tdb = db.tenant(req.params.tenantId);
        const count = await tdb.resetAllPauses();
        res.json({ ok: true, resetCount: count });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
