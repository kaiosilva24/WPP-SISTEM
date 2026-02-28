// Socket.IO connection
const socket = io();

// State
let accounts = [];
let stats = {};
let currentAccountId = null;

/**
 * Initialize
 */
document.addEventListener('DOMContentLoaded', () => {
  loadAccounts();

  // Proxy checkbox toggle
  document.getElementById('proxyEnabled').addEventListener('change', (e) => {
    document.getElementById('proxyFields').style.display = e.target.checked ? 'block' : 'none';
  });
});

/**
 * Socket events
 */
socket.on('initial-state', (data) => {
  stats = data.stats;
  updateStats();
});

socket.on('update', (data) => {
  stats = data.stats;
  updateStats();
  loadAccounts(); // Reload accounts to get updated status
});

socket.on('session:qr', ({ accountId, qrCode }) => {
  const card = document.querySelector(`[data-account-id="${accountId}"]`);
  if (card) {
    const qrContainer = card.querySelector('.qr-container');
    if (qrContainer) {
      qrContainer.innerHTML = `<img src="${qrCode}" alt="QR Code">`;
    }
  }
  showToast(`QR Code gerado para conta ${accountId}`, 'info');
});

socket.on('session:authenticated', ({ accountName }) => {
  showToast(`${accountName} autenticada!`, 'success');
});

socket.on('session:ready', ({ accountName }) => {
  showToast(`${accountName} conectada!`, 'success');
});

socket.on('session:disconnected', ({ accountName }) => {
  showToast(`${accountName} desconectada`, 'warning');
});

/**
 * Load accounts from API
 */
async function loadAccounts() {
  try {
    const response = await fetch('/api/accounts');
    accounts = await response.json();
    renderAccounts();
  } catch (error) {
    console.error('Erro ao carregar contas:', error);
    showToast('Erro ao carregar contas', 'error');
  }
}

/**
 * Render accounts grid
 */
