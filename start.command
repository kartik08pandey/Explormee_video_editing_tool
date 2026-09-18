#!/bin/bash
cd "$(dirname "$0")"

echo "======================================================="
echo "       LOCAL VIDEO EDITOR - 1-CLICK LAUNCHER (macOS)   "
echo "======================================================="
echo ""

# 1. Check Python 3
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] Python 3 was not detected on your Mac."
    echo "Please install Python 3 from https://www.python.org/downloads/"
    echo "or install it via Homebrew: brew install python"
    read -p "Press Enter to exit..."
    exit 1
fi

# 2. Auto-update from GitHub if Git is available
if command -v git &> /dev/null && [ -d ".git" ]; then
    echo "[1/3] Checking for latest updates from GitHub..."
    git pull origin main
    echo ""
fi

# 3. Check FFmpeg
if ! command -v ffmpeg &> /dev/null; then
    echo "[WARNING] FFmpeg was not detected on your Mac!"
    if command -v brew &> /dev/null; then
        echo "Installing FFmpeg via Homebrew automatically..."
        brew install ffmpeg
    else
        echo "Please install FFmpeg by opening Terminal and running:"
        echo "  brew install ffmpeg"
        echo "Or download standalone binary from: https://evermeet.cx/ffmpeg/"
        echo ""
    fi
fi

# 4. Setup / Activate Virtual Environment
if [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
else
    echo "[2/3] Setting up Python environment (first-time setup, please wait)..."
    python3 -m venv venv
    source venv/bin/activate
    echo "Installing required dependencies..."
    pip install -r requirements.txt
    echo "Setup complete!"
    echo ""
fi

# 5. Launch Video Editor & Auto-Open Browser
echo "[3/3] Starting Video Editor Server..."
echo "Opening http://localhost:5000 in your web browser..."
echo ""
echo "Press Ctrl+C in this window anytime to stop the editor."
echo "======================================================="
echo ""

# Open default browser after 2 seconds
(sleep 2 && open "http://localhost:5000") &

# Start Flask
python3 app.py
