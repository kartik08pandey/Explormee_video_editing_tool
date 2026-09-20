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
