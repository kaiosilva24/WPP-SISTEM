# WhatsApp Warming System - Deploy DisCloud

## 📋 Pré-requisitos

- Conta no DisCloud com plano que suporte 4GB RAM
- Subdomínio configurado: `wpp.discloud.app`

## 🚀 Deploy

### 1. Faça upload do repositório

No Discord do DisCloud, use:
```
.add github:kaiosilva24/WPP-SISTEM
```

OU faça deploy pelo painel web: https://discloud.com/app

### 2. Configure as variáveis de ambiente

No painel do DisCloud, vá em **Configurações > Variáveis de Ambiente** e adicione:

```
WEB_PORT=80
FRONTEND_URL=https://wpp.discloud.app
NODE_ENV=production
```

### 3. Configure o subdomínio

No painel do DisCloud:
1. Vá em **Configurações > Domínio**
2. Ative para usar: `wpp.discloud.app`

### 4. Acesse o sistema

Após o deploy, acesse:
- **Dashboard:** https://wpp.discloud.app

## ⚠️ Limitações do DisCloud

> **IMPORTANTE:** O DisCloud **NÃO SUPORTA** navegadores headless (Puppeteer/Chrome) nativamente.
> 
> O WhatsApp Web.js requer um navegador Chrome em execução, o que pode não funcionar no DisCloud.
> 
> **Alternativas recomendadas:**
> 1. **VPS** (Oracle Cloud Free, DigitalOcean, Vultr) - Recomendado
> 2. **Heroku** com buildpack de Chrome
> 3. **Railway** com Docker

## 🐳 Deploy em VPS (Recomendado)

```bash
# Clone o repositório
git clone https://github.com/kaiosilva24/WPP-SISTEM.git
cd WPP-SISTEM

# Instale dependências
cd backend && npm install
cd ../frontend && npm install && npm run build
cd ..

# Configure variáveis
cp .env.example .env
nano .env  # Edite conforme necessário

# Inicie
cd backend && npm start
```

## 📁 Estrutura do Projeto

```
WPP-SISTEM/
├── backend/           # API Node.js + Socket.IO
│   ├── src/
│   │   ├── api/       # Rotas REST
│   │   ├── services/  # WhatsApp Session, Message Handler
│   │   ├── web/       # Express Server
│   │   └── utils/     # Logger, helpers
│   └── package.json
├── frontend/          # React + Vite
│   ├── src/
│   ├── dist/          # Build de produção
│   └── package.json
├── data/              # Dados persistentes
├── discloud.config    # Configuração DisCloud
└── docker-compose.yml # Deploy Docker
```
