@echo off
:: Restarts the PostgreSQL service. Asks for administrator rights (click "Yes").
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
echo Restarting PostgreSQL...
net stop postgresql-x64-18 /y
net start postgresql-x64-18
echo.
echo Done. You can close this window and run: npm run dev
pause
