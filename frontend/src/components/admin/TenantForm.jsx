import { useState } from 'react';
import { apiJson } from '../../api';

export default function TenantForm({ plans, onClose }) {
    const [data, setData] = useState({
        name: '',
        owner_email: '',
        owner_password: '',
        plan_code: plans && plans[0] ? plans[0].code : 'basic',
        current_period_end: ''
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    const submit = async () => {
        setError(null);
        if (!data.name || !data.owner_email || !data.owner_password) {
            setError('Preencha nome, email e senha');
            return;
        }
        if (data.owner_password.length < 6) {
            setError('Senha mínimo 6 caracteres');
            return;
        }
        setSaving(true);
        try {
            await apiJson('/api/admin/tenants', {
                method: 'POST',
                body: JSON.stringify({
                    ...data,
                    current_period_end: data.current_period_end ? `${data.current_period_end}T23:59:59Z` : null
                })
            });
            onClose();
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="tenant-form" style={{ maxWidth: 520, margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h2 style={{ margin: 0 }}>Novo Cliente</h2>
                <button className="btn btn-secondary" onClick={onClose}>Voltar</button>
            </div>

            {error && <div style={{ padding: 10, background: 'rgba(255,68,102,0.15)', color: '#ff4466', borderRadius: 6, marginBottom: 12 }}>{error}</div>}

            <div className="form-group">
                <label>Nome do cliente</label>
                <input value={data.name} onChange={(e) => setData({ ...data, name: e.target.value })} />
            </div>

            <div className="form-group">
                <label>Email do owner (login)</label>
                <input type="email" value={data.owner_email} onChange={(e) => setData({ ...data, owner_email: e.target.value })} />
            </div>

            <div className="form-group">
                <label>Senha inicial (mín 6)</label>
                <input type="text" value={data.owner_password} onChange={(e) => setData({ ...data, owner_password: e.target.value })} />
            </div>

            <div className="form-group">
                <label>Plano</label>
                <select value={data.plan_code} onChange={(e) => setData({ ...data, plan_code: e.target.value })}>
                    {(plans || []).map((p) => (
                        <option key={p.id} value={p.code}>{p.name} ({p.max_accounts} contas)</option>
                    ))}
                </select>
            </div>

            <div className="form-group">
                <label>Vencimento (opcional)</label>
                <input type="date" value={data.current_period_end} onChange={(e) => setData({ ...data, current_period_end: e.target.value })} />
            </div>

            <button className="btn btn-primary" onClick={submit} disabled={saving} style={{ marginTop: 12 }}>
                {saving ? 'Criando...' : 'Criar cliente'}
            </button>
        </div>
    );
}
