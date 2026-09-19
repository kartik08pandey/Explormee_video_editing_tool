/* --- Sequential Autoplay Engine --- */
    function togglePlaySequence() {
        if (isPlayingSequence) {
            pauseSequencePlayback();
        } else {
            startSequencePlayback();
        }
    }

    function startSequencePlayback() {
        sequenceClips = getTimelineClipsOrder();
        if (!sequenceClips || sequenceClips.length === 0) return;
        
        isPlayingSequence = true;
        updateSequencePlayButton();
        
        // If index is valid, resume from it; otherwise start from the beginning
        let startIndex = activeTimelineIndex;
        if (startIndex < 0 || startIndex >= sequenceClips.length) {
            startIndex = 0;
        }
        
        playClipInSequence(startIndex);
    }

    function pauseSequencePlayback() {
        isPlayingSequence = false;
        updateSequencePlayButton();
        if (videoPlayer) {
            videoPlayer.pause();
        }
    }

    function restartSequence() {
        sequenceClips = getTimelineClipsOrder();
        if (!sequenceClips || sequenceClips.length === 0) return;
        
        // Reset all progress bars
        const track = document.getElementById('timelineTrack');
        if (track) {
            track.querySelectorAll('.clip-progress-bar').forEach(b => b.style.width = '0%');
        }
        
        isPlayingSequence = true;
        updateSequencePlayButton();
        playClipInSequence(0);
    }

    function playClipInSequence(index) {
        if (!isPlayingSequence) return;
        sequenceClips = getTimelineClipsOrder();
        
        if (index >= sequenceClips.length) {
            // Sequence completed!
            isPlayingSequence = false;
            updateSequencePlayButton();
            activeTimelineIndex = -1;
            highlightTimelineCard(-1);
            showStatus('splitStatus', 'success', 'Sequence playback complete! Click "⚡ Only Merge" or "📐 Merge + Crop" to export.');
            return;
        }
        
        activeTimelineIndex = index;
        const clip = sequenceClips[index];
        
        highlightTimelineCard(index);
        
        if (!currentSession) return;
        
        // Hide crop overlay while playing clips
        const cropEditor = document.getElementById('cropEditor');
        if (cropEditor) cropEditor.style.display = 'none';
        
        const banner = document.getElementById('activeVideoBanner');
        const title = document.getElementById('activeVideoTitle');
        title.innerHTML = `<strong>Playing Sequence:</strong> Clip #${index + 1} of ${sequenceClips.length} (${clip.filename})`;
        banner.style.display = 'flex';
        
        videoPlayer.src = `/media/${currentSession}/${clip.filename}?t=${Date.now()}`;
        videoPlayer.load();
        videoPlayer.play().catch(() => {});
    }

    function highlightTimelineCard(index) {
        const track = document.getElementById('timelineTrack');
        if (!track) return;
        const cards = track.querySelectorAll('.timeline-clip-card');
        cards.forEach((card, i) => {
            const prog = card.querySelector('.clip-progress-bar');
            if (i === index) {
                card.classList.add('active-playing');
                card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
                if (prog) prog.style.width = '0%';
            } else {
                card.classList.remove('active-playing');
                if (i < index && prog) {
                    prog.style.width = '100%';
                } else if (i > index && prog) {
                    prog.style.width = '0%';
                }
            }
        });
    }

    function updateSequencePlayButton() {
        const btn = document.getElementById('btnPlaySequence');
        if (!btn) return;
        if (isPlayingSequence) {
            btn.innerHTML = `⏸ Pause Sequence`;
            btn.classList.add('playing');
        } else {
            btn.innerHTML = `▶ Play Sequence`;
            btn.classList.remove('playing');
        }
    }

    function playSoloClip(filename, index) {
        pauseSequencePlayback();
        activeTimelineIndex = index;
        highlightTimelineCard(index);
        loadIntoMainPlayer(filename, `Clip #${index + 1} (${filename})`);
    }

    // Video Player sequence listeners
    videoPlayer.addEventListener('ended', () => {
        if (isPlayingSequence) {
            const track = document.getElementById('timelineTrack');
            if (track && activeTimelineIndex >= 0) {
                const cards = track.querySelectorAll('.timeline-clip-card');
                if (cards[activeTimelineIndex]) {
                    const bar = cards[activeTimelineIndex].querySelector('.clip-progress-bar');
                    if (bar) bar.style.width = '100%';
                }
            }
            playClipInSequence(activeTimelineIndex + 1);
        }
    });

    videoPlayer.addEventListener('timeupdate', () => {
        if (isPlayingSequence && activeTimelineIndex >= 0 && videoPlayer.duration > 0) {
            const pct = (videoPlayer.currentTime / videoPlayer.duration) * 100;
            const track = document.getElementById('timelineTrack');
            if (track) {
                const cards = track.querySelectorAll('.timeline-clip-card');
                if (cards[activeTimelineIndex]) {
                    const bar = cards[activeTimelineIndex].querySelector('.clip-progress-bar');
                    if (bar) bar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
                }
            }
        }
    });

    videoPlayer.addEventListener('pause', () => {
        if (isPlayingSequence && videoPlayer.currentTime < (videoPlayer.duration - 0.15)) {
            isPlayingSequence = false;
            updateSequencePlayButton();
        }
    });


/* --- Workspace Active Video Previewing --- */
    function loadIntoMainPlayer(filename, label) {
        if (!currentSession) return;
        
        // Hide crop overlay while previewing clips
        const cropEditor = document.getElementById('cropEditor');
        if (cropEditor) cropEditor.style.display = 'none';
        
        const banner = document.getElementById('activeVideoBanner');
        const title = document.getElementById('activeVideoTitle');
        
        title.innerText = `Now Previewing: ${label || filename}`;
        banner.style.display = 'flex';
        
        videoPlayer.src = `/media/${currentSession}/${filename}?t=${Date.now()}`;
        videoPlayer.load();
        videoPlayer.play().catch(() => {});
        
        document.getElementById('videoContainer').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function restoreOriginalVideo() {
        if (!currentSession || !currentFilename) return;
        
        pauseSequencePlayback();
        activeTimelineIndex = -1;
        highlightTimelineCard(-1);
        
        const banner = document.getElementById('activeVideoBanner');
        banner.style.display = 'none';
        
        videoPlayer.src = `/media/${currentSession}/${currentFilename}`;
        videoPlayer.load();
        
    }
