@echo off
setlocal enabledelayedexpansion
title Video Editor Launcher
cd /d "%~dp0"

echo =======================================================
echo          LOCAL VIDEO EDITOR - 1-CLICK LAUNCHER        
echo =======================================================
echo.

:: 1. Verify Python is installed
where python >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python is not installed or not added to your system PATH.
    echo.
    echo Please install Python 3.10 or higher from:
    echo https://www.python.org/downloads/
    echo IMPORTANT: Make sure to check the box "Add Python to PATH" during installation.
    echo.
    pause
    exit /b 1
)

:: 2. Auto-update from GitHub if Git is available
where git >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    if exist ".git" (
        echo [1/3] Checking for latest updates from GitHub...
        git pull origin main
        echo.
    )
) else (
    echo [INFO] Git is not installed. Skipping automatic updates.
)

:: 3. Setup / Activate Virtual Environment
if exist "venv\Scripts\activate.bat" (
    call venv\Scripts\activate.bat
) else if exist "video\Scripts\activate.bat" (
    call video\Scripts\activate.bat
) else (
    echo [2/3] Setting up Python environment (first-time setup, please wait)...
    python -m venv venv
    call venv\Scripts\activate.bat
    echo Installing dependencies...
    pip install -r requirements.txt
    echo Setup complete!
    echo.
)

:: 4. Verify FFmpeg is accessible
where ffmpeg >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [WARNING] FFmpeg is not detected on your system PATH!
    echo Video clipping and merging will require FFmpeg.
    echo Download it from: https://ffmpeg.org/download.html
    echo.
)

:: 5. Launch Video Editor & Open Browser
echo [3/3] Starting Video Editor Server...
echo Opening http://localhost:5000 in your web browser...
echo.
echo Press Ctrl+C in this window anytime to stop the editor.
echo =======================================================
echo.

:: Give the server a second to initialize, then launch the browser
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:5000"

:: Start the Flask app
python app.py

pause
