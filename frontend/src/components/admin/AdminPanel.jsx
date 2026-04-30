import { useEffect, useState } from 'react';
import { apiJson } from '../../api';
import TenantForm from './TenantForm';

export default function AdminPanel() {
    const [tenants, setTenants] = useState([]);
    const [plans, setPlans] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [error, setError] = useState(null);

    const load = async () => {
        try {
            const [t, p] = await Promise.all([
                apiJson('/api/admin/tenants'),
                apiJson('/api/admin/plans')
            ]);
            setTenants(t || []);
            setPlans(p || []);
            setError(null);
        } catch (e) {
            setError(e.message);
        }
    };

    useEffect(() => { load(); }, []);

    const changePlan = async (tenant, plan_code) => {
        try {
            await apiJson(`/api/admin/tenants/${tenant.id}/subscription`, {
                method: 'PUT',
                body: JSON.stringify({ plan_code })
            });
            load();
        } catch (e) { alert(e.message); }
    };

    const changeExpiry = async (tenant, value) => {
        try {
            await apiJson(`/api/admin/tenants/${tenant.id}/subscription`, {
                method: 'PUT',
                body: JSON.stringify({ current_period_end: value || null })
            });
            load();
        } catch (e) { alert(e.message); }
    };

    const toggleStatus = async (tenant) => {
        const next = tenant.status === 'active' ? 'suspended' : 'active';
        try {
            await apiJson(`/api/admin/tenants/${tenant.id}/status`, {
                method: 'PUT',
                body: JSON.stringify({ status: next })
            });
            load();
        } catch (e) { alert(e.message); }
    };

    const resetPassword = async (userId) => {
        const pw = prompt('Nova senha (mínimo 6 caracteres):');
        if (!pw || pw.length < 6) return;
        try {
            await apiJson(`/api/admin/users/${userId}/reset-password`, {
                method: 'POST',
                body: JSON.stringify({ new_password: pw })
            });
            alert('Senha alterada');
        } catch (e) { alert(e.message); }
    };

    const createOwner = async (tenant) => {
        const email = prompt(`Email do owner para "${tenant.name}":`);
        if (!email) return;
        const pw = prompt('Senha inicial (mínimo 6):');
        if (!pw || pw.length < 6) return;
        try {
            await apiJson(`/api/admin/tenants/${tenant.id}/owner`, {
                method: 'POST',
                body: JSON.stringify({ email, password: pw })
            });
            load();
        } catch (e) { alert(e.message); }
    };

    const deleteTenant = async (tenant) => {
        if (!confirm(`Excluir cliente "${tenant.name}" e TODOS os dados (schema ${tenant.schema_name})? Não há volta.`)) return;
        try {
            await apiJson(`/api/admin/tenants/${tenant.id}`, { method: 'DELETE' });
            load();
        } catch (e) { alert(e.message); }
    };

    if (showForm) {
        return <TenantForm plans={plans} onClose={() => { setShowForm(false); load(); }} />;
    }

    return (
        <div className="admin-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h2 style={{ margin: 0 }}>Painel Administrativo</h2>
                <button className="btn btn-primary" onClick={() => setShowForm(true)}>+ Novo Cliente</button>
            </div>

            {error && <div style={{ padding: 12, background: 'rgba(255,68,102,0.15)', color: '#ff4466', borderRadius: 6, marginBottom: 12 }}>{error}</div>}

            {tenants.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', opacity: 0.6 }}>Nenhum cliente cadastrado.</div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 12 }}>
                    {tenants.map((t) => {
                        const expired = t.current_period_end && new Date(t.current_period_end) < new Date();
                        return (
                            <div key={t.id} className="account-card" style={{ padding: 14 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                    <strong style={{ fontSize: 16 }}>{t.name}</strong>
                                    <span style={{
                                        fontSize: 11, padding: '2px 8px', borderRadius: 4,
                                        background: t.status === 'active' ? 'rgba(37,211,102,0.15)' : 'rgba(255,68,102,0.15)',
                                        color: t.status === 'active' ? '#25D366' : '#ff4466'
                                    }}>{t.status}</span>
                                </div>
                                <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 6 }}>
                                    Owner: <code>{t.owner_email || '—'}</code>
                                </div>
                                <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 6 }}>
                                    Schema: <code>{t.schema_name}</code>
                                </div>
                                <div style={{ fontSize: 12, marginBottom: 6 }}>
                                    Contas: <b>{t.accounts_in_use || 0} / {t.max_accounts || '—'}</b>
                                </div>
                                <div style={{ fontSize: 12, marginBottom: 8, color: expired ? '#ff4466' : 'inherit' }}>
                                    Vence: {t.current_period_end ? new Date(t.current_period_end).toLocaleDateString() : 'sem vencimento'}
                                    {expired && ' (vencido)'}
                                </div>

                                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                                    <small style={{ opacity: 0.7 }}>Plano:</small>
                                    <select value={t.plan_code || ''} onChange={(e) => changePlan(t, e.target.value)} style={{ flex: 1, fontSize: 12 }}>
                                        {plans.map((p) => <option key={p.id} value={p.code}>{p.name} ({p.max_accounts} contas)</option>)}
                                    </select>
                                </div>

                                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                                    <small style={{ opacity: 0.7 }}>Vencimento:</small>
                                    <input
                                        type="date"
                                        value={t.current_period_end ? t.current_period_end.split('T')[0] : ''}
                                        onChange={(e) => changeExpiry(t, e.target.value ? `${e.target.value}T23:59:59Z` : null)}
                                        style={{ flex: 1, fontSize: 12 }}
                                    />
                                </div>

                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                    <button className="btn btn-secondary" onClick={() => toggleStatus(t)} style={{ fontSize: 12 }}>
                                        {t.status === 'active' ? 'Suspender' : 'Reativar'}
                                    </button>
                                    {t.owner_user_id ? (
                                        <button className="btn btn-secondary" onClick={() => resetPassword(t.owner_user_id)} style={{ fontSize: 12 }}>
                                            Resetar senha
                                        </button>
                                    ) : (
                                        <button className="btn btn-secondary" onClick={() => createOwner(t)} style={{ fontSize: 12, color: '#ffc107' }}>
                                            Criar owner
                                        </button>
                                    )}
                                    <button className="btn btn-secondary" onClick={() => deleteTenant(t)} style={{ fontSize: 12, color: '#ff4466' }}>
                                        Excluir
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
