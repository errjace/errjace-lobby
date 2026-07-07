@echo off
title ERRJACE - Avvio completo
cd /d "C:\Users\utente\Documents\New OpenCode Project"
echo Avvio server ERRJACE + Tunnel Cloudflare...
echo.
start "ERRJACE Server" "avvia_server.bat"
timeout /t 3 /nobreak >nul
start "ERRJACE Tunnel" "avvia_tunnel.bat"
exit
