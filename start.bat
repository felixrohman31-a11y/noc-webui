@echo off
title NOC Control Center
cd /d "%~dp0"
echo ============================================
echo   NOC Control Center - starting...
echo   Web UI : http://localhost:3000
echo   Stop   : tekan Ctrl+C di jendela ini
echo ============================================
if not exist "node_modules" (
  echo Installing dependencies...
  call npm install || goto :error
)
if not exist "dist" (
  echo Building frontend...
  call npm run build || goto :error
)
start "" http://localhost:3000
call npm start
goto :eof
:error
echo.
echo [ERROR] Gagal menjalankan. Pastikan Node.js sudah ter-install (node -v).
pause
