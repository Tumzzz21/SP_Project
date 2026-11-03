@echo off
cd /d "%~dp0"
rem --watch restarts the server when a route or db module changes on disk.
start "CyberSafe" cmd /k "npm run dev"
echo CyberSafe starting on http://localhost:3001
