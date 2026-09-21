// --- Global Application State & References ---
let currentSession = null;
let currentFilename = null;
let videoMeta = null;

// Primary UI Element Selectors
const btnImport = document.getElementById('btnImport');
const fileInput = document.getElementById('fileInput');
const videoPlayer = document.getElementById('videoPlayer');
const timeOverlay = document.getElementById('videoTimeOverlay');
const emptyWorkspaceState = document.getElementById('emptyWorkspaceState');

// Visual Crop State
let actualCrop = { x: 0, y: 0, w: 1280, h: 720 };
let isCropToolActive = false;
let dragAction = null; // 'move', 'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'
let startMouseX = 0, startMouseY = 0;
let startActualCrop = { x: 0, y: 0, w: 1280, h: 720 };

// Timeline State
let draggedTimelineCard = null;
let activeTrim = null; // Holds { card, handleEl, handleSide, filename, origStart, origEnd, currentStart, currentEnd, origWidth, sourceTotalDur }
let isTrimmingActive = false;
let timelineCounter = 1;
let activePlayingTimelineId = null;
let isPlayingSequence = false;

// Sequential Autoplay & Modal State
let currentClips = [];
let activeClipIndex = -1;
let sequenceClips = [];
let activeTimelineIndex = -1;

// --- Helper & Utility Functions ---
    function showStatus(elementId, type, message) {
        const el = document.getElementById(elementId);
        el.className = `status-box status-${type}`;
        el.innerText = message;
    }

    function toggleAudioSettings() {
        const format = document.getElementById('audioFormat').value;
        const container = document.getElementById('bitrateContainer');
        if (format === 'wav' || format === 'flac') {
            container.style.display = 'none';
        } else {
            container.style.display = 'block';
        }
    }


    function formatTimeSec(seconds) {
        if (isNaN(seconds) || seconds < 0) seconds = 0;
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = (seconds % 60).toFixed(2);
        const padS = s.padStart(5, '0');
        if (h > 0) {
            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${padS}`;
        } else {
            return `${m.toString().padStart(2, '0')}:${padS}`;
        }
    }


    // Millisecond timestamp updater
    function updateTimeOverlay() {
        if (videoPlayer && videoPlayer.readyState > 0) {
            const t = videoPlayer.currentTime;
            const h = Math.floor(t / 3600).toString().padStart(2, '0');
            const m = Math.floor((t % 3600) / 60).toString().padStart(2, '0');
            const s = (t % 60).toFixed(3).padStart(6, '0');
            document.getElementById('videoTimeOverlay').innerText = `${h}:${m}:${s}`;
        }
        requestAnimationFrame(updateTimeOverlay); // Syncs with browser refresh rate for smooth display
    }
    requestAnimationFrame(updateTimeOverlay);


    function updateTimelineTotalDuration(timelineId = null) {
        let containers = [];
        if (timelineId) {
            const el = document.getElementById(`timelineContainer-${timelineId}`);
            if (el) containers.push(el);
        } else {
            containers = Array.from(document.querySelectorAll('.timeline-container'));
        }

        if (containers.length === 0) {
            const legacyEl = document.getElementById('timelineTotalDuration');
            if (legacyEl) legacyEl.innerText = '0.0s';
            return;
        }

        containers.forEach(container => {
            const id = container.getAttribute('data-timeline-id');
            const cards = container.querySelectorAll('.timeline-clip-card');
            const totalEl = container.querySelector('.timeline-total-dur-text') || 
                            document.getElementById(`timelineTotalDuration-${id}`) || 
                            document.getElementById('timelineTotalDuration');

            let totalSec = 0;
            cards.forEach(card => {
                const start = parseFloat(card.getAttribute('data-start') || '0');
                const end = parseFloat(card.getAttribute('data-end') || '0');
                const dur = (end > start) ? (end - start) : 0;
                totalSec += dur;
            });

            const th = Math.floor(totalSec / 3600);
            const tm = Math.floor((totalSec % 3600) / 60);
            const ts = (totalSec % 60).toFixed(1);
            const totalFormatted = th > 0 ? `${th}h ${tm}m ${ts}s` : `${tm}m ${ts}s`;

            if (totalEl) {
                totalEl.innerText = totalFormatted;
            }
        });
    }

// --- Workspace Persistence ---
const STORAGE_KEY = 'video_editor_workspace_state';
let _saveTimer = null;
let _saveSeqCounter = 0;

function serializeWorkspaceState() {
    if (!currentSession) return null;

    // Serialize timeline layout from DOM
    const timelineEls = document.querySelectorAll('.timeline-container');
    const timelines = [];
    timelineEls.forEach(container => {
        const id = container.getAttribute('data-timeline-id');
        const titleBadge = container.querySelector('.timeline-title-badge');
        const title = titleBadge ? titleBadge.textContent.replace(/^🎞\s*/, '').trim() : id;
        const cards = container.querySelectorAll('.timeline-clip-card');
        const clips = [];
        cards.forEach(card => {
            clips.push({
                filename: card.getAttribute('data-filename'),
                data_start: parseFloat(card.getAttribute('data-start') || '0'),
                data_end: parseFloat(card.getAttribute('data-end') || '0')
            });
        });
        timelines.push({ id, title, clips });
    });

    // Capture crop state
    const cropRatioEl = document.getElementById('cropRatio');
    const cropSettings = {
        ratio: cropRatioEl ? cropRatioEl.value : 'free',
        x: actualCrop.x,
        y: actualCrop.y,
        w: actualCrop.w,
        h: actualCrop.h
    };

    return {
        version: 1,
        session_id: currentSession,
        filename: currentFilename,
        metadata: videoMeta,
        durations_text: (document.getElementById('durations') || {}).value || '',
        crop_settings: cropSettings,
        timeline_counter: timelineCounter,
        current_clips: currentClips.map(c => ({
            filename: c.filename,
            index: c.index,
            duration: c.duration,
            duration_formatted: c.duration_formatted,
            start_time: c.start_time,
            end_time: c.end_time,
            range_label: c.range_label || ''
        })),
        timelines: timelines,
        saved_at: Date.now()
    };
}

function saveWorkspaceState() {
    if (!currentSession) return;

    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
        const state = serializeWorkspaceState();
        if (!state) return;

        // Write to localStorage (with quota guard)
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
            console.warn('[Persistence] localStorage quota exceeded, skipping local cache:', e);
        }

        // Sync to server (fire-and-forget, with sequence counter to drop stale requests)
        const seq = ++_saveSeqCounter;
        fetch(`/session/${state.session_id}/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state)
        }).then(res => {
            if (seq !== _saveSeqCounter) return; // stale — newer save already fired
            if (!res.ok) console.warn('[Persistence] Server save failed:', res.status);
        }).catch(err => {
            console.warn('[Persistence] Server save error:', err);
        });
    }, 500);
}

