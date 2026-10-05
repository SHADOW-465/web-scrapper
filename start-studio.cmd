@echo off
cd /d "%~dp0"
node node_modules\next\dist\bin\next dev --port 3005
pause
