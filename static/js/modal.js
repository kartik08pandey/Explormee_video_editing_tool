/* --- Modal Review Dialog Logic --- */
    /* --- Modal Review Dialog Logic --- */
    function openClipReview(index) {
        currentClips = getTimelineClipsOrder();
        if (!currentClips || currentClips.length === 0) return;
        
        activeClipIndex = Math.max(0, Math.min(index, currentClips.length - 1));
        renderModalClip();
        
        const modal = document.getElementById('clipReviewModal');
        modal.style.display = 'flex';
    }

    function openClipReviewByFilename(filename) {
        currentClips = getTimelineClipsOrder();
        const idx = currentClips.findIndex(c => c.filename === filename);
        if (idx !== -1) {
            openClipReview(idx);
        } else {
            openClipReview(0);
        }
    }

    function renderModalClip() {
        if (!currentClips || currentClips.length === 0) return;
        const clip = currentClips[activeClipIndex];
        if (!clip) return;
        
        const nameEl = document.getElementById('modalClipName');
        const metaEl = document.getElementById('modalClipMeta');
        const counterEl = document.getElementById('modalClipCounter');
        const downloadBtn = document.getElementById('modalDownloadBtn');
        const prevBtn = document.getElementById('prevClipBtn');
        const nextBtn = document.getElementById('nextClipBtn');
        const modalVideo = document.getElementById('modalVideoPlayer');
        
        nameEl.innerText = clip.filename;
        const durText = clip.duration_formatted ? `Duration: ${clip.duration_formatted}` : '';
        const rangeText = clip.range_label ? ` • Range: ${clip.range_label}` : ((clip.start_time !== undefined) ? ` • Starts at: ${clip.start_time.toFixed(2)}s` : '');
        metaEl.innerText = `${durText}${rangeText}` || 'Clip Preview';
        counterEl.innerText = `Clip ${activeClipIndex + 1} of ${currentClips.length}`;
        
        downloadBtn.href = `/download/${currentSession}/${clip.filename}`;
        
        prevBtn.disabled = (activeClipIndex === 0);
        nextBtn.disabled = (activeClipIndex === currentClips.length - 1);
        
        const targetSrc = `/media/${currentSession}/${clip.filename}?t=${Date.now()}`;
        modalVideo.src = targetSrc;
        modalVideo.load();
        modalVideo.play().catch(() => {});
    }

    function navigateClip(delta) {
        currentClips = getTimelineClipsOrder();
        const target = activeClipIndex + delta;
        if (target >= 0 && target < currentClips.length) {
            activeClipIndex = target;
            renderModalClip();
        }
    }

    function closeClipReview() {
        const modal = document.getElementById('clipReviewModal');
        modal.style.display = 'none';
        const modalVideo = document.getElementById('modalVideoPlayer');
        modalVideo.pause();
        modalVideo.removeAttribute('src');
        modalVideo.load();
    }

    function handleModalBackdropClick(e) {
        if (e.target.id === 'clipReviewModal') {
            closeClipReview();
        }
    }

    function loadModalClipIntoMain() {
        if (!currentClips || currentClips.length === 0) return;
        const clip = currentClips[activeClipIndex];
        if (!clip) return;
        loadIntoMainPlayer(clip.filename, `Clip #${activeClipIndex + 1} (${clip.filename})`);
        closeClipReview();
    }
