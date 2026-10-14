# CLAUDE.md

Guidance for AI coding assistants working in this repository.

## What this is

A local, browser-based video editor: Flask backend ([app.py](app.py), ~1,400 lines, single file) that shells out to FFmpeg/FFprobe, plus a vanilla-JS frontend (no bundler, no framework, no tests). Default URL: <http://127.0.0.1:5050>.

## Commands

```bash
pip install -r requirements.txt      # Flask, Werkzeug
python app.py                        # run (debug=True, auto-reload), PORT env var overrides 5050
ffmpeg -version && ffprobe -version  # both must be on PATH or in ./bin
```

There is no test suite, linter or build step. Verify changes by running the app and exercising the feature in a browser (checklist in [CONTRIBUTING.md](CONTRIBUTING.md#testing)).

**Never run `start.command` / `start.bat` to test**: `start.command` does `git reset --hard origin/main` and will destroy uncommitted work; `start.bat` does `git pull`.

## Layout

- `app.py`: routes, task manager (`create_task`, `TASKS`, `ThreadPoolExecutor(2)`), `run_ffmpeg_command`, timestamp parsing, ffprobe metadata.
- `templates/index.html` + `templates/components/*.html`: Jinja2 includes. Sidebar tool cards are in `sidebar.html`; timeline container markup is generated in JS (`renderTimelineContainerHtml`).
- `static/js/*.js`: global-scope scripts loaded in order set in `index.html` (state → upload → crop → timeline → playback → rename → modal → speed → tasks → app).
- `static/css/*.css`: modules `@import`ed by `main.css`; colour tokens in `theme.css`.
- `outputs/session_<uuid>/`: runtime data (git-ignored). `bin/`, `python_portable/`, `video/`, `venv/` are also git-ignored.
- `docs/`: [ARCHITECTURE](docs/ARCHITECTURE.md), [API](docs/API.md), [USER_GUIDE](docs/USER_GUIDE.md), [KNOWN_ISSUES](docs/KNOWN_ISSUES.md).

## Rules that are easy to get wrong

1. **Path safety.** Every `session_id` and filename from a request goes through `secure_filename` before `os.path.join(UPLOAD_FOLDER, f"session_{id}")`. Keep that pattern in new routes.
2. **Long jobs use the task system.** Write `_do_x(..., set_progress=None, register_proc=None)`, call `create_task('x', _do_x, ...)`, return `202 {task_id}`. Run FFmpeg via `run_ffmpeg_command` (progress parsing, stderr draining, cancel via `register_proc`). `/trim-clip` and `/split-clip` are the only synchronous FFmpeg routes.
3. **Atomic overwrites.** Encode to `*_tmp_<hex>.mp4`, then `os.replace` onto the target.
4. **DOM is the timeline model.** Clip cards carry `data-filename`, `data-start`, `data-end`, `data-index`. `serializeWorkspaceState()` reads them; `restoreWorkspace()` rebuilds from state. Changing card markup requires updating both and the `getClipCard()` lookup in [rename.js](static/js/rename.js) (card-scoped, multi-timeline-aware).
5. **History and persistence hooks.** `pushCurrentStateToUndo()` *before* an undoable change; `saveWorkspaceState()` *after* any change that must persist. Skipping either silently breaks undo or refresh-restore.
6. **Multi-timeline.** Many functions take an optional `timelineId`. Do not assume a single `.timeline-container`; ids look like `timeline-1`, `timelineContainer-<id>`.
7. **Theming.** Use CSS variables; avoid hard-coded colours. Many existing inline styles hard-code colours (amber `#f59e0b` for speed/split) and dark panels, which is known debt.
8. **Cache-busting.** Script tags use `?v=4`; bump when changing JS if stale cache is a problem.
9. **Encoding profile.** `libx264 -preset veryfast -crf 22`, AAC 192k, `-pix_fmt yuv420p`. Keep consistent so concat merges work.
10. **Windows-first author.** Paths and launchers target Windows and macOS; use `os.path`, not hard-coded separators.

## Known pitfalls to check before "fixing"

See [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md). Notably: `run_ffmpeg_command` tolerates exit codes 1 and -9; `preserve_pitch` is accepted but unused; the review modal (`modal.js`) is not wired to any UI control; `shiftTimelineClip` is unused; server binds `0.0.0.0` with debug on. Do not change these silently as part of an unrelated task, and flag them if relevant.

## Style

- Python: 4-space indent, snake_case, short docstrings on helpers, JSON errors as `{'error': msg}`.
- JS: camelCase, functions on global scope, `async/await` + `fetch`, console tags like `[Persistence]`.
- Match the surrounding file's style and comment density. Commit messages follow Conventional Commits (`feat(scope): …`, `fix: …`).
- Update [CHANGELOG.md](CHANGELOG.md) and the relevant doc when adding user-visible behaviour or endpoints.
