import { useEffect, useState } from 'react';
import { apiFetch } from '../../api';

export default function InboxPanel({ socket, accounts }) {
    const [messages, setMessages] = useState([]);
    const [filterAccount, setFilterAccount] = useState('');

    const load = async () => {
        try {
            const r = await apiFetch('/api/dispatch/inbox?limit=300');
            if (!r.ok) { setMessages([]); return; }
            const data = await r.json();
            setMessages(Array.isArray(data) ? data : []);
        } catch {
            setMessages([]);
        }
    };

    useEffect(() => { load(); }, []);

    useEffect(() => {
        const onMsg = (m) => setMessages((prev) => [m, ...prev].slice(0, 500));
        socket.on('dispatch:message', onMsg);
        return () => socket.off('dispatch:message', onMsg);
    }, [socket]);

    const accountById = Object.fromEntries((accounts || []).map((a) => [a.id, a.name]));
    const filtered = filterAccount ? messages.filter((m) => String(m.account_id) === String(filterAccount)) : messages;

    return (
        <div className="inbox-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h2 style={{ margin: 0 }}>Inbox Global (Disparo)</h2>
                <select value={filterAccount} onChange={(e) => setFilterAccount(e.target.value)}>
                    <option value="">Todas as contas</option>
                    {(accounts || []).filter((a) => a.account_mode === 'dispatch').map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: '70vh', overflowY: 'auto' }}>
                {filtered.length === 0 && <div style={{ opacity: 0.6, padding: 20, textAlign: 'center' }}>Sem mensagens.</div>}
                {filtered.map((m) => (
                    <div key={m.id} style={{
                        padding: 8, borderRadius: 6,
                        background: m.direction === 'in' ? 'rgba(255,193,7,0.12)' : 'rgba(37,211,102,0.1)',
                        borderLeft: `3px solid ${m.direction === 'in' ? '#ffc107' : '#25D366'}`
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, opacity: 0.7, marginBottom: 4 }}>
                            <span>
                                {m.direction === 'in' ? '← Recebida' : '→ Enviada'} · {accountById[m.account_id] || `conta ${m.account_id}`} · {m.contact_phone}
                            </span>
                            <span>{new Date(m.created_at).toLocaleTimeString()}</span>
                        </div>
                        <div style={{ fontSize: 13 }}>{m.body || (m.media_path ? `[mídia: ${m.media_path.split(/[\\\\/]/).pop()}]` : '')}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}
