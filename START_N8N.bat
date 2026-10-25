@echo off
cd /d "%~dp0"
set "PLANNER_NODE=node"
where node >nul 2>nul
if errorlevel 1 set "PLANNER_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
set "PLANNER_ENV=.env.local"
if not exist "%PLANNER_ENV%" set "PLANNER_ENV=var\runtime.env"
if not exist "%PLANNER_ENV%" (
  echo Configure .env.local using .env.example first. See docs/N8N_SETUP.md
  pause
  exit /b 1
)
start "" "http://127.0.0.1:8787"
"%PLANNER_NODE%" --env-file="%PLANNER_ENV%" src/server.mjs
pause
