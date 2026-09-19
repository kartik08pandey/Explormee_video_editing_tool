/* --- Drag and Drop & Reordering Logic for Timeline --- */

    document.getElementById('splitOutputs').addEventListener('dragstart', (e) => {
        if (e.target.classList.contains('clip-trim-handle') || isTrimmingActive) {
            e.preventDefault();
            return false;
        }
        const card = e.target.closest('.timeline-clip-card');
        if (card) {
            draggedTimelineCard = card;
            requestAnimationFrame(() => card.classList.add('dragging'));
        }
    });

    document.getElementById('splitOutputs').addEventListener('dragend', (e) => {
        const card = e.target.closest('.timeline-clip-card');
        if (card) {
            card.classList.remove('dragging');
            draggedTimelineCard = null;
            updateTimelineIndices();
        }
    });

    document.getElementById('splitOutputs').addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!draggedTimelineCard || isTrimmingActive) return;
        const track = document.getElementById('timelineTrack');
        if (!track) return;
        
        const afterElement = getTimelineDragAfterElement(track, e.clientX);
        if (afterElement == null) {
            track.appendChild(draggedTimelineCard);
        } else {
            track.insertBefore(draggedTimelineCard, afterElement);
        }
    });

    function getTimelineDragAfterElement(container, x) {
        const draggableElements = [...container.querySelectorAll('.timeline-clip-card:not(.dragging)')];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = x - box.left - box.width / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    function shiftTimelineClip(btn, direction) {
        const card = btn.closest('.timeline-clip-card');
        if (!card) return;
        const track = document.getElementById('timelineTrack');
        if (!track) return;
        
        if (direction === -1 && card.previousElementSibling) {
            track.insertBefore(card, card.previousElementSibling);
        } else if (direction === 1 && card.nextElementSibling) {
            track.insertBefore(card.nextElementSibling, card);
        }
        updateTimelineIndices();
    }

    function updateTimelineIndices() {
        const track = document.getElementById('timelineTrack');
        if (!track) return;
        const cards = [...track.querySelectorAll('.timeline-clip-card')];
        cards.forEach((card, idx) => {
            card.setAttribute('data-index', idx);
            const badge = card.querySelector('.clip-index-badge');
            if (badge) badge.innerText = `#${idx + 1}`;
            
            const leftBtn = card.querySelector('.btn-shift-left');
            const rightBtn = card.querySelector('.btn-shift-right');
            if (leftBtn) leftBtn.disabled = (idx === 0);
            if (rightBtn) rightBtn.disabled = (idx === cards.length - 1);
        });
        
        if (isPlayingSequence) {
            sequenceClips = getTimelineClipsOrder();
        }
    }

    function getTimelineClipsOrder() {
        const track = document.getElementById('timelineTrack');
        if (!track) return currentClips;
        const cards = track.querySelectorAll('.timeline-clip-card');
        if (cards.length === 0) return currentClips;
        
        const ordered = [];
        cards.forEach((card, i) => {
            const fn = card.getAttribute('data-filename');
            const found = currentClips.find(c => c.filename === fn);
            if (found) {
                ordered.push({ ...found, timelineIndex: i });
            } else {
                ordered.push({ filename: fn, index: i + 1, timelineIndex: i, duration_formatted: '', duration: 0 });
            }
        });
        return ordered;
    }



/* --- Timeline Clip Interactive Trimming Engine --- */
    function handleTrimHandleMouseDown(e, handleSide) {
        e.preventDefault();
        e.stopPropagation();

        const card = e.target.closest('.timeline-clip-card');
        if (!card || !currentSession) return;

        const filename = card.getAttribute('data-filename');
        let startSec = parseFloat(card.getAttribute('data-start'));
        let endSec = parseFloat(card.getAttribute('data-end'));

        if (isNaN(startSec)) startSec = 0;
        if (isNaN(endSec) || endSec <= startSec) {
            const found = currentClips.find(c => c.filename === filename);
            if (found && found.duration) {
                endSec = startSec + found.duration;
            } else {
                endSec = startSec + 5.0;
            }
        }

        const sourceTotalDur = (videoMeta && videoMeta.duration) ? videoMeta.duration : 999999;
        const initialWidth = card.offsetWidth;

        isTrimmingActive = true;
        card.setAttribute('draggable', 'false');
        card.classList.add('is-trimming');
        e.target.classList.add('active-trimming');

        // Point video player to original source video so scrubbing covers full duration
        if (currentFilename && (!videoPlayer.src || !videoPlayer.src.includes(currentFilename))) {
            videoPlayer.src = `/media/${currentSession}/${currentFilename}`;
            videoPlayer.load();
        }

        // Pause video so user has precision frame scrubbing
        if (videoPlayer && !videoPlayer.paused) {
            videoPlayer.pause();
        }

        const initialScrub = handleSide === 'left' ? startSec : endSec;
        if (videoPlayer && Number.isFinite(initialScrub)) {
            try { videoPlayer.currentTime = initialScrub; } catch (err) {}
        }

        activeTrim = {
            card: card,
            handleSide: handleSide,
            handleEl: e.target,
            filename: filename,
            idx: card.getAttribute('data-index'),
            startX: e.clientX,
            origStart: startSec,
            origEnd: endSec,
            currentStart: startSec,
            currentEnd: endSec,
            origWidth: initialWidth,
            sourceTotalDur: sourceTotalDur,
            pxPerSec: 15 // 15 pixels = 1 second for smooth precision
        };
        isTrimmingActive = true;

        updateTrimTooltip(e.clientX, e.clientY, startSec, endSec, handleSide);
    }

    function updateTrimTooltip(x, y, startSec, endSec, handleSide) {
        const tip = document.getElementById('timelineTrimTooltip');
        if (!tip) return;
        const dur = Math.max(0.5, endSec - startSec);
        
        tip.innerHTML = `
            <div class="trim-tip-title">
                <span>✂️</span>
                <span>Trimming ${handleSide === 'left' ? 'Start (In-point)' : 'End (Out-point)'}</span>
            </div>
            <div class="trim-tip-meta">
                <span><strong>In:</strong> ${formatTimeSec(startSec)}</span>
                <span><strong>Out:</strong> ${formatTimeSec(endSec)}</span>
            </div>
            <div style="margin-top: 3px; font-size: 0.75rem;">
                Duration: <span class="trim-tip-dur">${dur.toFixed(2)}s</span>
            </div>
        `;
        tip.style.left = `${x}px`;
        tip.style.top = `${y}px`;
        tip.style.display = 'block';
    }

    document.addEventListener('mousemove', (e) => {
        if (!isTrimmingActive || !activeTrim) return;

        const dx = e.clientX - activeTrim.startX;
        const dt = dx / activeTrim.pxPerSec;

        let newStart = activeTrim.origStart;
        let newEnd = activeTrim.origEnd;

        if (activeTrim.handleSide === 'left') {
            // Drag left (dx < 0) decreases start time -> starts earlier -> clip grows
            // Drag right (dx > 0) increases start time -> starts later -> clip shrinks
            newStart = activeTrim.origStart + dt;
            newStart = Math.max(0, Math.min(newStart, activeTrim.origEnd - 0.5));
        } else {
            // Drag right (dx > 0) increases end time -> ends later -> clip grows
            // Drag left (dx < 0) decreases end time -> ends earlier -> clip shrinks
            newEnd = activeTrim.origEnd + dt;
            newEnd = Math.max(activeTrim.origStart + 0.5, Math.min(newEnd, activeTrim.sourceTotalDur));
        }

        activeTrim.currentStart = newStart;
        activeTrim.currentEnd = newEnd;

        // 1. Live scrubbing in player
        const scrubTime = activeTrim.handleSide === 'left' ? newStart : newEnd;
        if (videoPlayer && Number.isFinite(scrubTime)) {
            try { videoPlayer.currentTime = scrubTime; } catch (err) {}
        }

        // 2. Live tooltip HUD
        updateTrimTooltip(e.clientX, e.clientY, newStart, newEnd, activeTrim.handleSide);

        // 3. Live feedback on timeline card badges
        const dur = newEnd - newStart;
        const durBadge = activeTrim.card.querySelector('.clip-duration-badge');
        if (durBadge) durBadge.innerText = `⏱ ${dur.toFixed(2)}s`;

        const rangeBadge = activeTrim.card.querySelector('.clip-range-badge');
        if (rangeBadge) {
            rangeBadge.innerText = `📍 ${formatTimeSec(newStart)} -> ${formatTimeSec(newEnd)}`;
            rangeBadge.style.display = 'block';
        }

        // 4. Dynamically adjust card width to visually reflect growth/shrink
        const durDelta = dur - (activeTrim.origEnd - activeTrim.origStart);
        const dynamicWidth = Math.max(180, Math.min(520, activeTrim.origWidth + (durDelta * activeTrim.pxPerSec)));
        activeTrim.card.style.width = `${dynamicWidth}px`;
    });

    document.addEventListener('mouseup', (e) => {
        if (!isTrimmingActive || !activeTrim) return;

        const tip = document.getElementById('timelineTrimTooltip');
        if (tip) tip.style.display = 'none';

        const { card, handleEl, filename, currentStart, currentEnd, origStart, origEnd, origWidth } = activeTrim;
        
        card.setAttribute('draggable', 'true');
        card.classList.remove('is-trimming');
        if (handleEl) handleEl.classList.remove('active-trimming');

        isTrimmingActive = false;
        activeTrim = null;

        const diffStart = Math.abs(currentStart - origStart);
        const diffEnd = Math.abs(currentEnd - origEnd);

        // If changed by more than 0.05s, send trim request to backend
        if (diffStart > 0.05 || diffEnd > 0.05) {
            executeTrimClip(card, filename, currentStart, currentEnd, origStart, origEnd, origWidth);
        } else {
            card.style.width = `${origWidth}px`;
        }
    });

    async function executeTrimClip(card, filename, newStart, newEnd, origStart, origEnd, origWidth) {
        if (!currentSession || !currentFilename) return;

        // Add loading spinner overlay on card
        let loadingOverlay = card.querySelector('.clip-card-trim-loading');
        if (!loadingOverlay) {
            loadingOverlay = document.createElement('div');
            loadingOverlay.className = 'clip-card-trim-loading';
            loadingOverlay.innerHTML = `
                <div class="trim-spinner"></div>
                <span>✂️ Trimming clip...</span>
            `;
            card.appendChild(loadingOverlay);
        }

        showStatus('splitStatus', 'info', `Trimming "${filename}" (${formatTimeSec(newStart)} -> ${formatTimeSec(newEnd)})...`);

        try {
            const res = await fetch('/trim-clip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: currentSession,
                    filename: filename,
                    source_filename: currentFilename,
                    start_time: newStart,
                    end_time: newEnd
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Trimming failed');

            if (loadingOverlay) loadingOverlay.remove();

            // 1. Update card attributes
            card.setAttribute('data-start', data.start_time);
            card.setAttribute('data-end', data.end_time);

            // 2. Update card badges
            const durBadge = card.querySelector('.clip-duration-badge');
            if (durBadge) durBadge.innerText = `⏱ ${data.duration_formatted}`;

            const rangeBadge = card.querySelector('.clip-range-badge');
            if (rangeBadge) {
                rangeBadge.innerText = `📍 ${data.range_label}`;
                rangeBadge.style.display = 'block';
            }

            // 3. Update in-memory currentClips and sequenceClips array
            if (currentClips && Array.isArray(currentClips)) {
                const clipObj = currentClips.find(c => c.filename === filename);
                if (clipObj) {
                    clipObj.start_time = data.start_time;
                    clipObj.end_time = data.end_time;
                    clipObj.duration = data.duration;
                    clipObj.duration_formatted = data.duration_formatted;
                    clipObj.start_formatted = data.start_formatted;
                    clipObj.end_formatted = data.end_formatted;
                    clipObj.range_label = data.range_label;
                }
            }
            if (sequenceClips && Array.isArray(sequenceClips)) {
                const seqObj = sequenceClips.find(c => c.filename === filename);
                if (seqObj) {
                    seqObj.start_time = data.start_time;
                    seqObj.end_time = data.end_time;
                    seqObj.duration = data.duration;
                    seqObj.duration_formatted = data.duration_formatted;
                    seqObj.start_formatted = data.start_formatted;
                    seqObj.end_formatted = data.end_formatted;
                    seqObj.range_label = data.range_label;
                }
            }

            // 4. Recalculate total duration in timeline header
            updateTimelineTotalDuration();

            // 5. If main player is currently playing this solo clip, reload with cache buster
            if (videoPlayer.src && videoPlayer.src.includes(filename)) {
                videoPlayer.src = `/media/${currentSession}/${filename}?t=${Date.now()}`;
                videoPlayer.load();
            }

            showStatus('splitStatus', 'success', `✂️ Clip "${filename}" trimmed to ${data.duration_formatted} (${data.range_label})!`);

        } catch (err) {
            if (loadingOverlay) loadingOverlay.remove();
            
            // Revert DOM to original values
            card.setAttribute('data-start', origStart);
            card.setAttribute('data-end', origEnd);
            card.style.width = `${origWidth}px`;
            
            const origDur = origEnd - origStart;
            const durBadge = card.querySelector('.clip-duration-badge');
            if (durBadge) durBadge.innerText = `⏱ ${origDur.toFixed(2)}s`;

            const rangeBadge = card.querySelector('.clip-range-badge');
            if (rangeBadge) {
                rangeBadge.innerText = `📍 ${formatTimeSec(origStart)} -> ${formatTimeSec(origEnd)}`;
            }

            showStatus('splitStatus', 'error', `Trimming failed: ${err.message}`);
        }
    }
