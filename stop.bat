@echo off
taskkill /F /IM node.exe >nul 2>&1
echo CyberSafe stopped.
echo Tip: start.bat runs "npm run dev", so saving a route file restarts the server.
