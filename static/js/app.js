// --- Global App Shortcuts & Key Handlers ---
    // Modal keyboard controls
    document.addEventListener('keydown', (e) => {
        const modal = document.getElementById('clipReviewModal');
        if (modal && modal.style.display === 'flex') {
            if (e.key === 'Escape') {
                closeClipReview();
            } else if (e.key === 'ArrowLeft') {
                navigateClip(-1);
            } else if (e.key === 'ArrowRight') {
                navigateClip(1);
            } else if (e.key === ' ' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                e.preventDefault();
                const mv = document.getElementById('modalVideoPlayer');
                if (mv.paused) mv.play(); else mv.pause();
            }
        }
    });

// --- Workspace State Initialization & Restore on Load ---
function initApp() {
    // 1. Setup "Start New Project" button
    const btnNew = document.getElementById('btnNewProject');
    if (btnNew) {
        btnNew.addEventListener('click', () => {
            if (!confirm('Start a new project? This will clear current clips and reset your workspace.')) {
                return;
            }

            clearSavedWorkspace(true);

            // Reset UI to initial empty state
            const emptyState = document.getElementById('emptyWorkspaceState');
            if (emptyState) emptyState.style.display = 'flex';

            document.querySelectorAll('.tools-section').forEach(el => el.style.display = 'none');

            const videoPlayerEl = document.getElementById('videoPlayer');
            if (videoPlayerEl) {
                videoPlayerEl.pause();
                videoPlayerEl.removeAttribute('src');
                videoPlayerEl.load();
            }

            const timeOverlayEl = document.getElementById('videoTimeOverlay');
            if (timeOverlayEl) timeOverlayEl.style.display = 'none';

            const banner = document.getElementById('activeVideoBanner');
            if (banner) banner.style.display = 'none';

            const splitOutputs = document.getElementById('splitOutputs');
            if (splitOutputs) splitOutputs.innerHTML = '';

            const durations = document.getElementById('durations');
            if (durations) durations.value = '';

            const metaTbody = document.querySelector('#metaTable tbody');
            if (metaTbody) metaTbody.innerHTML = '';

            const splitStatus = document.getElementById('splitStatus');
            if (splitStatus) { splitStatus.innerText = ''; splitStatus.className = 'status-box'; }

            const uploadStatus = document.getElementById('uploadStatus');
            if (uploadStatus) { uploadStatus.innerText = ''; uploadStatus.className = 'status-box'; }

            const cropStatus = document.getElementById('cropStatus');
            if (cropStatus) { cropStatus.innerText = ''; cropStatus.className = 'status-box'; }

            const fileInputEl = document.getElementById('fileInput');
            if (fileInputEl) fileInputEl.value = '';

            btnNew.style.display = 'none';
        });
    }

    // 2. Check for cached session and restore
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;

        const cached = JSON.parse(raw);
        if (!cached || !cached.session_id) return;

        fetch(`/session/${cached.session_id}`)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then(data => {
                if (data.valid && data.state) {
                    restoreWorkspace(data.state, data.missing_clips || []);
                    if (btnNew) btnNew.style.display = 'inline-flex';
                } else {
                    console.log('[Persistence] Saved session is invalid or files missing from disk. Resetting cache.');
                    clearSavedWorkspace(false);
                }
            })
            .catch(err => {
                console.warn('[Persistence] Error validating session with server:', err);
                // Fallback: If server check failed temporarily, attempt to restore from cached state
                if (cached && cached.session_id && cached.filename) {
                    try {
                        restoreWorkspace(cached, []);
                        if (btnNew) btnNew.style.display = 'inline-flex';
                    } catch (fallbackErr) {
                        console.warn('[Persistence] Fallback restore failed:', fallbackErr);
                    }
                }
            });
    } catch (err) {
        console.warn('[Persistence] Failed reading state from localStorage:', err);
    }
}

// Auto-init on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

