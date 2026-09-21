// --- File Import & Drag-and-Drop Handling ---

    // Active XHR reference for cancel support
    let activeUploadXHR = null;

    // Progress UI elements (cached once)
    const uploadProgressWrap = document.getElementById('uploadProgressWrap');
    const uploadBar          = document.getElementById('uploadBar');
    const uploadPct          = document.getElementById('uploadPct');
    const uploadFileName     = document.getElementById('uploadFileName');
    const uploadSize         = document.getElementById('uploadSize');
    const uploadSpeed        = document.getElementById('uploadSpeed');
    const uploadETA          = document.getElementById('uploadETA');
    const uploadCancelBtn    = document.getElementById('uploadCancelBtn');

    // --- Cancel button ---
    if (uploadCancelBtn) {
        uploadCancelBtn.addEventListener('click', () => {
            if (activeUploadXHR) {
                activeUploadXHR.abort();
                activeUploadXHR = null;
            }
        });
    }

    // --- UI event listeners for Import Video button ---
    if (btnImport) {
        btnImport.addEventListener('click', () => fileInput.click());
        btnImport.addEventListener('dragover', (e) => { e.preventDefault(); btnImport.style.opacity = '0.8'; });
        btnImport.addEventListener('dragleave', () => { btnImport.style.opacity = '1'; });
        btnImport.addEventListener('drop', (e) => {
            e.preventDefault();
            btnImport.style.opacity = '1';
            if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files[0]);
        });
    }
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleUpload(e.target.files[0]);
    });

    if (emptyWorkspaceState) {
        emptyWorkspaceState.addEventListener('dragover', (e) => {
            e.preventDefault();
            emptyWorkspaceState.classList.add('dragover');
        });
        emptyWorkspaceState.addEventListener('dragleave', () => {
            emptyWorkspaceState.classList.remove('dragover');
        });
        emptyWorkspaceState.addEventListener('drop', (e) => {
            e.preventDefault();
            emptyWorkspaceState.classList.remove('dragover');
            if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files[0]);
        });
    }

    // --- Helpers ---
    function _formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function _formatETA(seconds) {
        if (!isFinite(seconds) || seconds <= 0) return '--';
        if (seconds < 60) return Math.ceil(seconds) + 's';
        const m = Math.floor(seconds / 60);
        const s = Math.ceil(seconds % 60);
        return m + 'm ' + s + 's';
    }

    function _showProgress(show) {
        if (uploadProgressWrap) {
            uploadProgressWrap.classList.toggle('active', show);
        }
    }

    function _resetProgress() {
        if (uploadBar) uploadBar.style.width = '0%';
        if (uploadPct) uploadPct.textContent = '0%';
        if (uploadSize) uploadSize.textContent = '';
        if (uploadSpeed) uploadSpeed.textContent = '';
        if (uploadETA) uploadETA.textContent = '';
        if (uploadFileName) uploadFileName.textContent = '';
    }

    // --- Main upload handler using XMLHttpRequest for real progress ---
    function handleUpload(file) {
        if (!file) return;

        // Prevent double-upload
        if (activeUploadXHR) {
            activeUploadXHR.abort();
            activeUploadXHR = null;
        }

        const formData = new FormData();
        formData.append('video', file);

        // Show progress UI, hide any previous status
        _resetProgress();
        _showProgress(true);
        if (uploadFileName) uploadFileName.textContent = file.name;
        if (uploadSize) uploadSize.textContent = _formatBytes(file.size);
        showStatus('uploadStatus', 'info', 'Uploading…');

        const xhr = new XMLHttpRequest();
        activeUploadXHR = xhr;

        const startTime = Date.now();
        let lastLoaded = 0;
        let lastTime = startTime;

        // --- Progress event: fires many times during upload ---
        xhr.upload.addEventListener('progress', (e) => {
            if (!e.lengthComputable) return;

            const pct = Math.round((e.loaded / e.total) * 100);
            if (uploadBar)  uploadBar.style.width = pct + '%';
            if (uploadPct)  uploadPct.textContent = pct + '%';
            if (uploadSize) uploadSize.textContent = _formatBytes(e.loaded) + ' / ' + _formatBytes(e.total);

            // Speed calculation (smoothed over last interval)
            const now = Date.now();
            const dt = (now - lastTime) / 1000; // seconds
            if (dt > 0.3) { // update speed every ~300ms to avoid jitter
                const bytesPerSec = (e.loaded - lastLoaded) / dt;
                lastLoaded = e.loaded;
                lastTime = now;

                if (uploadSpeed) uploadSpeed.textContent = _formatBytes(bytesPerSec) + '/s';

                // ETA
                const remaining = e.total - e.loaded;
                if (bytesPerSec > 0 && uploadETA) {
                    uploadETA.textContent = '~' + _formatETA(remaining / bytesPerSec);
                }
            }
        });

        // --- Upload complete (response received) ---
        xhr.addEventListener('load', () => {
            activeUploadXHR = null;

            // Finish the bar to 100%
            if (uploadBar) uploadBar.style.width = '100%';
            if (uploadPct) uploadPct.textContent = '100%';
            if (uploadSpeed) uploadSpeed.textContent = '';
            if (uploadETA) uploadETA.textContent = '';

            let data;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                showStatus('uploadStatus', 'error', 'Invalid server response.');
                setTimeout(() => _showProgress(false), 1500);
                return;
            }

            if (xhr.status < 200 || xhr.status >= 300) {
                showStatus('uploadStatus', 'error', data.error || 'Upload failed (HTTP ' + xhr.status + ')');
                setTimeout(() => _showProgress(false), 2000);
                return;
            }

            // --- Success: populate app state ---
            currentSession = data.session_id;
            currentFilename = data.filename;
            videoMeta = data.metadata;

            showStatus('uploadStatus', 'success', `Uploaded: ${currentFilename}`);

            // Hide progress bar after brief delay
            setTimeout(() => _showProgress(false), 800);

            // Populate metadata table
            const tbody = document.querySelector('#metaTable tbody');
            tbody.innerHTML = `
                <tr><th>Duration</th><td>${data.metadata.duration_formatted}</td></tr>
                <tr><th>Resolution</th><td>${data.metadata.width}x${data.metadata.height}</td></tr>
                <tr><th>FPS</th><td>${data.metadata.fps}</td></tr>
                <tr><th>Size</th><td>${data.metadata.size_formatted}</td></tr>
            `;

            // Reset timeline and split/merge outputs
            isPlayingSequence = false;
            activeTimelineIndex = -1;
            timelineCounter = 1;
            activePlayingTimelineId = null;
            currentClips = [];
            sequenceClips = [];
            const splitOutputs = document.getElementById('splitOutputs');
            if (splitOutputs) splitOutputs.innerHTML = '';
            const timelinesControlBar = document.getElementById('timelinesControlBar');
            if (timelinesControlBar) timelinesControlBar.style.display = 'none';
            const mergeSection = document.getElementById('mergeSection');
            if (mergeSection) mergeSection.style.display = 'none';
            const banner = document.getElementById('activeVideoBanner');
            if (banner) banner.style.display = 'none';

            // Hide empty workspace state & reveal editor tools
            const emptyWorkspaceState = document.getElementById('emptyWorkspaceState');
            if (emptyWorkspaceState) emptyWorkspaceState.style.display = 'none';
            document.querySelectorAll('.tools-section').forEach(el => el.style.display = 'block');
            document.getElementById('videoTimeOverlay').style.display = 'block';

            // Show Crop Toggle button on top-right of player, initially inactive
            const cropToggleBtn = document.getElementById('btnToggleCropOverlay');
            if (cropToggleBtn) {
                cropToggleBtn.style.display = 'flex';
                cropToggleBtn.classList.remove('active');
                document.getElementById('cropToggleText').innerText = 'Crop Video';
            }
            isCropToolActive = false;
            if (cropEditor) cropEditor.style.display = 'none';

            videoPlayer.src = `/media/${currentSession}/${currentFilename}`;
        });

        // --- Network / server error ---
        xhr.addEventListener('error', () => {
            activeUploadXHR = null;
            showStatus('uploadStatus', 'error', 'Network error — check your connection.');
            setTimeout(() => _showProgress(false), 2000);
        });

        // --- Upload aborted (user clicked Cancel) ---
        xhr.addEventListener('abort', () => {
            activeUploadXHR = null;
            showStatus('uploadStatus', 'info', 'Upload cancelled.');
            setTimeout(() => _showProgress(false), 1200);
        });

        // --- Timeout ---
        xhr.addEventListener('timeout', () => {
            activeUploadXHR = null;
            showStatus('uploadStatus', 'error', 'Upload timed out. Try a smaller file or check your connection.');
            setTimeout(() => _showProgress(false), 2000);
        });

        xhr.open('POST', '/upload');
        xhr.send(formData);
    }
