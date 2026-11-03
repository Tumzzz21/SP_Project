@echo off
taskkill /F /IM node.exe >nul 2>&1
taskkill /F /IM cloudflared.exe >nul 2>&1
echo CyberSafe stopped (server and public tunnel).
echo Tip: start.bat runs "npm run dev", so saving a route file restarts the server.