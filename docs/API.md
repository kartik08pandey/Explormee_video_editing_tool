# HTTP API

Base URL: `http://127.0.0.1:5050` (override the port with the `PORT` env var). All request and response bodies are JSON unless noted. There is no authentication. All responses carry `Cache-Control: no-cache, no-store`.

Errors use the shape `{ "error": "message" }` with a 4xx/5xx status.

`session_id`, `filename` and similar values are passed through `secure_filename` server-side.

## Contents

- [Pages and media](#pages-and-media)
- [Sessions](#sessions)
- [Tasks](#tasks)
- [Asynchronous operations](#asynchronous-operations-return-202--task_id)
- [Synchronous clip operations](#synchronous-clip-operations)
- [Task result shapes](#task-result-shapes)

## Pages and media

| Method | Path | Description |
| --- | --- | --- |
| GET | `/` | Renders the editor. Returns a 500 HTML message if `ffmpeg`/`ffprobe` are missing. |
| POST | `/upload` | `multipart/form-data` with field `video`. Allowed: mp4, mov, avi, mkv, webm, mpeg, mpg. Max 2 GB. |
| GET | `/media/<session_id>/<filename>` | Stream a file for playback. |
| GET | `/download/<session_id>/<filename>` | Same file as an attachment. |
| GET | `/download-zip/<session_id>` | Zips every `clip_*.mp4` in the session into `clips_<id8>.zip`. 404 if the session is missing. |

### `POST /upload` response

```json
{
  "message": "Upload successful",
  "session_id": "3f2c…",
  "filename": "movie.mp4",
  "metadata": {
    "duration": 123.45, "duration_formatted": "00:02:03.450",
    "width": 1920, "height": 1080, "fps": 29.97,
    "size": 12345678, "size_formatted": "11.77 MB",
    "has_audio": true, "has_video": true
  }
}
```

Errors: `400` for missing part, empty filename, unsupported extension, or unreadable metadata.

## Sessions

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| POST | `/session/<id>/save` | Workspace state object (any JSON) | `{ "status": "saved" }`. 404 unknown session, 400 empty payload. |
| GET | `/session/<id>` | – | `{ "valid": true, "state": {…}, "missing_clips": ["x.mp4"] }` or `{ "valid": false, "reason": … }`. |
| DELETE | `/session/<id>` | – | `{ "status": "deleted" }`. Removes the whole folder. Idempotent. |

`reason` values: `session_not_found` (404), `no_saved_state` (404), `corrupted_state` (500), `source_video_missing` (200 with `valid:false`).

## Tasks

| Method | Path | Description |
| --- | --- | --- |
| GET | `/tasks/<task_id>` | Poll a background job. |
| POST | `/tasks/<task_id>/cancel` | Mark cancelled and kill the FFmpeg process. 404 if unknown. |

```json
{
  "task_id": "…", "type": "merge",
  "status": "queued | processing | completed | failed | cancelled",
  "progress": 0,
  "message": "Encoding... 42%",
  "result": null,
  "error": null,
  "created_at": 1760000000.0, "updated_at": 1760000012.3
}
```

Tasks live in memory for about 30 minutes (pruned when new tasks are created) and vanish on server restart. At most 2 run at once.

## Asynchronous operations (return `202` + `task_id`)

All return:

```json
{ "task_id": "…", "status": "queued", "message": "…" }
```

### `POST /split` – generate clips

```json
{ "session_id": "…", "filename": "movie.mp4", "durations": "00:10 - 00:25\n01:15 to 01:45 | Intro" }
```

`400` on bad timestamps or none provided; `404` if the source is missing. See the [User Guide](USER_GUIDE.md#timestamp-syntax) for syntax.

### `POST /merge`

```json
{ "session_id": "…", "files": ["clip_01.mp4", "clip_02.mp4"], "mode": "merge" }
```

`mode`: `merge` (default) or `merge_crop` (1080×1920 stacked output). Files are concatenated in the order given. `404` if any file is missing. Output: `merged_<ts>.mp4` / `merged_cropped_<ts>.mp4`.

### `POST /crop`

```json
{ "session_id": "…", "filename": "movie.mp4", "x": 0, "y": 0, "w": 1280, "h": 720 }
```

Integers (defaults shown). Output is always `cropped_video.mp4`.

### `POST /extract-audio`

```json
{ "session_id": "…", "filename": "movie.mp4", "format": "mp3", "bitrate": "192k", "sample_rate": "44100" }
```

`format`: `mp3 | wav | aac | m4a | flac | ogg`. `400` for unsupported format or a video without audio. Output: `extracted_audio.<format>`.

### `POST /change-speed`

```json
{ "session_id": "…", "filename": "clip_01.mp4", "speed": 1.5, "mode": "new", "preserve_pitch": true }
```

`speed`: 0.25–4.0 (`400` otherwise). `mode`: `new` (default, writes `<name>_<speed>x.mp4` with `_N` suffix on collision) or `replace` (overwrites the input atomically). The response also includes `target_filename`, `mode`, `speed`.

## Synchronous clip operations

These run immediately and return the final result in the response (no task).

| Method | Path | Body | Response highlights |
| --- | --- | --- | --- |
| POST | `/rename-clip` | `session_id`, `old_name`, `new_name` | `{ message, old_name, new_name }`. `.mp4` is appended if missing; `400` if the target exists. |
| POST | `/delete-clip` | `session_id`, `filename` | `{ message, filename }`. Missing files are ignored. |
| POST | `/duplicate-clip` | `session_id`, `filename` | `{ original_filename, new_filename, metadata }`. Copies to `<base>_copy.mp4`, `_copy_2`, … |
| POST | `/trim-clip` | `session_id`, `filename`, `source_filename`, `start_time`, `end_time` | Re-cuts `filename` from the source. Min length 0.5 s. Returns new `start_time`, `end_time`, `duration`, `range_label` and formatted strings. |
| POST | `/split-clip` | `session_id`, `filename`, `source_filename`, `start_time`, `end_time`, `split_points: [seconds]` | Splits at points relative to the clip. Each piece ≥ 0.35 s. Returns `{ message, parts: [...], part1, part2 }`. Pieces after the first are named `<base>_partN.mp4`. |

`/trim-clip` and `/split-clip` block the request while FFmpeg runs and return `500` with the tail of FFmpeg's stderr on failure.

## Task result shapes

The `result` field of a completed task depends on the operation.

| Operation | `result` |
| --- | --- |
| split | `{ "files": ["clip_01.mp4", …], "clip_details": [{ filename, index, duration, duration_formatted, start_time, end_time, start_formatted, end_formatted, range_label }] }` |
| merge | `{ "file": "merged_….mp4", "mode": "merge", "metadata": {…} }` |
| crop | `{ "file": "cropped_video.mp4" }` |
| extract-audio | `{ "file": "extracted_audio.mp3" }` |
| change-speed | `{ "file": "…", "original_file": "…", "mode": "new", "speed": 1.5, "metadata": {…} }` |

## Typical flow

```
POST /upload                      → session_id
POST /split {durations}           → task_id ─ poll /tasks/<id> ─► clip_details
POST /trim-clip, /split-clip …    → edit clips on the timeline
POST /merge {files, mode}         → task_id ─ poll ─► merged file
GET  /download/<sid>/<file>       → save the result
DELETE /session/<sid>             → clean up
```
