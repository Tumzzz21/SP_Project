@echo off
setlocal
cd /d "%~dp0"

rem Read PORT from .env so the tunnel targets the same port as the app.
set "APPPORT=3001"
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if /i "%%A"=="PORT" set "APPPORT=%%B"
  )
)

rem --watch restarts the server when a route or db module changes on disk.
start "CyberSafe" cmd /k "npm run dev"

echo Starting CyberSafe on http://localhost:%APPPORT%
echo Waiting for the server before opening the public tunnel...
ping -n 5 127.0.0.1 >nul

rem Find cloudflared even when PATH has not refreshed since installation.
set "CF="
for %%P in (cloudflared.exe) do if not defined CF set "CF=%%~$PATH:P"
if not defined CF if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" set "CF=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
if not defined CF if exist "%ProgramFiles%\cloudflared\cloudflared.exe" set "CF=%ProgramFiles%\cloudflared\cloudflared.exe"
if not defined CF if exist "%LOCALAPPDATA%\cloudflared\cloudflared.exe" set "CF=%LOCALAPPDATA%\cloudflared\cloudflared.exe"
if not defined CF if exist "%~dp0cloudflared.exe" set "CF=%~dp0cloudflared.exe"

if not defined CF (
  echo.
  echo cloudflared is not installed, so no public link was created.
  echo Install it once with:  winget install --id Cloudflare.cloudflared -e
  echo Then run start.bat again.
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