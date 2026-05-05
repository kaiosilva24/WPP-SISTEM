# Script para resetar cache e autenticação WhatsApp
# Execute como administrador

Write-Host "🔴 RESET DE SESSÃO WHATSAPP" -ForegroundColor Red
Write-Host ""

# Parar o servidor se estiver rodando
Write-Host "⏹️  Parando servidor Node.js..." -ForegroundColor Yellow
Get-Process "node" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Limpar cache
$cacheDir = ".\.wwebjs_cache"
$authDir = ".\.wwebjs_auth"

if (Test-Path $cacheDir) {
    Write-Host "🗑️  Removendo cache ($cacheDir)..." -ForegroundColor Cyan
    Remove-Item $cacheDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "✅ Cache removido" -ForegroundColor Green
} else {
    Write-Host "ℹ️  Pasta de cache não encontrada (OK)" -ForegroundColor Gray
}

if (Test-Path $authDir) {
    Write-Host "🗑️  Removendo autenticação ($authDir)..." -ForegroundColor Cyan
    Remove-Item $authDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "✅ Autenticação removida" -ForegroundColor Green
} else {
    Write-Host "ℹ️  Pasta de auth não encontrada (OK)" -ForegroundColor Gray
}

# Aguardar
Write-Host ""
Write-Host "⏳ Aguarde 5 segundos..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Pronto para reiniciar
Write-Host ""
Write-Host "✅ PRONTO PARA REINICIAR!" -ForegroundColor Green
Write-Host ""
Write-Host "Próximo passo:" -ForegroundColor Cyan
Write-Host "1. Execute: npm start" -ForegroundColor White
Write-Host "2. Escaneie o QR code com seu telefone" -ForegroundColor White
Write-Host "3. Aguarde até ver '✅ Pronta: 01'" -ForegroundColor White
Write-Host ""
Write-Host "🚀 Pressione qualquer tecla para fechar..." -ForegroundColor Yellow
$null = Read-Host
