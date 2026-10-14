# Architecture

Local Video Editor is a single-process Flask application plus a vanilla-JS single page. All media work is delegated to the `ffmpeg` / `ffprobe` command-line tools.

```
┌──────────────────────────── Browser ────────────────────────────┐
│ index.html (Jinja2 includes)                                    │
│  state.js → upload.js → crop.js → timeline.js → playback.js     │
│  → rename.js → modal.js → speed.js → tasks.js → app.js          │
│  (global scope, no bundler/modules)                             │
│  localStorage: workspace cache + theme                          │
└───────────────▲─────────────────────────────┬───────────────────┘
                │ JSON / media streams        │ fetch / XHR
┌───────────────┴─────────────────────────────▼───────────────────┐
│ Flask app.py (port 5050)                                        │
│  routes ─► validation ─► create_task() ─► ThreadPoolExecutor(2) │
│                                         └► run_ffmpeg_command() │
│                                                 │ subprocess    │
└─────────────────────────────────────────────────▼───────────────┘
                         ffmpeg / ffprobe  ──►  outputs/session_<uuid>/
```

## Backend ([app.py](../app.py))

The whole backend is one file.

### Sessions and storage

- `POST /upload` creates `outputs/session_<uuid4>/` and stores the source file there (`secure_filename`). The UUID is the only "identity"; there are no users or accounts.
- Every derived file (clips, merged, cropped, extracted audio, temp files, `concat_list.txt`, `session_state.json`) lives in that same flat folder.
- Every route that touches the filesystem passes `session_id` and filenames through `werkzeug.utils.secure_filename` before joining paths.
- `bin/` is prepended to `PATH` at import time so a bundled FFmpeg is used.

### Background task manager

Heavy jobs (split/generate, merge, crop, extract-audio, change-speed) are submitted with `create_task()`:

- A `ThreadPoolExecutor(max_workers=2)` runs jobs; further jobs wait in `queued`.
- `TASKS` (dict) guarded by `TASKS_LOCK` holds per-task state: `status` (`queued → processing → completed | failed | cancelled`), `progress` (0–100), `message`, `result`, `error`, timestamps and a private `_proc` handle.
- Each target function receives `set_progress` and `register_proc` callbacks. `register_proc` stores the live `Popen` so `cancel_task()` can `kill()` it.
- Tasks older than 30 minutes are pruned whenever a new task is created. State is in memory only and is lost on restart.
- The browser polls `GET /tasks/<id>` every 500 ms (`pollTask` in [tasks.js](../static/js/tasks.js)).

### FFmpeg execution

`run_ffmpeg_command(cmd, total_duration, set_progress, register_proc)`:

- Starts FFmpeg with `Popen`. When a duration is known it moves the output path to the end and inserts `-progress pipe:1 -nostats`, then parses `out_time=` lines to compute percent (capped at 99 until `progress=end`).
- A daemon thread drains `stderr` (last 60 lines kept) to avoid pipe deadlocks; the last 20 lines go into the error message on failure.
- Encoding profile used everywhere: `libx264 -preset veryfast -crf 22`, `aac -b:a 192k`, `-pix_fmt yuv420p` (most routes).

Two routes do **not** use the task system and run FFmpeg synchronously inside the request: `POST /trim-clip` and `POST /split-clip`. They write to a temp file (`trim_tmp_*.mp4`, `split_tmp_*.mp4`) and `os.replace` it into place so a failed encode never corrupts an existing clip.

### Timestamp parsing

`parse_clip_segments()` turns the textarea into segments: lines split on commas/newlines, ranges split on `->`, `-`, `–`, `—` or `to`, optional name after `|` or after the end time, and bare durations chained from the previous end. Helpers: `parse_time_str`, `format_timestamp`.

### Metadata

`get_video_metadata()` runs `ffprobe -show_format -show_streams` and returns duration, formatted duration, resolution, FPS, size, and `has_audio` / `has_video`.

### Operations worth knowing

| Operation | FFmpeg approach |
| --- | --- |
| Clip generation | `-ss <start> -i src -t <dur>` (input seeking) + re-encode. |
| Trim | Re-cut from the *original source*, not the existing clip, so extending a trim works. End is clamped to source duration. |
| Split clip | Re-cut each piece from the source when it is available (`start_time + offset`), otherwise from the clip. First piece keeps the original filename. |
| Merge | `-f concat -safe 0` with a generated `concat_list.txt`, re-encoded. |
| Merge + Crop | `filter_complex`: scale/crop to 1920×540, crop left & right 960×540 halves, `vstack` (right on top), scale to 1080×1216, pad to 1080×1920. |
| Crop | `-vf crop=w:h:x:y`, audio `copy`. |
| Speed | Video `setpts=(1/speed)*(PTS-STARTPTS)`; audio chain of `atempo` filters (each 0.5–2.0). Writes to `speed_tmp_*.mp4` then `os.replace`s over the original (*replace*) or to a new `name_<speed>x.mp4` (*new*). |
| Audio extract | `-vn` + codec per format (`libmp3lame`, `pcm_s16le`, `aac`, `flac`, `libvorbis`). |

