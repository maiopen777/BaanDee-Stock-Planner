@echo off
cd /d "%~dp0"
set "PLANNER_NODE=node"
where node >nul 2>nul
if errorlevel 1 set "PLANNER_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
set "N8N_WEBHOOK_URL="
start "" "http://127.0.0.1:8787"
"%PLANNER_NODE%" src/server.mjs
pause
