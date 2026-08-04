@echo off
setlocal
title Noon Report
cd /d "%~dp0"

REM Prefer installed app copy when this bat lives in install\pc\
set "APPDIR=%~dp0"
if exist "%LOCALAPPDATA%\NoonReport\app\voyage_manager.html" (
  if not exist "%~dp0voyage_manager.html" set "APPDIR=%LOCALAPPDATA%\NoonReport\app"
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-NoonReport.ps1" -AppDir "%APPDIR%"
if errorlevel 1 (
  echo.
  echo Noon Report failed to start. Ensure PowerShell is available.
  pause
)
endlocal
