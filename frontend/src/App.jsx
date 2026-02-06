import { useEffect, useState } from 'react'
import io from 'socket.io-client'
import './App.css'

// Conecta ao backend via Socket.IO
const socket = io('http://localhost:3000');

function App() {
    const [accounts, setAccounts] = useState([]);
    const [stats, setStats] = useState({});
    const [currentAccountId, setCurrentAccountId] = useState(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showConfigModal, setShowConfigModal] = useState(false);
    const [qrTimestamps, setQrTimestamps] = useState({}); // Armazena quando cada QR foi recebido

    // Carrega contas ao iniciar
    useEffect(() => {
        loadAccounts();
        loadStats();

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

        return () => {
            socket.off('connect');
            socket.off('disconnect');
            socket.off('initial-state');
            socket.off('update');
            socket.off('session:qr');
            socket.off('session:authenticated');
            socket.off('session:ready');
            socket.off('session:disconnected');
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
                throw new Error('Erro ao iniciar');
            }
        } catch (error) {
            console.error(error);
            showToast('Erro ao iniciar conta', 'error');
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
            showToast('Conta parada', 'success');
            loadAccounts();
        } catch (error) {
            showToast('Erro ao parar conta', 'error');
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
        console.log('Abrindo configuração para conta:', id);
        setCurrentAccountId(id);

        // Carrega configurações da conta
        try {
            const response = await fetch(`/api/accounts/${id}`);
            const account = await response.json();
            console.log('Conta carregada:', account);

            // Aguarda o modal aparecer antes de preencher
            setShowConfigModal(true);

            // Usa setTimeout para garantir que os elementos existam
            setTimeout(() => {
                // Preenche formulário
                const proxyEnabled = document.getElementById('proxyEnabled');
                if (proxyEnabled) {
                    proxyEnabled.checked = account.proxy_enabled || false;
                    document.getElementById('proxyIp').value = account.proxy_ip || '';
                    document.getElementById('proxyPort').value = account.proxy_port || '';
                    document.getElementById('proxyUsername').value = account.proxy_username || '';
                    document.getElementById('proxyPassword').value = account.proxy_password || '';

                    document.getElementById('minReadDelay').value = account.min_read_delay || 3000;
                    document.getElementById('maxReadDelay').value = account.max_read_delay || 15000;
                    document.getElementById('minTypingDelay').value = account.min_typing_delay || 5000;
                    document.getElementById('maxTypingDelay').value = account.max_typing_delay || 20000;
                    document.getElementById('minResponseDelay').value = account.min_response_delay || 10000;
                    document.getElementById('maxResponseDelay').value = account.max_response_delay || 30000;
                    document.getElementById('minMessageInterval').value = account.min_message_interval || 20000;
                    document.getElementById('ignoreProbability').value = account.ignore_probability || 20;

                    document.getElementById('mediaEnabled').checked = account.media_enabled || false;
                    document.getElementById('mediaInterval').value = account.media_interval || 2;

                    // Mostra/esconde campos de proxy
                    toggleProxyFields();
                }
            }, 100);
        } catch (error) {
            console.error('Erro ao carregar configurações:', error);
            showToast('Erro ao carregar configurações', 'error');
        }
    };

    const saveConfig = async () => {
        if (!currentAccountId) return;

        const config = {
            proxy_enabled: document.getElementById('proxyEnabled').checked ? 1 : 0,
            proxy_ip: document.getElementById('proxyIp').value,
            proxy_port: parseInt(document.getElementById('proxyPort').value),
            proxy_username: document.getElementById('proxyUsername').value || null,
            proxy_password: document.getElementById('proxyPassword').value || null,

            min_read_delay: parseInt(document.getElementById('minReadDelay').value),
            max_read_delay: parseInt(document.getElementById('maxReadDelay').value),
            min_typing_delay: parseInt(document.getElementById('minTypingDelay').value),
            max_typing_delay: parseInt(document.getElementById('maxTypingDelay').value),
            min_response_delay: parseInt(document.getElementById('minResponseDelay').value),
            max_response_delay: parseInt(document.getElementById('maxResponseDelay').value),
            min_message_interval: parseInt(document.getElementById('minMessageInterval').value),
            ignore_probability: parseInt(document.getElementById('ignoreProbability').value),

            media_enabled: document.getElementById('mediaEnabled').checked ? 1 : 0,
            media_interval: parseInt(document.getElementById('mediaInterval').value)
        };

        try {
            console.log('💾 Salvando config:', config);
            const response = await fetch(`/api/accounts/${currentAccountId}/config`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });

            console.log('📡 Resposta status:', response.status);

            if (!response.ok) {
                const errorData = await response.json();
                console.error('❌ Erro do servidor:', errorData);
                throw new Error(errorData.error || 'Erro ao salvar');
            }

            const result = await response.json();
            console.log('✅ Config salva:', result);

            showToast('Configurações salvas!', 'success');
            setShowConfigModal(false);
            loadAccounts();
        } catch (error) {
            console.error('❌ Erro ao salvar:', error);
            showToast(`Erro: ${error.message}`, 'error');
        }
    };

    const testProxy = async () => {
        const proxyIp = document.getElementById('proxyIp').value;
        const proxyPort = document.getElementById('proxyPort').value;
        const proxyUsername = document.getElementById('proxyUsername').value;
        const proxyPassword = document.getElementById('proxyPassword').value;

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
        const enabled = document.getElementById('proxyEnabled')?.checked;
        const fields = document.getElementById('proxyFields');
        if (fields) {
            fields.style.display = enabled ? 'block' : 'none';
        }
    };

    const switchTab = (tabName) => {
        // Remove active de todos
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

        // Adiciona active no selecionado
        document.querySelector(`[data-tab="${tabName}"]`)?.classList.add('active');
        document.getElementById(`tab-${tabName}`)?.classList.add('active');
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
            'initializing': '⏳ Gerando QR Code...',
            'ready': '✅ Conectado',
            'qr': '📱 Aguardando QR',
            'authenticated': '🔐 Autenticado',
            'disconnected': '⚠️ Desconectado',
            'error': '❌ Erro'
        };
        return map[status] || status;
    };

    return (
        <div className="container">
            {/* Header */}
            <header className="header">
                <div className="header-content">
                    <h1 className="title">
                        <span className="icon">🔥</span>
                        Sistema de Aquecimento WhatsApp
                        <span className="version">v2.0</span>
                    </h1>
                    <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
                        <span>➕</span> Nova Conta
                    </button>
                </div>
            </header>

            {/* Global Stats */}
            <section className="stats-section">
                <div className="stats-grid">
                    <div className="stat-card">
                        <div className="stat-icon">📱</div>
                        <div className="stat-info">
                            <div className="stat-number">{stats.totalAccounts || 0}</div>
                            <div className="stat-label">Total de Contas</div>
                        </div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-icon">✅</div>
                        <div className="stat-info">
                            <div className="stat-number">{stats.ready || 0}</div>
                            <div className="stat-label">Contas Ativas</div>
                        </div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-icon">📤</div>
                        <div className="stat-info">
                            <div className="stat-number">{stats.totalMessagesSent || 0}</div>
                            <div className="stat-label">Mensagens Enviadas</div>
                        </div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-icon">👥</div>
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
                            <div className="empty-icon">📱</div>
                            <h3>Nenhuma conta criada</h3>
                            <p>Clique em "Nova Conta" para começar</p>
                        </div>
                    ) : (
                        accounts.map(account => (
                            <div key={account.id} className="account-card">
                                <div className="account-header">
                                    <div className="account-name">{account.name}</div>
                                    <div className={`account-status ${(account.status || 'disconnected').toLowerCase()}`}>
                                        {getStatusText(account.status || 'disconnected', account.id)}
                                    </div>
                                </div>

                                {account.status === 'qr' && account.qrCode && (
                                    <div className="qr-container">
                                        <img src={account.qrCode} alt="QR Code" />
                                        <div className="connection-info">
                                            {account.publicIP && account.isp ? (
                                                <div className="connection-badge proxy">
                                                    <span className="connection-icon">🌐</span>
                                                    <div className="connection-details">
                                                        <div className="connection-label">{account.isp}</div>
                                                        <div className="connection-value">{account.publicIP}</div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="connection-badge local">
                                                    <span className="connection-icon">📡</span>
                                                    <div className="connection-details">
                                                        <div className="connection-label">Detectando conexão...</div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                <div className="account-info">
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

                                <div className={`proxy-badge ${account.proxy_enabled ? '' : 'no-proxy'}`}>
                                    {account.proxy_enabled ?
                                        `🔒 ${account.proxy_ip}:${account.proxy_port}` :
                                        'Sem Proxy'
                                    }
                                </div>

                                <div className="account-actions">
                                    {account.status === 'ready' ? (
                                        <button className="btn btn-sm btn-danger" onClick={() => stopAccount(account.id)}>Parar</button>
                                    ) : (
                                        <button className="btn btn-sm btn-success" onClick={() => startAccount(account.id)} title="Iniciar">▶️</button>
                                    )}
                                    <button className="btn btn-sm btn-warning" onClick={() => restartAccount(account.id)} title="Recarregar QR / Reiniciar">🔄</button>
                                    <button className="btn btn-sm btn-secondary" title="Ver Navegador" onClick={() => handleViewBrowser(account)}>👁️</button>
                                    <button className="btn btn-sm btn-secondary" onClick={() => openConfigModal(account.id)}>⚙️</button>
                                    <button className="btn btn-sm btn-danger" onClick={() => deleteAccount(account.id)}>🗑️</button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </section>

            {/* Modal: Criar Conta */}
            {showCreateModal && (
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
            )}

            {/* Modal: Configurar Conta */}
            {showConfigModal && (
                <div className="modal show">
                    <div className="modal-content modal-large">
                        <div className="modal-header">
                            <h2>Configurar Conta</h2>
                            <button className="modal-close" onClick={() => setShowConfigModal(false)}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="tabs">
                                <button className="tab-btn active" data-tab="proxy" onClick={() => switchTab('proxy')}>Proxy</button>
                                <button className="tab-btn" data-tab="delays" onClick={() => switchTab('delays')}>Delays</button>
                                <button className="tab-btn" data-tab="media" onClick={() => switchTab('media')}>Mídia</button>
                            </div>

                            {/* Tab: Proxy */}
                            <div id="tab-proxy" className="tab-content active">
                                <div className="form-group">
                                    <label className="checkbox-label">
                                        <input type="checkbox" id="proxyEnabled" onChange={toggleProxyFields} />
                                        <span>Usar Proxy</span>
                                    </label>
                                </div>
                                <div id="proxyFields" style={{ display: 'none' }}>
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label>IP do Proxy</label>
                                            <input type="text" id="proxyIp" placeholder="192.168.1.1" className="form-input" />
                                        </div>
                                        <div className="form-group">
                                            <label>Porta</label>
                                            <input type="number" id="proxyPort" placeholder="8080" className="form-input" />
                                        </div>
                                    </div>
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label>Usuário (opcional)</label>
                                            <input type="text" id="proxyUsername" placeholder="usuario" className="form-input" />
                                        </div>
                                        <div className="form-group">
                                            <label>Senha (opcional)</label>
                                            <input type="password" id="proxyPassword" placeholder="senha" className="form-input" />
                                        </div>
                                    </div>
                                    <button className="btn btn-primary btn-sm" onClick={testProxy}>
                                        🔍 Testar Proxy
                                    </button>
                                </div>
                            </div>

                            {/* Tab: Delays */}
                            <div id="tab-delays" className="tab-content">
                                <div className="form-group">
                                    <label>Delay de Leitura (ms)</label>
                                    <div className="form-row">
                                        <input type="number" id="minReadDelay" placeholder="Mínimo (3000)" className="form-input" />
                                        <input type="number" id="maxReadDelay" placeholder="Máximo (15000)" className="form-input" />
                                    </div>
                                    <small>Tempo que leva para "ler" a mensagem</small>
                                </div>
                                <div className="form-group">
                                    <label>Delay de Digitação (ms)</label>
                                    <div className="form-row">
                                        <input type="number" id="minTypingDelay" placeholder="Mínimo (5000)" className="form-input" />
                                        <input type="number" id="maxTypingDelay" placeholder="Máximo (20000)" className="form-input" />
                                    </div>
                                    <small>Tempo que leva para "digitar"</small>
                                </div>
                                <div className="form-group">
                                    <label>Delay de Resposta (ms)</label>
                                    <div className="form-row">
                                        <input type="number" id="minResponseDelay" placeholder="Mínimo (10000)" className="form-input" />
                                        <input type="number" id="maxResponseDelay" placeholder="Máximo (30000)" className="form-input" />
                                    </div>
                                    <small>Tempo entre terminar de digitar e enviar</small>
                                </div>
                                <div className="form-group">
                                    <label>Intervalo Mínimo entre Mensagens (ms)</label>
                                    <input type="number" id="minMessageInterval" placeholder="20000" className="form-input" />
                                    <small>Tempo mínimo entre mensagens para o mesmo contato</small>
                                </div>
                                <div className="form-group">
                                    <label>Probabilidade de Ignorar (%)</label>
                                    <input type="number" id="ignoreProbability" min="0" max="100" placeholder="20" className="form-input" />
                                    <small>Chance de não responder imediatamente</small>
                                </div>
                            </div>

                            {/* Tab: Mídia */}
                            <div id="tab-media" className="tab-content">
                                <div className="form-group">
                                    <label className="checkbox-label">
                                        <input type="checkbox" id="mediaEnabled" />
                                        <span>Enviar Mídia</span>
                                    </label>
                                    <small>Alterna entre texto e mídia automaticamente</small>
                                </div>
                                <div className="form-group">
                                    <label>Intervalo de Mídia</label>
                                    <input type="number" id="mediaInterval" placeholder="2" className="form-input" />
                                    <small>Envia mídia a cada X mensagens (padrão: 2)</small>
                                </div>
                                <div className="info-box">
                                    <strong>📁 Pasta de Mídia:</strong> ./media/<br />
                                    Coloque imagens (.jpg, .png), vídeos (.mp4), áudios (.mp3) ou figurinhas (.webp) nesta pasta.
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowConfigModal(false)}>Cancelar</button>
                            <button className="btn btn-primary" onClick={saveConfig}>Salvar Configurações</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast Container */}
            <div id="toastContainer" className="toast-container"></div>
        </div>
    )
}

export default App
