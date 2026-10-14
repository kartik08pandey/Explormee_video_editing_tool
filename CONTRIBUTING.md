# Contributing

Thanks for helping improve the Local Video Editor. This is a small project with no build tooling, so setup is quick.

## Development setup

```bash
git clone https://github.com/kartik08pandey/Explormee_video_editing_tool.git
cd Explormee_video_editing_tool

python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

# ffmpeg and ffprobe must be on PATH or in ./bin
python app.py                   # http://127.0.0.1:5050
```

`app.py` runs with `debug=True`, so Python changes reload the server and templates auto-reload. For JS/CSS changes bump the `?v=` query string in [templates/index.html](templates/index.html) if the browser caches stale files (the server already sends `no-store` headers, so a hard refresh is usually enough).

> Do **not** develop through `start.command`: it runs `git reset --hard origin/main` and will wipe your work. Use `python app.py` directly.

## Project conventions

### Backend ([app.py](app.py))

- Validate input at the route, return `jsonify({'error': …}), <status>`.
- Wrap every client-supplied path component in `secure_filename` and join it onto the session directory. Never trust paths from the client.
- Anything that can take more than a second or two belongs in a task: write a `_do_<thing>(…, set_progress=None, register_proc=None)` function and call `create_task('<type>', _do_<thing>, …)`; return `202` with `task_id`.
- Run FFmpeg through `run_ffmpeg_command` so progress, cancellation and stderr draining work. Pass `total_duration` (the expected *output* duration) to get percentages.
- Write results to a temp file and `os.replace` into place when overwriting an existing file.
- Use the standard encoding profile (`libx264 -preset veryfast -crf 22`, AAC 192k, `yuv420p`) for consistency with merges.

### Frontend

- Scripts are plain globals loaded in the order set in `index.html`. If a new file depends on another, place it after it.
- Reuse `showStatus(elementId, type, message)` (types: `info`, `success`, `error`, `warning`) and `pollTask()` rather than writing new polling code.
- Timeline state lives in the DOM (`data-filename`, `data-start`, `data-end`, `data-index` on `.timeline-clip-card`). If you change a card's markup, keep those attributes and update `serializeWorkspaceState()` / `restoreWorkspace()` if needed.
- Call `pushCurrentStateToUndo()` **before** a mutation that should be undoable and `saveWorkspaceState()` **after** any change that should persist.
- Style with the CSS variables in [theme.css](static/css/theme.css) so both themes work; avoid hard-coded colours in new code. New stylesheets must be `@import`ed in [main.css](static/css/main.css).
- UI markup belongs in `templates/components/` (Jinja2 includes), not in `index.html`.

### Commit messages

The history follows [Conventional Commits](https://www.conventionalcommits.org/) in most cases:

```
feat(speed): add video speed control with cancel support
fix(launcher): use fetch+reset instead of pull
chore: remove clip index badge numbering
```

Keep one logical change per commit.

## Adding a new tool (checklist)

1. **Backend** – add `POST /<tool>` in `app.py` plus a `_do_<tool>` worker; register progress; return a result dict.
2. **Template** – add a card in `templates/components/sidebar.html` (class `tools-section`, so it is shown/hidden with the workspace) and status/output containers with ids.
3. **Frontend** – extend the `config` map in `processTask()` in [tasks.js](static/js/tasks.js) (button id, status id, output id, body builder) or write a dedicated module as `speed.js` does.
4. **Persistence** – if the tool has state worth restoring, add it to `serializeWorkspaceState()` and `restoreWorkspace()`.
5. **Docs** – update [docs/API.md](docs/API.md), [docs/USER_GUIDE.md](docs/USER_GUIDE.md) and [CHANGELOG.md](CHANGELOG.md).

## Testing

There is no automated test suite yet. Before opening a PR, run through this manual checklist with a short video that has audio and one without:

- [ ] Upload (drag-drop and button); cancel mid-upload.
- [ ] Generate clips with ranges, a named range (`| name`), and a bare duration.
- [ ] Trim both handles on a clip; reload the page and confirm the state restores.
- [ ] Split a clip with 2+ markers; duplicate; rename (with a clashing name); delete.
- [ ] Create a second timeline and drag a clip across; Undo / Redo (`Ctrl+Z`, `Ctrl+Y`).
- [ ] Merge and Merge + Crop; confirm the 1080×1920 output and the progress bar.
- [ ] Crop with each aspect ratio preset.
- [ ] Speed: preview, apply as new, apply in place, cancel mid-encode, silent video.
- [ ] Extract audio in several formats; confirm the error for a silent video.
- [ ] Toggle dark mode (`Alt+T`), reload.
- [ ] Start New Project removes `outputs/session_*`.

If you add automated tests, `pytest` with Flask's test client is a good fit for the validation helpers (`parse_clip_segments`, `parse_time_str`) and route error paths; mock `subprocess` for FFmpeg.

## Reporting issues

Include: OS, Python version, `ffmpeg -version` first line, the source file's codec/resolution (from the metadata table), the steps taken, and the terminal output from the server. Check [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) first.
