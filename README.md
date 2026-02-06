# Sistema de Aquecimento WhatsApp v2.0

## �️ Arquitetura Separada

- **Frontend**: React + Vite (porta 5173)
- **Backend**: Express + Socket.IO (porta 3000)

## 🚀 Como Iniciar

### 1. Instalar Dependências

**Backend**:
```bash
cd backend
npm install
```

**Frontend**:
```bash
cd frontend
npm install
```

### 2. Iniciar Backend (Terminal 1)

```bash
cd backend
npm start
```

Você verá:
```
🔥 SISTEMA DE AQUECIMENTO WHATSAPP v2.0
🚀 Backend API rodando em http://localhost:3000
🔗 CORS habilitado para: http://localhost:5173
```

### 3. Iniciar Frontend (Terminal 2)

```bash
cd frontend
npm run dev
```

Você verá:
```
  VITE v7.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

### 4. Acessar Sistema

Abra seu navegador em: **http://localhost:5173**

## 📡 Comunicação Frontend-Backend

O frontend se comunica com o backend através de:

1. **REST API** (HTTP):
   - `GET /api/accounts` - Lista contas
   - `POST /api/accounts` - Cria conta
   - `PUT /api/accounts/:id/config` - Atualiza configuração
   - etc.

2. **WebSocket** (Socket.IO):
   - Atualizações em tempo real
   - QR codes
   - Status das contas
   - Estatísticas

## 🔧 Configuração

### Backend (.env)

```env
WEB_PORT=3000
FRONTEND_URL=http://localhost:5173
```

### Frontend (vite.config.js)

```javascript
server: {
  port: 5173,
  proxy: {
    '/api': 'http://localhost:3000',
    '/socket.io': {
      target: 'http://localhost:3000',
      ws: true
    }
  }
}
```

## 📁 Estrutura do Projeto

```
AQUECIMENTO/
├── backend/                    # API Backend (porta 3000)
│   ├── src/
│   │   ├── api/               # Rotas REST
│   │   ├── database/          # SQLite
│   │   ├── services/          # Lógica de negócio
│   │   ├── utils/             # Utilitários
│   │   ├── web/               # Servidor Express
│   │   └── index.js           # Entry point
│   ├── data/                  # Banco de dados
│   ├── .env                   # Configuração backend
│   └── package.json
│
├── frontend/                   # Interface React (porta 5173)
│   ├── src/
│   │   ├── App.jsx            # Componente principal
│   │   ├── main.jsx           # Entry point
│   │   ├── App.css            # Estilos
│   │   └── index.css          # Estilos globais
│   ├── public/
│   │   ├── app.js             # Lógica do dashboard
│   │   └── styles.css         # Estilos originais
│   ├── vite.config.js         # Configuração Vite
│   └── package.json
│
├── media/                      # Arquivos de mídia (compartilhado)
├── logs/                       # Logs do sistema
└── .wwebjs_auth/              # Sessões WhatsApp
```

## ✨ Funcionalidades

### Dashboard (Frontend - 5173)

- ✅ Criar contas dinamicamente
- ✅ Configurar proxy individual
- ✅ Personalizar mensagens
- ✅ Ajustar delays
- ✅ Ver QR codes
- ✅ Monitorar estatísticas em tempo real

### API (Backend - 3000)

- ✅ CRUD completo de contas
- ✅ Gerenciamento de sessões WhatsApp
- ✅ Processamento de mensagens
- ✅ Comportamento humano
- ✅ Banco de dados SQLite
- ✅ WebSocket para tempo real

## 🔄 Fluxo de Dados

1. **Usuário** cria conta no frontend (5173)
2. **Frontend** envia POST para `/api/accounts` (3000)
3. **Backend** salva no banco e cria sessão WhatsApp
4. **Backend** emite evento Socket.IO com QR code
5. **Frontend** recebe e exibe QR code
6. **Usuário** escaneia QR code
7. **Backend** detecta autenticação
8. **Backend** emite evento de "ready"
9. **Frontend** atualiza status para "Conectado"

## 🛠️ Desenvolvimento

### Adicionar Nova Rota API

**Backend** (`backend/src/api/accounts.js`):
```javascript
router.get('/nova-rota', (req, res) => {
  res.json({ message: 'Nova rota' });
});
```

### Adicionar Novo Componente

**Frontend** (`frontend/src/components/NovoComponente.jsx`):
```jsx
export default function NovoComponente() {
  return <div>Novo Componente</div>;
}
```

## 📦 Build para Produção

### Backend

```bash
cd backend
npm start
```

### Frontend

```bash
cd frontend
npm run build
```

Arquivos gerados em `frontend/dist/`

## � Deploy

### Opção 1: VPS

1. Faça upload de `backend/` e `frontend/dist/`
2. Configure Nginx para servir o frontend e fazer proxy para o backend
3. Use PM2 para gerenciar o processo do backend

### Opção 2: Docker

```bash
# Backend
cd backend
docker build -t whatsapp-backend .
docker run -p 3000:3000 whatsapp-backend

# Frontend
cd frontend
npm run build
# Servir dist/ com nginx
```

## 🔍 Troubleshooting

### Frontend não conecta ao backend

1. Verifique se o backend está rodando na porta 3000
2. Verifique CORS no backend
3. Verifique proxy no `vite.config.js`

### Socket.IO não funciona

1. Verifique se WebSocket está habilitado no proxy
2. Verifique CORS do Socket.IO no backend
3. Veja console do navegador para erros

### Contas não aparecem

1. Verifique se o backend está rodando
2. Abra DevTools > Network > XHR
3. Veja se `/api/accounts` retorna dados
4. Verifique console para erros

## � Notas

- **Porta 3000**: Backend API
- **Porta 5173**: Frontend (desenvolvimento)
- **CORS**: Habilitado entre frontend e backend
- **Proxy**: Vite faz proxy de `/api` e `/socket.io` para o backend
- **Banco**: SQLite em `backend/data/accounts.db`

---

**Sistema pronto!** 🔥

Inicie o backend e frontend em terminais separados e acesse http://localhost:5173