// Flush pending debounced save synchronously before page unloads
window.addEventListener('beforeunload', () => {
    if (_saveTimer) {
        clearTimeout(_saveTimer);
        const state = serializeWorkspaceState();
        if (state) {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            } catch (e) { /* ignore */ }
        }
    }
});

function clearSavedWorkspace(resetServer = true) {
    const sessionId = currentSession;

    // Clear localStorage
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }

    // Reset globals
    currentSession = null;
    currentFilename = null;
    videoMeta = null;
    currentClips = [];
    sequenceClips = [];
    timelineCounter = 1;
    activePlayingTimelineId = null;
    activeClipIndex = -1;
    activeTimelineIndex = -1;

    // Clean server side
    if (resetServer && sessionId) {
        fetch(`/session/${sessionId}`, { method: 'DELETE' }).catch(() => {});
    }
}

function restoreWorkspace(state, missingClips = []) {
    // 1. Restore global JS variables
    currentSession = state.session_id;
    currentFilename = state.filename;
    videoMeta = state.metadata;
    timelineCounter = state.timeline_counter || 1;

    // Restore currentClips, filtering out missing ones
    const missingSet = new Set(missingClips);
    currentClips = (state.current_clips || []).filter(c => !missingSet.has(c.filename));

    // 2. Reveal editor UI immediately & hide empty workspace dropzone
    const emptyState = document.getElementById('emptyWorkspaceState');
    if (emptyState) emptyState.style.display = 'none';
    document.querySelectorAll('.tools-section').forEach(el => el.style.display = 'block');
    const timeOverlayEl = document.getElementById('videoTimeOverlay');
    if (timeOverlayEl) timeOverlayEl.style.display = 'block';

    const newProjBtn = document.getElementById('btnNewProject');
    if (newProjBtn) newProjBtn.style.display = 'inline-flex';

    const cropToggleBtn = document.getElementById('btnToggleCropOverlay');
    if (cropToggleBtn) {
        cropToggleBtn.style.display = 'flex';
        cropToggleBtn.classList.remove('active');
        const cropText = document.getElementById('cropToggleText');
        if (cropText) cropText.innerText = 'Crop Video';
    }
    isCropToolActive = false;
    const cropEditorEl = document.getElementById('cropEditor');
    if (cropEditorEl) cropEditorEl.style.display = 'none';

    // 3. Populate metadata table
    if (videoMeta) {
        const tbody = document.querySelector('#metaTable tbody');
        if (tbody) {
            tbody.innerHTML = `
                <tr><th>Duration</th><td>${videoMeta.duration_formatted || ''}</td></tr>
                <tr><th>Resolution</th><td>${videoMeta.width || ''}x${videoMeta.height || ''}</td></tr>
                <tr><th>FPS</th><td>${videoMeta.fps || ''}</td></tr>
                <tr><th>Size</th><td>${videoMeta.size_formatted || ''}</td></tr>
            `;
        }
    }

    // 4. Set video player source
    if (videoPlayer) {
        videoPlayer.src = `/media/${currentSession}/${currentFilename}`;
    }

    // 5. Restore durations textarea
    const durEl = document.getElementById('durations');
    if (durEl && state.durations_text) {
        durEl.value = state.durations_text;
    }

    // 6. Restore crop settings
    if (state.crop_settings) {
        const cropRatioEl = document.getElementById('cropRatio');
        if (cropRatioEl) cropRatioEl.value = state.crop_settings.ratio || 'free';
        actualCrop.x = state.crop_settings.x || 0;
        actualCrop.y = state.crop_settings.y || 0;
        actualCrop.w = state.crop_settings.w || 1280;
        actualCrop.h = state.crop_settings.h || 720;
        if (typeof updateInputFields === 'function') {
            updateInputFields();
        }
    }

    // 7. Rebuild timelines
    try {
        const splitOutputs = document.getElementById('splitOutputs');
        if (splitOutputs && state.timelines && state.timelines.length > 0) {
            let allHtml = '';
            state.timelines.forEach(tl => {
                const clipsForRender = (tl.clips || [])
                    .filter(c => !missingSet.has(c.filename))
                    .map((c, idx) => {
                        const detail = currentClips.find(cc => cc.filename === c.filename) || {};
                        return {
                            filename: c.filename,
                            index: idx + 1,
                            duration: (c.data_end > c.data_start) ? (c.data_end - c.data_start) : (detail.duration || 0),
                            duration_formatted: detail.duration_formatted || `${((c.data_end > c.data_start) ? (c.data_end - c.data_start) : 0).toFixed(2)}s`,
                            start_time: c.data_start,
                            end_time: c.data_end,
                            range_label: detail.range_label || ''
                        };
                    });
                allHtml += renderTimelineContainerHtml(tl.id, tl.title, clipsForRender);
            });
            splitOutputs.innerHTML = allHtml;
            updateTimelinesToolbarAndButtons();
            state.timelines.forEach(tl => {
                updateTimelineIndices(tl.id);
                updateTimelineTotalDuration(tl.id);
            });
        }
    } catch (tlErr) {
        console.warn('[Persistence] Error rebuilding timelines:', tlErr);
    }

    // 8. Show "Project Restored" toast
    _showRestoreToast(currentFilename);

    // 9. Notify about missing clips
    if (missingClips.length > 0) {
        console.warn('[Persistence] Some clips were missing on disk:', missingClips);
        setTimeout(() => {
            showStatus('splitStatus', 'warning',
                `⚠ ${missingClips.length} clip(s) were deleted from disk and removed from the timeline.`);
        }, 1500);
    }
}

function _showRestoreToast(filename) {
    const existing = document.getElementById('restoreToast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'restoreToast';
    toast.className = 'restore-toast';
    toast.innerHTML = `<span>✓ Project restored: <strong>${filename || 'Unknown'}</strong></span>`;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}
