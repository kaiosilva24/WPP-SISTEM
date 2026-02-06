# 🚀 Guia de Deploy

## Teste Local

### 1. Preparação

Certifique-se de que tudo está funcionando localmente:

```bash
# Instale as dependências
npm install

# Configure o .env
copy .env.example .env
# Edite .env com suas configurações

# Inicie o sistema
npm start
```

### 2. Teste Completo

- [ ] Dashboard abre em http://localhost:3000
- [ ] Todas as contas aparecem no dashboard
- [ ] QR codes são exibidos
- [ ] Consegue autenticar pelo menos 2 contas
- [ ] Mensagens são recebidas e respondidas
- [ ] Delays são variados e naturais
- [ ] Proxies funcionam (IPs diferentes no dashboard)
- [ ] Sistema roda por 1+ hora sem crashes

### 3. Backup das Sessões

Após autenticar as contas, faça backup da pasta `.wwebjs_auth/`:

```bash
# Compacte a pasta
tar -czf sessoes-backup.tar.gz .wwebjs_auth/
```

⚠️ **IMPORTANTE**: Guarde esse backup! Ele contém as sessões autenticadas.

## Deploy no Discloud

### 1. Preparação

O Discloud tem algumas limitações:
- Não suporta navegador headless (Puppeteer)
- Sessões precisam ser re-autenticadas após restart
- Recursos limitados (RAM, CPU)

### 2. Alternativa Recomendada: VPS

Para melhor performance, recomendamos usar uma VPS:

#### Opções de VPS

- **Contabo**: A partir de €4.99/mês
- **DigitalOcean**: A partir de $6/mês
- **Vultr**: A partir de $6/mês
- **Oracle Cloud**: Free tier disponível

#### Setup na VPS

```bash
# 1. Conecte via SSH
ssh root@seu-servidor

# 2. Instale Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. Instale dependências do Chromium
sudo apt-get install -y \
  chromium-browser \
  chromium-codecs-ffmpeg \
  fonts-liberation \
  libappindicator3-1 \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdbus-1-3 \
  libgdk-pixbuf2.0-0 \
  libnspr4 \
  libnss3 \
  libx11-xcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  xdg-utils

# 4. Clone o projeto
git clone <seu-repositorio>
cd AQUECIMENTO

# 5. Instale dependências
npm install

# 6. Configure .env
nano .env
# Cole suas configurações

# 7. Inicie com PM2 (gerenciador de processos)
npm install -g pm2
pm2 start src/index.js --name whatsapp-warming
pm2 save
pm2 startup
```

### 3. Ajustes para Linux

Edite `src/config.js` e ajuste o caminho do navegador:

```javascript
paths: {
  edgeBrowser: "/usr/bin/chromium-browser", // Para Linux
  authFolder: './.wwebjs_auth',
}
```

### 4. Acesso Remoto ao Dashboard

#### Opção 1: Túnel SSH (Desenvolvimento)

```bash
# No seu computador local
ssh -L 3000:localhost:3000 root@seu-servidor
```

Acesse: http://localhost:3000

#### Opção 2: Nginx Reverse Proxy (Produção)

```bash
# Instale Nginx
sudo apt-get install nginx

# Configure
sudo nano /etc/nginx/sites-available/whatsapp-warming
```

Cole:

```nginx
server {
    listen 80;
    server_name seu-dominio.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Ative:

```bash
sudo ln -s /etc/nginx/sites-available/whatsapp-warming /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 5. Segurança

#### Firewall

```bash
# Permita apenas portas necessárias
sudo ufw allow 22    # SSH
sudo ufw allow 80    # HTTP
sudo ufw allow 443   # HTTPS
sudo ufw enable
```

#### Senha no Dashboard

Edite `.env`:

```env
DASHBOARD_PASSWORD=sua-senha-forte
```

### 6. Monitoramento

#### Ver Logs

```bash
# Logs do PM2
pm2 logs whatsapp-warming

# Logs do sistema
tail -f logs/$(date +%Y-%m-%d).log
```

#### Status

```bash
pm2 status
pm2 monit
```

#### Restart

```bash
pm2 restart whatsapp-warming
```

### 7. Backup Automático

Crie um script de backup:

```bash
nano backup.sh
```

Cole:

```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
tar -czf ~/backups/sessoes_$DATE.tar.gz .wwebjs_auth/
# Mantém apenas últimos 7 backups
ls -t ~/backups/sessoes_*.tar.gz | tail -n +8 | xargs rm -f
```

Torne executável e agende:

```bash
chmod +x backup.sh
crontab -e
# Adicione: 0 */6 * * * /root/AQUECIMENTO/backup.sh
```

### 8. Atualização

```bash
# Pare o sistema
pm2 stop whatsapp-warming

# Atualize o código
git pull

# Reinstale dependências
npm install

# Reinicie
pm2 restart whatsapp-warming
```

## Docker (Opcional)

### Dockerfile

Já incluído no projeto. Para usar:

```bash
# Build
docker build -t whatsapp-warming .

# Run
docker run -d \
  --name whatsapp-warming \
  -p 3000:3000 \
  -v $(pwd)/.wwebjs_auth:/app/.wwebjs_auth \
  -v $(pwd)/media:/app/media \
  --env-file .env \
  whatsapp-warming
```

### Docker Compose

```bash
docker-compose up -d
```

## Checklist de Deploy

- [ ] VPS configurada com Node.js 18+
- [ ] Dependências do Chromium instaladas
- [ ] Projeto clonado e dependências instaladas
- [ ] Arquivo `.env` configurado
- [ ] Caminho do navegador ajustado para Linux
- [ ] PM2 instalado e configurado
- [ ] Firewall configurado
- [ ] Nginx configurado (se usando domínio)
- [ ] Backup automático configurado
- [ ] Sistema testado e rodando estável
- [ ] Dashboard acessível remotamente

## Troubleshooting Deploy

### Erro: "Chromium not found"

```bash
# Instale Chromium
sudo apt-get install chromium-browser

# Ou use Chrome
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo dpkg -i google-chrome-stable_current_amd64.deb
sudo apt-get install -f
```

### Erro: "Cannot connect to display"

Adicione variáveis de ambiente:

```bash
export DISPLAY=:99
Xvfb :99 -screen 0 1024x768x24 &
```

### Performance Ruim

- Aumente RAM da VPS (mínimo 2GB recomendado)
- Reduza número de contas simultâneas
- Aumente delays de comportamento humano

### Sessões Perdidas

- Sempre faça backup de `.wwebjs_auth/`
- Use volumes persistentes no Docker
- Configure backup automático

## Custos Estimados

### VPS (Recomendado)

- **Contabo VPS S**: €4.99/mês (4GB RAM, 2 vCPU)
- **DigitalOcean Droplet**: $12/mês (2GB RAM, 1 vCPU)
- **Oracle Cloud Free Tier**: Grátis (1GB RAM, 1 vCPU)

### Proxies

- Proxies residenciais: $5-15/GB
- Proxies datacenter: $1-3/proxy/mês

### Total Mensal

- VPS: €5-12
- Proxies (10 contas): $10-30
- **Total: €15-42/mês**
