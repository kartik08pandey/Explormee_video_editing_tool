# Local Video Editor

A browser-based video editor that runs entirely on your own machine. A small Flask server drives **FFmpeg** to cut, trim, merge, crop, re-time and extract audio from your videos. Nothing is uploaded to a third-party service.

> Powered by Python, Flask and FFmpeg. Frontend is plain HTML/CSS/vanilla JavaScript (no build step).

## Features

| Area | What it does |
| --- | --- |
| **Generate clips** | Paste timestamp ranges (`00:10 - 00:25`, `01:15 to 01:45`, …) and get one re-encoded clip per range. Optional custom names. |
| **Multi-timeline workspace** | Clips land on a timeline. Create several timelines, drag clips to reorder them, or move them between timelines. |
| **Interactive trim** | Drag the handles on a clip card to re-trim it against the original source video, with live scrub preview. |
| **Razor split** | Drop multiple cut markers on a clip and split it into several clips in one go. |
| **Duplicate / rename / delete** | Per-clip card actions, kept in sync with the files on disk. |
| **Merge** | *Only Merge* concatenates a timeline at its original size. *Merge + Crop* produces a 1080×1920 (9:16) vertical video by stacking the two halves of a 16:9 source. |
| **Crop** | Visual crop box over the player with aspect-ratio presets (1:1, 16:9, 9:16, 4:3, 3:4) or exact X/Y/W/H input. |
| **Speed control** | Re-time the full video, a single clip or a merged video (audio pitch preserved via chained `atempo`). Replace in place or save as a new file. Live preview in the player and cancel support. |
| **Extract audio** | MP3, WAV, AAC, M4A, FLAC or OGG, with bitrate and sample-rate options. |
| **Undo / Redo** | Up to 30 timeline states, with toolbar buttons and keyboard shortcuts. |
| **Project persistence** | The workspace (clips, timelines, crop settings) survives page refreshes and is validated against files on disk. |
| **Background jobs** | Long FFmpeg jobs run in a worker pool with real-time progress and cancellation. |
| **Upload progress** | Live percentage, speed and ETA, cancellable. |
| **Dark mode** | Follows the system preference, can be toggled with `Alt+T`, and is remembered. |

## Quick start

### Windows

Double-click **`start.bat`**. It will:

1. Use the bundled `bin\ffmpeg.exe` if present (otherwise looks for FFmpeg on `PATH`).
2. Run `git pull origin main` if Git is installed and the folder is a clone.
3. Pick a Python: `python_portable\`, then `venv\`, then `video\`, then the system `python` (installing `requirements.txt`).
4. Start the server and open <http://127.0.0.1:5050>.

### macOS

Double-click (or run) **`start.command`**. It will:

1. Require Python 3.
2. Sync to the latest `origin/main` with `git fetch` + `git reset --hard` (see the warning below).
3. Download static FFmpeg/FFprobe into `bin/` if they are not installed.
4. Create `venv/`, install dependencies and open <http://127.0.0.1:5050>.

> **Warning:** `start.command` runs `git reset --hard origin/main` on every launch. Any local, uncommitted or unpushed changes to tracked files will be discarded. If you are developing, run the app manually (below) instead.

### Manual / Linux

```bash
# 1. Install FFmpeg (ffmpeg + ffprobe must be on PATH, or placed in ./bin)
#    e.g. sudo apt install ffmpeg   |   brew install ffmpeg

# 2. Create a virtualenv and install dependencies
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt

# 3. Run
python app.py
```

Then open <http://127.0.0.1:5050>. Use the `PORT` environment variable to change the port:

```bash
PORT=8080 python app.py
```

## Requirements

- Python 3.10+
- Flask >= 2.0.0 and Werkzeug >= 2.0.0 (see [requirements.txt](requirements.txt))
- FFmpeg and FFprobe (on `PATH` or in `./bin`)
- A modern browser

## Supported input formats

`mp4`, `mov`, `avi`, `mkv`, `webm`, `mpeg`, `mpg`, up to **2 GB** per upload. All clip outputs are H.264/AAC `.mp4`.

## Project layout

```
Video editor/
├── app.py                  # Flask server, FFmpeg wrappers, task manager
├── requirements.txt        # Flask, Werkzeug
├── start.bat               # Windows 1-click launcher
├── start.command           # macOS 1-click launcher
├── templates/
│   ├── index.html          # Page shell (Jinja2)
│   └── components/         # Sidebar, player, timeline, modals, audio card…
├── static/
│   ├── css/                # base, sidebar, workspace, crop, timeline, modal, theme
│   └── js/                 # state, upload, crop, timeline, playback, rename,
│                           #   modal, speed, tasks, theme, app
├── outputs/                # Per-session working folders (git-ignored)
├── bin/                    # Optional bundled ffmpeg/ffprobe (git-ignored)
├── python_portable/        # Optional bundled Python (git-ignored)
└── docs/                   # Extended documentation
```

## Documentation

| Document | Contents |
| --- | --- |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | Step-by-step usage, timestamp syntax, shortcuts |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the backend, task system, frontend and persistence fit together |
| [docs/API.md](docs/API.md) | Every HTTP endpoint with request/response shapes |
| [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) | Security notes, limitations and quirks |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Dev setup, conventions, how to add a feature |
| [CHANGELOG.md](CHANGELOG.md) | History of changes |
| [CLAUDE.md](CLAUDE.md) | Guidance for AI coding assistants working in this repo |

## Data and privacy

Everything stays on your computer. Each upload creates `outputs/session_<uuid>/` holding the source video, generated clips, merged/cropped/extracted files and a `session_state.json`. Sessions are deleted only when you click **Start New Project** (or delete the folder yourself), so the folder can grow large over time.

## Security note

The server binds to `0.0.0.0` with Flask's debug mode on and has no authentication. Treat it as a single-user local tool and do not expose it to an untrusted network. Details in [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md).

## License

No license file is included in this repository yet. Add one before redistributing.
