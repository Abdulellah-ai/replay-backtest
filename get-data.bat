@echo off
cd /d "%~dp0"
echo Installing and downloading Dukascopy M1 data (first run only, needs Node.js and internet)...
call npm install
call npm run fetch -- XAUUSD 2026-03-08 2026-11-07
call npm run fetch -- XAUEUR 2026-03-08 2026-11-07
echo Done. Now double-click start.bat
pause
