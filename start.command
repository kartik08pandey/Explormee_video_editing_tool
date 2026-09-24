#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "======================================================="
echo "       LOCAL VIDEO EDITOR - 1-CLICK LAUNCHER (macOS)   "
echo "======================================================="
echo ""

# Ensure bin directory exists and is in PATH
mkdir -p bin
export PATH="$PWD/bin:$PATH"

# 1. Check Python 3
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] Python 3 was not detected on your Mac."
    echo "Please install Python 3 from: https://www.python.org/downloads/"
    echo "Or install via Homebrew: brew install python"
    echo ""
    read -p "Press Enter to exit..."
    exit 1
fi

# 2. Auto-update from GitHub if Git is available
if command -v git &> /dev/null && [ -d ".git" ]; then
    echo "[1/4] Checking for latest updates from GitHub..."
    if git fetch origin main 2>/dev/null; then
        git reset --hard origin/main 2>/dev/null || true
        echo "  [OK] Synced to latest version."
    else
        echo "  [!] Could not reach GitHub. Running local version."
    fi
    echo ""
fi

# 3. Ensure FFmpeg is available (Auto-Download for macOS if missing)
if ! command -v ffmpeg &> /dev/null || ! command -v ffprobe &> /dev/null; then
    echo "[2/4] FFmpeg was not detected on your Mac."
    echo "Starting automatic one-time download for macOS (Zero setup required)..."
    
    if [ ! -f "bin/ffmpeg" ]; then
        echo "  -> Downloading macOS FFmpeg binary (~40MB)..."
        curl -f -L "https://evermeet.cx/ffmpeg/getrelease/zip" -o "bin/ffmpeg.zip" --progress-bar
        unzip -o -q "bin/ffmpeg.zip" -d "bin"
        rm -f "bin/ffmpeg.zip"
    fi

    if [ ! -f "bin/ffprobe" ]; then
        echo "  -> Downloading macOS FFprobe binary (~25MB)..."
        curl -f -L "https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip" -o "bin/ffprobe.zip" --progress-bar
        unzip -o -q "bin/ffprobe.zip" -d "bin"
        rm -f "bin/ffprobe.zip"
    fi

    # Set executable permissions and clear macOS quarantine flags
    chmod +x bin/ffmpeg bin/ffprobe 2>/dev/null || true
    xattr -d com.apple.quarantine bin/ffmpeg bin/ffprobe 2>/dev/null || true
    echo "  [OK] FFmpeg and FFprobe successfully installed in bin/!"
    echo ""
else
    echo "[2/4] FFmpeg is ready."
fi

# 4. Setup / Verify Virtual Environment & Dependencies
VENV_PY="./venv/bin/python"
VENV_PIP="./venv/bin/pip"

if [ ! -f "$VENV_PY" ]; then
    echo "[3/4] Creating Python virtual environment (first-time setup)..."
    python3 -m venv venv
fi

# Verify if Flask and Werkzeug are installed and runnable in the venv
if ! "$VENV_PY" -c "import flask, werkzeug" &> /dev/null; then
    echo "[3/4] Installing / repairing dependencies in virtual environment..."
    "$VENV_PIP" install --upgrade pip --quiet 2>/dev/null || true
    "$VENV_PIP" install -r requirements.txt
    echo "  [OK] Dependencies installed successfully!"
    echo ""
else
    echo "[3/4] Python environment is ready."
    echo ""
fi

# 5. Launch Video Editor & Auto-Open Browser
echo "[4/4] Starting Video Editor Server..."
echo "Opening http://127.0.0.1:5050 in your web browser..."
echo ""
echo "Press Ctrl+C in this Terminal window anytime to stop the editor."
echo "======================================================="
echo ""

# Open default browser after 2 seconds
(sleep 2 && open "http://127.0.0.1:5050") &

# Start Flask using the virtual environment python directly
exec "$VENV_PY" app.py

