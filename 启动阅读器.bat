@echo off
cd /d "%~dp0"

set "APP_DIR=%~dp0."
set "ELECTRON_EXE=%~dp0node_modules\electron\dist\electron.exe"

if not exist "%ELECTRON_EXE%" (
  echo [Reader] Installing dependencies for the first run, please wait...
  call npm install
  if errorlevel 1 (
    echo [Reader] npm install failed. Please run "npm install" manually.
    pause
    exit /b 1
  )
)

if not exist "%ELECTRON_EXE%" (
  echo [Reader] Electron not found. Please run "npm install" manually.
  pause
  exit /b 1
)

start "" /d "%~dp0" "%ELECTRON_EXE%" "%APP_DIR%"
exit /b 0
