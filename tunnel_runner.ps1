$logFile = "$env:TEMP\errjace_tunnel.log"
$errFile = "$env:TEMP\errjace_tunnel_err.log"
$projectDir = "C:\Users\utente\Documents\New OpenCode Project"

Write-Host "Avvio tunnel Cloudflare..." -ForegroundColor Cyan

$p = Start-Process -FilePath "$projectDir\cloudflared.exe" `
    -ArgumentList "tunnel --url http://localhost:3000" `
    -NoNewWindow -RedirectStandardOutput $logFile -RedirectStandardError $errFile -PassThru

$url = $null
for ($i = 0; $i -lt 40; $i++) {
    $files = @($logFile, $errFile) | Where-Object { Test-Path $_ }
    foreach ($f in $files) {
        $content = Get-Content -Path $f -Raw -ErrorAction SilentlyContinue
        if ($content -match '(https://[a-z0-9-]+\.trycloudflare\.com)') {
            $url = $matches[1]
            break
        }
    }
    if ($url) { break }
    Start-Sleep -Milliseconds 500
}

Clear-Host

if ($url) {
    Write-Host "============================================================" -ForegroundColor Magenta
    Write-Host "                    TUNNEL ATTIVO!" -ForegroundColor Magenta
    Write-Host "============================================================" -ForegroundColor Magenta
    Write-Host ""
    Write-Host "  LINK: $url" -ForegroundColor White
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Magenta
    Write-Host "  Copia il link qui sopra e mandalo ai tuoi amici!" -ForegroundColor Cyan
    Write-Host "  Premi CTRL+C per fermare il tunnel" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Magenta
} else {
    Write-Host "ERRORE: Impossibile ottenere il link da Cloudflare." -ForegroundColor Red
}

Write-Host ""
Write-Host "LOG DEL TUNNEL:" -ForegroundColor DarkGray
Write-Host "---------------" -ForegroundColor DarkGray

$allLogs = @($logFile, $errFile) | Where-Object { Test-Path $_ }
foreach ($lf in $allLogs) {
    Get-Content $lf -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ -ForegroundColor DarkGray }
}

$p.WaitForExit()
