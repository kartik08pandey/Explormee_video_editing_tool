// --- File Import & Drag-and-Drop Handling ---
    // UI event listeners for Import Video button
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



    async function handleUpload(file) {
        if (!file) return;
        
        const formData = new FormData();
        formData.append('video', file);
        
        showStatus('uploadStatus', 'info', 'Uploading and probing metadata...');
        
        try {
            const res = await fetch('/upload', { method: 'POST', body: formData });
            const data = await res.json();
            
            if (!res.ok) throw new Error(data.error || 'Upload failed');
            
            currentSession = data.session_id;
            currentFilename = data.filename;
            videoMeta = data.metadata;
            
            showStatus('uploadStatus', 'success', `Uploaded: ${currentFilename}`);
            
            // Populate metadata
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
            
        } catch (err) {
            showStatus('uploadStatus', 'error', err.message);
        }
    }
