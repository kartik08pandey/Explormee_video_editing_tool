# Changelog

The project does not use version numbers or releases yet. This log is reconstructed from the git history (newest first) and grouped by date. Keep it updated going forward using the [Keep a Changelog](https://keepachangelog.com/) style.

## Unreleased

_Nothing yet._

## 2026-10-01

### Fixed
- Clip rename now resolves the correct clip card and stays in sync across multiple timelines.

## 2026-09-29

### Added
- Video speed control: sidebar tool, presets, slider, live preview, replace-in-place or save-as-new, cancel support, merged-video retiming, audio pitch preservation via chained `atempo`.

## 2026-09-26

### Added
- Dark mode with system-preference detection, persistence, and `Alt+T` shortcut.

## 2026-09-24

### Changed
- `start.command` uses `git fetch` + `git reset --hard` to force-sync with the remote on every launch.

## 2026-09-21

### Added
- Undo / Redo for timeline actions with toolbar buttons and keyboard shortcuts.
- Workspace persistence across refreshes (clips, timelines, trim state) via `localStorage` and server-side `session_state.json`.
- Background FFmpeg worker threads with real-time progress polling.
- Upload via `XMLHttpRequest` with live progress, speed, ETA and cancel.
- Multi-marker clip split tool with "Mark Cut Point" modal.
- Multi-timeline sections with cross-timeline drag-and-drop.

### Changed
- Removed the clip index badge from timeline cards.

## 2026-09-19

### Added
- Clip duplication with animated insertion and unique naming.
- Clip deletion with server-side file cleanup.
- Separate **Only Merge** and **Merge + Crop** actions.

### Changed
- Modularised `index.html` into Jinja2 components, CSS modules and JS modules.
- Clips section scrolls independently of the viewport.

### Fixed
- macOS launcher made self-healing (direct venv Python, Flask verification).

## 2026-09-18

### Added
- Non-sequential timestamp ranges for clip generation.
- Interactive draggable clip trimming with live scrubbing and the `/trim-clip` endpoint.
- Inline clip renaming and the `/rename-clip` endpoint.
- Vertical split-and-stack transformation, later output as standard 9:16 (1080×1920) with dark bars.
- Crop box toggled from a button on the player.
- `start.bat` one-click Windows launcher with portable Python/FFmpeg support, auto-update and browser launch.
- `start.command` macOS launcher with automatic FFmpeg download and quarantine bypass.
- Empty-state dropzone.

### Changed
- Port changed to 5050 (avoids the macOS AirPlay conflict); host uses `127.0.0.1` in launchers.
- Full-width layout; constrained player dimensions.

### Fixed
- ASCII arrow in `range_label`; `debug=True` for auto-reload.
- Missing closing brace in `renameCurrentModalClip`.

## 2026-09-17

### Added
- Initial Flask video editor application.

### Changed
- HTML separated into `templates/index.html`.
- Refresh handling fixed.
