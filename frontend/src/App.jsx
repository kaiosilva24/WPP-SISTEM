import { useEffect, useState } from 'react'
import io from 'socket.io-client'
import './App.css'
import whatsappFire from './assets/whatsapp_fire.png'
import logoSvg from './assets/logo.svg'

// Detecta a URL do backend dinamicamente
// Em produção, usa a mesma origem da página (DisCloud)
// Em desenvolvimento local, usa localhost:3000
const API_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : window.location.origin;

console.log('🌐 API URL:', API_URL);

// Conecta ao backend via Socket.IO
const socket = io(API_URL);

function App() {
    const [accounts, setAccounts] = useState([]);
    const [stats, setStats] = useState({});
    const [currentAccountId, setCurrentAccountId] = useState(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showConfigModal, setShowConfigModal] = useState(false);
    const [showWebhookModal, setShowWebhookModal] = useState(false);
    const [showScheduleModal, setShowScheduleModal] = useState(false);
    const [webhooks, setWebhooks] = useState([]);
    const [newWebhook, setNewWebhook] = useState({ name: '', url: '', method: 'GET' });
    const [qrTimestamps, setQrTimestamps] = useState({});
    // Auth state
    const [authToken, setAuthToken] = useState(() => localStorage.getItem('wpp_auth_token'));
    const [authUser, setAuthUser] = useState(null);
    const [showLoginModal, setShowLoginModal] = useState(false);
    const [loginEmail, setLoginEmail] = useState('');
    const [loginPassword, setLoginPassword] = useState('');
    const [loginError, setLoginError] = useState('');
    const [loginLoading, setLoginLoading] = useState(false);
    const [showUserModal, setShowUserModal] = useState(false);
    const [systemUsers, setSystemUsers] = useState([]);
    const [newUserEmail, setNewUserEmail] = useState('');
    const [newUserPassword, setNewUserPassword] = useState('');
    const [newUserRole, setNewUserRole] = useState('user');
    const [userActionLoading, setUserActionLoading] = useState(false);
    // Messages tab state
    const [customMessages, setCustomMessages] = useState({ first: [], followup: [], group: [] });
    const [newMessage, setNewMessage] = useState({ type: 'first', text: '' });
    // Media tab state
    const [mediaLibrary, setMediaLibrary] = useState({ images: [], videos: [], stickers: [], audio: [], docs: [], vcards: [] });
    const [uploadingMedia, setUploadingMedia] = useState(false);
    const [activeTab, setActiveTab] = useState('proxy');
    const [msgPopup, setMsgPopup] = useState(null); // 'first' | 'followup' | 'group' | null
    const [delayPopup, setDelayPopup] = useState(null); // 'first' | 'followup' | 'group' | null
    const [activeLogPanels, setActiveLogPanels] = useState([]); // Array [{id, name}]
    const [accountLogs, setAccountLogs] = useState(() => {
        const saved = localStorage.getItem('wpp_sistem_logs');
        return saved ? JSON.parse(saved) : {};
    }); // { [accountName]: [{ts, level, message}] }
    // Config form state (delays em segundos para UI)
    const [configFields, setConfigFields] = useState({
        proxyEnabled: false, proxyIp: '', proxyPort: '', proxyUsername: '', proxyPassword: '',
        minReadDelay: 3, maxReadDelay: 15,
        minTypingDelay: 5, maxTypingDelay: 20,
        minResponseDelay: 10, maxResponseDelay: 30,
        minMessageInterval: 20, maxMessageInterval: 60,
        minFollowupReadDelay: 3, maxFollowupReadDelay: 15,
        minFollowupTypingDelay: 5, maxFollowupTypingDelay: 20,
        minFollowupResponseDelay: 10, maxFollowupResponseDelay: 30,
        minFollowupInterval: 30, maxFollowupInterval: 120,
        followupAudioEnabled: false, followupMinRecDelay: 5, followupMaxRecDelay: 15,
        followupMediaEnabled: true, followupMediaInterval: 3,
        followupMinAudioListenDelay: 5, followupMaxAudioListenDelay: 30,
        minGroupReadDelay: 3, maxGroupReadDelay: 15,
        minGroupTypingDelay: 5, maxGroupTypingDelay: 20,
        minGroupResponseDelay: 10, maxGroupResponseDelay: 30,
        minGroupInterval: 15, maxGroupInterval: 45,
        groupAudioEnabled: false, groupMinRecDelay: 5, groupMaxRecDelay: 15,
        groupMediaEnabled: true, groupMediaInterval: 3,
        groupMinAudioListenDelay: 5, groupMaxAudioListenDelay: 30,
        followupDocsEnabled: false, followupDocsInterval: 5,
        groupDocsEnabled: false, groupDocsInterval: 5,
        ignoreProbability: 20,
        mediaEnabled: false, mediaInterval: 2,
        pauseAfterNResponses: 0, pauseDurationMinutes: 10,
        autoWarmEnabled: false, autoWarmIdleMinutes: 10,
        autoWarmDelayMin: 30, autoWarmDelayMax: 120,
        minAudioListenDelay: 5, maxAudioListenDelay: 30,
        standbyEnabled: false, standbyMinInterval: 5, standbyMaxInterval: 15,
        standbyMinDuration: 10, standbyMaxDuration: 60,
        standbyWatchStatusEnabled: true, standbyWatchStatusProb: 70,
        standbyWatchStatusMinContacts: 1, standbyWatchStatusMaxContacts: 4,
        standbyWatchStatusMinDelay: 3, standbyWatchStatusMaxDelay: 8,
        proxyGroupId: '', webhookId: '', scheduledStartTime: '', scheduledEndTime: ''
    });
    const setCfg = (field, value) => setConfigFields(prev => ({ ...prev, [field]: value }));

    // Auth: verifica token salvo ao iniciar
    useEffect(() => {
        if (authToken) {
            fetch('/api/auth/me', { headers: { Authorization: `Bearer ${authToken}` } })
                .then(r => r.ok ? r.json() : null)
                .then(data => {
                    if (data?.user) {
                        setAuthUser(data.user);
                    } else {
                        // Token inválido ou expirado
                        localStorage.removeItem('wpp_auth_token');
                        setAuthToken(null);
                        setAuthUser(null);
                        setShowLoginModal(true);
                    }
                })
                .catch(() => {
                    // Offline ou erro — mantém estado para tentar depois
                });
        } else {
            setShowLoginModal(true);
        }
    }, []);

    const handleLogin = async () => {
        setLoginError('');
        setLoginLoading(true);
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: loginEmail, password: loginPassword })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro ao entrar');
            localStorage.setItem('wpp_auth_token', data.token);
            setAuthToken(data.token);
            setAuthUser(data.user);
            setShowLoginModal(false);
            setLoginEmail('');
            setLoginPassword('');
        } catch (err) {
            setLoginError(err.message);
        } finally {
            setLoginLoading(false);
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('wpp_auth_token');
        setAuthToken(null);
        setAuthUser(null);
        setShowLoginModal(true);
        setShowUserModal(false);
    };

    const loadSystemUsers = async () => {
        if (!authToken || authUser?.role !== 'admin') return;
        try {
            const res = await fetch('/api/auth/users', { headers: { Authorization: `Bearer ${authToken}` } });
            const data = await res.json();
            if (Array.isArray(data)) setSystemUsers(data);
        } catch { }
    };

    const createSystemUser = async () => {
        if (!newUserEmail || !newUserPassword) return showToast('Preencha e-mail e senha', 'warning');
        setUserActionLoading(true);
        try {
            const res = await fetch('/api/auth/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
                body: JSON.stringify({ email: newUserEmail, password: newUserPassword, role: newUserRole })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            showToast('Usuário criado!', 'success');
            setNewUserEmail(''); setNewUserPassword(''); setNewUserRole('user');
            await loadSystemUsers();
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            setUserActionLoading(false);
        }
    };

    const deleteSystemUser = async (id, email) => {
        if (!confirm(`Excluir usuário "${email}"?`)) return;
        try {
            const res = await fetch(`/api/auth/users/${id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${authToken}` }
            });
            if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
            showToast('Usuário removido', 'success');
            await loadSystemUsers();
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    // Carrega contas ao iniciar
    useEffect(() => {
        loadAccounts();
        loadStats();
        loadWebhooks();

        // Socket.IO
        console.log('🔌 Conectando ao Socket.IO...');

        socket.on('connect', () => {
            console.log('✅ Socket.IO conectado!', socket.id);
        });

        socket.on('disconnect', () => {
            console.log('❌ Socket.IO desconectado');
        });

        socket.on('initial-state', (data) => {
            console.log('📊 Estado inicial recebido:', data);
            loadAccounts(); // Busca lista completa da API para evitar sobrescrever com lista vazia do socket
            setStats(data.stats || {});
        });

        socket.on('update', (data) => {
            console.log('🔄 Atualização recebida:', data);
            loadAccounts();
            loadStats();
        });

        socket.on('session:qr', ({ accountId, qr, publicIP, isp }) => {
            console.log('📱 QR CODE RECEBIDO para conta:', accountId);
            if (qr) {
                console.log('✅ QR válido! Tamanho:', qr.length, 'caracteres');
                console.log('🔍 Primeiros 100 chars:', qr.substring(0, 100));
                console.log('🔍 Últimos 50 chars:', qr.substring(qr.length - 50));

                // Registra o timestamp do QR code
                setQrTimestamps(prev => ({
                    ...prev,
                    [accountId]: Date.now()
                }));

                setAccounts(prev => prev.map(acc => {
                    if (acc.id === accountId) {
                        console.log('📝 Atualizando conta', accountId, 'com QR code');
                        return { ...acc, qrCode: qr, status: 'qr', publicIP, isp };
                    }
                    return acc;
                }));
            } else {
                console.error('❌ QR code está undefined!');
            }
        });

        socket.on('session:authenticated', ({ accountName }) => {
            console.log('✅ Autenticado:', accountName);
            showToast(`${accountName} autenticada!`, 'success');
        });

        socket.on('session:ready', ({ accountName }) => {
            console.log('✅ Pronta:', accountName);
            showToast(`${accountName} conectada!`, 'success');
        });

        socket.on('session:disconnected', ({ accountName }) => {
            console.log('⚠️ Desconectada:', accountName);
            showToast(`${accountName} desconectada`, 'warning');
        });

        // Logs em tempo real por conta
        socket.on('account:log', ({ accountId, accountName, level, message, timestamp }) => {
            const idToSave = accountId || accountName; // Compatibilidade com instâncias antigas 
            setAccountLogs(prev => {
                const existing = prev[idToSave] || [];
                const updated = [...existing, { ts: timestamp, level, message }];
                // Mantém últimas 200 entradas
                const newState = { ...prev, [idToSave]: updated.slice(-200) };
                localStorage.setItem('wpp_sistem_logs', JSON.stringify(newState));
                return newState;
            });
        });

        return () => {
            socket.off('connect');
            socket.off('disconnect');
            socket.off('initial-state');
            socket.off('update');
            socket.off('session:qr');
            socket.off('session:authenticated');
            socket.off('session:ready');
            socket.off('session:disconnected');
            socket.off('account:log');
        };
    }, []);

    // Força re-render a cada segundo para atualizar contadores de QR
    useEffect(() => {
        const interval = setInterval(() => {
            // Força re-render se houver QR codes ativos
            if (Object.keys(qrTimestamps).length > 0) {
                setAccounts(prev => [...prev]);
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [qrTimestamps]);

    // Funções de API
    const loadAccounts = async () => {
        try {
            const response = await fetch('/api/accounts');
            const data = await response.json();
            console.log('📊 Contas carregadas:', data);
            setAccounts(data);
        } catch (error) {
            console.error('Erro ao carregar contas:', error);
        }
    };

    const loadStats = async () => {
        try {
            const response = await fetch('/api/stats');
            const data = await response.json();
            setStats(data);
        } catch (error) {
            console.error('Erro ao carregar estatísticas:', error);
        }
    };

    const loadWebhooks = async () => {
        try {
            const response = await fetch('/api/webhooks');
            const data = await response.json();
            setWebhooks(data);
        } catch (error) {
            console.error('Erro ao carregar webhooks:', error);
        }
    };

    const addWebhook = async () => {
        if (!newWebhook.name || !newWebhook.url) {
            return showToast('Preencha nome e URL do Webhook', 'warning');
        }
        try {
            const response = await fetch('/api/webhooks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newWebhook)
            });
            if (response.ok) {
                showToast('Webhook cadastrado!', 'success');
                setNewWebhook({ name: '', url: '', method: 'GET' });
                loadWebhooks();
            } else {
                showToast('Erro ao cadastrar Webhook', 'error');
            }
        } catch (error) {
            showToast('Erro de conexão ao salvar Webhook', 'error');
        }
    };

    const deleteWebhookHandler = async (id) => {
        if (!confirm('Excluir este Webhook? Contas que o usam perderão o vínculo.')) return;
        try {
            await fetch(`/api/webhooks/${id}`, { method: 'DELETE' });
            showToast('Webhook removido', 'success');
            loadWebhooks();
        } catch (error) {
            showToast('Erro ao remover Webhook', 'error');
        }
    };

    const createAccount = async (name) => {
        console.log('Criando conta:', name);
        try {
            const response = await fetch('/api/accounts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });

            console.log('Status da resposta:', response.status);

            if (!response.ok) {
                const error = await response.json();
                console.error('Erro ao criar conta:', error);
                throw new Error(error.error);
            }

            const account = await response.json();
            console.log('Conta criada:', account);

            showToast('Conta criada com sucesso!', 'success');
            setShowCreateModal(false);

            // Limpa o campo de input
            const input = document.getElementById('accountNameInput');
            if (input) input.value = '';

            loadAccounts();
        } catch (error) {
            console.error('Erro:', error);
            showToast(error.message, 'error');
        }
    };


    const startAccount = async (id, visible = false) => {
        try {
            console.log(`Iniciando conta: ${id} (Visível: ${visible})`);
            const accFn = accounts.find(a => a.id === id);

            setAccounts(accounts.map(acc =>
                acc.id === id ? { ...acc, status: 'initializing' } : acc
            ));

            const response = await fetch(`/api/accounts/${id}/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ visible })
            });

            if (response.ok) {
                showToast(visible ? 'Iniciando navegador visível...' : 'Iniciando sistema...', 'success');
            } else {
                const errData = await response.json();
                throw new Error(errData.error || 'Erro ao iniciar');
            }
        } catch (error) {
            console.error(error);
            showToast(error.message, 'error');
            // Reverte status se der erro
            loadAccounts();
        }
    };


    const restartAccount = async (id) => {
        try {
            console.log(`Reiniciando conta: ${id}`);
            showToast('Reiniciando e gerando novo QR...', 'info');

            setAccounts(accounts.map(acc =>
                acc.id === id ? { ...acc, status: 'initializing' } : acc
            ));

            const response = await fetch(`/api/accounts/${id}/restart`, {
                method: 'POST'
            });

            if (response.ok) {
                showToast('Solicitação de reinício enviada', 'success');
            } else {
                throw new Error('Erro ao reiniciar');
            }
        } catch (error) {
            console.error(error);
            showToast('Erro ao reiniciar conta', 'error');
            loadAccounts();
        }
    };

    const handleViewBrowser = async (account) => {
        if (['ready', 'qr', 'initializing', 'authenticated'].includes(account.status)) {
            if (confirm('⚠️ Para visualizar o navegador, é necessário reiniciar a sessão.\n\nO processo será interrompido e reiniciado com o navegador aberto.\nDeseja continuar?')) {
                await startAccount(account.id, true);
            }
        } else {
            // Se está parado, só inicia visível
            await startAccount(account.id, true);
        }
    };

    const stopAccount = async (id) => {
        try {
            await fetch(`/api/accounts/${id}/stop`, { method: 'POST' });
            showToast('Sessão destruída e encerrada!', 'success');
            loadAccounts();
        } catch (error) {
            showToast('Erro ao parar conta', 'error');
        }
    };

    const pauseAccount = async (id) => {
        try {
            // Optimistic update
            setAccounts(accounts.map(acc => acc.id === id ? { ...acc, isPaused: true, status: 'paused' } : acc));

            await fetch(`/api/accounts/${id}/pause`, { method: 'POST' });
            showToast('Conta em PAUSA (Standby / Modo Avião)!', 'warning');
            loadAccounts();
        } catch (error) {
            showToast('Erro ao pausar conta', 'error');
            loadAccounts();
        }
    };

    const resumeAccount = async (id) => {
        try {
            // Optimistic update
            setAccounts(accounts.map(acc => acc.id === id ? { ...acc, isPaused: false, status: 'ready' } : acc));

            await fetch(`/api/accounts/${id}/resume`, { method: 'POST' });
            showToast('Conta retomada com sucesso!', 'success');
            loadAccounts();
        } catch (error) {
            showToast('Erro ao retomar conta', 'error');
            loadAccounts();
        }
    };

    const deleteAccount = async (id) => {
        if (!confirm('Tem certeza que deseja deletar esta conta?')) return;

        try {
            await fetch(`/api/accounts/${id}`, { method: 'DELETE' });
            showToast('Conta deletada', 'success');
            loadAccounts();
        } catch (error) {
            showToast('Erro ao deletar conta', 'error');
        }
    };

    const openConfigModal = async (id) => {
        setCurrentAccountId(id);
        setActiveTab('proxy');
        setCustomMessages({ first: [], followup: [], group: [] });
        setMediaLibrary({ images: [], videos: [], stickers: [], audio: [], docs: [], vcards: [] });

        try {
            const response = await fetch(`/api/accounts/${id}`);
            const account = await response.json();

            // Converte ms -> segundos para exibir na UI
            setConfigFields({
                proxyEnabled: !!account.proxy_enabled,
                proxyIp: account.proxy_ip || '',
                proxyPort: account.proxy_port || '',
                proxyUsername: account.proxy_username || '',
                proxyPassword: account.proxy_password || '',
                minReadDelay: Math.round((account.min_read_delay || 3000) / 1000),
                maxReadDelay: Math.round((account.max_read_delay || 15000) / 1000),
                minTypingDelay: Math.round((account.min_typing_delay || 5000) / 1000),
                maxTypingDelay: Math.round((account.max_typing_delay || 20000) / 1000),
                minResponseDelay: Math.round((account.min_response_delay || 10000) / 1000),
                maxResponseDelay: Math.round((account.max_response_delay || 30000) / 1000),
                minMessageInterval: Math.round((account.min_message_interval || 20000) / 1000),
                maxMessageInterval: Math.round((account.max_message_interval || 60000) / 1000),
                minFollowupReadDelay: Math.round((account.min_followup_read_delay || 3000) / 1000),
                maxFollowupReadDelay: Math.round((account.max_followup_read_delay || 15000) / 1000),
                minFollowupTypingDelay: Math.round((account.min_followup_typing_delay || 5000) / 1000),
                maxFollowupTypingDelay: Math.round((account.max_followup_typing_delay || 20000) / 1000),
                minFollowupResponseDelay: Math.round((account.min_followup_response_delay || 10000) / 1000),
                maxFollowupResponseDelay: Math.round((account.max_followup_response_delay || 30000) / 1000),
                minFollowupInterval: Math.round((account.min_followup_interval || 30000) / 1000),
                maxFollowupInterval: Math.round((account.max_followup_interval || 120000) / 1000),
                followupAudioEnabled: !!account.followup_audio_enabled,
                followupMinRecDelay: Math.round((account.followup_min_recording_delay || 5000) / 1000),
                followupMaxRecDelay: Math.round((account.followup_max_recording_delay || 15000) / 1000),
                followupMediaEnabled: account.followup_media_enabled !== undefined ? !!account.followup_media_enabled : true,
                followupMediaInterval: account.followup_media_interval || 3,
                followupMinAudioListenDelay: (account.min_followup_audio_listen_delay || 5000) / 1000,
                followupMaxAudioListenDelay: (account.max_followup_audio_listen_delay || 30000) / 1000,
                minGroupReadDelay: Math.round((account.min_group_read_delay || 3000) / 1000),
                maxGroupReadDelay: Math.round((account.max_group_read_delay || 15000) / 1000),
                minGroupTypingDelay: Math.round((account.min_group_typing_delay || 5000) / 1000),
                maxGroupTypingDelay: Math.round((account.max_group_typing_delay || 20000) / 1000),
                minGroupResponseDelay: Math.round((account.min_group_response_delay || 10000) / 1000),
                maxGroupResponseDelay: Math.round((account.max_group_response_delay || 30000) / 1000),
                minGroupInterval: Math.round((account.min_group_interval || 15000) / 1000),
                maxGroupInterval: Math.round((account.max_group_interval || 45000) / 1000),
                groupAudioEnabled: !!account.group_audio_enabled,
                groupMinRecDelay: Math.round((account.group_min_recording_delay || 5000) / 1000),
                groupMaxRecDelay: Math.round((account.group_max_recording_delay || 15000) / 1000),
                groupMediaEnabled: account.group_media_enabled !== undefined ? !!account.group_media_enabled : true,
                groupMediaInterval: account.group_media_interval || 3,
                groupMinAudioListenDelay: (account.min_group_audio_listen_delay || 5000) / 1000,
                groupMaxAudioListenDelay: (account.max_group_audio_listen_delay || 30000) / 1000,
                followupDocsEnabled: !!account.followup_docs_enabled,
                followupDocsInterval: account.followup_docs_interval || 5,
                groupDocsEnabled: !!account.group_docs_enabled,
                groupDocsInterval: account.group_docs_interval || 5,
                ignoreProbability: account.ignore_probability || 20,
                mediaEnabled: !!account.media_enabled,
                mediaInterval: account.media_interval || 2,
                pauseAfterNResponses: account.pause_after_n_responses || 0,
                pauseDurationMinutes: account.pause_duration_minutes || 10,
                autoWarmEnabled: !!account.auto_warm_enabled,
                autoWarmIdleMinutes: account.auto_warm_idle_minutes || 10,
                autoWarmDelayMin: account.auto_warm_delay_min || 30,
                autoWarmDelayMax: account.auto_warm_delay_max || 120,
                groupEnabled: account.group_enabled !== false && account.group_enabled !== 0,
                minAudioListenDelay: (account.min_audio_listen_delay || 5000) / 1000,
                maxAudioListenDelay: (account.max_audio_listen_delay || 30000) / 1000,
                globalGroupDelayMinutes: account.global_group_delay_minutes || 0,
                globalPrivateDelayMinutes: account.global_private_delay_minutes || 0,
                standbyEnabled: account.standby_enabled === 1,
                standbyMinInterval: account.standby_min_interval || 5,
                standbyMaxInterval: account.standby_max_interval || 15,
                standbyMinDuration: account.standby_min_duration || 10,
                standbyMaxDuration: account.standby_max_duration || 60,
                standbyWatchStatusEnabled: account.standby_watch_status_enabled !== 0,
                standbyWatchStatusProb: account.standby_watch_status_prob || 70,
                standbyWatchStatusMinContacts: account.standby_watch_status_min_contacts || 1,
                standbyWatchStatusMaxContacts: account.standby_watch_status_max_contacts || 4,
                standbyWatchStatusMinDelay: account.standby_watch_status_min_delay || 3,
                standbyWatchStatusMaxDelay: account.standby_watch_status_max_delay || 8,
                proxyGroupId: account.proxy_group_id || '',
                webhookId: account.webhook_id || '',
                scheduledStartTime: account.scheduled_start_time || '',
                scheduledEndTime: account.scheduled_end_time || ''
            });

            setShowConfigModal(true);

            await Promise.all([loadMessages(id), loadMedia()]);
        } catch (error) {
            console.error('Erro ao carregar configurações:', error);
            showToast('Erro ao carregar configurações', 'error');
        }
    };

    const saveConfig = async () => {
        if (!currentAccountId) return;

        // Converte segundos -> ms para salvar no banco
        const config = {
            proxy_enabled: configFields.proxyEnabled ? 1 : 0,
            proxy_ip: configFields.proxyIp,
            proxy_port: parseInt(configFields.proxyPort) || null,
            proxy_username: configFields.proxyUsername || null,
            proxy_password: configFields.proxyPassword || null,

            min_read_delay: (parseFloat(configFields.minReadDelay) || 3) * 1000,
            max_read_delay: (parseFloat(configFields.maxReadDelay) || 15) * 1000,
            min_typing_delay: (parseFloat(configFields.minTypingDelay) || 5) * 1000,
            max_typing_delay: (parseFloat(configFields.maxTypingDelay) || 20) * 1000,
            min_response_delay: (parseFloat(configFields.minResponseDelay) || 10) * 1000,
            max_response_delay: (parseFloat(configFields.maxResponseDelay) || 30) * 1000,
            min_message_interval: (parseFloat(configFields.minMessageInterval) || 20) * 1000,
            max_message_interval: (parseFloat(configFields.maxMessageInterval) || 60) * 1000,
            min_followup_read_delay: (parseFloat(configFields.minFollowupReadDelay) || 3) * 1000,
            max_followup_read_delay: (parseFloat(configFields.maxFollowupReadDelay) || 15) * 1000,
            min_followup_typing_delay: (parseFloat(configFields.minFollowupTypingDelay) || 5) * 1000,
            max_followup_typing_delay: (parseFloat(configFields.maxFollowupTypingDelay) || 20) * 1000,
            min_followup_response_delay: (parseFloat(configFields.minFollowupResponseDelay) || 10) * 1000,
            max_followup_response_delay: (parseFloat(configFields.maxFollowupResponseDelay) || 30) * 1000,
            min_followup_interval: (parseFloat(configFields.minFollowupInterval) || 30) * 1000,
            max_followup_interval: (parseFloat(configFields.maxFollowupInterval) || 120) * 1000,
            min_group_read_delay: (parseFloat(configFields.minGroupReadDelay) || 3) * 1000,
            max_group_read_delay: (parseFloat(configFields.maxGroupReadDelay) || 15) * 1000,
            min_group_typing_delay: (parseFloat(configFields.minGroupTypingDelay) || 5) * 1000,
            max_group_typing_delay: (parseFloat(configFields.maxGroupTypingDelay) || 20) * 1000,
            min_group_response_delay: (parseFloat(configFields.minGroupResponseDelay) || 10) * 1000,
            max_group_response_delay: (parseFloat(configFields.maxGroupResponseDelay) || 30) * 1000,
            min_group_interval: (parseFloat(configFields.minGroupInterval) || 15) * 1000,
            max_group_interval: (parseFloat(configFields.maxGroupInterval) || 45) * 1000,
            followup_audio_enabled: configFields.followupAudioEnabled ? 1 : 0,
            followup_min_recording_delay: (parseFloat(configFields.followupMinRecDelay) || 5) * 1000,
            followup_max_recording_delay: (parseFloat(configFields.followupMaxRecDelay) || 15) * 1000,
            followup_media_enabled: configFields.followupMediaEnabled ? 1 : 0,
            followup_media_interval: parseInt(configFields.followupMediaInterval) || 3,
            min_followup_audio_listen_delay: (parseFloat(configFields.followupMinAudioListenDelay) || 5) * 1000,
            max_followup_audio_listen_delay: (parseFloat(configFields.followupMaxAudioListenDelay) || 30) * 1000,
            group_audio_enabled: configFields.groupAudioEnabled ? 1 : 0,
            group_min_recording_delay: (parseFloat(configFields.groupMinRecDelay) || 5) * 1000,
            group_max_recording_delay: (parseFloat(configFields.groupMaxRecDelay) || 15) * 1000,
            group_media_enabled: configFields.groupMediaEnabled ? 1 : 0,
            group_media_interval: parseInt(configFields.groupMediaInterval) || 3,
            min_group_audio_listen_delay: (parseFloat(configFields.groupMinAudioListenDelay) || 5) * 1000,
            max_group_audio_listen_delay: (parseFloat(configFields.groupMaxAudioListenDelay) || 30) * 1000,
            followup_docs_enabled: configFields.followupDocsEnabled ? 1 : 0,
            followup_docs_interval: parseInt(configFields.followupDocsInterval) || 5,
            group_docs_enabled: configFields.groupDocsEnabled ? 1 : 0,
            group_docs_interval: parseInt(configFields.groupDocsInterval) || 5,
            ignore_probability: parseInt(configFields.ignoreProbability) || 20,

            media_enabled: configFields.mediaEnabled ? 1 : 0,
            media_interval: parseInt(configFields.mediaInterval) || 2,

            pause_after_n_responses: parseInt(configFields.pauseAfterNResponses) || 0,
            pause_duration_minutes: parseInt(configFields.pauseDurationMinutes) || 10,
            auto_warm_enabled: configFields.autoWarmEnabled ? 1 : 0,
            auto_warm_idle_minutes: parseInt(configFields.autoWarmIdleMinutes) || 10,
            auto_warm_delay_min: parseInt(configFields.autoWarmDelayMin) || 30,
            auto_warm_delay_max: parseInt(configFields.autoWarmDelayMax) || 120,
            group_enabled: configFields.groupEnabled ? 1 : 0,
            min_audio_listen_delay: (parseFloat(configFields.minAudioListenDelay) || 5) * 1000,
            max_audio_listen_delay: (parseFloat(configFields.maxAudioListenDelay) || 30) * 1000,
            global_group_delay_minutes: parseInt(configFields.globalGroupDelayMinutes) || 0,
            global_private_delay_minutes: parseInt(configFields.globalPrivateDelayMinutes) || 0,
            standby_enabled: configFields.standbyEnabled ? 1 : 0,
            standby_min_interval: parseInt(configFields.standbyMinInterval) || 5,
            standby_max_interval: parseInt(configFields.standbyMaxInterval) || 15,
            standby_min_duration: parseInt(configFields.standbyMinDuration) || 10,
            standby_max_duration: parseInt(configFields.standbyMaxDuration) || 60,
            standby_watch_status_enabled: configFields.standbyWatchStatusEnabled ? 1 : 0,
            standby_watch_status_prob: parseInt(configFields.standbyWatchStatusProb) || 70,
            standby_watch_status_min_contacts: parseInt(configFields.standbyWatchStatusMinContacts) || 1,
            standby_watch_status_max_contacts: parseInt(configFields.standbyWatchStatusMaxContacts) || 4,
            standby_watch_status_min_delay: parseInt(configFields.standbyWatchStatusMinDelay) || 3,
            standby_watch_status_max_delay: parseInt(configFields.standbyWatchStatusMaxDelay) || 8,
            proxy_group_id: configFields.proxyGroupId || null,
            webhook_id: parseInt(configFields.webhookId) || null,
            scheduled_start_time: configFields.scheduledStartTime || null,
            scheduled_end_time: configFields.scheduledEndTime || null
        };

        try {
            const response = await fetch(`/api/accounts/${currentAccountId}/config`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Erro ao salvar');
            }

            showToast('Configurações salvas!', 'success');
            setShowConfigModal(false);
            loadAccounts();
        } catch (error) {
            showToast(`Erro: ${error.message}`, 'error');
        }
    };

    const testProxy = async () => {
        const proxyIp = configFields.proxyIp;
        const proxyPort = configFields.proxyPort;
        const proxyUsername = configFields.proxyUsername;
        const proxyPassword = configFields.proxyPassword;

        if (!proxyIp || !proxyPort) {
            showToast('Preencha IP e Porta do proxy', 'warning');
            return;
        }

        showToast('Testando proxy...', 'info');

        try {
            const response = await fetch('/api/test-proxy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ip: proxyIp,
                    port: parseInt(proxyPort),
                    username: proxyUsername,
                    password: proxyPassword
                })
            });

            const result = await response.json();

            if (result.success) {
                showToast(`✅ Proxy funcionando! IP: ${result.ip}`, 'success');
            } else {
                showToast(`❌ Proxy falhou: ${result.error}`, 'error');
            }
        } catch (error) {
            showToast('❌ Erro ao testar proxy', 'error');
        }
    };

    const toggleProxyFields = () => {
        // Mantido por compatibilidade, mas o proxy agora usa React state
    };

    // ---- Messages helpers ----
    const loadMessages = async (id) => {
        try {
            const [first, followup, group] = await Promise.all([
                fetch(`/api/accounts/${id}/messages?type=first`).then(r => r.json()),
                fetch(`/api/accounts/${id}/messages?type=followup`).then(r => r.json()),
                fetch(`/api/accounts/${id}/messages?type=group`).then(r => r.json()),
            ]);
            const total = (first?.length || 0) + (followup?.length || 0) + (group?.length || 0);
            // Auto-seed: se não tem nenhuma mensagem, insere as padrões automaticamente
            if (total === 0) {
                await fetch(`/api/accounts/${id}/messages/seed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
                const [f2, fu2, g2] = await Promise.all([
                    fetch(`/api/accounts/${id}/messages?type=first`).then(r => r.json()),
                    fetch(`/api/accounts/${id}/messages?type=followup`).then(r => r.json()),
                    fetch(`/api/accounts/${id}/messages?type=group`).then(r => r.json()),
                ]);
                setCustomMessages({ first: f2, followup: fu2, group: g2 });
            } else {
                setCustomMessages({ first, followup, group });
            }
        } catch (e) {
            console.error('Erro ao carregar mensagens:', e);
        }
    };

    const addMessage = async () => {
        const lines = newMessage.text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length === 0) return showToast('Digite pelo menos uma mensagem', 'warning');
        try {
            for (const line of lines) {
                await fetch(`/api/accounts/${currentAccountId}/messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message_type: newMessage.type, message_text: line })
                });
            }
            setNewMessage(prev => ({ ...prev, text: '' }));
            await loadMessages(currentAccountId);
            showToast(`${lines.length} mensagem(ns) adicionada(s)!`, 'success');
        } catch (e) {
            showToast('Erro ao adicionar mensagens', 'error');
        }
    };

    const deleteMessage = async (msgId) => {
        try {
            await fetch(`/api/accounts/${currentAccountId}/messages/${msgId}`, { method: 'DELETE' });
            await loadMessages(currentAccountId);
            showToast('Mensagem removida', 'success');
        } catch (e) {
            showToast('Erro ao remover mensagem', 'error');
        }
    };

    const seedMessages = async (force = false) => {
        try {
            showToast(force ? 'Recriando mensagens padrão...' : 'Carregando mensagens padrão...', 'info');
            const res = await fetch(`/api/accounts/${currentAccountId}/messages/seed`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ force })
            });
            const data = await res.json();
            await loadMessages(currentAccountId);
            showToast(data.message || 'Mensagens padrão carregadas!', 'success');
        } catch (e) {
            showToast('Erro ao carregar mensagens padrão', 'error');
        }
    };

    // ---- Media helpers ----
    const loadMedia = async () => {
        try {
            const data = await fetch('/api/accounts/media/library').then(r => r.json());
            setMediaLibrary({
                images: data.images || [],
                videos: data.videos || [],
                stickers: data.stickers || [],
                audio: data.audio || [],
                docs: data.docs || [],
                vcards: data.vcards || []
            });
        } catch (e) {
            console.error('Erro ao listar mídias:', e);
        }
    };

    const uploadMedia = async (category, e) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        setUploadingMedia(true);
        try {
            const fd = new FormData();
            for (let i = 0; i < files.length; i++) fd.append('files', files[i]);
            const res = await fetch(`/api/accounts/media/upload/${category}`, { method: 'POST', body: fd });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Erro no upload');
            }
            const result = await res.json();
            await loadMedia();
            showToast(`${result.count} arquivo(s) enviado(s)!`, 'success');
        } catch (err) {
            showToast(`Erro: ${err.message}`, 'error');
        } finally {
            setUploadingMedia(false);
            e.target.value = '';
        }
    };

    const deleteMedia = async (category, filename) => {
        if (!confirm(`Deletar "${filename}"?`)) return;
        try {
            await fetch(`/api/accounts/media/${category}/${encodeURIComponent(filename)}`, { method: 'DELETE' });
            await loadMedia();
            showToast('Arquivo deletado', 'success');
        } catch (e) {
            showToast('Erro ao deletar arquivo', 'error');
        }
    };

    const deleteAllMedia = async (category, label) => {
        if (!confirm(`Deletar TODOS os arquivos de ${label}?`)) return;
        try {
            const res = await fetch(`/api/accounts/media/clear/${category}`, { method: 'DELETE' });
            const data = await res.json();
            await loadMedia();
            showToast(`${data.deleted} arquivo(s) deletado(s) de ${label}`, 'success');
        } catch (e) {
            showToast('Erro ao deletar', 'error');
        }
    };

    const switchTab = (tabName) => {
        setActiveTab(tabName);
    };

    const formatFileSize = (bytes) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    const getFileIcon = (name) => {
        const ext = name.split('.').pop().toLowerCase();
        if (['jpg', 'jpeg', 'png', 'gif'].includes(ext)) return '🖼️';
        if (['mp4', 'mov', 'avi'].includes(ext)) return '🎬';
        if (ext === 'webp') return '🎭';
        if (['mp3', 'ogg', 'm4a'].includes(ext)) return '🎵';
        if (['pdf', 'doc', 'docx'].includes(ext)) return '📄';
        if (ext === 'vcf') return '👤';
        return '📎';
    };

    const showToast = (message, type = 'info') => {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;

        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => container.removeChild(toast), 300);
        }, 3000);
    };

    // Componente de contador regressivo para QR Code
    const QRCountdown = ({ accountId }) => {
        const [timeLeft, setTimeLeft] = useState(60);

        useEffect(() => {
            const qrTime = qrTimestamps[accountId];
            if (!qrTime) return;

            const interval = setInterval(() => {
                const elapsed = Math.floor((Date.now() - qrTime) / 1000);
                const remaining = Math.max(0, 60 - elapsed);
                setTimeLeft(remaining);

                if (remaining === 0) {
                    clearInterval(interval);
                }
            }, 1000);

            return () => clearInterval(interval);
        }, [accountId, qrTimestamps]);

        const minutes = Math.floor(timeLeft / 60);
        const seconds = timeLeft % 60;
        const percentage = (timeLeft / 60) * 100;

        return (
            <div className="qr-countdown">
                <div className="countdown-bar">
                    <div
                        className="countdown-progress"
                        style={{ width: `${percentage}%` }}
                    ></div>
                </div>
                <div className="countdown-text">
                    {timeLeft > 0 ? (
                        <>
                            ⏱️ Tempo restante: <strong>{minutes}:{seconds.toString().padStart(2, '0')}</strong>
                        </>
                    ) : (
                        <span className="countdown-expired">⚠️ QR Code expirado - Clique em Iniciar novamente</span>
                    )}
                </div>
            </div>
        );
    };

    const getStatusText = (status, accountId) => {
        // Se está no status QR e temos timestamp, mostra o contador
        if (status === 'qr' && qrTimestamps[accountId]) {
            const elapsed = Math.floor((Date.now() - qrTimestamps[accountId]) / 1000);
            const remaining = Math.max(0, 60 - elapsed);

            // Se ainda não expirou, mostra o contador
            if (remaining > 0) {
                const minutes = Math.floor(remaining / 60);
                const seconds = remaining % 60;
                return `⏱️ Tempo restante: ${minutes}:${seconds.toString().padStart(2, '0')}`;
            } else {
                return '⚠️ QR Expirado';
            }
        }

        const map = {
            'initializing': 'GERANDO QR...',
            'ready': 'CONECTADO',
            'paused': 'PAUSADO',
            'qr': 'AGUARDANDO QR',
            'authenticated': 'AUTENTICADO',
            'disconnected': 'DESCONECTADO',
            'error': 'ERRO'
        };
        return map[status] || status;
    };

    return (
        <div className="container">
            {/* Header */}
            <header className="header">
                <div className="header-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <h1 className="title" style={{ display: 'flex', alignItems: 'center', margin: 0, padding: 0 }}>
                        <img
                            src={logoSvg}
                            alt="WPP SISTEM"
                            className="header-logo-image"
                            style={{
                                height: '60px',
                                marginRight: '10px',
                                filter: 'drop-shadow(0 0 10px rgba(37, 211, 102, 0.7))'
                            }}
                        />
                        <span style={{
                            fontSize: '1.4rem',
                            fontWeight: '800',
                            marginRight: '10px',
                            letterSpacing: '1px',
                            fontFamily: 'Orbitron, sans-serif',
                            textTransform: 'uppercase',
                            background: 'linear-gradient(90deg, #25D366, #00ff88)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            filter: 'drop-shadow(0px 0px 10px rgba(37,211,102,0.5))',
                            position: 'relative',
                            zIndex: 10
                        }}>
                            AQUECIMENTO ADVANCED PRO
                        </span>
                        <span className="version" style={{ marginLeft: 0 }}>v2.0</span>
                        {/* User icon */}
                        <button
                            onClick={() => {
                                if (!authUser) { setShowLoginModal(true); return; }
                                if (authUser.role === 'admin') {
                                    loadSystemUsers();
                                    setShowUserModal(true);
                                } else {
                                    // Usuário comum: só mostra info
                                    setShowUserModal(true);
                                }
                            }}
                            title={authUser ? `${authUser.email} (${authUser.role === 'admin' ? 'Administrador' : 'Usuário'})` : 'Entrar'}
                            style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                marginLeft: '12px',
                                padding: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                color: authUser?.role === 'admin' ? '#25D366' : '#aaa',
                                transition: 'color 0.2s',
                                position: 'relative',
                                zIndex: 10
                            }}
                        >
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                                stroke={authUser?.role === 'admin' ? '#25D366' : '#aaa'}
                                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                style={{ filter: authUser?.role === 'admin' ? 'drop-shadow(0 0 5px rgba(37,211,102,0.6))' : 'none' }}
                            >
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                <circle cx="12" cy="7" r="4" />
                            </svg>
                            {authUser && (
                                <span style={{ fontSize: '0.7rem', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.8 }}>
                                    {authUser.email.split('@')[0]}
                                </span>
                            )}
                        </button>
                    </h1>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button className="btn btn-secondary" onClick={() => setShowWebhookModal(true)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#25D366" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
                            Webhooks
                        </button>
                        <button className="btn btn-secondary" onClick={() => setShowScheduleModal(true)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#25D366" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12,6 12,12 16,14" /></svg>
                            Programar
                        </button>
                        <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                            Nova Conta
                        </button>
                    </div>
                </div>
            </header>

            <section className="stats-section">
                <div className="stats-grid">
                    <div className="stat-card">
                        <div className="stat-icon">
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#25D366" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="5" y="2" width="14" height="20" rx="2" ry="2" /><line x1="12" y1="18" x2="12" y2="18" />
                            </svg>
                        </div>
                        <div className="stat-info">
                            <div className="stat-number">{stats.totalAccounts || 0}</div>
                            <div className="stat-label">Total de Contas</div>
                        </div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-icon">
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#25D366" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20,6 9,17 4,12" />
                            </svg>
                        </div>
                        <div className="stat-info">
                            <div className="stat-number">{stats.ready || 0}</div>
                            <div className="stat-label">Contas Ativas</div>
                        </div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-icon">
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#25D366" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22,2 15,22 11,13 2,9" />
                            </svg>
                        </div>
                        <div className="stat-info">
                            <div className="stat-number">{stats.totalMessagesSent || 0}</div>
                            <div className="stat-label">Mensagens Enviadas</div>
                        </div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-icon">
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#25D366" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                            </svg>
                        </div>
                        <div className="stat-info">
                            <div className="stat-number">{stats.totalUniqueContacts || 0}</div>
                            <div className="stat-label">Contatos Únicos</div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Accounts Grid */}
            <section className="accounts-section">
                <h2 className="section-title">Contas WhatsApp</h2>
                <div className="accounts-grid">
                    {accounts.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-icon">
                                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#25D366" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                                    <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                                    <line x1="12" y1="18" x2="12" y2="18" strokeWidth="2" />
                                    <line x1="9" y1="7" x2="15" y2="7" />
                                    <line x1="9" y1="10" x2="15" y2="10" />
                                    <line x1="9" y1="13" x2="12" y2="13" />
                                </svg>
                            </div>
                            <h3>Nenhuma conta criada</h3>
                            <p>Clique em "Nova Conta" para começar</p>
                        </div>
                    ) : (
                        accounts.map(account => (
                            <div key={account.id} className="account-card">
                                <div className="account-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div className="account-name">{account.name}</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        {/* Botão de Leads Novos (Sempre visível se conectado) */}
                                        {['ready', 'authenticated', 'paused'].includes(account.status) && (
                                            <button
                                                className="btn-vcard-subtle"
                                                title={`Baixar ${account.unsaved_contacts} novo(s) lead(s) (vCard)`}
                                                onClick={() => {
                                                    window.location.href = `/api/accounts/${account.id}/unsaved-vcard`;
                                                    setTimeout(() => loadAccounts(), 2000);
                                                }}
                                            >
                                                vCard {account.unsaved_contacts}
                                            </button>
                                        )}
                                        <div className={`account-status ${(account.status || 'disconnected').toLowerCase()}`}>
                                            {getStatusText(account.status || 'disconnected', account.id)}
                                        </div>
                                    </div>
                                </div>

                                {
                                    account.status === 'qr' && account.qrCode && (
                                        <div className="qr-container">
                                            <img src={account.qrCode} alt="QR Code" />
                                            <div className="connection-info">
                                                {account.publicIP && account.isp ? (
                                                    <div className="connection-badge proxy">
                                                        <span className="connection-icon">
                                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
                                                        </span>
                                                        <div className="connection-details">
                                                            <div className="connection-label">{account.isp}</div>
                                                            <div className="connection-value">{account.publicIP}</div>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="connection-badge local">
                                                        <span className="connection-icon">
                                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="2,16.5 12,2 22,16.5" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12" y2="17" /></svg>
                                                        </span>
                                                        <div className="connection-details">
                                                            <div className="connection-label">Detectando conexão...</div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )
                                }

                                < div className="account-info" >
                                    <div className="info-item">
                                        <span className="info-label">Enviadas</span>
                                        <span className="info-value">{account.messages_sent || 0}</span>
                                    </div>
                                    <div className="info-item">
                                        <span className="info-label">Recebidas</span>
                                        <span className="info-value">{account.messages_received || 0}</span>
                                    </div>
                                    <div className="info-item">
                                        <span className="info-label">Contatos</span>
                                        <span className="info-value">{account.unique_contacts || 0}</span>
                                    </div>
                                </div>

                                {/* Breakdown por tipo: Privado e Grupo */}
                                <div className="stats-breakdown">
                                    <div className="breakdown-col">
                                        <div className="breakdown-title">
                                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ display: 'inline', marginRight: '4px' }}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>PRIVADO
                                        </div>
                                        <div className="breakdown-row"><span><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg></span><span>{account.priv_text || 0}</span></div>
                                        <div className="breakdown-row"><span><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21,15 16,10 5,21" /></svg></span><span>{account.priv_image || 0}</span></div>
                                        <div className="breakdown-row"><span><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /></svg></span><span>{account.priv_audio || 0}</span></div>
                                        <div className="breakdown-row"><span><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg></span><span>{account.priv_sticker || 0}</span></div>
                                    </div>
                                    <div className="breakdown-divider" />
                                    <div className="breakdown-col">
                                        <div className="breakdown-title">
                                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ display: 'inline', marginRight: '4px' }}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>GRUPO
                                        </div>
                                        <div className="breakdown-row"><span><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg></span><span>{account.group_text || 0}</span></div>
                                        <div className="breakdown-row"><span><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21,15 16,10 5,21" /></svg></span><span>{account.group_image || 0}</span></div>
                                        <div className="breakdown-row"><span><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /></svg></span><span>{account.group_audio || 0}</span></div>
                                        <div className="breakdown-row"><span><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg></span><span>{account.group_sticker || 0}</span></div>
                                    </div>
                                </div>

                                <div className={`proxy-badge ${account.proxy_enabled ? '' : 'no-proxy'}`}>
                                    {account.proxy_enabled ? (
                                        <>
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                                            {account.proxy_ip}:{account.proxy_port}
                                        </>
                                    ) : 'SEM PROXY'}
                                </div>

                                <div className="account-actions futuristic-actions">
                                    {account.status === 'ready' && !account.isPaused && (
                                        <button className="btn-action action-glow-red" onClick={() => pauseAccount(account.id)} title="Pausar">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                                            Pausar
                                        </button>
                                    )}
                                    {(account.status === 'paused' || account.isPaused) && (
                                        <button className="btn-action action-glow-green" onClick={() => resumeAccount(account.id)} title="Continuar">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5,3 19,12 5,21" /></svg>
                                            Continuar
                                        </button>
                                    )}
                                    {account.status !== 'ready' && account.status !== 'paused' && !account.isPaused && (
                                        <button className="btn-action action-glow-green" onClick={() => startAccount(account.id)} title="Iniciar">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5,3 19,12 5,21" /></svg>
                                            Iniciar
                                        </button>
                                    )}
                                    <button className="btn-action icon-only" onClick={() => restartAccount(account.id)} title="Reiniciar / Recarregar QR">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23,4 23,10 17,10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
                                    </button>
                                    <button className="btn-action icon-only" title="Ver Navegador" onClick={() => handleViewBrowser(account)}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="2" /><path d="M12 5C7 5 3 8.6 3 12s4 7 9 7 9-3.6 9-7-4-7-9-7z" /><line x1="3" y1="12" x2="21" y2="12" /></svg>
                                    </button>
                                    <button className="btn-action icon-only popup-anchor" title="Logs em tempo real" onClick={() => setActiveLogPanels([{ id: account.id, name: account.name }])}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14,2 14,8 20,8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
                                        {(accountLogs[account.id] || accountLogs[account.name] || []).length > 0 && (
                                            <span className="badge-notification">
                                                {Math.min((accountLogs[account.id] || accountLogs[account.name] || []).length, 99)}
                                            </span>
                                        )}
                                    </button>
                                    <button className="btn-action icon-only" onClick={() => openConfigModal(account.id)} title="Configurações">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                                    </button>

                                    <button className="btn-action action-glow-red icon-only" onClick={() => deleteAccount(account.id)} title="Excluir Conta">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3,6 5,6 21,6" /><path d="M19,6l-1,14a2,2,0,0,1-2,2H8a2,2,0,0,1-2-2L5,6" /><path d="M10,11v6" /><path d="M14,11v6" /><path d="M9,6V4a1,1,0,0,1,1-1h4a1,1,0,0,1,1,1V6" /></svg>
                                    </button>
                                </div>
                            </div>
                        ))
                    )
                    }
                </div >
            </section >

            {/* Modal: Criar Conta */}
            {
                showCreateModal && (
                    <div className="modal show">
                        <div className="modal-content">
                            <div className="modal-header">
                                <h2>Nova Conta WhatsApp</h2>
                                <button className="modal-close" onClick={() => setShowCreateModal(false)}>&times;</button>
                            </div>
                            <div className="modal-body">
                                <div className="form-group">
                                    <label>Nome da Conta</label>
                                    <input
                                        type="text"
                                        id="accountNameInput"
                                        placeholder="Ex: Conta 1, Vendas, Suporte..."
                                        className="form-input"
                                    />
                                    <small>Escolha um nome único para identificar esta conta</small>
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>Cancelar</button>
                                <button className="btn btn-primary" onClick={() => {
                                    const name = document.getElementById('accountNameInput').value.trim();
                                    if (name) createAccount(name);
                                }}>Criar Conta</button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Modal: Configurar Conta */}
            {
                showConfigModal && (
                    <div className="modal show">
                        <div className="modal-content modal-large">
                            <div className="modal-header">
                                <h2>Configurar Conta</h2>
                                <button className="modal-close" onClick={() => setShowConfigModal(false)}>&times;</button>
                            </div>
                            <div className="modal-body">
                                <div className="tabs">
                                    <button className={`tab-btn ${activeTab === 'proxy' ? 'active' : ''}`} onClick={() => switchTab('proxy')}>Proxy</button>
                                    <button className={`tab-btn ${activeTab === 'delays' ? 'active' : ''}`} onClick={() => switchTab('delays')}>Delays</button>
                                    <button className={`tab-btn ${activeTab === 'mensagens' ? 'active' : ''}`} onClick={() => switchTab('mensagens')}>Mensagens</button>
                                    <button className={`tab-btn ${activeTab === 'media' ? 'active' : ''}`} onClick={() => switchTab('media')}>Mídia</button>
                                    <button className={`tab-btn ${activeTab === 'standby' ? 'active' : ''}`} onClick={() => switchTab('standby')}>Standby</button>
                                </div>

                                {/* Tab: Proxy */}
                                {activeTab === 'proxy' && (
                                    <div id="tab-proxy" className="tab-content active">
                                        <div className="form-group">
                                            <label className="checkbox-label">
                                                <input
                                                    type="checkbox"
                                                    checked={configFields.proxyEnabled}
                                                    onChange={e => setCfg('proxyEnabled', e.target.checked)}
                                                />
                                                <span>Usar Proxy</span>
                                            </label>
                                        </div>
                                        {configFields.proxyEnabled && (
                                            <div>
                                                <div className="form-row">
                                                    <div className="form-group">
                                                        <label>IP do Proxy</label>
                                                        <input type="text" placeholder="192.168.1.1" className="form-input"
                                                            value={configFields.proxyIp}
                                                            onChange={e => setCfg('proxyIp', e.target.value)} />
                                                    </div>
                                                    <div className="form-group">
                                                        <label>Porta</label>
                                                        <input type="number" placeholder="8080" className="form-input"
                                                            value={configFields.proxyPort}
                                                            onChange={e => setCfg('proxyPort', e.target.value)} />
                                                    </div>
                                                </div>
                                                <div className="form-row">
                                                    <div className="form-group">
                                                        <label>Usuário (opcional)</label>
                                                        <input type="text" placeholder="usuario" className="form-input"
                                                            value={configFields.proxyUsername}
                                                            onChange={e => setCfg('proxyUsername', e.target.value)} />
                                                    </div>
                                                    <div className="form-group">
                                                        <label>Senha (opcional)</label>
                                                        <input type="password" placeholder="senha" className="form-input"
                                                            value={configFields.proxyPassword}
                                                            onChange={e => setCfg('proxyPassword', e.target.value)} />
                                                    </div>
                                                </div>
                                                <button className="btn btn-primary btn-sm" onClick={testProxy}>
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                                                    Testar Proxy
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Tab: Delays */}
                                {activeTab === 'delays' && (
                                    <div id="tab-delays" className="tab-content active">
                                        <p style={{ color: '#aaa', fontSize: '0.85rem', margin: '0 0 14px 0' }}>
                                            Configure os delays para cada tipo de mensagem. Clique em um tipo para abrir as configurações.
                                        </p>

                                        {/* 3 Card Buttons */}
                                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
                                            {/* Primeiro Contato */}
                                            <div
                                                onClick={() => setDelayPopup('first')}
                                                style={{
                                                    flex: '1 1 140px', cursor: 'pointer',
                                                    background: 'rgba(0, 0, 0, 0.4)',
                                                    border: '1px solid rgba(37, 211, 102, 0.2)', borderRadius: '12px',
                                                    padding: '16px 14px', textAlign: 'center',
                                                    transition: 'all .2s', boxShadow: '0 2px 8px rgba(37, 211, 102, 0.1)'
                                                }}
                                                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-primary)'; e.currentTarget.style.boxShadow = 'var(--shadow-neon-green)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                                                onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(37, 211, 102, 0.2)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(37, 211, 102, 0.1)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                                            >
                                                <div style={{ marginBottom: '6px', display: 'flex', justifyContent: 'center' }}>
                                                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#25D366" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                                                </div>
                                                <div style={{ fontWeight: 700, color: 'var(--accent-primary)', fontSize: '0.85rem' }}>Primeiro Contato</div>
                                                <div style={{ color: '#888', fontSize: '0.7rem', marginTop: '4px' }}>
                                                    {configFields.minReadDelay}s–{configFields.maxReadDelay}s leitura
                                                </div>
                                            </div>

                                            {/* Follow-up */}
                                            <div
                                                onClick={() => setDelayPopup('followup')}
                                                style={{
                                                    flex: '1 1 140px', cursor: 'pointer',
                                                    background: 'rgba(0, 0, 0, 0.4)',
                                                    border: '1px solid rgba(0, 255, 102, 0.2)', borderRadius: '12px',
                                                    padding: '16px 14px', textAlign: 'center',
                                                    transition: 'all .2s', boxShadow: '0 2px 8px rgba(0, 255, 102, 0.1)'
                                                }}
                                                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-success)'; e.currentTarget.style.boxShadow = '0 0 15px rgba(0, 255, 102, 0.3)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                                                onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(0, 255, 102, 0.2)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 255, 102, 0.1)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                                            >
                                                <div style={{ marginBottom: '6px', display: 'flex', justifyContent: 'center' }}>
                                                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00ff88" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="23,4 23,10 17,10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
                                                </div>
                                                <div style={{ fontWeight: 700, color: 'var(--accent-success)', fontSize: '0.85rem' }}>Follow-up</div>
                                                <div style={{ color: '#888', fontSize: '0.7rem', marginTop: '4px' }}>
                                                    {configFields.minFollowupReadDelay}s–{configFields.maxFollowupReadDelay}s leitura
                                                </div>
                                            </div>

                                            {/* Grupo */}
                                            <div
                                                onClick={() => setDelayPopup('group')}
                                                style={{
                                                    flex: '1 1 140px', cursor: 'pointer',
                                                    background: 'rgba(0, 0, 0, 0.4)',
                                                    border: '1px solid rgba(0, 153, 0, 0.2)', borderRadius: '12px',
                                                    padding: '16px 14px', textAlign: 'center',
                                                    transition: 'all .2s', boxShadow: '0 2px 8px rgba(0, 153, 0, 0.1)'
                                                }}
                                                onMouseEnter={e => { e.currentTarget.style.borderColor = '#009900'; e.currentTarget.style.boxShadow = '0 0 15px rgba(0, 153, 0, 0.3)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                                                onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(0, 153, 0, 0.2)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 153, 0, 0.1)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                                            >
                                                <div style={{ marginBottom: '6px', display: 'flex', justifyContent: 'center' }}>
                                                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00ff66" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                                                </div>
                                                <div style={{ fontWeight: 700, color: '#00ff66', fontSize: '0.85rem' }}>Grupo</div>
                                                <div style={{ color: '#888', fontSize: '0.7rem', marginTop: '4px' }}>
                                                    {configFields.minGroupReadDelay}s–{configFields.maxGroupReadDelay}s leitura
                                                </div>
                                            </div>
                                        </div>

                                        {/* Pausa Automática */}
                                        <div style={{
                                            background: 'linear-gradient(135deg, rgba(255,0,51,0.06) 0%, rgba(6,14,24,0.95) 100%)',
                                            border: '1px solid rgba(255,0,51,0.25)',
                                            borderLeft: '3px solid #ff0033',
                                            clipPath: 'polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px)',
                                            padding: '16px 18px', marginTop: '12px',
                                            boxShadow: '0 0 20px rgba(255,0,51,0.08)'
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ff0033" strokeWidth="2.2" strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 5px #ff003380)' }}><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                                                <strong style={{ color: '#ff3355', fontFamily: 'Orbitron, sans-serif', fontSize: '0.85rem', letterSpacing: '2px', textTransform: 'uppercase', textShadow: '0 0 10px rgba(255,0,51,0.4)' }}>Pausa Automática</strong>
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                                <div className="form-group" style={{ margin: 0 }}>
                                                    <label style={{ color: '#888', fontSize: '0.72rem', letterSpacing: '1.5px', textTransform: 'uppercase', fontFamily: 'Share Tech Mono, monospace' }}>Pausar após N respostas <span style={{ color: '#555' }}>(0 = desativado)</span></label>
                                                    <input type="number" min="0" className="form-input"
                                                        value={configFields.pauseAfterNResponses}
                                                        onChange={e => setCfg('pauseAfterNResponses', parseInt(e.target.value) || 0)} />
                                                </div>
                                                <div className="form-group" style={{ margin: 0 }}>
                                                    <label style={{ color: '#888', fontSize: '0.72rem', letterSpacing: '1.5px', textTransform: 'uppercase', fontFamily: 'Share Tech Mono, monospace' }}>Duração da pausa (minutos)</label>
                                                    <input type="number" min="1" className="form-input"
                                                        value={configFields.pauseDurationMinutes}
                                                        onChange={e => setCfg('pauseDurationMinutes', parseInt(e.target.value) || 10)} />
                                                </div>
                                            </div>
                                            <small style={{ color: '#444', display: 'block', marginTop: '8px', fontFamily: 'Share Tech Mono, monospace', fontSize: '0.72rem' }}>A conta para de responder por X minutos após enviar N respostas. Útil para simular comportamento humano.</small>
                                        </div>

                                        {/* Auto-Aquecimento */}
                                        <div style={{
                                            background: 'linear-gradient(135deg, rgba(255,102,0,0.08) 0%, rgba(6,14,24,0.98) 100%)',
                                            border: '1px solid rgba(255,102,0,0.3)',
                                            borderLeft: '3px solid #ff6600',
                                            clipPath: 'polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px)',
                                            padding: '16px 18px', marginTop: '12px',
                                            boxShadow: 'inset 0 0 30px rgba(255,102,0,0.04), 0 0 20px rgba(255,102,0,0.08)'
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ff6600" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'pulse-icon 2s infinite ease-in-out', filter: 'drop-shadow(0 0 6px #ff660080)' }}><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10" /><path d="M12 6v6l4 2" /><path d="M16 2l2 2-2 2" /></svg>
                                                    <strong style={{ color: '#ff8833', fontFamily: 'Orbitron, sans-serif', fontSize: '0.85rem', letterSpacing: '2px', textTransform: 'uppercase', textShadow: '0 0 10px rgba(255,102,0,0.5)' }}>Auto-Aquecimento</strong>
                                                </div>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                                    <input type="checkbox" checked={configFields.autoWarmEnabled}
                                                        onChange={e => setCfg('autoWarmEnabled', e.target.checked)} />
                                                    <span style={{ fontSize: '0.72rem', color: configFields.autoWarmEnabled ? '#ff8833' : '#444', fontWeight: 'bold', letterSpacing: '1.5px', fontFamily: 'Share Tech Mono, monospace' }}>
                                                        {configFields.autoWarmEnabled ? 'ON' : 'OFF'}
                                                    </span>
                                                </label>
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', opacity: configFields.autoWarmEnabled ? 1 : 0.35, pointerEvents: configFields.autoWarmEnabled ? 'auto' : 'none' }}>
                                                <div className="form-group" style={{ margin: 0 }}>
                                                    <label style={{ color: '#888', fontSize: '0.72rem', letterSpacing: '1.5px', textTransform: 'uppercase', fontFamily: 'Share Tech Mono, monospace' }}>Acionar após idle (min)</label>
                                                    <input type="number" min="1" className="form-input"
                                                        value={configFields.autoWarmIdleMinutes}
                                                        onChange={e => setCfg('autoWarmIdleMinutes', parseInt(e.target.value) || 10)} />
                                                </div>
                                                <div className="form-group" style={{ margin: 0 }}>
                                                    <label style={{ color: '#888', fontSize: '0.72rem', letterSpacing: '1.5px', textTransform: 'uppercase', fontFamily: 'Share Tech Mono, monospace' }}>Delay mínimo (s)</label>
                                                    <input type="number" min="5" className="form-input"
                                                        value={configFields.autoWarmDelayMin}
                                                        onChange={e => setCfg('autoWarmDelayMin', parseInt(e.target.value) || 30)} />
                                                </div>
                                                <div className="form-group" style={{ margin: 0 }}>
                                                    <label style={{ color: '#888', fontSize: '0.72rem', letterSpacing: '1.5px', textTransform: 'uppercase', fontFamily: 'Share Tech Mono, monospace' }}>Delay máximo (s)</label>
                                                    <input type="number" min="10" className="form-input"
                                                        value={configFields.autoWarmDelayMax}
                                                        onChange={e => setCfg('autoWarmDelayMax', parseInt(e.target.value) || 120)} />
                                                </div>
                                            </div>
                                            <small style={{ color: '#444', display: 'block', marginTop: '8px', fontFamily: 'Share Tech Mono, monospace', fontSize: '0.72rem' }}>Quando a conta ficar idle, envia mensagens automáticas para outras contas conectadas para manter o aquecimento ativo. Precisa de ≥2 contas conectadas.</small>
                                        </div>

                                    </div>
                                )}

                                {/* Tab: Mensagens */}
                                {activeTab === 'mensagens' && (
                                    <div id="tab-mensagens" className="tab-content active">
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                                            <p style={{ color: '#aaa', fontSize: '0.85rem', margin: 0 }}>
                                                Configure as mensagens automáticas. Use <code style={{ background: '#333', padding: '1px 4px', borderRadius: '3px' }}>{'{'}nome{'}'}</code> para o nome.
                                            </p>
                                            <button
                                                className="btn btn-secondary btn-sm"
                                                style={{ flexShrink: 0, marginLeft: '8px' }}
                                                onClick={() => seedMessages(true)}
                                                title="Apaga todas as mensagens e recarrega as mensagens padrão do sistema"
                                            >
                                                🔄 Recriar com padrão
                                            </button>
                                        </div>

                                        {/* Seletor de tipo */}
                                        <div className="form-group">
                                            <label>Tipo de Mensagem</label>
                                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                                                {[['first', 'Primeiro Contato', 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'], ['followup', 'Follow-up', 'M23 4v6h-6M20.49 15a9 9 0 1 1-2.12-9.36L23 10'], ['group', 'Grupo', 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75']].map(([type, label, path]) => (
                                                    <button
                                                        key={type}
                                                        className={`btn btn-sm ${newMessage.type === type ? 'btn-primary' : 'btn-secondary'}`}
                                                        onClick={() => setNewMessage(prev => ({ ...prev, type }))}
                                                    >
                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>
                                                        {label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Adicionar mensagem */}
                                        <div className="form-group">
                                            <label>
                                                Nova(s) Mensagem ({newMessage.type === 'first' ? 'Primeiro Contato' : newMessage.type === 'followup' ? 'Follow-up' : 'Grupo'})
                                                <span style={{ fontWeight: 400, color: '#888', fontSize: '0.78rem', marginLeft: '8px' }}>— uma por linha para adicionar em massa</span>
                                            </label>
                                            <textarea
                                                className="form-input"
                                                style={{ minHeight: '140px', resize: 'vertical', lineHeight: '1.6' }}
                                                placeholder={`Linha 1: Oi {nome}! Bora conversar? 💬\nLinha 2: E aí {nome}, tudo bem? 😊\nLinha 3: Me chama no privado! 📲\n\nCada linha vira uma mensagem separada.`}
                                                value={newMessage.text}
                                                onChange={e => setNewMessage(prev => ({ ...prev, text: e.target.value }))}
                                            />
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                                                <button className="btn btn-primary btn-sm" onClick={addMessage}>
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                                                    Adicionar {newMessage.text.split('\n').filter(l => l.trim()).length > 1
                                                        ? `${newMessage.text.split('\n').filter(l => l.trim()).length} Mensagens`
                                                        : 'Mensagem'}
                                                </button>
                                                <span style={{ color: '#666', fontSize: '0.78rem' }}>
                                                    {newMessage.text.split('\n').filter(l => l.trim()).length} linha(s)
                                                </span>
                                            </div>
                                        </div>

                                        {/* Botões de acesso às mensagens salvas */}
                                        <div style={{ display: 'flex', gap: '10px', marginTop: '20px', flexWrap: 'wrap' }}>
                                            {[
                                                ['first', 'Primeiro Contato', '#25D366', 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'],
                                                ['followup', 'Follow-up', '#00ff88', 'M23 4v6h-6 M20.49 15a9 9 0 1 1-2.12-9.36L23 10'],
                                                ['group', 'Grupo', '#009900', 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75']
                                            ].map(([type, label, color]) => (
                                                <button
                                                    key={type}
                                                    onClick={() => setMsgPopup(type)}
                                                    style={{
                                                        flex: 1, minWidth: '120px',
                                                        background: `rgba(0, 0, 0, 0.4)`,
                                                        border: `1px solid ${color}44`,
                                                        borderRadius: '10px',
                                                        padding: '14px 10px',
                                                        cursor: 'pointer',
                                                        textAlign: 'center',
                                                        transition: 'all 0.15s',
                                                        boxShadow: `0 0 10px ${color}11`
                                                    }}
                                                    onMouseEnter={e => { e.currentTarget.style.borderColor = color; e.currentTarget.style.boxShadow = `0 0 15px ${color}44`; }}
                                                    onMouseLeave={e => { e.currentTarget.style.borderColor = `${color}44`; e.currentTarget.style.boxShadow = `0 0 10px ${color}11`; }}
                                                >
                                                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#eee' }}>{label}</div>
                                                    <div style={{ marginTop: '4px', background: color, borderRadius: '12px', padding: '2px 10px', fontSize: '0.8rem', color: '#000', display: 'inline-block', fontWeight: 'bold' }}>
                                                        {customMessages[type]?.length || 0} mensagens
                                                    </div>
                                                    <div style={{ marginTop: '6px', fontSize: '0.72rem', color: '#888' }}>Clique para gerenciar</div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Tab: Mídia — Biblioteca Global */}
                                {activeTab === 'media' && (() => {
                                    const totalFiles = Object.values(mediaLibrary).reduce((s, arr) => s + arr.length, 0);
                                    const categories = [
                                        { key: 'images', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e57373" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21,15 16,10 5,21" /></svg>, label: 'Imagens', accept: '.jpg,.jpeg,.png,.gif', color: '#e57373' },
                                        { key: 'videos', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#64b5f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23,7 16,12 23,17" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>, label: 'Vídeos', accept: '.mp4', color: '#64b5f6' },
                                        { key: 'stickers', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ba68c8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>, label: 'Figurinhas', accept: '.webp', color: '#ba68c8' },
                                        { key: 'audio', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4db6ac" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>, label: 'Áudio', accept: '.mp3,.ogg', color: '#4db6ac' },
                                        { key: 'docs', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffb74d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14,2 14,8 20,8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>, label: 'Documentos', accept: '.pdf,.doc,.docx', color: '#ffb74d' },
                                        { key: 'vcards', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#aed581" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>, label: 'vCards', accept: '.vcf', color: '#aed581' }
                                    ];
                                    return (
                                        <div id="tab-media" className="tab-content active">
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                                <div>
                                                    <div style={{ fontSize: '1rem', fontWeight: 700, color: '#eee', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#25D366" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                                                        Biblioteca de Mídia
                                                    </div>
                                                    <small style={{ color: '#888' }}>Global — compartilhada entre todas as contas ({totalFiles} arquivo{totalFiles !== 1 ? 's' : ''})</small>
                                                </div>
                                            </div>

                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                                {categories.map(cat => {
                                                    const files = mediaLibrary[cat.key] || [];
                                                    return (
                                                        <div key={cat.key} style={{
                                                            background: `linear-gradient(135deg, ${cat.color}08 0%, rgba(4,10,18,0.97) 100%)`,
                                                            border: `1px solid ${cat.color}33`,
                                                            borderLeft: `3px solid ${cat.color}`,
                                                            clipPath: 'polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)',
                                                            overflow: 'visible',
                                                            boxShadow: `0 0 12px ${cat.color}11`
                                                        }}>
                                                            {/* Header da categoria */}
                                                            <div style={{
                                                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                                padding: '10px 14px', borderBottom: files.length > 0 ? `1px solid ${cat.color}18` : 'none',
                                                                background: `linear-gradient(90deg, ${cat.color}0a 0%, transparent 55%)`
                                                            }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                    <span style={{ fontSize: '1.2rem' }}>{cat.icon}</span>
                                                                    <span style={{ fontWeight: 700, color: cat.color, fontSize: '0.82rem', letterSpacing: '1.5px', textTransform: 'uppercase', fontFamily: 'Share Tech Mono, monospace' }}>{cat.label}</span>
                                                                    <span style={{
                                                                        background: `${cat.color}22`, color: cat.color,
                                                                        border: `1px solid ${cat.color}44`,
                                                                        padding: '1px 8px', fontSize: '0.7rem', fontWeight: 700,
                                                                        fontFamily: 'Share Tech Mono, monospace'
                                                                    }}>{files.length}</span>
                                                                </div>
                                                                <div style={{ display: 'flex', gap: '6px' }}>
                                                                    <label style={{
                                                                        cursor: uploadingMedia ? 'wait' : 'pointer',
                                                                        background: `${cat.color}18`, color: cat.color,
                                                                        border: `1px solid ${cat.color}44`,
                                                                        padding: '4px 10px', fontSize: '0.72rem', fontWeight: 700,
                                                                        display: 'flex', alignItems: 'center', gap: '4px',
                                                                        fontFamily: 'Share Tech Mono, monospace', letterSpacing: '1px',
                                                                        transition: 'all .2s'
                                                                    }}
                                                                        onMouseEnter={e => { e.currentTarget.style.background = `${cat.color}30`; e.currentTarget.style.boxShadow = `0 0 8px ${cat.color}44`; }}
                                                                        onMouseLeave={e => { e.currentTarget.style.background = `${cat.color}18`; e.currentTarget.style.boxShadow = 'none'; }}
                                                                    >
                                                                        {uploadingMedia ? (
                                                                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'pulse-icon 1s infinite' }}><circle cx="12" cy="12" r="10" /><polyline points="12,6 12,12 16,14" /></svg>
                                                                        ) : (
                                                                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                                                                        )} UPLOAD
                                                                        <input type="file" multiple style={{ display: 'none' }} accept={cat.accept} onChange={e => uploadMedia(cat.key, e)} disabled={uploadingMedia} />
                                                                    </label>
                                                                    {files.length > 0 && (
                                                                        <button
                                                                            onClick={() => deleteAllMedia(cat.key, cat.label)}
                                                                            style={{
                                                                                background: 'rgba(255,0,51,0.1)', color: '#ff4466',
                                                                                border: '1px solid rgba(255,0,51,0.3)',
                                                                                padding: '4px 10px', fontSize: '0.72rem', fontWeight: 700,
                                                                                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
                                                                                fontFamily: 'Share Tech Mono, monospace', letterSpacing: '1px',
                                                                                transition: 'all .2s'
                                                                            }}
                                                                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,0,51,0.2)'; e.currentTarget.style.boxShadow = '0 0 8px rgba(255,0,51,0.3)'; }}
                                                                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,0,51,0.1)'; e.currentTarget.style.boxShadow = 'none'; }}
                                                                        >
                                                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="3,6 5,6 21,6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg> DEL ALL
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            {/* Lista de arquivos */}
                                                            {files.length > 0 && (
                                                                <div style={{ maxHeight: '140px', overflowY: 'auto', padding: '6px 10px' }}>
                                                                    {files.map(file => (
                                                                        <div key={file.name} style={{
                                                                            display: 'flex', alignItems: 'center', gap: '8px',
                                                                            padding: '4px 6px',
                                                                            borderLeft: `1px solid ${cat.color}22`,
                                                                            marginBottom: '2px',
                                                                            transition: 'all .15s'
                                                                        }}
                                                                            onMouseEnter={e => { e.currentTarget.style.background = `${cat.color}10`; e.currentTarget.style.borderLeftColor = cat.color; }}
                                                                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderLeftColor = `${cat.color}22`; }}
                                                                        >
                                                                            <span style={{ fontSize: '0.95rem' }}>{getFileIcon(file.name)}</span>
                                                                            <div style={{ flex: 1, overflow: 'hidden' }}>
                                                                                <div style={{ fontSize: '0.75rem', color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'Share Tech Mono, monospace' }}>{file.name}</div>
                                                                            </div>
                                                                            <span style={{ fontSize: '0.65rem', color: '#555', flexShrink: 0, fontFamily: 'Share Tech Mono, monospace' }}>{formatFileSize(file.size)}</span>
                                                                            <button
                                                                                style={{
                                                                                    background: 'none', border: 'none', color: '#ff4466',
                                                                                    cursor: 'pointer', padding: '2px 4px',
                                                                                    flexShrink: 0, opacity: 0.5, transition: 'opacity .15s'
                                                                                }}
                                                                                onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                                                                                onMouseLeave={e => e.currentTarget.style.opacity = '0.5'}
                                                                                onClick={() => deleteMedia(cat.key, file.name)}
                                                                            >
                                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="3,6 5,6 21,6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                                                            </button>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>


                                                    );
                                                })}
                                            </div>

                                            <small style={{ display: 'block', marginTop: '12px', color: '#555', lineHeight: '1.5' }}>
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2" strokeLinecap="round" style={{ display: 'inline', marginRight: '4px' }}><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="8" /></svg>
                                                Cada envio tem bytes randomizados para evitar detecção de duplicata.<br />
                                                Configure os intervalos de envio na aba <b style={{ color: '#aaa' }}>Delays</b>.
                                            </small>
                                        </div>
                                    );
                                })()}
                                {/* Tab: Standby */}
                                {activeTab === 'standby' && (
                                    <div id="tab-standby" className="tab-content active">
                                        <div className="form-group">
                                            <label className="checkbox-label">
                                                <input
                                                    type="checkbox"
                                                    checked={configFields.standbyEnabled}
                                                    onChange={e => setCfg('standbyEnabled', e.target.checked)}
                                                />
                                                <span style={{ fontWeight: 600 }}>Ativar Modo Standby (Humanização Ociosa)</span>
                                            </label>
                                            <p style={{ color: '#aaa', fontSize: '0.85rem', marginTop: '6px' }}>
                                                Quando não houver mensagens para responder, o envio forçado do status "Online" para os seus contatos imitará um humano curioso vendo status ou conversas aleatórias de forma ociosa.
                                            </p>
                                        </div>

                                        {configFields.standbyEnabled && (
                                            <div style={{ background: 'linear-gradient(135deg, rgba(6,14,24,0.95) 0%, rgba(4,10,18,0.98) 100%)', border: '1px solid rgba(37,211,102,0.15)', borderRadius: '0', clipPath: 'polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px)', padding: '18px', marginTop: '16px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#b39ddb" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12,6 12,12 16,14" /></svg>
                                                    <strong style={{ color: '#b39ddb', letterSpacing: '2px', textTransform: 'uppercase', fontSize: '0.85rem', fontFamily: 'Orbitron, sans-serif' }}>Configuração de Ociosidade</strong>
                                                </div>

                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '16px' }}>
                                                    <div className="form-group" style={{ margin: 0 }}>
                                                        <label style={{ color: '#aaa', fontSize: '0.85rem' }}>A cada (minutos) — Intervalo entre abrir e fechar o app</label>
                                                        <div className="form-row" style={{ marginTop: '4px' }}>
                                                            <div style={{ flex: 1 }}>
                                                                <small style={{ color: '#888' }}>Mínimo</small>
                                                                <input type="number" min="1" className="form-input"
                                                                    value={configFields.standbyMinInterval}
                                                                    onChange={e => setCfg('standbyMinInterval', e.target.value)} />
                                                            </div>
                                                            <div style={{ flex: 1 }}>
                                                                <small style={{ color: '#888' }}>Máximo</small>
                                                                <input type="number" min="2" className="form-input"
                                                                    value={configFields.standbyMaxInterval}
                                                                    onChange={e => setCfg('standbyMaxInterval', e.target.value)} />
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="form-group" style={{ margin: 0 }}>
                                                        <label style={{ color: '#aaa', fontSize: '0.85rem' }}>Por (segundos) — Ficará online bisbilhotando</label>
                                                        <div className="form-row" style={{ marginTop: '4px' }}>
                                                            <div style={{ flex: 1 }}>
                                                                <small style={{ color: '#888' }}>Mínimo</small>
                                                                <input type="number" min="5" className="form-input"
                                                                    value={configFields.standbyMinDuration}
                                                                    onChange={e => setCfg('standbyMinDuration', e.target.value)} />
                                                            </div>
                                                            <div style={{ flex: 1 }}>
                                                                <small style={{ color: '#888' }}>Máximo</small>
                                                                <input type="number" min="10" className="form-input"
                                                                    value={configFields.standbyMaxDuration}
                                                                    onChange={e => setCfg('standbyMaxDuration', e.target.value)} />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {configFields.standbyEnabled && (
                                            <div style={{ background: 'linear-gradient(135deg, rgba(6,14,24,0.95) 0%, rgba(4,10,18,0.98) 100%)', border: '1px solid rgba(100,149,237,0.2)', borderRadius: '0', clipPath: 'polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px)', padding: '18px', marginTop: '16px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#b39ddb" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                                                    <strong style={{ color: '#b39ddb', letterSpacing: '2px', textTransform: 'uppercase', fontSize: '0.85rem', fontFamily: 'Orbitron, sans-serif' }}>Leitura de Status (Stories)</strong>
                                                </div>

                                                <div className="form-group">
                                                    <label className="checkbox-label">
                                                        <input type="checkbox"
                                                            checked={configFields.standbyWatchStatusEnabled}
                                                            onChange={e => setCfg('standbyWatchStatusEnabled', e.target.checked)} />
                                                        <span style={{ fontWeight: 600, color: '#e2e2e2' }}>Habilitar Visualização Aleatória de Histórias</span>
                                                    </label>
                                                </div>

                                                {configFields.standbyWatchStatusEnabled && (
                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '16px', marginTop: '16px' }}>
                                                        <div className="form-group" style={{ margin: 0 }}>
                                                            <label style={{ color: '#aaa', fontSize: '0.85rem' }}>Probabilidade de Ler os Status (%)</label>
                                                            <div className="form-row" style={{ marginTop: '4px' }}>
                                                                <div style={{ flex: 1 }}>
                                                                    <small style={{ color: '#888' }}>Chance no Ciclo</small>
                                                                    <input type="number" min="1" max="100" className="form-input"
                                                                        value={configFields.standbyWatchStatusProb}
                                                                        onChange={e => setCfg('standbyWatchStatusProb', e.target.value)} />
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="form-group" style={{ margin: 0 }}>
                                                            <label style={{ color: '#aaa', fontSize: '0.85rem' }}>Quantidade de Contatos Diferentes</label>
                                                            <div className="form-row" style={{ marginTop: '4px' }}>
                                                                <div style={{ flex: 1 }}>
                                                                    <small style={{ color: '#888' }}>Mín</small>
                                                                    <input type="number" min="1" className="form-input"
                                                                        value={configFields.standbyWatchStatusMinContacts}
                                                                        onChange={e => setCfg('standbyWatchStatusMinContacts', e.target.value)} />
                                                                </div>
                                                                <div style={{ flex: 1 }}>
                                                                    <small style={{ color: '#888' }}>Máx</small>
                                                                    <input type="number" min="1" className="form-input"
                                                                        value={configFields.standbyWatchStatusMaxContacts}
                                                                        onChange={e => setCfg('standbyWatchStatusMaxContacts', e.target.value)} />
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="form-group" style={{ margin: 0 }}>
                                                            <label style={{ color: '#aaa', fontSize: '0.85rem' }}>Tempo Vendo Cada Foto/Vídeo (Segundos)</label>
                                                            <div className="form-row" style={{ marginTop: '4px' }}>
                                                                <div style={{ flex: 1 }}>
                                                                    <small style={{ color: '#888' }}>Mín</small>
                                                                    <input type="number" min="1" className="form-input"
                                                                        value={configFields.standbyWatchStatusMinDelay}
                                                                        onChange={e => setCfg('standbyWatchStatusMinDelay', e.target.value)} />
                                                                </div>
                                                                <div style={{ flex: 1 }}>
                                                                    <small style={{ color: '#888' }}>Máx</small>
                                                                    <input type="number" min="2" className="form-input"
                                                                        value={configFields.standbyWatchStatusMaxDelay}
                                                                        onChange={e => setCfg('standbyWatchStatusMaxDelay', e.target.value)} />
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}

                            </div>
                            <div className="modal-footer">
                                <button className="btn btn-secondary" onClick={() => setShowConfigModal(false)}>Cancelar</button>
                                <button className="btn btn-primary" onClick={saveConfig}>Salvar Configurações</button>
                            </div>
                        </div>
                    </div >
                )
            }

            {/* Toast Container */}
            <div id="toastContainer" className="toast-container"></div>

            {/* Popup: Lista de Mensagens por Tipo */}
            {
                msgPopup && (
                    <div
                        style={{
                            position: 'fixed', inset: 0, zIndex: 3000,
                            background: 'rgba(0,0,0,0.88)',
                            backdropFilter: 'blur(12px)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            padding: '20px'
                        }}
                        onClick={() => setMsgPopup(null)}
                    >
                        <div
                            onClick={e => e.stopPropagation()}
                            style={{
                                background: 'linear-gradient(145deg, rgba(6,14,24,0.98) 0%, rgba(4,10,18,1) 100%)',
                                border: '1px solid rgba(37,211,102,0.25)',
                                borderTop: '2px solid #25D366',
                                clipPath: 'polygon(20px 0, 100% 0, 100% calc(100% - 20px), calc(100% - 20px) 100%, 0 100%, 0 20px)',
                                width: '100%',
                                maxWidth: '560px',
                                maxHeight: '80vh',
                                display: 'flex',
                                flexDirection: 'column',
                                boxShadow: '0 0 40px rgba(37,211,102,0.15), 0 30px 60px rgba(0,0,0,0.9)'
                            }}
                        >
                            {/* Header */}
                            <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(37,211,102,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'linear-gradient(90deg, rgba(37,211,102,0.07) 0%, transparent 60%)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <span style={{ fontWeight: 900, fontSize: '0.85rem', color: '#25D366', letterSpacing: '3px', textTransform: 'uppercase', fontFamily: 'Orbitron, sans-serif' }}>
                                        {msgPopup === 'first' ? 'PRIMEIRO CONTATO' : msgPopup === 'followup' ? 'FOLLOW-UP' : 'GRUPO'}
                                    </span>
                                    <span style={{ background: 'rgba(37,211,102,0.1)', border: '1px solid rgba(37,211,102,0.3)', padding: '2px 10px', fontSize: '0.72rem', color: '#25D366', fontFamily: 'Share Tech Mono, monospace' }}>
                                        {customMessages[msgPopup]?.length || 0} msgs
                                    </span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    {msgPopup === 'group' && (() => {
                                        const globalGroupState = !accounts.some(a => a.group_enabled === false);
                                        return (
                                            <button
                                                style={{
                                                    background: 'transparent',
                                                    border: `1px solid ${globalGroupState ? 'rgba(0, 255, 102, 0.4)' : 'rgba(255, 0, 51, 0.4)'}`,
                                                    color: globalGroupState ? '#00ff66' : '#ff3333',
                                                    padding: '4px 10px',
                                                    fontSize: '0.72rem',
                                                    fontWeight: 'bold',
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '6px',
                                                    borderRadius: '4px',
                                                    transition: 'all 0.2s',
                                                    fontFamily: 'Share Tech Mono, monospace'
                                                }}
                                                title={globalGroupState ? 'Desativar Todos os Grupos' : 'Ativar Todos os Grupos'}
                                                onClick={async () => {
                                                    const newVal = !globalGroupState;
                                                    if (accounts.length === 0) return showToast('Nenhuma conta criada', 'warn');
                                                    await Promise.all(accounts.map(acc =>
                                                        fetch(`/api/accounts/${acc.id}/config`, {
                                                            method: 'PUT',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({ group_enabled: newVal })
                                                        })
                                                    ));
                                                    loadAccounts();
                                                }}
                                            >
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                                                Grupos {globalGroupState ? 'ON' : 'OFF'}
                                            </button>
                                        );
                                    })()}
                                    <button
                                        onClick={() => setMsgPopup(null)}
                                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#888', fontSize: '1rem', cursor: 'pointer', lineHeight: 1, width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', clipPath: 'polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px)', transition: 'all .2s' }}
                                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,0,51,0.15)'; e.currentTarget.style.color = '#ff0033'; }}
                                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#888'; }}
                                    >✕</button>
                                </div>
                            </div>

                            {/* Body com scroll */}
                            <div style={{ overflowY: 'auto', padding: '12px 16px', flex: 1 }}>
                                {customMessages[msgPopup]?.length === 0 ? (
                                    <div style={{ color: '#444', fontSize: '0.85rem', padding: '30px', textAlign: 'center', fontFamily: 'Share Tech Mono, monospace' }}>
                                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(37,211,102,0.3)" strokeWidth="1.5" strokeLinecap="round" style={{ display: 'block', margin: '0 auto 12px' }}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                                        NENHUMA MENSAGEM CADASTRADA<br />
                                        <span style={{ color: '#555', fontSize: '0.75rem' }}>Adicione mensagens acima ou clique em Recriar com padrão</span>
                                    </div>
                                ) : (
                                    customMessages[msgPopup].map((msg, idx) => (
                                        <div key={msg.id} style={{
                                            display: 'flex', alignItems: 'flex-start', gap: '8px',
                                            background: idx % 2 === 0 ? 'rgba(37,211,102,0.03)' : 'rgba(4,10,18,0.6)',
                                            border: '1px solid rgba(37,211,102,0.08)',
                                            borderLeft: '2px solid rgba(37,211,102,0.3)',
                                            padding: '10px 12px',
                                            marginBottom: '6px',
                                            transition: 'border-color .2s'
                                        }}
                                            onMouseEnter={e => e.currentTarget.style.borderLeftColor = '#25D366'}
                                            onMouseLeave={e => e.currentTarget.style.borderLeftColor = 'rgba(37,211,102,0.3)'}
                                        >
                                            <span style={{ color: 'rgba(37,211,102,0.4)', fontSize: '0.68rem', minWidth: '22px', paddingTop: '3px', fontFamily: 'Share Tech Mono, monospace' }}>
                                                {String(idx + 1).padStart(2, '0')}.
                                            </span>
                                            <div style={{ flex: 1, color: '#ccc', fontSize: '0.83rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'Share Tech Mono, monospace', lineHeight: 1.6 }}>
                                                {msg.message_text}
                                            </div>
                                            <button
                                                style={{ background: 'rgba(255,0,51,0.1)', border: '1px solid rgba(255,0,51,0.25)', color: '#ff4466', cursor: 'pointer', padding: '4px 8px', display: 'flex', alignItems: 'center', flexShrink: 0, transition: 'all .2s' }}
                                                onClick={() => deleteMessage(msg.id)}
                                                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,0,51,0.2)'; e.currentTarget.style.boxShadow = '0 0 8px rgba(255,0,51,0.3)'; }}
                                                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,0,51,0.1)'; e.currentTarget.style.boxShadow = 'none'; }}
                                            >
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="3,6 5,6 21,6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>

                            {/* Footer */}
                            <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(37,211,102,0.1)', display: 'flex', justifyContent: 'flex-end', background: 'linear-gradient(270deg, rgba(37,211,102,0.04) 0%, transparent 60%)' }}>
                                <button className="btn btn-secondary btn-sm" onClick={() => setMsgPopup(null)}>FECHAR</button>
                            </div>
                        </div>
                    </div>
                )
            }

            {
                delayPopup && (() => {
                    const typeMap = {
                        first: { svgD: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', label: 'PRIMEIRO CONTATO', color: '#b39ddb', readMin: 'minReadDelay', readMax: 'maxReadDelay', typMin: 'minTypingDelay', typMax: 'maxTypingDelay', respMin: null, respMax: null, intMin: 'minMessageInterval', intMax: 'maxMessageInterval', audioEn: null, recMin: null, recMax: null, mediaEn: null, mediaInt: null, listenMin: 'minAudioListenDelay', listenMax: 'maxAudioListenDelay', globalDelay: 'globalPrivateDelayMinutes' },
                        followup: { svgD: 'M23 4v6h-6M20.49 15a9 9 0 1 1-2.12-9.36L23 10', label: 'FOLLOW-UP', color: '#80cbc4', readMin: 'minFollowupReadDelay', readMax: 'maxFollowupReadDelay', typMin: 'minFollowupTypingDelay', typMax: 'maxFollowupTypingDelay', respMin: 'minFollowupResponseDelay', respMax: 'maxFollowupResponseDelay', intMin: 'minFollowupInterval', intMax: 'maxFollowupInterval', audioEn: 'followupAudioEnabled', recMin: 'followupMinRecDelay', recMax: 'followupMaxRecDelay', mediaEn: 'followupMediaEnabled', mediaInt: 'followupMediaInterval', listenMin: 'followupMinAudioListenDelay', listenMax: 'followupMaxAudioListenDelay', docsEn: 'followupDocsEnabled', docsInt: 'followupDocsInterval', globalDelay: 'globalPrivateDelayMinutes' },
                        group: { svgD: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75', label: 'GRUPO', color: '#a5d6a7', readMin: 'minGroupReadDelay', readMax: 'maxGroupReadDelay', typMin: 'minGroupTypingDelay', typMax: 'maxGroupTypingDelay', respMin: 'minGroupResponseDelay', respMax: 'maxGroupResponseDelay', intMin: 'minGroupInterval', intMax: 'maxGroupInterval', audioEn: 'groupAudioEnabled', recMin: 'groupMinRecDelay', recMax: 'groupMaxRecDelay', mediaEn: 'groupMediaEnabled', mediaInt: 'groupMediaInterval', listenMin: 'groupMinAudioListenDelay', listenMax: 'groupMaxAudioListenDelay', docsEn: 'groupDocsEnabled', docsInt: 'groupDocsInterval', globalDelay: 'globalGroupDelayMinutes' }
                    };
                    const t = typeMap[delayPopup];

                    const fieldLabel = (svgPath, text) => (
                        <label style={{ color: t.color, fontWeight: 700, fontSize: '0.72rem', letterSpacing: '1.5px', textTransform: 'uppercase', fontFamily: 'Share Tech Mono, monospace', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d={svgPath} /></svg>
                            {text}
                        </label>
                    );

                    const sectionSep = (svgPath, label, enableKey, children) => (
                        <div style={{ borderTop: `1px solid ${t.color}22`, paddingTop: '14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                                <label style={{ color: t.color, fontWeight: 700, fontSize: '0.72rem', margin: 0, letterSpacing: '1.5px', textTransform: 'uppercase', fontFamily: 'Share Tech Mono, monospace', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d={svgPath} /></svg>
                                    {label}
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={configFields[enableKey]} onChange={e => setCfg(enableKey, e.target.checked)} style={{ accentColor: t.color }} />
                                    <span style={{ color: configFields[enableKey] ? t.color : '#444', fontSize: '0.7rem', fontFamily: 'Share Tech Mono, monospace', letterSpacing: '1px' }}>{configFields[enableKey] ? 'ON' : 'OFF'}</span>
                                </label>
                            </div>
                            {configFields[enableKey] && children}
                        </div>
                    );

                    const minMaxRow = (minKey, maxKey, minVal, maxVal) => (
                        <div className="form-row" style={{ marginTop: '4px' }}>
                            <div style={{ flex: 1 }}><small style={{ color: '#444' }}>Mínimo</small><input type="number" min="1" className="form-input" value={minVal} onChange={e => setCfg(minKey, e.target.value)} /></div>
                            <div style={{ flex: 1 }}><small style={{ color: '#444' }}>Máximo</small><input type="number" min="1" className="form-input" value={maxVal} onChange={e => setCfg(maxKey, e.target.value)} /></div>
                        </div>
                    );

                    return (
                        <div
                            style={{
                                position: 'fixed', inset: 0, zIndex: 3000,
                                background: 'rgba(0,0,0,0.88)',
                                backdropFilter: 'blur(12px)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                padding: '20px'
                            }}
                            onClick={() => setDelayPopup(null)}
                        >
                            <div
                                onClick={e => e.stopPropagation()}
                                style={{
                                    background: 'linear-gradient(145deg, rgba(6,14,24,0.98) 0%, rgba(4,10,18,1) 100%)',
                                    border: `1px solid ${t.color}44`,
                                    borderTop: `2px solid ${t.color}`,
                                    clipPath: 'polygon(20px 0, 100% 0, 100% calc(100% - 20px), calc(100% - 20px) 100%, 0 100%, 0 20px)',
                                    width: '100%',
                                    maxWidth: '500px',
                                    maxHeight: '84vh',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    boxShadow: `0 0 40px ${t.color}22, 0 30px 60px rgba(0,0,0,0.9)`
                                }}
                            >
                                {/* Header */}
                                <div style={{ padding: '14px 20px', borderBottom: `1px solid ${t.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: `linear-gradient(90deg, ${t.color}0d 0%, transparent 60%)` }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={t.color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={t.svgD} /></svg>
                                        <span style={{ fontWeight: 900, fontSize: '0.82rem', color: t.color, letterSpacing: '3px', textTransform: 'uppercase', fontFamily: 'Orbitron, sans-serif' }}>
                                            {t.label} — DELAYS
                                        </span>
                                    </div>
                                    <button
                                        onClick={() => setDelayPopup(null)}
                                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#888', fontSize: '1rem', cursor: 'pointer', lineHeight: 1, width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', clipPath: 'polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px)', transition: 'all .2s' }}
                                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,0,51,0.15)'; e.currentTarget.style.color = '#ff0033'; }}
                                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#888'; }}
                                    >✕</button>
                                </div>

                                {/* Body */}
                                <div style={{ overflowY: 'auto', padding: '16px 20px', flex: 1, display: 'flex', flexDirection: 'column', gap: '14px' }}>

                                    <div className="form-group" style={{ margin: 0 }}>
                                        {fieldLabel('M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'Delay de Leitura (s)')}
                                        {minMaxRow(t.readMin, t.readMax, configFields[t.readMin], configFields[t.readMax])}
                                        <small style={{ color: '#444' }}>Tempo para marcar como lido (ticks azuis)</small>
                                    </div>

                                    <div className="form-group" style={{ margin: 0 }}>
                                        {fieldLabel('M2 4h20v4H2zM6 8v12M10 8v12M14 8v12M18 8v12', 'Delay de Digitação (s)')}
                                        {minMaxRow(t.typMin, t.typMax, configFields[t.typMin], configFields[t.typMax])}
                                        <small style={{ color: '#444' }}>Tempo mostrando "digitando..." antes de enviar</small>
                                    </div>

                                    {t.respMin && (
                                        <div className="form-group" style={{ margin: 0 }}>
                                            {fieldLabel('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', 'Delay de Resposta (s)')}
                                            {minMaxRow(t.respMin, t.respMax, configFields[t.respMin], configFields[t.respMax])}
                                            <small style={{ color: '#444' }}>Pausa extra entre terminar de digitar e enviar</small>
                                        </div>
                                    )}

                                    <div className="form-group" style={{ margin: 0 }}>
                                        {fieldLabel('M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2', 'Intervalo entre Mensagens (s)')}
                                        {minMaxRow(t.intMin, t.intMax, configFields[t.intMin], configFields[t.intMax])}
                                        <small style={{ color: '#444' }}>Tempo mínimo antes de responder o mesmo contato</small>
                                    </div>

                                    {t.globalDelay && (
                                        <div className="form-group" style={{ margin: 0 }}>
                                            {fieldLabel('M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01', `Pausa Geral ${delayPopup === 'group' ? 'Grupos' : 'Privado'} (min)`)}
                                            <div style={{ marginTop: '4px' }}>
                                                <small style={{ color: '#444' }}>Pausa</small>
                                                <input type="number" min="0" className="form-input" style={{ maxWidth: '100px' }} value={configFields[t.globalDelay]} onChange={e => setCfg(t.globalDelay, e.target.value)} />
                                            </div>
                                            <small style={{ color: '#444' }}>{delayPopup === 'group' ? 'Após responder um grupo, ignora todos os outros por esse tempo (0 = off).' : 'Após responder qualquer contato privado, pausa geral por esse tempo (0 = off).'}</small>
                                        </div>
                                    )}

                                    <div className="form-group" style={{ margin: 0 }}>
                                        {fieldLabel('M3 18v-6a9 9 0 0 1 18 0v6M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z', 'Escuta de Áudio Recebido (s)')}
                                        <div className="form-row" style={{ marginTop: '4px' }}>
                                            <div style={{ flex: 1 }}><small style={{ color: '#444' }}>Mínimo</small><input type="number" min="1" step="0.5" className="form-input" value={configFields[t.listenMin]} onChange={e => setCfg(t.listenMin, parseFloat(e.target.value) || 5)} /></div>
                                            <div style={{ flex: 1 }}><small style={{ color: '#444' }}>Máximo</small><input type="number" min="1" step="0.5" className="form-input" value={configFields[t.listenMax]} onChange={e => setCfg(t.listenMax, parseFloat(e.target.value) || 30)} /></div>
                                        </div>
                                        <small style={{ color: '#444' }}>Simula escuta de áudio antes de responder</small>
                                    </div>

                                    {t.audioEn && sectionSep(
                                        'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4',
                                        'Enviar Áudio (Voz)', t.audioEn,
                                        <div className="form-group" style={{ margin: 0 }}>
                                            <label style={{ color: '#555', fontSize: '0.7rem', letterSpacing: '1px', textTransform: 'uppercase', fontFamily: 'Share Tech Mono, monospace' }}>Delay de Gravação (s)</label>
                                            {minMaxRow(t.recMin, t.recMax, configFields[t.recMin], configFields[t.recMax])}
                                            <small style={{ color: '#444' }}>Simula "gravando áudio" antes de enviar</small>
                                        </div>
                                    )}

                                    {t.mediaEn && sectionSep(
                                        'M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14M3 15l5-5 4 4 4-4 5 5',
                                        'Mídia Aleatória', t.mediaEn,
                                        <div className="form-group" style={{ margin: 0 }}>
                                            <label style={{ color: '#555', fontSize: '0.7rem', letterSpacing: '1px', textTransform: 'uppercase', fontFamily: 'Share Tech Mono, monospace' }}>A cada X textos, enviar 1 mídia</label>
                                            <input type="number" min="1" className="form-input" style={{ maxWidth: '100px', marginTop: '4px' }} value={configFields[t.mediaInt]} onChange={e => setCfg(t.mediaInt, e.target.value)} />
                                            <small style={{ color: '#444', display: 'block', marginTop: '6px' }}>Envia aleatoriamente: imagem, figurinha, áudio ou vídeo da biblioteca de mídia.</small>
                                        </div>
                                    )}

                                    {t.docsEn && sectionSep(
                                        'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
                                        'Docs / vCard', t.docsEn,
                                        <div className="form-group" style={{ margin: 0 }}>
                                            <label style={{ color: '#555', fontSize: '0.7rem', letterSpacing: '1px', textTransform: 'uppercase', fontFamily: 'Share Tech Mono, monospace' }}>A cada X textos, enviar 1 doc ou vCard</label>
                                            <input type="number" min="1" className="form-input" style={{ maxWidth: '100px', marginTop: '4px' }} value={configFields[t.docsInt]} onChange={e => setCfg(t.docsInt, e.target.value)} />
                                            <small style={{ color: '#444', display: 'block', marginTop: '6px' }}>Envia da biblioteca: PDF, DOC/DOCX ou vCard (.vcf).</small>
                                        </div>
                                    )}

                                </div>

                                {/* Footer */}
                                <div style={{ padding: '10px 16px', borderTop: `1px solid ${t.color}18`, display: 'flex', justifyContent: 'flex-end', background: `linear-gradient(270deg, ${t.color}08 0%, transparent 60%)` }}>
                                    <button className="btn btn-secondary btn-sm" onClick={() => setDelayPopup(null)}>FECHAR</button>
                                </div>
                            </div>
                        </div>
                    );
                })()
            }

            {/* Modal de Webhooks */}
            {
                showWebhookModal && (
                    <div className="modal show">
                        <div className="modal-content modal-large">
                            <div className="modal-header">
                                <h2>🔗 Gerenciar Webhooks</h2>
                                <button className="modal-close" onClick={() => setShowWebhookModal(false)}>×</button>
                            </div>
                            <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                                <div style={{ background: 'rgba(0, 0, 0, 0.4)', padding: '16px', borderRadius: '12px', marginBottom: '16px', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
                                    <h4 style={{ margin: '0 0 10px 0', color: 'var(--accent-primary)' }}>Novo Webhook (Para Modo Avião)</h4>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 2fr auto auto', gap: '10px', alignItems: 'end' }}>
                                        <div className="form-group" style={{ margin: 0 }}>
                                            <label style={{ fontSize: '0.8rem' }}>Nome (Ex: Proxy Farm 1)</label>
                                            <input type="text" className="form-input" placeholder="Referência"
                                                value={newWebhook.name} onChange={e => setNewWebhook({ ...newWebhook, name: e.target.value })} />
                                        </div>
                                        <div className="form-group" style={{ margin: 0 }}>
                                            <label style={{ fontSize: '0.8rem' }}>URL</label>
                                            <input type="text" className="form-input" placeholder="http://192.168.1.5:8080/toggle"
                                                value={newWebhook.url} onChange={e => setNewWebhook({ ...newWebhook, url: e.target.value })} />
                                        </div>
                                        <div className="form-group" style={{ margin: 0 }}>
                                            <label style={{ fontSize: '0.8rem' }}>Método</label>
                                            <select className="form-input" value={newWebhook.method} onChange={e => setNewWebhook({ ...newWebhook, method: e.target.value })}>
                                                <option value="GET">GET</option>
                                                <option value="POST">POST</option>
                                            </select>
                                        </div>
                                        <button className="btn btn-primary" onClick={addWebhook}>Adicionar</button>
                                    </div>
                                </div>

                                {webhooks.length === 0 ? (
                                    <div style={{ textAlign: 'center', padding: '20px', color: '#aaa' }}>Nenhum Webhook cadastrado</div>
                                ) : (
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                                        <thead>
                                            <tr style={{ borderBottom: '1px solid #333' }}>
                                                <th style={{ textAlign: 'left', padding: '8px' }}>ID</th>
                                                <th style={{ textAlign: 'left', padding: '8px' }}>Nome</th>
                                                <th style={{ textAlign: 'left', padding: '8px' }}>URL / Método</th>
                                                <th style={{ textAlign: 'right', padding: '8px' }}>Ações</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {webhooks.map(wh => (
                                                <tr key={wh.id} style={{ borderBottom: '1px solid #222' }}>
                                                    <td style={{ padding: '8px', color: '#888' }}>#{wh.id}</td>
                                                    <td style={{ padding: '8px', fontWeight: 'bold' }}>{wh.name}</td>
                                                    <td style={{ padding: '8px' }}>
                                                        <span style={{ background: '#222', padding: '2px 6px', borderRadius: '4px', fontSize: '0.75rem', marginRight: '6px' }}>{wh.method}</span>
                                                        <span style={{ color: '#aaa', wordBreak: 'break-all' }}>{wh.url}</span>
                                                    </td>
                                                    <td style={{ padding: '8px', textAlign: 'right' }}>
                                                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center' }}>
                                                            <button className="btn btn-sm btn-success" onClick={async () => {
                                                                if (!window.confirm(`Tem certeza que deseja executar o webhook "${wh.name}" agora?`)) return;
                                                                try {
                                                                    const res = await fetch(`/api/webhooks/${wh.id}/execute`, { method: 'POST' });
                                                                    const result = await res.json();
                                                                    if (res.ok && result.success) {
                                                                        showToast('Webhook executado com sucesso!', 'success');
                                                                    } else {
                                                                        showToast(`Erro ao executar: ${result.error || 'Falha desconhecida'}`, 'error');
                                                                        console.error('Webhook execution failed:', result);
                                                                    }
                                                                } catch (e) {
                                                                    showToast('Erro de conexão ao executar webhook', 'error');
                                                                    console.error('Webhook connection error:', e);
                                                                }
                                                            }}>Executar</button>
                                                            <button className="btn btn-sm btn-danger" onClick={() => deleteWebhookHandler(wh.id)}>Excluir</button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Modal de Agendamento Global */}
            {
                showScheduleModal && (
                    <div className="modal show">
                        <div className="modal-content modal-large">
                            <div className="modal-header">
                                <h2>⏰ Agendamento e Rotação de Proxy</h2>
                                <button className="modal-close" onClick={() => setShowScheduleModal(false)}>×</button>
                            </div>
                            <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                                <p style={{ color: '#aaa', fontSize: '0.9rem', marginBottom: '16px' }}>
                                    Selecione qual Proxy esta conta compartilha. Contas com o mesmo Proxy entram em Pausa automaticamente para ceder a vez.
                                </p>

                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid #333' }}>
                                            <th style={{ textAlign: 'left', padding: '8px' }}>Conta</th>
                                            <th style={{ textAlign: 'left', padding: '8px' }}>Grupo Proxy</th>
                                            <th style={{ textAlign: 'left', padding: '8px' }}>Webhook/Modo Avião</th>
                                            <th style={{ textAlign: 'left', padding: '8px' }}>Horário (Início - Fim)</th>
                                            <th style={{ textAlign: 'center', padding: '8px' }}>Ativo</th>
                                            <th style={{ textAlign: 'right', padding: '8px' }}>Ação</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {accounts.map(acc => (
                                            <tr key={acc.id} style={{ borderBottom: '1px solid #222' }}>
                                                <td style={{ padding: '8px', fontWeight: 'bold' }}>{acc.name}</td>
                                                <td style={{ padding: '8px' }}>
                                                    <select id={`sgProxy_${acc.id}`} defaultValue={acc.proxy_group_id || ''} className="form-input" style={{ width: '140px', padding: '6px', fontSize: '0.8rem' }}>
                                                        <option value="">-- Nenhum --</option>
                                                        {/* Lista os IPs de proxy e os Grupos já salvos para serem selecionados sem digitar (filtra inválidos como '01') */}
                                                        {[...new Set([
                                                            ...accounts.map(a => a.proxy_ip ? (a.proxy_port ? `${a.proxy_ip}:${a.proxy_port}` : a.proxy_ip) : null).filter(Boolean),
                                                            ...accounts.map(a => a.proxy_group_id).filter(id => id && /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(id))
                                                        ])].map(ip => (
                                                            <option key={ip} value={ip}>{ip}</option>
                                                        ))}
                                                    </select>
                                                </td>
                                                <td style={{ padding: '8px' }}>
                                                    <select id={`sgHook_${acc.id}`} defaultValue={acc.webhook_id || ''} className="form-input" style={{ width: '160px', padding: '6px', fontSize: '0.8rem' }}>
                                                        <option value="">-- Nenhum --</option>
                                                        {webhooks.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                                    </select>
                                                </td>
                                                <td style={{ padding: '8px' }}>
                                                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                                        <input type="time" id={`sgStart_${acc.id}`} defaultValue={acc.scheduled_start_time || ''} className="form-input" style={{ padding: '4px' }} />
                                                        <span style={{ color: '#666' }}>até</span>
                                                        <input type="time" id={`sgEnd_${acc.id}`} defaultValue={acc.scheduled_end_time || ''} className="form-input" style={{ padding: '4px' }} />
                                                    </div>
                                                </td>
                                                <td style={{ padding: '8px', textAlign: 'center' }}>
                                                    <button
                                                        id={`sgEnabled_${acc.id}`}
                                                        data-enabled={acc.schedule_enabled ? '1' : '0'}
                                                        onClick={(e) => {
                                                            const btn = e.currentTarget;
                                                            const cur = btn.getAttribute('data-enabled') === '1';
                                                            btn.setAttribute('data-enabled', cur ? '0' : '1');
                                                            btn.textContent = cur ? 'OFF' : 'ON';
                                                            btn.style.background = cur ? 'rgba(255,0,51,0.15)' : 'rgba(37,211,102,0.2)';
                                                            btn.style.color = cur ? '#ff4466' : '#25D366';
                                                            btn.style.borderColor = cur ? 'rgba(255,0,51,0.4)' : 'rgba(37,211,102,0.5)';
                                                        }}
                                                        style={{
                                                            padding: '4px 14px', fontSize: '0.75rem', fontWeight: 'bold',
                                                            border: `1px solid ${acc.schedule_enabled ? 'rgba(37,211,102,0.5)' : 'rgba(255,0,51,0.4)'}`,
                                                            background: acc.schedule_enabled ? 'rgba(37,211,102,0.2)' : 'rgba(255,0,51,0.15)',
                                                            color: acc.schedule_enabled ? '#25D366' : '#ff4466',
                                                            borderRadius: '6px', cursor: 'pointer',
                                                            fontFamily: 'Orbitron, Share Tech Mono, monospace',
                                                            letterSpacing: '1px', transition: 'all 0.2s'
                                                        }}
                                                    >{acc.schedule_enabled ? 'ON' : 'OFF'}</button>
                                                </td>
                                                <td style={{ padding: '8px', textAlign: 'right' }}>
                                                    <button className="btn btn-sm btn-primary" onClick={async () => {
                                                        const pGroup = document.getElementById(`sgProxy_${acc.id}`).value;
                                                        const wh = document.getElementById(`sgHook_${acc.id}`).value;
                                                        const sStart = document.getElementById(`sgStart_${acc.id}`).value;
                                                        const sEnd = document.getElementById(`sgEnd_${acc.id}`).value;
                                                        const enabled = document.getElementById(`sgEnabled_${acc.id}`).getAttribute('data-enabled') === '1' ? 1 : 0;

                                                        try {
                                                            const response = await fetch(`/api/accounts/${acc.id}/config`, {
                                                                method: 'PUT',
                                                                headers: { 'Content-Type': 'application/json' },
                                                                body: JSON.stringify({
                                                                    proxy_group_id: pGroup || null,
                                                                    webhook_id: parseInt(wh) || null,
                                                                    scheduled_start_time: sStart || null,
                                                                    scheduled_end_time: sEnd || null,
                                                                    schedule_enabled: enabled
                                                                })
                                                            });
                                                            if (response.ok) {
                                                                showToast('Agendamento salvo para ' + acc.name, 'success');
                                                                loadAccounts();
                                                            } else {
                                                                showToast('Erro ao salvar', 'error');
                                                            }
                                                        } catch (e) {
                                                            showToast('Erro de conexão ao salvar', 'error');
                                                        }
                                                    }}>Salvar</button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Popup: Log Multi-Terminais em Tempo Real */}
            {
                activeLogPanels.length > 0 && (() => {
                    const levelColor = { error: '#ff5252', warn: '#ffb300', info: '#40c4ff', debug: '#888', success: '#69f0ae' };
                    return (
                        <div
                            style={{ position: 'fixed', inset: 0, zIndex: 4000, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
                            onClick={() => setActiveLogPanels([])}
                        >
                            <div
                                onClick={e => e.stopPropagation()}
                                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '14px', width: '98vw', maxWidth: '1600px', height: '85vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-neon-green)' }}
                            >
                                {/* Header Multi-Terminal */}
                                <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <span style={{ fontSize: '1.2rem' }}>📋</span>
                                        <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '1rem' }}>Terminais Ao Vivo</span>
                                        <span style={{ background: 'rgba(37, 211, 102, 0.2)', color: 'var(--accent-primary)', borderRadius: '6px', fontSize: '0.65rem', padding: '3px 8px', fontWeight: 'bold', border: '1px solid rgba(37, 211, 102, 0.5)' }}>
                                            {activeLogPanels.length} MONITORES
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                        <select
                                            onChange={e => {
                                                if (e.target.value) {
                                                    const acct = accounts.find(a => String(a.id) === String(e.target.value));
                                                    if (acct && !activeLogPanels.find(p => String(p.id) === String(acct.id))) {
                                                        setActiveLogPanels([...activeLogPanels, { id: acct.id, name: acct.name }]);
                                                    }
                                                    e.target.value = '';
                                                }
                                            }}
                                            style={{ background: '#1a1a2e', color: '#fff', border: '1px solid #444', borderRadius: '6px', padding: '6px 10px', fontSize: '0.8rem', cursor: 'pointer', outline: 'none' }}
                                        >
                                            <option value="">➕ Comparar com conta...</option>
                                            {accounts.filter(a => !activeLogPanels.find(p => String(p.id) === String(a.id))).map(a => (
                                                <option key={a.id} value={a.id}>{a.name}</option>
                                            ))}
                                        </select>
                                        <button onClick={() => setActiveLogPanels([])} style={{ background: 'none', border: 'none', color: '#888', fontSize: '1.4rem', cursor: 'pointer', lineHeight: 1 }}>✕</button>
                                    </div>
                                </div>

                                {/* Terminals Container */}
                                <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                                    {activeLogPanels.map((panel, idx) => {
                                        const logs = accountLogs[panel.id] || accountLogs[panel.name] || [];
                                        return (
                                            <div key={panel.id} style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: idx < activeLogPanels.length - 1 ? '1px solid var(--border-color)' : 'none', minWidth: '300px' }}>
                                                {/* Panel Header */}
                                                <div style={{ padding: '8px 16px', background: 'rgba(0,0,0,0.3)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <span style={{ fontWeight: 700, color: 'var(--accent-primary)', fontSize: '0.90rem' }}>{panel.name}</span>
                                                        <span style={{ background: 'var(--accent-primary)', color: '#000', borderRadius: '10px', fontSize: '0.65rem', padding: '2px 6px', fontWeight: 700, boxShadow: '0 0 5px var(--accent-primary)' }}>{logs.length} linhas</span>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                                        <button onClick={() => setAccountLogs(prev => {
                                                            const newState = { ...prev, [panel.id]: [], [panel.name]: [] };
                                                            localStorage.setItem('wpp_sistem_logs', JSON.stringify(newState));
                                                            return newState;
                                                        })} style={{ background: 'transparent', border: '1px solid #444', color: '#888', borderRadius: '4px', cursor: 'pointer', fontSize: '0.65rem', padding: '2px 6px' }}>Limpar</button>
                                                        <button onClick={() => setActiveLogPanels(activeLogPanels.filter(p => p.id !== panel.id))} style={{ background: 'transparent', border: 'none', color: '#ff5252', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1, padding: '0 4px' }}>✕</button>
                                                    </div>
                                                </div>

                                                {/* Scroll Area */}
                                                <div
                                                    style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', fontFamily: "'Courier New', monospace", fontSize: '0.78rem', lineHeight: '1.6' }}
                                                    ref={el => { if (el) el.scrollTop = el.scrollHeight; }}
                                                >
                                                    {logs.length === 0 ? (
                                                        <div style={{ color: '#555', textAlign: 'center', marginTop: '40px' }}>
                                                            <div style={{ fontSize: '1.5rem', marginBottom: '8px' }}>🔇</div>
                                                            <div>Aguardando logs de <strong style={{ color: '#888' }}>{panel.name}</strong>...</div>
                                                        </div>
                                                    ) : logs.map((entry, i) => (
                                                        <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '4px', alignItems: 'flex-start' }}>
                                                            <span style={{ color: '#444', flexShrink: 0, fontSize: '0.7rem', paddingTop: '2px' }}>{entry.ts.substring(11)}</span>
                                                            <span style={{ color: levelColor[entry.level] || '#aaa', flexShrink: 0, fontSize: '0.7rem', paddingTop: '2px', minWidth: '36px' }}>[{entry.level.toUpperCase().substring(0, 4)}]</span>
                                                            <span style={{ color: '#ccc', wordBreak: 'break-word' }}>{entry.message}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Footer do Container */}
                                <div style={{ padding: '10px 16px', borderTop: '1px solid #222', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                                    {[['info', '#40c4ff'], ['warn', '#ffb300'], ['error', '#ff5252'], ['debug', '#666']].map(([lvl, clr]) => (
                                        <span key={lvl} style={{ fontSize: '0.7rem', color: clr }}>● {lvl}</span>
                                    ))}
                                    <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: '#444' }}>Exibindo {activeLogPanels.length} terminais integrados na mesma tela. Lado a Lado.</span>
                                </div>
                            </div>
                        </div>
                    );
                })()
            }

            {/* ================== LOGIN MODAL ================== */}
            {showLoginModal && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.92)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 9999,
                    backdropFilter: 'blur(10px)'
                }}>
                    <div style={{
                        background: 'linear-gradient(135deg, #0d1117 0%, #111820 100%)',
                        border: '1px solid rgba(37,211,102,0.25)',
                        borderRadius: '18px',
                        padding: '40px 36px',
                        width: '100%', maxWidth: '380px',
                        boxShadow: '0 0 60px rgba(37,211,102,0.15), 0 20px 60px rgba(0,0,0,0.6)',
                        display: 'flex', flexDirection: 'column', gap: '20px',
                        animation: 'fadeIn 0.3s ease'
                    }}>
                        {/* Logo */}
                        <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                            <img src={logoSvg} alt="WPP SISTEM" style={{ height: '70px', marginBottom: '8px', filter: 'drop-shadow(0 0 8px rgba(37,211,102,0.6))' }} />
                            <div style={{
                                fontFamily: 'Orbitron, sans-serif', fontSize: '1.2rem', fontWeight: '800',
                                background: 'linear-gradient(90deg, #25D366, #00ff88)',
                                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                                letterSpacing: '2px', textTransform: 'uppercase'
                            }}>AQUECIMENTO PRO</div>
                            <div style={{ color: '#555', fontSize: '0.8rem', marginTop: '4px' }}>Acesso ao Painel Restrito</div>
                        </div>

                        {loginError && (
                            <div style={{
                                background: 'rgba(255,50,50,0.1)', border: '1px solid rgba(255,50,50,0.3)',
                                borderRadius: '8px', padding: '10px 14px',
                                color: '#ff6464', fontSize: '0.85rem', textAlign: 'center'
                            }}>{loginError}</div>
                        )}

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div>
                                <label style={{ color: '#666', fontSize: '0.75rem', display: 'block', marginBottom: '6px' }}>E-MAIL</label>
                                <input
                                    id="loginEmailInput"
                                    type="email"
                                    value={loginEmail}
                                    onChange={e => setLoginEmail(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleLogin()}
                                    placeholder="Seu e-mail"
                                    style={{
                                        width: '100%', padding: '12px 14px',
                                        background: 'rgba(255,255,255,0.04)',
                                        border: '1px solid rgba(37,211,102,0.2)',
                                        borderRadius: '10px', color: '#eee',
                                        fontSize: '0.9rem', outline: 'none',
                                        transition: 'border-color 0.2s',
                                        boxSizing: 'border-box'
                                    }}
                                    onFocus={e => e.target.style.borderColor = 'rgba(37,211,102,0.6)'}
                                    onBlur={e => e.target.style.borderColor = 'rgba(37,211,102,0.2)'}
                                />
                            </div>
                            <div>
                                <label style={{ color: '#666', fontSize: '0.75rem', display: 'block', marginBottom: '6px' }}>SENHA</label>
                                <input
                                    type="password"
                                    value={loginPassword}
                                    onChange={e => setLoginPassword(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleLogin()}
                                    placeholder="Sua senha"
                                    style={{
                                        width: '100%', padding: '12px 14px',
                                        background: 'rgba(255,255,255,0.04)',
                                        border: '1px solid rgba(37,211,102,0.2)',
                                        borderRadius: '10px', color: '#eee',
                                        fontSize: '0.9rem', outline: 'none',
                                        transition: 'border-color 0.2s',
                                        boxSizing: 'border-box'
                                    }}
                                    onFocus={e => e.target.style.borderColor = 'rgba(37,211,102,0.6)'}
                                    onBlur={e => e.target.style.borderColor = 'rgba(37,211,102,0.2)'}
                                />
                            </div>
                        </div>

                        <button
                            id="loginSubmitBtn"
                            onClick={handleLogin}
                            disabled={loginLoading}
                            style={{
                                padding: '13px', borderRadius: '10px', border: 'none',
                                background: loginLoading ? '#1a3b28' : 'linear-gradient(135deg, #25D366, #1db954)',
                                color: '#fff', fontWeight: '700', fontSize: '0.95rem',
                                cursor: loginLoading ? 'not-allowed' : 'pointer',
                                letterSpacing: '1px', transition: 'opacity 0.2s',
                                boxShadow: '0 4px 20px rgba(37,211,102,0.3)'
                            }}
                        >{loginLoading ? 'Entrando...' : '→ ENTRAR'}</button>
                    </div>
                </div>
            )}

            {/* ================== USER MANAGEMENT MODAL ================== */}
            {showUserModal && authUser && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.75)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 9998,
                    backdropFilter: 'blur(6px)'
                }} onClick={e => { if (e.target === e.currentTarget) setShowUserModal(false); }}>
                    <div style={{
                        background: 'linear-gradient(135deg, #0d1117 0%, #111820 100%)',
                        border: '1px solid rgba(37,211,102,0.2)',
                        borderRadius: '18px',
                        width: '100%', maxWidth: '520px',
                        maxHeight: '90vh',
                        display: 'flex', flexDirection: 'column',
                        boxShadow: '0 0 60px rgba(37,211,102,0.1), 0 20px 60px rgba(0,0,0,0.7)',
                        overflow: 'hidden'
                    }}>
                        {/* Header */}
                        <div style={{
                            padding: '20px 24px', borderBottom: '1px solid rgba(37,211,102,0.1)',
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                        }}>
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#25D366" strokeWidth="2">
                                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                        <circle cx="12" cy="7" r="4" />
                                    </svg>
                                    <span style={{ fontFamily: 'Orbitron, sans-serif', fontSize: '0.9rem', fontWeight: '700', color: '#25D366', letterSpacing: '1px' }}>
                                        {authUser.role === 'admin' ? 'GERENCIAR USUÁRIOS' : 'PERFIL'}
                                    </span>
                                </div>
                                <div style={{ color: '#555', fontSize: '0.75rem', marginTop: '4px' }}>
                                    Logado como: <span style={{ color: '#25D366' }}>{authUser.email}</span>
                                    <span style={{
                                        marginLeft: '8px', padding: '2px 8px',
                                        background: authUser.role === 'admin' ? 'rgba(37,211,102,0.15)' : 'rgba(100,100,200,0.15)',
                                        border: `1px solid ${authUser.role === 'admin' ? 'rgba(37,211,102,0.3)' : 'rgba(100,100,200,0.3)'}`,
                                        borderRadius: '20px', fontSize: '0.65rem',
                                        color: authUser.role === 'admin' ? '#25D366' : '#8888ff'
                                    }}>{authUser.role === 'admin' ? '👑 ADMIN' : '👤 USER'}</span>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowUserModal(false)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', fontSize: '1.4rem', lineHeight: 1 }}
                            >×</button>
                        </div>

                        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            {/* Admin: create user form */}
                            {authUser.role === 'admin' && (
                                <div style={{
                                    background: 'rgba(37,211,102,0.05)',
                                    border: '1px solid rgba(37,211,102,0.15)',
                                    borderRadius: '12px', padding: '18px'
                                }}>
                                    <div style={{ color: '#25D366', fontWeight: '600', fontSize: '0.8rem', marginBottom: '14px', letterSpacing: '1px' }}>
                                        + CRIAR NOVO USUÁRIO
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                        <input
                                            type="email"
                                            value={newUserEmail}
                                            onChange={e => setNewUserEmail(e.target.value)}
                                            placeholder="E-mail do usuário"
                                            style={{
                                                padding: '10px 12px',
                                                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(37,211,102,0.15)',
                                                borderRadius: '8px', color: '#eee', fontSize: '0.85rem', outline: 'none',
                                                boxSizing: 'border-box', width: '100%'
                                            }}
                                        />
                                        <input
                                            type="password"
                                            value={newUserPassword}
                                            onChange={e => setNewUserPassword(e.target.value)}
                                            placeholder="Senha"
                                            style={{
                                                padding: '10px 12px',
                                                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(37,211,102,0.15)',
                                                borderRadius: '8px', color: '#eee', fontSize: '0.85rem', outline: 'none',
                                                boxSizing: 'border-box', width: '100%'
                                            }}
                                        />
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            {['user', 'admin'].map(r => (
                                                <button
                                                    key={r}
                                                    onClick={() => setNewUserRole(r)}
                                                    style={{
                                                        flex: 1, padding: '8px',
                                                        background: newUserRole === r ? (r === 'admin' ? 'rgba(37,211,102,0.2)' : 'rgba(100,100,255,0.2)') : 'rgba(255,255,255,0.04)',
                                                        border: `1px solid ${newUserRole === r ? (r === 'admin' ? 'rgba(37,211,102,0.5)' : 'rgba(100,100,255,0.5)') : 'rgba(255,255,255,0.1)'}`,
                                                        borderRadius: '8px',
                                                        color: newUserRole === r ? (r === 'admin' ? '#25D366' : '#8888ff') : '#888',
                                                        cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600',
                                                        transition: 'all 0.2s'
                                                    }}
                                                >
                                                    {r === 'admin' ? '👑 Administrador' : '👤 Usuário'}
                                                </button>
                                            ))}
                                        </div>
                                        <button
                                            onClick={createSystemUser}
                                            disabled={userActionLoading}
                                            style={{
                                                padding: '10px', borderRadius: '8px', border: 'none',
                                                background: 'linear-gradient(135deg, #25D366, #1db954)',
                                                color: '#fff', fontWeight: '700', fontSize: '0.85rem',
                                                cursor: userActionLoading ? 'not-allowed' : 'pointer',
                                                opacity: userActionLoading ? 0.7 : 1
                                            }}
                                        >{userActionLoading ? 'Criando...' : '+ Criar Usuário'}</button>
                                    </div>
                                </div>
                            )}

                            {/* User list (admin only) */}
                            {authUser.role === 'admin' && (
                                <div>
                                    <div style={{ color: '#555', fontSize: '0.75rem', letterSpacing: '1px', marginBottom: '12px' }}>
                                        USUÁRIOS CADASTRADOS
                                    </div>
                                    {systemUsers.length === 0 ? (
                                        <div style={{ color: '#444', textAlign: 'center', padding: '20px', fontSize: '0.85rem' }}>Nenhum usuário encontrado</div>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            {systemUsers.map(u => (
                                                <div key={u.id} style={{
                                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                    padding: '12px 14px',
                                                    background: 'rgba(255,255,255,0.03)',
                                                    border: '1px solid rgba(255,255,255,0.06)',
                                                    borderRadius: '10px'
                                                }}>
                                                    <div>
                                                        <div style={{ color: '#ddd', fontSize: '0.85rem' }}>{u.email}</div>
                                                        <div style={{ marginTop: '2px' }}>
                                                            <span style={{
                                                                padding: '2px 8px',
                                                                background: u.role === 'admin' ? 'rgba(37,211,102,0.1)' : 'rgba(100,100,200,0.1)',
                                                                border: `1px solid ${u.role === 'admin' ? 'rgba(37,211,102,0.25)' : 'rgba(100,100,200,0.25)'}`,
                                                                borderRadius: '20px', fontSize: '0.65rem',
                                                                color: u.role === 'admin' ? '#25D366' : '#8888ff'
                                                            }}>{u.role === 'admin' ? '👑 admin' : '👤 user'}</span>
                                                        </div>
                                                    </div>
                                                    {u.id !== authUser.id && (
                                                        <button
                                                            onClick={() => deleteSystemUser(u.id, u.email)}
                                                            title="Excluir usuário"
                                                            style={{
                                                                background: 'rgba(255,50,50,0.08)',
                                                                border: '1px solid rgba(255,50,50,0.2)',
                                                                borderRadius: '8px', padding: '6px 10px',
                                                                color: '#ff6464', cursor: 'pointer',
                                                                fontSize: '0.8rem', transition: 'all 0.2s'
                                                            }}
                                                        >🗑</button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Footer: logout */}
                        <div style={{ padding: '16px 24px', borderTop: '1px solid rgba(37,211,102,0.08)' }}>
                            <button
                                onClick={handleLogout}
                                style={{
                                    width: '100%', padding: '10px',
                                    background: 'rgba(255,50,50,0.08)',
                                    border: '1px solid rgba(255,50,50,0.2)',
                                    borderRadius: '10px', color: '#ff6464',
                                    cursor: 'pointer', fontWeight: '600', fontSize: '0.85rem',
                                    transition: 'all 0.2s'
                                }}
                            >⎋ Sair da Sessão</button>
                        </div>
                    </div>
                </div>
            )}

        </div >
    )
}

export default App
