// Wrapper de fetch que injeta Authorization automaticamente.

export const API_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : window.location.origin;

export function getToken() {
    return localStorage.getItem('wpp_auth_token');
}

export function setToken(token) {
    if (token) localStorage.setItem('wpp_auth_token', token);
    else localStorage.removeItem('wpp_auth_token');
}

export async function apiFetch(path, options = {}) {
    const token = getToken();
    const headers = { ...(options.headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }
    const url = path.startsWith('http') ? path : `${API_URL}${path}`;
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
        setToken(null);
        // dispara evento global pra App.jsx forçar login
        window.dispatchEvent(new Event('wpp:unauthorized'));
    }
    return res;
}

export async function apiJson(path, options) {
    const res = await apiFetch(path, options);
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
        const msg = (data && data.error) || `HTTP ${res.status}`;
        const e = new Error(msg);
        e.status = res.status;
        e.data = data;
        throw e;
    }
    return data;
}
