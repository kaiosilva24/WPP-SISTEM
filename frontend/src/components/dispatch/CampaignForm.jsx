import { useEffect, useState } from 'react';
import { apiFetch } from '../../api';

export default function CampaignForm({ campaign, accounts, onClose }) {
    const [data, setData] = useState({
        name: '', send_mode: 'alternate', caption_enabled: false,
        interval_min_seconds: 30, interval_max_seconds: 60,
        auto_reply_enabled: false, pause_on_reply_seconds: 3600,
        messages_per_account: 0
    });
    const [campaignId, setCampaignId] = useState(null);
    const [texts, setTexts] = useState([]);
    const [replies, setReplies] = useState([]);
    const [media, setMedia] = useState([]);
    const [assigned, setAssigned] = useState([]); // [{accountId, quota}]
    const [contactsRaw, setContactsRaw] = useState('');
    const [newText, setNewText] = useState('');
    const [newReply, setNewReply] = useState('');
    const [insertedCount, setInsertedCount] = useState(null);

    useEffect(() => {
        if (!campaign) return;
        setCampaignId(campaign.id);
        setData({
            name: campaign.name,
            send_mode: campaign.send_mode,
            caption_enabled: campaign.caption_enabled,
            interval_min_seconds: Math.round((campaign.interval_min_ms || 30000) / 1000),
            interval_max_seconds: Math.round((campaign.interval_max_ms || 60000) / 1000),
            auto_reply_enabled: campaign.auto_reply_enabled,
            pause_on_reply_seconds: campaign.pause_on_reply_seconds,
            messages_per_account: campaign.messages_per_account
        });
        loadDetails(campaign.id);
    }, [campaign]);

    const loadDetails = async (id) => {
        const r = await apiFetch(`/api/dispatch/campaigns/${id}`);
        const c = await r.json();
        setTexts((c.texts || []).filter((t) => t.kind === 'outbound'));
        setReplies((c.texts || []).filter((t) => t.kind === 'reply'));
        setMedia(c.media || []);
        setAssigned((c.accounts || []).map((a) => ({ accountId: a.id, quota: a.quota || 0 })));
    };

    const ensureCreated = async () => {
        if (campaignId) return campaignId;
        const r = await apiFetch('/api/dispatch/campaigns', {
            method: 'POST',
            body: JSON.stringify(toPayload())
        });
        const c = await r.json();
        setCampaignId(c.id);
        return c.id;
    };

    const toPayload = () => ({
        name: data.name,
        send_mode: data.send_mode,
        caption_enabled: data.caption_enabled,
        interval_min_ms: (data.interval_min_seconds || 0) * 1000,
        interval_max_ms: (data.interval_max_seconds || 0) * 1000,
        auto_reply_enabled: data.auto_reply_enabled,
        pause_on_reply_seconds: data.pause_on_reply_seconds,
        messages_per_account: data.messages_per_account
    });

    const saveCampaign = async () => {
        if (!data.name) return alert('Defina um nome');
        const id = await ensureCreated();
        await apiFetch(`/api/dispatch/campaigns/${id}`, {
            method: 'PUT',
            body: JSON.stringify(toPayload())
        });
        loadDetails(id);
    };

    const addText = async (kind) => {
        const body = kind === 'reply' ? newReply : newText;
        if (!body) return;
        const id = await ensureCreated();
        await apiFetch(`/api/dispatch/campaigns/${id}/texts`, {
            method: 'POST',
            body: JSON.stringify({ body, kind })
        });
        if (kind === 'reply') setNewReply(''); else setNewText('');
        loadDetails(id);
    };

    const removeText = async (textId) => {
        await apiFetch(`/api/dispatch/campaigns/${campaignId}/texts/${textId}`, { method: 'DELETE' });
        loadDetails(campaignId);
    };

    const uploadMedia = async (e) => {
        const files = e.target.files;
        if (!files || !files.length) return;
        const id = await ensureCreated();
        const fd = new FormData();
        for (const f of files) fd.append('files', f);
        await apiFetch(`/api/dispatch/campaigns/${id}/media`, { method: 'POST', body: fd });
        e.target.value = '';
        loadDetails(id);
    };

    const removeMedia = async (mediaId) => {
        await apiFetch(`/api/dispatch/campaigns/${campaignId}/media/${mediaId}`, { method: 'DELETE' });
        loadDetails(campaignId);
    };

    const toggleAccount = async (accountId, checked) => {
        const id = await ensureCreated();
        if (checked) {
            const next = [...assigned, { accountId, quota: 0 }];
            setAssigned(next);
            await apiFetch(`/api/dispatch/campaigns/${id}/accounts`, {
                method: 'POST',
                body: JSON.stringify({ accountId, quota: 0 })
            });
        } else {
            setAssigned(assigned.filter((a) => a.accountId !== accountId));
            await apiFetch(`/api/dispatch/campaigns/${id}/accounts/${accountId}`, { method: 'DELETE' });
        }
    };

    const setQuota = async (accountId, quota) => {
        const next = assigned.map((a) => a.accountId === accountId ? { ...a, quota } : a);
        setAssigned(next);
        await apiFetch(`/api/dispatch/campaigns/${campaignId}/accounts`, {
            method: 'POST',
            body: JSON.stringify({ accountId, quota })
        });
    };

    const importContacts = async () => {
        if (!contactsRaw.trim()) return;
        const id = await ensureCreated();
        const r = await apiFetch(`/api/dispatch/campaigns/${id}/contacts`, {
            method: 'POST',
            body: JSON.stringify({ raw: contactsRaw })
        });
        const j = await r.json();
        setInsertedCount(j.inserted);
        setContactsRaw('');
    };

    return (
        <div className="campaign-form" style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h2 style={{ margin: 0 }}>{campaign ? 'Editar Campanha' : 'Nova Campanha'}</h2>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-primary" onClick={saveCampaign}>Salvar</button>
                    <button className="btn btn-secondary" onClick={onClose}>Voltar</button>
                </div>
            </div>

            <div className="form-group">
                <label>Nome</label>
                <input value={data.name} onChange={(e) => setData({ ...data, name: e.target.value })} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div className="form-group">
                    <label>Modo</label>
                    <select value={data.send_mode} onChange={(e) => setData({ ...data, send_mode: e.target.value })}>
                        <option value="text_only">Apenas texto</option>
                        <option value="image_with_caption">Imagem + caption</option>
                        <option value="alternate">Alternar texto/imagem</option>
                    </select>
                </div>
                <div className="form-group">
                    <label>Intervalo mín (s)</label>
                    <input type="number" value={data.interval_min_seconds} onChange={(e) => setData({ ...data, interval_min_seconds: parseInt(e.target.value || 0, 10) })} />
                </div>
                <div className="form-group">
                    <label>Intervalo máx (s)</label>
                    <input type="number" value={data.interval_max_seconds} onChange={(e) => setData({ ...data, interval_max_seconds: parseInt(e.target.value || 0, 10) })} />
                </div>
            </div>

            {data.send_mode === 'alternate' && (
                <div className="form-group">
                    <label>
                        <input type="checkbox" checked={!!data.caption_enabled}
                               onChange={(e) => setData({ ...data, caption_enabled: e.target.checked })} />
                        {' '}Caption nas imagens (quando sortear imagem)
                    </label>
                </div>
            )}

            <div className="form-group">
                <label>
                    <input type="checkbox" checked={!!data.auto_reply_enabled}
                           onChange={(e) => setData({ ...data, auto_reply_enabled: e.target.checked })} />
                    {' '}Auto-resposta para contatos da lista
                </label>
            </div>
            {data.auto_reply_enabled && (
                <div className="form-group">
                    <label>Pausa após resposta (segundos)</label>
                    <input type="number" value={data.pause_on_reply_seconds}
                           onChange={(e) => setData({ ...data, pause_on_reply_seconds: parseInt(e.target.value || 0, 10) })} />
                </div>
            )}

            <hr style={{ margin: '20px 0', opacity: 0.2 }} />

            <h3>Variantes de texto (envio)</h3>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <input style={{ flex: 1 }} placeholder="Adicionar texto..." value={newText}
                       onChange={(e) => setNewText(e.target.value)} />
                <button className="btn btn-secondary" onClick={() => addText('outbound')}>+ Adicionar</button>
            </div>
            {texts.map((t) => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 6, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <span style={{ flex: 1, fontSize: 13 }}>{t.body}</span>
                    <button className="btn btn-secondary" onClick={() => removeText(t.id)} style={{ fontSize: 11 }}>X</button>
                </div>
            ))}

            {data.auto_reply_enabled && (
                <>
                    <h3 style={{ marginTop: 16 }}>Variantes de resposta automática</h3>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                        <input style={{ flex: 1 }} placeholder="Adicionar resposta..." value={newReply}
                               onChange={(e) => setNewReply(e.target.value)} />
                        <button className="btn btn-secondary" onClick={() => addText('reply')}>+ Adicionar</button>
                    </div>
                    {replies.map((t) => (
                        <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 6, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                            <span style={{ flex: 1, fontSize: 13 }}>{t.body}</span>
                            <button className="btn btn-secondary" onClick={() => removeText(t.id)} style={{ fontSize: 11 }}>X</button>
                        </div>
                    ))}
                </>
            )}

            <hr style={{ margin: '20px 0', opacity: 0.2 }} />

            <h3>Imagens da campanha (rotação)</h3>
            <input type="file" multiple accept="image/*" onChange={uploadMedia} />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {media.map((m) => (
                    <div key={m.id} style={{ position: 'relative' }}>
                        <div style={{ width: 80, height: 80, background: 'rgba(0,0,0,0.4)', borderRadius: 4, fontSize: 10, padding: 4, overflow: 'hidden', wordBreak: 'break-all' }}>
                            {m.file_path.split(/[\\\\/]/).pop()}
                        </div>
                        <button onClick={() => removeMedia(m.id)} style={{ position: 'absolute', top: -6, right: -6, fontSize: 10 }}>X</button>
                    </div>
                ))}
            </div>

            <hr style={{ margin: '20px 0', opacity: 0.2 }} />

            <h3>Contas atribuídas</h3>
            {accounts.length === 0 ? (
                <div style={{ opacity: 0.6 }}>Nenhuma conta em modo "disparo". Volte ao painel principal.</div>
            ) : accounts.map((a) => {
                const sel = assigned.find((s) => s.accountId === a.id);
                return (
                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 6, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <input type="checkbox" checked={!!sel} onChange={(e) => toggleAccount(a.id, e.target.checked)} />
                        <span style={{ flex: 1 }}>{a.name} <small style={{ opacity: 0.6 }}>({a.status})</small></span>
                        {sel && (
                            <>
                                <span style={{ fontSize: 11, opacity: 0.7 }}>Cota:</span>
                                <input type="number" value={sel.quota} onChange={(e) => setQuota(a.id, parseInt(e.target.value || 0, 10))} style={{ width: 70 }} />
                            </>
                        )}
                    </div>
                );
            })}

            <hr style={{ margin: '20px 0', opacity: 0.2 }} />

            <h3>Lista de contatos</h3>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>Um por linha. Formato: <code>numero</code> ou <code>numero,nome</code></div>
            <textarea rows={6} style={{ width: '100%' }} value={contactsRaw} onChange={(e) => setContactsRaw(e.target.value)} placeholder="5511999999999&#10;5511888888888,Maria" />
            <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
                <button className="btn btn-secondary" onClick={importContacts}>Importar contatos</button>
                {insertedCount !== null && <small>{insertedCount} novos contatos adicionados</small>}
            </div>
        </div>
    );
}
