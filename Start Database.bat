@echo off
:: Starts ShopLink's own PostgreSQL (port 5433). Run it once after restarting the PC.
set PGBIN=C:\Program Files\PostgreSQL\18\bin
set PGDATA=C:\Users\User\shoplink-pgdata
"%PGBIN%\pg_isready.exe" -h 127.0.0.1 -p 5433 >nul 2>&1
if %errorlevel% equ 0 (
  echo Database is already running.
) else (
  start "" /b "%PGBIN%\pg_ctl.exe" -D "%PGDATA%" -o "-p 5433" -l "%PGDATA%.log" start
  timeout /t 3 >nul
  echo Database started.
)
echo Now run: npm run dev
pause
