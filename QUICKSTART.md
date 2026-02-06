# 🚀 Guia Rápido - Sistema Funcionando!

## ✅ Servidores Rodando

- **Backend**: http://localhost:3000 (API + WhatsApp)
- **Frontend**: http://localhost:5173 (Interface React)

## 📱 Como Usar

### 1. Acessar o Sistema

Abra seu navegador em: **http://localhost:5173**

### 2. Criar Primeira Conta

1. Clique no botão **"➕ Nova Conta"**
2. Digite um nome (ex: "Conta 01", "Vendas", "Suporte")
3. Clique em **"Criar Conta"**
4. A conta aparecerá no dashboard

### 3. Iniciar Conta

1. Clique no botão **"Iniciar"** da conta
2. Aguarde o QR Code aparecer (15-30 segundos)
3. Abra o WhatsApp no celular
4. Vá em **Aparelhos Conectados** > **Conectar um aparelho**
5. Escaneie o QR Code
6. Status mudará para **"✅ Conectado"**

### 4. Configurar Conta (Opcional)

Clique no botão **"⚙️ Configurar"** para:

#### Tab Proxy
- Ativar/desativar proxy
- IP: `192.168.1.1`
- Porta: `8080`
- Usuário e senha (opcional)

#### Tab Delays
- **Leitura**: 3000-15000ms (tempo para "ler")
- **Digitação**: 5000-20000ms (tempo para "digitar")
- **Resposta**: 10000-30000ms (tempo antes de enviar)
- **Intervalo**: 20000ms (entre mensagens)
- **Ignorar**: 20% (chance de não responder)

#### Tab Mensagens
- Adicione mensagens personalizadas
- Use `{nome}` para incluir o nome do contato
- Tipos:
  - **Primeira Resposta**: Primeira vez que responde
  - **Resposta Subsequente**: Respostas seguintes
  - **Saudação de Grupo**: Para grupos

#### Tab Mídia
- Ativar envio de mídia
- Intervalo: a cada 2 mensagens
- Coloque arquivos em `media/`

## 🔧 Problemas Comuns

### QR Code não aparece
- Aguarde 30 segundos
- Verifique se Edge está instalado
- Veja logs no terminal do backend

### Conta desconecta
- Normal na primeira vez
- Sistema reconecta automaticamente
- Aguarde 30 segundos

### Erro "Conta já existe"
- Use um nome diferente
- Cada conta precisa de nome único

### Frontend não carrega
- Verifique se ambos servidores estão rodando
- Backend: porta 3000
- Frontend: porta 5173

## 📊 Monitoramento

### Estatísticas Globais
- **Total de Contas**: Quantas você criou
- **Contas Ativas**: Quantas estão conectadas
- **Mensagens Enviadas**: Total geral
- **Contatos Únicos**: Total de contatos

### Por Conta
- Mensagens enviadas/recebidas
- Contatos únicos
- Status da conexão
- Proxy configurado

## 🎯 Fluxo Completo

1. **Criar conta** → Nome único
2. **Iniciar conta** → Gera QR code
3. **Escanear QR** → Conecta WhatsApp
4. **Configurar** (opcional) → Proxy, delays, mensagens
5. **Monitorar** → Dashboard em tempo real
6. **Responder** → Automático com comportamento humano

## 💡 Dicas

- Comece com 1-2 contas para testar
- Configure proxies diferentes para cada conta
- Varie os delays entre contas
- Adicione várias mensagens personalizadas
- Monitore as estatísticas regularmente

## 🛑 Parar Sistema

**Terminal do Backend** (Ctrl+C):
```
Encerrando sistema...
✅ Sistema encerrado com sucesso!
```

**Terminal do Frontend** (Ctrl+C):
```
Vite dev server encerrado
```

## 🔄 Reiniciar

### Backend:
```bash
cd backend
npm start
```

### Frontend:
```bash
cd frontend
npm run dev
```

---

**Sistema 100% funcional!** 🔥

Acesse: http://localhost:5173
