# User Guide

## 1. Start a project

1. Launch the app (see the [README](../README.md#quick-start)) and open <http://127.0.0.1:5050>.
2. Drag a video onto the workspace, or click **Choose Video File** / **Import**.
3. A progress bar shows percentage, upload speed and ETA. Click **Cancel** to abort.

After the upload the player, tools and metadata table (duration, resolution, FPS, size) appear. A **Start New Project** button replaces the empty state; it deletes the current session folder from disk after confirmation.

## 2. Generate clips

In the **Generate Clips** card, enter one range per line (commas also separate entries):

```
00:10 - 00:25
01:15 to 01:45
05:00 -> 05:30 | Intro
```

### Timestamp syntax

| Rule | Examples |
| --- | --- |
| Time formats | `90`, `90.5` (seconds) · `01:30` (MM:SS) · `00:01:30.5` (HH:MM:SS) |
| Range separators | `-`, `–`, `—`, `->`, `to` |
| Custom clip name | Put it after the end time: `00:10 - 00:25 | Highlight` or `00:10 - 00:25 Highlight`. The `.mp4` extension is added automatically and the name is sanitised. |
| Single duration | A line with just a time, e.g. `20`, is treated as a length that starts where the previous clip ended (first one starts at `0`). |
| Errors | End must be after start, no negative times, durations must be > 0. |

Clips are cut with re-encoding (H.264 `veryfast`, CRF 22, AAC 192k) so cuts are frame-accurate rather than snapped to keyframes. Output files are `clip_01.mp4`, `clip_02.mp4`, … unless you gave names.

Generating clips **replaces** the current timeline set with a fresh *Timeline 1*.

## 3. Work on the timeline

Each clip is a card on a timeline.

| Action | How |
| --- | --- |
| Preview a clip | Press the **▶** button on the card to play it solo in the main player. Use **Play Sequence** / **Restart** in the timeline header to play the whole timeline back to back. Use **Back to Original Video** in the player banner to return to the source. |
| Reorder | Drag a card left/right along the track. |
| Move between timelines | Drag a card onto another timeline's track. |
| Trim | Drag the left/right handle of a card. The clip is re-cut from the **original source video**, minimum length 0.5 s. |
| Split | Open the split modal, scrub or play, then add cut markers. Each resulting piece must be at least 0.35 s. Pieces keep the name with `_part2`, `_part3`, … suffixes. |
| Duplicate | Creates `name_copy.mp4`, `name_copy_2.mp4`, … on disk and a new card. |
| Rename | Click the clip name (or the pencil icon) on the card, type a new name, press `Enter` to save or `Esc` to cancel. Names must be unique within the session. |
| Speed | The ⚡ button on a card loads that clip into the **Video Speed** tool. |
| Delete | Removes the card and the file on disk. |
| Add timeline | **Add Timeline** in the timelines toolbar. Remove an extra timeline from its header. |
| Undo / Redo | Toolbar buttons or shortcuts below. |

When a clip is loaded in the main player, a **Split at playhead** button appears in the player banner.

## 4. Merge

Every timeline has two merge buttons:

- **Only Merge**: concatenates clips in timeline order, keeping the original dimensions and aspect ratio. Output `merged_<timestamp>.mp4`.
- **Merge + Crop**: scales/crops the video to 1920×540, splits it into a left and right half, stacks the **right half on top of the left**, scales to 1080 wide and pads with black bars to **1080×1920 (9:16)**. Output `merged_cropped_<timestamp>.mp4`.

A merged-video preview appears below the timelines with **Download Merged Video** and **Adjust Speed** buttons. Merging runs as a background task with a live progress message.

## 5. Crop the whole video

1. Click **Crop Video** at the top-right of the player to show the crop box.
2. Drag/resize the box, pick an aspect ratio preset, or type X / Y / W / H.
3. **Reset Full** restores the full frame.
4. Click **Crop Video** in the sidebar card. The result is saved as `cropped_video.mp4` (audio is copied untouched) and can be played or downloaded.

> Each crop overwrites the previous `cropped_video.mp4` in the session.

## 6. Change speed

The **Video Speed** card has three targets (tabs): the **master** video, the **current/selected clip**, and the **merged** video (visible after a merge).

- Pick a preset or use the slider (UI range 0.5×–2.0×; the API accepts 0.25×–4.0×).
- The card shows original vs new duration.
- **Preview in Player** plays the target at the chosen rate without encoding.
- Choose **Apply to selected (Replace in place)** or **Save as new video file** (`name_1.2x.mp4`).
- A progress bar and **Cancel** button appear while encoding.

Audio is time-stretched with FFmpeg `atempo` (chained for factors outside 0.5–2.0), which keeps the pitch. Silent videos are handled.

## 7. Extract audio

In the **Extract Audio** card choose format (MP3, WAV, AAC, M4A, FLAC, OGG), bitrate (WAV/FLAC hide it) and sample rate (44100 / 48000 Hz), then run it. The result is `extracted_audio.<ext>` and is downloadable. Videos without an audio stream return an error.

## 8. Download

- Per clip: the download icon on the clip card.
- All clips: `/download-zip/<session_id>` zips every `clip_*.mp4` (custom-named clips are not included).
- Merged / cropped / extracted files: download buttons next to their outputs.

## 9. Persistence

Your workspace is saved automatically (debounced by 0.5 s) to the browser's `localStorage` and to `outputs/session_<id>/session_state.json`. On reload the app restores the project, drops clips whose files vanished, and shows a *Project restored* toast. If the server is unreachable it falls back to the cached copy.

## Keyboard shortcuts

| Context | Keys | Action |
| --- | --- | --- |
| Anywhere (not typing in a field) | `Ctrl/Cmd + Z` | Undo |
| | `Ctrl/Cmd + Y` or `Ctrl/Cmd + Shift + Z` | Redo |
| | `Alt + T` | Toggle dark/light theme |
| Clip review modal (see [Known Issues](KNOWN_ISSUES.md#unwired-review-modal)) | `Space` | Play / pause |
| | `←` / `→` | Previous / next clip |
| | `Esc` | Close |
| Split modal | `M` | Mark cut point at playhead |
| | `Space` | Play / pause |
| | `←` / `→` | Step the scrubber ±0.1 s |
| | `Esc` | Cancel |

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Error: FFmpeg or FFprobe not found" page | Install FFmpeg and put `ffmpeg`/`ffprobe` on `PATH`, or drop them in `bin/`. |
| macOS page does not load on port 5000 | The app uses **5050** because 5000 clashes with AirPlay. |
| "Failed to read video metadata" | The file is corrupt or not a video FFprobe can read. |
| Project did not restore | The session folder or source video was removed from `outputs/`. |
| Disk filling up | Delete old `outputs/session_*` folders. |
| Local edits disappear on macOS launch | `start.command` hard-resets to `origin/main`; see the README warning. |
