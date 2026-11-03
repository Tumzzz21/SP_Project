@echo off
setlocal
cd /d "%~dp0"

rem --- Port: read from .env so app, tunnel and printed URLs agree ----------
set "APPPORT=3001"
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if /i "%%A"=="PORT" set "APPPORT=%%B"
  )
)

rem --- Node: bundled runtime first (USB), then an installed Node ----------
set "NODE=%~dp0runtime\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" --version >nul 2>&1
if errorlevel 1 (
  echo.
  echo Node.js was not found.
  echo Expected runtime\node.exe next to this script, or Node.js installed here.
  pause
  goto :done
)

rem --- App window (cmd /k keeps crash messages readable) -------------------
start "CyberSafe" cmd /k ""%NODE%" src\server.js"

echo Starting CyberSafe on http://localhost:%APPPORT%
echo Waiting for the server before opening the public tunnel...
ping -n 5 127.0.0.1 >nul

rem --- cloudflared: bundled first, then PATH and usual install folders ----
set "CF="
if exist "%~dp0tools\cloudflared.exe" set "CF=%~dp0tools\cloudflared.exe"
if not defined CF if exist "%~dp0cloudflared.exe" set "CF=%~dp0cloudflared.exe"
if not defined CF for %%P in (cloudflared.exe) do set "CF=%%~$PATH:P"
if not defined CF if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" set "CF=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
if not defined CF if exist "%ProgramFiles%\cloudflared\cloudflared.exe" set "CF=%ProgramFiles%\cloudflared\cloudflared.exe"
if not defined CF if exist "%LOCALAPPDATA%\cloudflared\cloudflared.exe" set "CF=%LOCALAPPDATA%\cloudflared\cloudflared.exe"

if not defined CF (
  echo.
  echo cloudflared not found - running locally only.
  echo Put cloudflared.exe in tools\ for a public link.
  echo.
  echo Local demo URL: http://localhost:%APPPORT%
  goto :done
)

echo.
echo Opening a public Cloudflare Quick Tunnel.
echo Copy the https://....trycloudflare.com URL from the "CyberSafe Tunnel" window.
start "CyberSafe Tunnel" cmd /k ""%CF%" tunnel --url http://localhost:%APPPORT%"
echo.
echo Local demo URL:  http://localhost:%APPPORT%
echo Public URL:      shown in the "CyberSafe Tunnel" window

:done
endlocal