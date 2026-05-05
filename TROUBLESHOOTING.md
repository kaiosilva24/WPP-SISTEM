# 🔧 TROUBLESHOOTING - Sistema Não Responde

## ✅ Checklist Rápido

### 1️⃣ Verificar Conexão
- [ ] Status da conta é **CONECTADO** ✅?
- [ ] Vê "Pronto para receber novas mensagens" nos logs?
- [ ] Dashboard mostra conta em verde?

### 2️⃣ Verificar Configuração da Campanha
**No Dashboard → Campanhas:**
- [ ] Campanha existe e está **ATIVA**?
- [ ] Abra a campanha e verifique:
  - [ ] Aba **RESPOSTAS** tem textos salvos?
  - [ ] Checkbox **AUTO-RESPONDER** está ✓ ATIVADO?
  - [ ] Campo **Pausa após resposta** está configurado?

### 3️⃣ Verificar Contatos
**Dashboard → Campanha → Contatos:**
- [ ] Existem contatos em **PENDING** (aguardando envio)?
- [ ] Ou estão todos em **REPLIED** (já responderam)?
- [ ] Se tudo está em REPLIED, rode o reset:
  ```
  POST /api/dispatch/reset-pauses
  ```

### 4️⃣ Verificar Banco de Dados
Se nenhum contato está em PENDING:
```sql
-- Ver quantos contatos por status
SELECT status, COUNT(*) FROM dispatch_contacts GROUP BY status;

-- Ver pausas ativas
SELECT id, phone, pause_until FROM dispatch_contacts WHERE pause_until > now();

-- Limpar todas as pausas (última opção)
UPDATE dispatch_contacts SET pause_until = NULL;
```

### 5️⃣ Logs de Erro
**Discloud → Logs:**
- [ ] Procure por **ERROR** ou **Falha**
- [ ] Veja se há erro ao processar mensagens
- [ ] Procure por nome da campanha nos logs

---

## 🆘 Problemas Comuns

### Problema: "Conta desconecta constantemente"
**Solução:**
```powershell
# Discloud → Painel
# 1. Clique em "Restart"
# 2. Aguarde 2 minutos
# 3. Verifique status nos logs
```

### Problema: "Nenhuma mensagem de resposta no log"
**Verificar:**
1. Há textos de **resposta** (reply) configurados?
2. Auto-responder está **ATIVADO**?
3. Contatos estão em status **PENDING**?

### Problema: "Status diz CONECTADO mas não recebe mensagens"
**Solução:**
1. Abra o emulador
2. Mande uma mensagem manualmente
3. Veja se aparece no log (procure por seu número)
4. Se não aparecer, sessão está quebrada → Restart

### Problema: "Enviadas=0, Recebidas=0"
**Solução:**
1. Campanha não tem contatos atribuídos
2. OU estão TODOS em REPLIED/PAUSED
3. Execute o reset de pausas:
   ```
   POST http://discloud-api/api/dispatch/reset-pauses
   ```

---

## 📋 Verificação Final

Antes de dizer "sistema está OK":
- ✅ Conta mostra CONECTADO
- ✅ Enviou pelo menos 1 mensagem
- ✅ Recebeu resposta manual (pelo emulador)
- ✅ Respondeu automaticamente
- ✅ Logs não mostram ERROR

---

## 💬 Debug via Logs

**Procure por estas linhas nos logs:**

```
✅ OK - Vendo isso:
[INFO] Pronto para receber novas mensagens (Baileys)
[INFO] Disparo enviado para: NUMERO
[INFO] Resposta automática enviada

❌ PROBLEMA - Se vendo isso:
[ERROR] Falha ao enviar mensagem
[WARN] Contato em pausa até...
[ERROR] Desconectado
```

---

## 🚀 Próximos Passos

1. **Responda o checklist acima**
2. **Se tudo está marcado**: Sistema deve estar OK! 
3. **Se algo não está**: Entre em contato com seus logs prontos