function renderAccounts() {
  const grid = document.getElementById('accountsGrid');

  if (accounts.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📱</div>
        <h3>Nenhuma conta criada</h3>
        <p>Clique em "Nova Conta" para começar</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = accounts.map(account => createAccountCard(account)).join('');
}

/**
 * Create account card HTML
 */
function createAccountCard(account) {
  const statusClass = (account.status || 'disconnected').toLowerCase();
  const statusText = getStatusText(account.status || 'disconnected');

  let qrSection = '';
  if (account.status === 'qr') {
    qrSection = `
      <div class="qr-container">
        <div class="qr-loading">Gerando QR Code...</div>
      </div>
    `;
  }

  const proxyInfo = account.proxy_enabled ?
    `<div class="proxy-badge">🔒 ${account.proxy_ip}:${account.proxy_port}</div>` :
    '<div class="proxy-badge no-proxy">Sem Proxy</div>';

  return `
    <div class="account-card" data-account-id="${account.id}">
      <div class="account-header">
        <div class="account-name">${account.name}</div>
        <div class="account-status ${statusClass}">${statusText}</div>
      </div>
      
      ${qrSection}
      
      <div class="account-info">
        <div class="info-item">
          <span class="info-label">Enviadas</span>
          <span class="info-value">${account.messages_sent || 0}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Recebidas</span>
          <span class="info-value">${account.messages_received || 0}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Contatos</span>
          <span class="info-value">${account.unique_contacts || 0}</span>
        </div>
      </div>
      
      ${proxyInfo}
      
      <div class="account-actions">
        ${account.status === 'ready' ?
      `<button class="btn btn-sm btn-danger" onclick="stopAccount(${account.id})">Parar</button>` :
      `<button class="btn btn-sm btn-success" onclick="startAccount(${account.id})">Iniciar</button>`
    }
        <button class="btn btn-sm btn-secondary" onclick="configureAccount(${account.id})">⚙️ Configurar</button>
        <button class="btn btn-sm btn-danger" onclick="deleteAccount(${account.id})">🗑️</button>
      </div>
    </div>
  `;
}

/**
 * Get status text
 */
function getStatusText(status) {
  const map = {
    'ready': '✅ Conectado',
    'qr': '📱 Aguardando QR',
    'authenticated': '🔐 Autenticado',
    'disconnected': '⚠️ Desconectado',
    'error': '❌ Erro'
  };
  return map[status] || status;
}

/**
 * Update stats
 */
function updateStats() {
  document.getElementById('totalAccounts').textContent = stats.totalAccounts || 0;
  document.getElementById('activeSessions').textContent = stats.ready || 0;
  document.getElementById('totalMessagesSent').textContent = stats.totalMessagesSent || 0;
  document.getElementById('totalUniqueContacts').textContent = stats.totalUniqueContacts || 0;
}

/**
 * Show create account modal
 */
function showCreateAccountModal() {
  document.getElementById('accountName').value = '';
  document.getElementById('createAccountModal').classList.add('show');
}

/**
 * Create account
 */
async function createAccount() {
  const name = document.getElementById('accountName').value.trim();

  if (!name) {
    showToast('Digite um nome para a conta', 'error');
    return;
  }

  try {
    const response = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error);
    }

    showToast('Conta criada com sucesso!', 'success');
    closeModal('createAccountModal');
    loadAccounts();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

/**
 * Start account
 */
async function startAccount(id) {
  try {
    const response = await fetch(`/api/accounts/${id}/start`, { method: 'POST' });

    if (!response.ok) {
      throw new Error('Erro ao iniciar conta');
    }

    showToast('Conta iniciada', 'success');
    loadAccounts();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

/**
 * Stop account
 */
async function stopAccount(id) {
  try {
    const response = await fetch(`/api/accounts/${id}/stop`, { method: 'POST' });

    if (!response.ok) {
      throw new Error('Erro ao parar conta');
    }

    showToast('Conta parada', 'success');
    loadAccounts();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

/**
 * Delete account
 */
async function deleteAccount(id) {
  if (!confirm('Tem certeza que deseja deletar esta conta?')) {
    return;
  }

  try {
    const response = await fetch(`/api/accounts/${id}`, { method: 'DELETE' });

    if (!response.ok) {
      throw new Error('Erro ao deletar conta');
    }

    showToast('Conta deletada', 'success');
    loadAccounts();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

/**
 * Configure account
 */
async function configureAccount(id) {
  currentAccountId = id;

  try {
    const response = await fetch(`/api/accounts/${id}`);
    const account = await response.json();

    document.getElementById('configAccountName').textContent = account.name;

    // Proxy
    document.getElementById('proxyEnabled').checked = account.proxy_enabled || false;
    document.getElementById('proxyIp').value = account.proxy_ip || '';
    document.getElementById('proxyPort').value = account.proxy_port || '';
    document.getElementById('proxyUsername').value = account.proxy_username || '';
    document.getElementById('proxyPassword').value = account.proxy_password || '';
    document.getElementById('proxyFields').style.display = account.proxy_enabled ? 'block' : 'none';

    // Delays
    document.getElementById('minReadDelay').value = account.min_read_delay || 3000;
    document.getElementById('maxReadDelay').value = account.max_read_delay || 15000;
    document.getElementById('minTypingDelay').value = account.min_typing_delay || 5000;
    document.getElementById('maxTypingDelay').value = account.max_typing_delay || 20000;
    document.getElementById('minResponseDelay').value = account.min_response_delay || 10000;
    document.getElementById('maxResponseDelay').value = account.max_response_delay || 30000;
    document.getElementById('minMessageInterval').value = account.min_message_interval || 20000;
    document.getElementById('ignoreProbability').value = account.ignore_probability || 20;

    // Media
    document.getElementById('mediaEnabled').checked = account.media_enabled !== false;
    document.getElementById('mediaInterval').value = account.media_interval || 2;

    // Load custom messages
    loadCustomMessages(id);

    document.getElementById('configAccountModal').classList.add('show');
  } catch (error) {
    showToast('Erro ao carregar configurações', 'error');
  }
}

/**
 * Save account config
 */
async function saveAccountConfig() {
  const config = {
    proxy_enabled: document.getElementById('proxyEnabled').checked,
    proxy_ip: document.getElementById('proxyIp').value,
    proxy_port: parseInt(document.getElementById('proxyPort').value) || null,
    proxy_username: document.getElementById('proxyUsername').value,
    proxy_password: document.getElementById('proxyPassword').value,
    min_read_delay: parseInt(document.getElementById('minReadDelay').value),
    max_read_delay: parseInt(document.getElementById('maxReadDelay').value),
    min_typing_delay: parseInt(document.getElementById('minTypingDelay').value),
    max_typing_delay: parseInt(document.getElementById('maxTypingDelay').value),
    min_response_delay: parseInt(document.getElementById('minResponseDelay').value),
    max_response_delay: parseInt(document.getElementById('maxResponseDelay').value),
    min_message_interval: parseInt(document.getElementById('minMessageInterval').value),
    ignore_probability: parseInt(document.getElementById('ignoreProbability').value),
    media_enabled: document.getElementById('mediaEnabled').checked,
    media_interval: parseInt(document.getElementById('mediaInterval').value)
  };

  try {
    const response = await fetch(`/api/accounts/${currentAccountId}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });

    if (!response.ok) {
      throw new Error('Erro ao salvar configurações');
    }

    showToast('Configurações salvas!', 'success');
    closeModal('configAccountModal');
    loadAccounts();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

/**
 * Load custom messages
 */
async function loadCustomMessages(accountId) {
  try {
    const response = await fetch(`/api/accounts/${accountId}/messages`);
    const messages = await response.json();

    const list = document.getElementById('messagesList');
    list.innerHTML = messages.map(msg => `
      <div class="message-item">
        <div class="message-type">${getMessageTypeLabel(msg.message_type)}</div>
        <div class="message-text">${msg.message_text}</div>
        <button class="btn btn-sm btn-danger" onclick="deleteMessage(${msg.id})">🗑️</button>
      </div>
    `).join('');
  } catch (error) {
    console.error('Erro ao carregar mensagens:', error);
  }
}

/**
 * Add custom message
 */
async function addCustomMessage() {
  const messageType = document.getElementById('messageType').value;
  const messageText = document.getElementById('messageText').value.trim();

  if (!messageText) {
    showToast('Digite o texto da mensagem', 'error');
    return;
  }

  try {
    const response = await fetch(`/api/accounts/${currentAccountId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_type: messageType, message_text: messageText })
    });

    if (!response.ok) {
      throw new Error('Erro ao adicionar mensagem');
    }

    document.getElementById('messageText').value = '';
    showToast('Mensagem adicionada!', 'success');
    loadCustomMessages(currentAccountId);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

/**
 * Delete message
 */
async function deleteMessage(messageId) {
  try {
    const response = await fetch(`/api/accounts/${currentAccountId}/messages/${messageId}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      throw new Error('Erro ao deletar mensagem');
    }

    showToast('Mensagem deletada', 'success');
    loadCustomMessages(currentAccountId);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

/**
 * Get message type label
 */
function getMessageTypeLabel(type) {
  const map = {
    'first': 'Primeira Resposta',
    'followup': 'Resposta Subsequente',
    'group': 'Saudação de Grupo'
  };
  return map[type] || type;
}

/**
 * Switch tab
 */
function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

  event.target.classList.add('active');
  document.getElementById(`tab-${tabName}`).classList.add('active');
}

/**
 * Close modal
 */
function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('show');
}

/**
 * Show toast
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => container.removeChild(toast), 300);
  }, 3000);
}
