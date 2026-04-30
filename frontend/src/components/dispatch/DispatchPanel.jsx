import { useEffect, useState } from 'react';
import CampaignForm from './CampaignForm';
import CampaignBoard from './CampaignBoard';
import { apiFetch } from '../../api';

export default function DispatchPanel({ socket, accounts }) {
    const [campaigns, setCampaigns] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState(null);
    const [error, setError] = useState(null);

    const load = async () => {
        try {
            const r = await apiFetch('/api/dispatch/campaigns');
            if (!r.ok) {
                const j = await r.json().catch(() => ({}));
                setError(j.error || `Backend retornou ${r.status}`);
                setCampaigns([]);
                return;
            }
            const data = await r.json();
            setError(null);
            setCampaigns(Array.isArray(data) ? data : []);
        } catch (e) {
            setError(`Falha ao conectar: ${e.message}`);
            setCampaigns([]);
        }
    };

    useEffect(() => { load(); }, []);

    useEffect(() => {
        if (!socket) return;
        const onUpdate = () => load();
        socket.on('dispatch:campaign:update', onUpdate);
        return () => socket.off('dispatch:campaign:update', onUpdate);
    }, [socket]);

    const startCampaign = async (id) => {
        const r = await apiFetch(`/api/dispatch/campaigns/${id}/start`, { method: 'POST' });
        if (!r.ok) { const e = await r.json(); alert(`Erro: ${e.error}`); return; }
        load();
    };
    const pauseCampaign = async (id) => {
        await apiFetch(`/api/dispatch/campaigns/${id}/pause`, { method: 'POST' });
        load();
    };
    const resumeCampaign = async (id) => {
        const r = await apiFetch(`/api/dispatch/campaigns/${id}/resume`, { method: 'POST' });
        if (!r.ok) { const e = await r.json(); alert(`Erro: ${e.error}`); return; }
        load();
    };
    const stopCampaign = async (id) => {
        if (!confirm('Encerrar campanha?')) return;
        await apiFetch(`/api/dispatch/campaigns/${id}/stop`, { method: 'POST' });
        load();
    };
    const deleteCampaign = async (id) => {
        if (!confirm('Excluir campanha e todos os dados?')) return;
        await apiFetch(`/api/dispatch/campaigns/${id}`, { method: 'DELETE' });
        if (selectedId === id) setSelectedId(null);
        load();
    };

    const dispatchAccounts = (accounts || []).filter((a) => a.account_mode === 'dispatch');

    if (selectedId) {
        return (
            <CampaignBoard
                socket={socket}
                campaignId={selectedId}
                onBack={() => { setSelectedId(null); load(); }}
            />
        );
    }

    if (showForm) {
        return (
            <CampaignForm
                campaign={editing}
                accounts={dispatchAccounts}
                onClose={() => { setShowForm(false); setEditing(null); load(); }}
            />
        );
    }

    return (
        <div className="dispatch-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h2 style={{ margin: 0, color: 'var(--accent-primary, #25D366)' }}>Disparo em Massa</h2>
                <button className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>+ Nova Campanha</button>
            </div>

            {error && (
                <div style={{ padding: 12, background: 'rgba(255,68,102,0.15)', borderRadius: 6, marginBottom: 16, fontSize: 13, color: '#ff4466' }}>
                    {error}
                </div>
            )}

            {dispatchAccounts.length === 0 && (
                <div style={{ padding: 12, background: 'rgba(255,200,0,0.1)', borderRadius: 6, marginBottom: 16, fontSize: 13 }}>
                    Nenhuma conta marcada como "disparo". Mude o modo de uma conta no painel principal antes de criar campanhas.
                </div>
            )}

            {campaigns.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', opacity: 0.6 }}>Nenhuma campanha criada.</div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
                    {campaigns.map((c) => (
                        <div key={c.id} className="account-card" style={{ padding: 14 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                <strong>{c.name}</strong>
                                <span className={`account-status ${c.status}`} style={{ fontSize: 11 }}>{c.status}</span>
                            </div>
                            <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 8 }}>
                                Modo: <b>{c.send_mode}</b> · Intervalo: {Math.round(c.interval_min_ms / 1000)}-{Math.round(c.interval_max_ms / 1000)}s
                            </div>
                            <div style={{ display: 'flex', gap: 6, fontSize: 11, marginBottom: 10, flexWrap: 'wrap' }}>
                                <span>Pendentes: {c.counts?.pending || 0}</span>
                                <span>Enviadas: {c.counts?.sent || 0}</span>
                                <span>Resp: {c.counts?.replied || 0}</span>
                                <span>Falhas: {c.counts?.failed || 0}</span>
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                <button className="btn btn-secondary" onClick={() => setSelectedId(c.id)}>Abrir</button>
                                {c.status === 'draft' && (
                                    <button className="btn btn-secondary" onClick={() => { setEditing(c); setShowForm(true); }}>Editar</button>
                                )}
                                {(c.status === 'draft' || c.status === 'paused') && (
                                    <button className="btn btn-primary" onClick={() => c.status === 'paused' ? resumeCampaign(c.id) : startCampaign(c.id)}>
                                        {c.status === 'paused' ? 'Retomar' : 'Iniciar'}
                                    </button>
                                )}
                                {c.status === 'running' && (
                                    <button className="btn btn-secondary" onClick={() => pauseCampaign(c.id)}>Pausar</button>
                                )}
                                {(c.status === 'running' || c.status === 'paused') && (
                                    <button className="btn btn-secondary" onClick={() => stopCampaign(c.id)}>Encerrar</button>
                                )}
                                <button className="btn btn-secondary" onClick={() => deleteCampaign(c.id)}>Excluir</button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
