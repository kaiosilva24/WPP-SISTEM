# 🔴 IMPORTANTE: Reset de Sessão WhatsApp

## Problema
A conta está entrando em loop de desconexão porque há **múltiplas instâncias tentando usar a mesma conta WhatsApp simultaneamente**.

## Solução:

### 1️⃣ PARAR TODAS AS INSTÂNCIAS
```bash
# Local
npm stop
# ou Ctrl+C no terminal

# Discloud
# Vá ao painel Discloud e pause a aplicação
```

### 2️⃣ LIMPAR CACHE DE AUTENTICAÇÃO
```bash
# Windows
rmdir /s /q ".\.wwebjs_cache"
rmdir /s /q ".\.wwebjs_auth"

# Ou manualmente:
# - Delete as pastas .wwebjs_cache e .wwebjs_auth
```

### 3️⃣ RESETAR BANCO DE DADOS (opcional, se necessário)
Se o problema persistir, rode o reset de pausas no banco:
```sql
UPDATE dispatch_contacts SET pause_until = NULL WHERE pause_until IS NOT NULL;
```

### 4️⃣ REINICIAR APENAS UMA INSTÂNCIA
Escolha: usar LOCAL ou DISCLOUD, NÃO AMBOS
```bash
# Apenas Local:
npm start

# Ou apenas Discloud:
# Vá ao painel Discloud e inicie
```

### 5️⃣ RESCANEAR QR CODE
- Uma tela de QR code aparecerá
- Escaneie com o seu telefone
- Aguarde a sincronização completa

## ✅ Verificar Status
```bash
# Veja os logs:
# Local: npm start (mostra logs no terminal)
# Discloud: Painel → Logs

# Aguarde até ver: "✅ Pronta: 01" + "Pronto para receber novas mensagens"
```

## ⚠️ Dicas Importantes
1. **Não rode local + Discloud simultaneamente** - Use apenas um
2. **Aguarde 30 segundos** após limpar cache antes de reiniciar
3. **Verifique se nenhuma outra aba/janela tem a conta aberta**
4. Se o WhatsApp pedir confirmação no telefone, confirme

---
Depois que estiver estável, o sistema responderá automaticamente novamente! 🚀
