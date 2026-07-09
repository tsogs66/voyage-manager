@echo off
setlocal

echo ===========================================
echo Voyage Manager - Windows Launcher
echo ===========================================
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python is not installed or not on PATH.
  echo Install Python 3.11+ from https://www.python.org/downloads/windows/
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo [INFO] Creating virtual environment...
  python -m venv .venv
  if errorlevel 1 (
    echo [ERROR] Failed to create virtual environment.
    pause
    exit /b 1
  )
)

echo [INFO] Installing/updating dependencies...
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
  echo [ERROR] Failed to install dependencies.
  pause
  exit /b 1
)

echo [INFO] Opening browser at http://127.0.0.1:5000
start "" http://127.0.0.1:5000

echo [INFO] Starting web server...
echo Press Ctrl+C in this window to stop the server.
echo.
".venv\Scripts\python.exe" app.py

endlocal
