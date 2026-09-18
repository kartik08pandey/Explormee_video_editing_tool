@echo off
setlocal enabledelayedexpansion
title Video Editor Launcher
cd /d "%~dp0"

echo =======================================================
echo          LOCAL VIDEO EDITOR - 1-CLICK LAUNCHER        
echo =======================================================
echo.

:: 1. Add bundled FFmpeg to PATH if present
if exist "%~dp0bin\ffmpeg.exe" (
    set "PATH=%~dp0bin;%PATH%"
    echo [OK] Using preconfigured portable FFmpeg.
) else (
    where ffmpeg >nul 2>&1
    if %ERRORLEVEL% NEQ 0 (
        echo [WARNING] FFmpeg was not found in bin\ or system PATH!
        echo Video clipping and merging will require FFmpeg.
        echo.
    )
)

:: 2. Auto-update from GitHub if Git is available
where git >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    if exist ".git" (
        echo [1/2] Checking for latest updates from GitHub...
        git pull origin main
        echo.
    )
) else (
    echo [INFO] Git is not installed. Skipping automatic updates.
)

:: 3. Select Python Executable (Portable Python first)
if exist "%~dp0python_portable\python.exe" (
    echo [OK] Using preconfigured portable Python (Zero setup required).
    set "PY_CMD=%~dp0python_portable\python.exe"
) else if exist "%~dp0venv\Scripts\python.exe" (
    echo [OK] Using local virtual environment.
    set "PY_CMD=%~dp0venv\Scripts\python.exe"
) else if exist "%~dp0video\Scripts\python.exe" (
    echo [OK] Using local virtual environment.
    set "PY_CMD=%~dp0video\Scripts\python.exe"
) else (
    where python >nul 2>&1
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Python is not detected on your system.
        echo Please install Python 3.10+ or keep the bundled python_portable folder.
        pause
        exit /b 1
    )
    echo [2/2] Checking dependencies...
    pip install -r requirements.txt --quiet
    set "PY_CMD=python"
)

:: 4. Launch Video Editor & Auto-Open Browser
echo.
echo [2/2] Starting Video Editor Server...
echo Opening http://127.0.0.1:5050 in your web browser...
echo.
echo Press Ctrl+C in this window anytime to stop the editor.
echo =======================================================
echo.

:: Launch the browser after 2 seconds
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:5050"

:: Run the application
"%PY_CMD%" app.py

pause

