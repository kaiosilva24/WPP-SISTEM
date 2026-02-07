# 🔧 Configuração de Variáveis de Ambiente - DisCloud

## ⚠️ IMPORTANTE
O bot está rodando mas não consegue conectar ao banco de dados porque as variáveis de ambiente não estão configuradas.

## 📋 Variáveis Necessárias

Configure estas variáveis no Discord do DisCloud usando o comando `.config`:

```
.config set DB_HOST 129.80.149.224
.config set DB_PORT 8080
.config set DB_USER admin
.config set DB_PASS SecurePass_WhatsApp_2026!
.config set DB_NAME whatsapp_warming
.config set WEB_PORT 80
.config set FRONTEND_URL https://wpp-aquecimento.discloud.app
```

## 🔄 Após Configurar

Depois de configurar todas as variáveis, reinicie o bot:

```
.restart wpp
```

## ✅ Verificar Logs

Após reiniciar, verifique os logs:

```
.logs wpp
```

Você deve ver:
```
✅ Banco de dados inicializado com sucesso!
🔗 API rodando em: http://localhost:80
```

## 🌐 Acessar o Sistema

Depois que o bot estiver rodando sem erros:

```
https://wpp.discloud.app
```

## 🔍 Troubleshooting

### Se ainda mostrar erro de conexão ao banco:
1. Verifique se o IP da Oracle (129.80.149.224) está acessível publicamente
2. Confirme que a porta 8080 está aberta no firewall da Oracle
3. Teste a conexão do DisCloud para o banco

### Se mostrar erro de porta:
- DisCloud usa porta 80 automaticamente para aplicações web
- Não precisa mudar nada no código
