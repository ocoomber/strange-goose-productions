@echo off
title Strange Goose Productions - local preview
cd /d "%~dp0"
where python >nul 2>nul
if %errorlevel%==0 goto python
where node >nul 2>nul
if %errorlevel%==0 goto node
echo Neither Python nor Node.js was found. Install one of them, then run this again.
pause
exit /b

:python
echo Starting local server at http://localhost:8000  (close the server window to stop)
start "SGP local server" cmd /k "python -m http.server 8000"
timeout /t 2 /nobreak >nul
start "" http://localhost:8000
exit /b

:node
echo Starting local server at http://localhost:8080  (close the server window to stop)
start "SGP local server" cmd /k "npx --yes http-server -p 8080 -c-1"
timeout /t 3 /nobreak >nul
start "" http://localhost:8080
exit /b