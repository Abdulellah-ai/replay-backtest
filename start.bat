@echo off
cd /d "%~dp0"
echo Press Ctrl+C in this window to stop the server.
start "" http://localhost:8770/index.html
python -m http.server 8770 --directory .
