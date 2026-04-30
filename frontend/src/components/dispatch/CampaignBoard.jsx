import { useEffect, useState } from 'react';
import { apiFetch } from '../../api';

const STATUS_COLORS = {
    pending: '#888',
    sending: '#00bcd4',
    sent: '#25D366',
    replied: '#ffc107',
    paused: '#9e9e9e',
    failed: '#f44336'
};

export default function CampaignBoard({ socket, campaignId, onBack }) {
    const [board, setBoard] = useState({ accounts: [], unassigned: [] });
    const [campaign, setCampaign] = useState(null);
    const [messages, setMessages] = useState([]);

    const load = async () => {
        const [bRes, cRes, mRes] = await Promise.all([
            apiFetch(`/api/dispatch/campaigns/${campaignId}/board`).then((r) => r.json()),
            apiFetch(`/api/dispatch/campaigns/${campaignId}`).then((r) => r.json()),
            apiFetch(`/api/dispatch/campaigns/${campaignId}/messages?limit=200`).then((r) => r.json())
        ]);
        setBoard(bRes);
        setCampaign(cRes);
        setMessages(Array.isArray(mRes) ? mRes : []);
    };

    useEffect(() => { load(); }, [campaignId]);

    useEffect(() => {
        const onContact = (p) => {
            if (String(p.campaignId) !== String(campaignId)) return;
            setBoard((prev) => ({
                ...prev,
                accounts: prev.accounts.map((a) => ({
                    ...a,
                    contacts: a.contacts.map((c) => c.id === p.contactId ? { ...c, status: p.status } : c)
                }))
            }));
        };
        const onMsg = (m) => {
            if (String(m.campaign_id) !== String(campaignId)) return;
            setMessages((prev) => [m, ...prev].slice(0, 300));
        };
        socket.on('dispatch:contact:update', onContact);
        socket.on('dispatch:message', onMsg);
        return () => {
            socket.off('dispatch:contact:update', onContact);
            socket.off('dispatch:message', onMsg);
        };
    }, [socket, campaignId]);

    const counts = (contacts) => {
        const out = { pending: 0, sending: 0, sent: 0, replied: 0, failed: 0 };
        for (const c of contacts || []) out[c.status] = (out[c.status] || 0) + 1;
        return out;
    };

    return (
        <div className="campaign-board">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                    <button className="btn btn-secondary" onClick={onBack}>← Voltar</button>
                    <span style={{ marginLeft: 12, fontSize: 18, fontWeight: 600 }}>
                        {campaign?.name} <small style={{ opacity: 0.6 }}>({campaign?.status})</small>
                    </span>
                </div>
            </div>

            <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 12 }}>
                {board.accounts.map((a) => {
                    const cs = counts(a.contacts);
                    const proxyLabel = a.proxy_enabled ? `${a.proxy_ip}:${a.proxy_port}` : 'sem proxy';
                    return (
                        <div key={a.id} style={{ minWidth: 280, maxWidth: 320, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 10 }}>
                            <div style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 6, marginBottom: 6 }}>
                                <div style={{ fontWeight: 600 }}>{a.name}</div>
                                <div style={{ fontSize: 11, opacity: 0.7 }}>{proxyLabel}</div>
                                <div style={{ fontSize: 11, marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    <span>P:{cs.pending}</span>
                                    <span style={{ color: STATUS_COLORS.sent }}>E:{cs.sent}</span>
                                    <span style={{ color: STATUS_COLORS.replied }}>R:{cs.replied}</span>
                                    {cs.failed > 0 && <span style={{ color: STATUS_COLORS.failed }}>F:{cs.failed}</span>}
                                </div>
                            </div>
                            <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                                {(a.contacts || []).map((c) => (
                                    <div key={c.id} style={{
                                        padding: 4, fontSize: 12, display: 'flex', justifyContent: 'space-between',
                                        borderLeft: `3px solid ${STATUS_COLORS[c.status] || '#666'}`,
                                        paddingLeft: 6, marginBottom: 2
                                    }}>
                                        <span>{c.name || c.phone}</span>
                                        <small style={{ opacity: 0.6 }}>{c.status}</small>
                                    </div>
                                ))}
                            </div>

                            <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: 6, paddingTop: 6, maxHeight: 160, overflowY: 'auto' }}>
                                <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 4 }}>Últimas mensagens</div>
                                {messages.filter((m) => m.account_id === a.id).slice(0, 20).map((m) => (
                                    <div key={m.id} style={{
                                        fontSize: 11, padding: 4, marginBottom: 2, borderRadius: 4,
                                        background: m.direction === 'in' ? 'rgba(255,193,7,0.15)' : 'rgba(37,211,102,0.1)'
                                    }}>
                                        <div style={{ opacity: 0.6, fontSize: 10 }}>
                                            {m.direction === 'in' ? '←' : '→'} {m.contact_phone}
                                        </div>
                                        <div>{m.body || (m.media_path ? '[mídia]' : '')}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}

                {board.unassigned.length > 0 && (
                    <div style={{ minWidth: 240, background: 'rgba(255,200,0,0.08)', borderRadius: 8, padding: 10 }}>
                        <div style={{ fontWeight: 600, marginBottom: 8 }}>Não distribuídos</div>
                        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                            {board.unassigned.map((c) => (
                                <div key={c.id} style={{ fontSize: 12, padding: 4 }}>
                                    {c.name || c.phone}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
