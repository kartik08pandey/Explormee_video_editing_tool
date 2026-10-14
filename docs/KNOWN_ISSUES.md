# Known Issues, Limitations and Security Notes

Findings from reading the code. None of these have been changed; they are documented so they are not surprises. Items are ordered roughly by importance.

## Security

This is designed as a single-user local tool. Hardening is needed before any shared or networked use.

| # | Issue | Where | Impact / suggestion |
| --- | --- | --- | --- |
| S1 | Server binds to `0.0.0.0` with `debug=True` | `app.run(host='0.0.0.0', …, debug=True)` at the end of [app.py](../app.py) | Anyone on the same network can reach the editor, and the Werkzeug debugger allows remote code execution. Bind to `127.0.0.1` and turn debug off unless developing. |
| S2 | No authentication or per-user isolation | all routes | A session UUID is the only secret. Anyone who can reach the port can upload, read, overwrite or delete sessions. |
| S3 | `start.command` runs `git reset --hard origin/main` on every launch | [start.command](../start.command) | Silently discards local changes to tracked files. Also means the app auto-executes whatever is on the remote `main`. |
| S4 | Client builds HTML with unescaped filenames | `createTimelineClipCardHtml`, `processTask` in [timeline.js](../static/js/timeline.js) / [tasks.js](../static/js/tasks.js) | Filenames are sanitised by `secure_filename` on the server, which strips most dangerous characters, but values interpolated into `innerHTML` / inline `onclick` are not escaped client-side. Prefer DOM APIs or an escape helper. |
| S5 | Static FFmpeg downloaded over HTTPS without checksum | `start.command` | Trust is placed entirely in evermeet.cx. Consider verifying a hash. |

## Functional gaps and quirks

### Unwired review modal

[modal.js](../static/js/modal.js) and [review_modal.html](../templates/components/review_modal.html) implement a clip review dialog (previous/next, rename, load into workspace, download), but nothing in the current UI calls `openClipReview` / `openClipReviewByFilename`. Clicking a clip name starts renaming instead. Either re-attach it (for example to a card "preview" action) or remove the dead code.

### Unused code and parameters

- `shiftTimelineClip()` in [timeline.js](../static/js/timeline.js) is defined but no card button calls it.
- `/change-speed` accepts `preserve_pitch` but ignores it. Audio always goes through `atempo`, which preserves pitch.
- `_do_extract_audio` receives `input_path`/`out_path` but only uses the prebuilt command.
- `merge`'s `concat_list.txt` uses a fixed name per session, so two merges queued at the same time in one session would overwrite each other's list.

### Fixed output names overwrite earlier results

- `/crop` always writes `cropped_video.mp4`.
- `/extract-audio` always writes `extracted_audio.<ext>`.
- `/split` with custom names overwrites existing files of the same name, and two ranges with the same custom name collide.

### Speed tool range mismatch

The API accepts 0.25×–4.0×; the UI slider is limited to 0.5×–2.0× (card tooltip mentions 1.1×–2.0×).

### FFmpeg exit codes

`run_ffmpeg_command` treats return codes `1` and `-9` as success-ish (it only raises for other non-zero codes). A genuine FFmpeg failure that exits with code 1 will therefore not raise, and the task may report "completed" with a missing or empty output. Cancellation relies on this behaviour for `-9`. A safer approach is to track the cancelled flag explicitly and treat any other non-zero code as failure.

### Merge ordering and mixed formats

Merging uses the concat *demuxer* with re-encoding. Clips with different resolutions, frame rates or sample rates may fail or produce odd output. All clips produced by the app share the same encoder settings, but clips derived from differently sized sources (or cropped files added later) can mismatch. `merge_crop` assumes a roughly 16:9 source (it scales to 1920×540 first).

### Synchronous trim / split

`/trim-clip` and `/split-clip` block the request thread (Flask runs threaded in dev) and have no progress or cancel. Long source files make them slow, and the UI offers no timeout handling.

### Undo does not touch disk

Undo/redo restores timeline layout only. Deleting a clip removes the file, so undoing the delete brings back a card whose file is gone. The next restore shows a "missing clips" warning.

### Disk growth and cleanup

Sessions are removed only by **Start New Project** or manually. Abandoned sessions in `outputs/` accumulate (source videos can be up to 2 GB each). There is no periodic clean-up job. Download-zip also leaves `clips_<id8>.zip` in the session folder.

### Naming limits

`secure_filename` removes non-ASCII characters, so clip names such as `café` or non-Latin names are reduced (and may become empty, in which case a default is used or an error returned).

### In-memory task store

Task state is lost if the server restarts or reloads (debug mode reloads on every code change). The UI would then poll a missing task and show an error.

### Batch ZIP only includes default names

`/download-zip` collects `clip_*.mp4`. Custom-named, duplicated, split (`_partN`) or sped-up clips are not included.

### Windows file locking

Trim/split/speed use `os.replace` with one 100–150 ms retry. If the browser still has the old file open for playback, replacement can fail on Windows.

### Browser support

Developed against modern Chromium/Firefox/Safari. Relies on `localStorage`, `XMLHttpRequest` upload progress, `requestAnimationFrame` and CSS variables.

## Tests

The repository contains no automated tests, linters, or CI configuration. See [CONTRIBUTING.md](../CONTRIBUTING.md#testing) for a manual checklist.
