/* --- Sequential Autoplay Engine --- */
    function togglePlaySequence(timelineId = null) {
        if (isPlayingSequence) {
            if (!timelineId || activePlayingTimelineId === timelineId) {
                pauseSequencePlayback(timelineId || activePlayingTimelineId);
            } else {
                pauseSequencePlayback(activePlayingTimelineId);
                startSequencePlayback(timelineId);
            }
        } else {
            startSequencePlayback(timelineId);
        }
    }

    function startSequencePlayback(timelineId = null) {
        if (!timelineId) {
            timelineId = activePlayingTimelineId || document.querySelector('.timeline-container')?.getAttribute('data-timeline-id') || 'timeline-1';
        }

        if (activePlayingTimelineId && activePlayingTimelineId !== timelineId) {
            pauseSequencePlayback(activePlayingTimelineId);
        }

        activePlayingTimelineId = timelineId;
        sequenceClips = getTimelineClipsOrder(timelineId);
        if (!sequenceClips || sequenceClips.length === 0) {
            alert("This timeline has no clips to play.");
            return;
        }
        
        isPlayingSequence = true;
        updateSequencePlayButton(timelineId);
        
        // If index is valid, resume from it; otherwise start from the beginning
        let startIndex = activeTimelineIndex;
        if (startIndex < 0 || startIndex >= sequenceClips.length) {
            startIndex = 0;
        }
        
        playClipInSequence(startIndex, timelineId);
    }

    function pauseSequencePlayback(timelineId = null) {
        isPlayingSequence = false;
        updateSequencePlayButton(timelineId || activePlayingTimelineId);
        if (videoPlayer) {
            videoPlayer.pause();
        }
    }

    function restartSequence(timelineId = null) {
        if (!timelineId) {
            timelineId = activePlayingTimelineId || document.querySelector('.timeline-container')?.getAttribute('data-timeline-id') || 'timeline-1';
        }

        if (activePlayingTimelineId && activePlayingTimelineId !== timelineId) {
            pauseSequencePlayback(activePlayingTimelineId);
        }

        activePlayingTimelineId = timelineId;
        sequenceClips = getTimelineClipsOrder(timelineId);
        if (!sequenceClips || sequenceClips.length === 0) return;
        
        // Reset all progress bars in this timeline
        const container = document.getElementById(`timelineContainer-${timelineId}`) || 
                          document.querySelector(`[data-timeline-id="${timelineId}"]`);
        if (container) {
            container.querySelectorAll('.clip-progress-bar').forEach(b => b.style.width = '0%');
        }
        
        isPlayingSequence = true;
        updateSequencePlayButton(timelineId);
        playClipInSequence(0, timelineId);
    }

    function playClipInSequence(index, timelineId = null) {
        if (!timelineId) timelineId = activePlayingTimelineId;
        if (!isPlayingSequence) return;
        sequenceClips = getTimelineClipsOrder(timelineId);
        
        if (index >= sequenceClips.length) {
            // Sequence completed!
            isPlayingSequence = false;
            updateSequencePlayButton(timelineId);
            activeTimelineIndex = -1;
            highlightTimelineCard(-1, timelineId);
            showStatus('splitStatus', 'success', 'Sequence playback complete! Click "⚡ Only Merge" or "📐 Merge + Crop" to export.');
            return;
        }
        
        activeTimelineIndex = index;
        const clip = sequenceClips[index];
        
        highlightTimelineCard(index, timelineId);
        
        if (!currentSession) return;
        
        // Hide crop overlay while playing clips
        const cropEditor = document.getElementById('cropEditor');
        if (cropEditor) cropEditor.style.display = 'none';
        
        const banner = document.getElementById('activeVideoBanner');
        const title = document.getElementById('activeVideoTitle');
        const container = document.getElementById(`timelineContainer-${timelineId}`) || document.querySelector(`[data-timeline-id="${timelineId}"]`);
        const tlTitle = container?.querySelector('.timeline-title-badge')?.innerText || 'Timeline';
        title.innerHTML = `<strong>Playing Sequence (${tlTitle}):</strong> Clip #${index + 1} of ${sequenceClips.length} (${clip.filename})`;
        banner.style.display = 'flex';
        
        videoPlayer.src = `/media/${currentSession}/${clip.filename}?t=${Date.now()}`;
        videoPlayer.load();
        videoPlayer.play().catch(() => {});
    }

    function highlightTimelineCard(index, timelineId = null) {
        let container = null;
        if (timelineId) {
            container = document.getElementById(`timelineContainer-${timelineId}`) || 
                        document.querySelector(`[data-timeline-id="${timelineId}"]`);
        } else if (activePlayingTimelineId) {
            container = document.getElementById(`timelineContainer-${activePlayingTimelineId}`) || 
                        document.querySelector(`[data-timeline-id="${activePlayingTimelineId}"]`);
        } else {
            container = document.querySelector('.timeline-container');
        }
        if (!container) return;

        // Clear active playing styling on all other containers
        document.querySelectorAll('.timeline-clip-card.active-playing').forEach(c => {
            if (!container.contains(c)) c.classList.remove('active-playing');
        });

        const cards = container.querySelectorAll('.timeline-clip-card');
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

    function updateSequencePlayButton(timelineId = null) {
        const containers = document.querySelectorAll('.timeline-container');
        containers.forEach(container => {
            const id = container.getAttribute('data-timeline-id');
            const btn = container.querySelector('.btn-sequence-play') || document.getElementById(`btnPlaySequence-${id}`) || document.getElementById('btnPlaySequence');
            if (!btn) return;
            if (isPlayingSequence && activePlayingTimelineId === id) {
                btn.innerHTML = `⏸ Pause Sequence`;
                btn.classList.add('playing');
            } else {
                btn.innerHTML = `▶ Play Sequence`;
                btn.classList.remove('playing');
            }
        });
    }

    function playSoloClip(filename, index, timelineId = null) {
        pauseSequencePlayback();
        activeTimelineIndex = index;
        highlightTimelineCard(index, timelineId);
        loadIntoMainPlayer(filename, `Clip #${index + 1} (${filename})`);
    }

    // Video Player sequence listeners
    videoPlayer.addEventListener('ended', () => {
        if (isPlayingSequence && activePlayingTimelineId) {
            const container = document.getElementById(`timelineContainer-${activePlayingTimelineId}`) ||
                              document.querySelector(`[data-timeline-id="${activePlayingTimelineId}"]`);
            if (container && activeTimelineIndex >= 0) {
                const cards = container.querySelectorAll('.timeline-clip-card');
                if (cards[activeTimelineIndex]) {
                    const bar = cards[activeTimelineIndex].querySelector('.clip-progress-bar');
                    if (bar) bar.style.width = '100%';
                }
            }
            playClipInSequence(activeTimelineIndex + 1, activePlayingTimelineId);
        }
    });

    videoPlayer.addEventListener('timeupdate', () => {
        if (isPlayingSequence && activePlayingTimelineId && activeTimelineIndex >= 0 && videoPlayer.duration > 0) {
            const pct = (videoPlayer.currentTime / videoPlayer.duration) * 100;
            const container = document.getElementById(`timelineContainer-${activePlayingTimelineId}`) ||
                              document.querySelector(`[data-timeline-id="${activePlayingTimelineId}"]`);
            if (container) {
                const cards = container.querySelectorAll('.timeline-clip-card');
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
        const splitBtn = document.getElementById('btnBannerSplitAtPlayhead');
        
        title.innerText = `Now Previewing: ${label || filename}`;
        banner.style.display = 'flex';
        if (splitBtn) splitBtn.style.display = 'inline-flex';
        
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
        const splitBtn = document.getElementById('btnBannerSplitAtPlayhead');
        banner.style.display = 'none';
        if (splitBtn) splitBtn.style.display = 'none';
        
        videoPlayer.src = `/media/${currentSession}/${currentFilename}`;
        videoPlayer.load();
    }

    function splitActiveVideoAtPlayhead() {
        if (!currentSession) return;
        const titleEl = document.getElementById('activeVideoTitle');
        const text = titleEl ? titleEl.innerText : '';
        const match = text.match(/\((.*?)\)/);
        const fn = match ? match[1] : null;
        if (!fn) {
            alert("Please preview a timeline clip first to split at playhead.");
            return;
        }

        const currentTime = videoPlayer ? videoPlayer.currentTime : null;
        openSplitClipModal(fn, activeTimelineIndex >= 0 ? activeTimelineIndex : 0, currentTime);
    }