## Frontend

### Page composition

[templates/index.html](../templates/index.html) includes components from [templates/components/](../templates/components/): `sidebar`, `empty_state`, `video_player`, `timeline`, `audio_card`, `review_modal`, `split_modal`, `trim_tooltip`. CSS is a single entry ([main.css](../static/css/main.css)) that `@import`s the modules. Scripts are plain `<script>` tags loaded in dependency order with a `?v=4` cache-buster; they share the global scope.

### Script responsibilities

| File | Responsibility |
| --- | --- |
| [state.js](../static/js/state.js) | Global variables, helpers, workspace serialisation/restore, undo/redo engine |
| [upload.js](../static/js/upload.js) | Drag-and-drop and `XMLHttpRequest` upload with progress/speed/ETA/cancel |
| [crop.js](../static/js/crop.js) | Crop overlay, handle dragging, aspect-ratio maths in video-pixel coordinates |
| [timeline.js](../static/js/timeline.js) | Multi-timeline rendering, clip cards, drag-and-drop, trim handles, duplicate/delete, split modal |
| [playback.js](../static/js/playback.js) | Sequence playback across clips, solo play, load/restore main player, split at playhead |
| [rename.js](../static/js/rename.js) | Inline rename resolved against the specific card (multi-timeline safe) |
| [modal.js](../static/js/modal.js) | Clip review modal (previous/next, load in workspace) |
| [speed.js](../static/js/speed.js) | Speed tool: target selection (master/clip/merged), presets, preview, submit, cancel |
| [tasks.js](../static/js/tasks.js) | `pollTask`, `mergeClips`, and the generic `processTask` for split/crop/extract-audio |
| [theme.js](../static/js/theme.js) | Light/dark theme, system preference, `Alt+T` |
| [app.js](../static/js/app.js) | Global key handlers and `initApp()` (new-project button, session restore) |

### DOM as source of truth

Timelines are not held in a JS model. Each clip card carries `data-filename`, `data-start`, `data-end` and `data-index`; `serializeWorkspaceState()` reads the DOM to build the state object, and `restoreWorkspace()` rebuilds the DOM from it via `renderTimelineContainerHtml()`. Keep this in mind when changing card markup: persistence and undo depend on those attributes.

### Persistence

1. Any mutation calls `saveWorkspaceState()` (500 ms debounce).
2. State (version 1) is written to `localStorage["video_editor_workspace_state"]` and POSTed to `/session/<id>/save`, which writes `session_state.json`. A sequence counter discards stale responses.
3. On load, `initApp()` reads the cached `session_id`, calls `GET /session/<id>`, and `restoreWorkspace()` filters out clips listed in `missing_clips`. If the server is unreachable it restores from the cache.
4. `beforeunload` flushes a pending save to `localStorage`.

State includes: session id, source filename and metadata, the generate-clips textarea, crop settings, timeline counter, `current_clips`, and each timeline's ordered clips with start/end.

### Undo / redo

`pushCurrentStateToUndo()` snapshots `serializeWorkspaceState()` before a mutating action (deduplicated on timelines + clips, capped at 30). Undo/redo swap snapshots through `restoreWorkspace()`. History is in memory only and is cleared on new project. Note it restores timeline *layout*; it does not undo filesystem changes (a deleted clip file is not brought back).

### Theming

Colour tokens are CSS variables in [theme.css](../static/css/theme.css) (`:root` for light, `[data-theme="dark"]` overrides). An inline script in `<head>` sets `data-theme` before first paint to avoid a flash. Preference key: `video_editor_theme`.

## Launchers

| File | Behaviour |
| --- | --- |
| [start.bat](../start.bat) | Windows. Prefers bundled `bin\ffmpeg.exe` and `python_portable\`, falls back to `venv`, `video`, then system Python. `git pull origin main`, opens the browser after 2 s. |
| [start.command](../start.command) | macOS. Creates `venv`, downloads FFmpeg/FFprobe from evermeet.cx into `bin/` if missing, strips the quarantine flag, `git fetch` + `git reset --hard origin/main`, opens the browser. |

## Design trade-offs

- **No database.** Files on disk plus one JSON file per session keep the tool zero-config.
- **Re-encode everything.** Slower than stream copy but gives frame-accurate cuts and uniform output for concat.
- **Flat session folder.** Simple, but filenames must be unique per session; the server enforces this on rename and generates unique names on duplicate/split/speed.
- **Global-scope JS.** No build step; load order in `index.html` matters.
