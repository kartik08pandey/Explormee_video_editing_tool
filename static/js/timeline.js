/* --- Multi-Timeline & Drag/Drop Reordering Logic --- */
    let sourceTimelineId = null;

    document.getElementById('splitOutputs').addEventListener('dragstart', (e) => {
        if (e.target.classList.contains('clip-trim-handle') || isTrimmingActive || e.target.closest('button') || e.target.closest('input')) {
            e.preventDefault();
            return false;
        }
        const card = e.target.closest('.timeline-clip-card');
        if (card) {
            draggedTimelineCard = card;
            const container = card.closest('.timeline-container');
            sourceTimelineId = container ? container.getAttribute('data-timeline-id') : null;
            requestAnimationFrame(() => card.classList.add('dragging'));
        }
    });

    document.getElementById('splitOutputs').addEventListener('dragend', (e) => {
        const card = e.target.closest('.timeline-clip-card');
        if (card) {
            card.classList.remove('dragging');
            draggedTimelineCard = null;

            // Remove any dragover highlights from all tracks
            document.querySelectorAll('.timeline-track').forEach(t => t.classList.remove('dragover-track'));

            const targetContainer = card.closest('.timeline-container');
            const targetTimelineId = targetContainer ? targetContainer.getAttribute('data-timeline-id') : null;

            // Clean up empty notices if cards were inserted
            if (targetContainer) {
                const emptyNotice = targetContainer.querySelector('.timeline-empty-notice');
                if (emptyNotice) emptyNotice.remove();
            }

            // Check if source container became empty
            if (sourceTimelineId && sourceTimelineId !== targetTimelineId) {
                const srcContainer = document.getElementById(`timelineContainer-${sourceTimelineId}`);
                if (srcContainer) {
                    const srcCards = srcContainer.querySelectorAll('.timeline-clip-card');
                    if (srcCards.length === 0) {
                        const srcTrack = srcContainer.querySelector('.timeline-track');
                        if (srcTrack && !srcTrack.querySelector('.timeline-empty-notice')) {
                            srcTrack.innerHTML = `<div class="timeline-empty-notice" id="timelineEmptyNotice-${sourceTimelineId}">
                                <span>📥 Drag clips here or duplicate from other timelines</span>
                            </div>`;
                        }
                    }
                    updateTimelineIndices(sourceTimelineId);
                    updateTimelineTotalDuration(sourceTimelineId);
                }
            }

            if (targetTimelineId) {
                updateTimelineIndices(targetTimelineId);
                updateTimelineTotalDuration(targetTimelineId);
            } else {
                updateTimelineIndices();
                updateTimelineTotalDuration();
            }

            sourceTimelineId = null;
        }
    });

    document.getElementById('splitOutputs').addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!draggedTimelineCard || isTrimmingActive) return;

        // Find target track (supports dragging into any timeline)
        const track = e.target.closest('.timeline-track') || e.target.closest('.timeline-track-wrapper')?.querySelector('.timeline-track');
        if (!track) return;

        // Highlight active hovered track
        document.querySelectorAll('.timeline-track').forEach(t => {
            if (t === track) t.classList.add('dragover-track');
            else t.classList.remove('dragover-track');
        });

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
        const track = card.closest('.timeline-track');
        if (!track) return;
        const container = card.closest('.timeline-container');
        const timelineId = container ? container.getAttribute('data-timeline-id') : null;
        
        if (direction === -1 && card.previousElementSibling && !card.previousElementSibling.classList.contains('timeline-empty-notice')) {
            track.insertBefore(card, card.previousElementSibling);
        } else if (direction === 1 && card.nextElementSibling) {
            track.insertBefore(card.nextElementSibling, card);
        }
        updateTimelineIndices(timelineId);
        updateTimelineTotalDuration(timelineId);
    }

    function updateTimelineIndices(timelineId = null) {
        let containers = [];
        if (timelineId) {
            const el = document.getElementById(`timelineContainer-${timelineId}`) || 
                       document.querySelector(`[data-timeline-id="${timelineId}"]`);
            if (el) containers.push(el);
        } else {
            containers = Array.from(document.querySelectorAll('.timeline-container'));
        }

        containers.forEach(container => {
            const id = container.getAttribute('data-timeline-id');
            const cards = Array.from(container.querySelectorAll('.timeline-clip-card'));

            cards.forEach((card, idx) => {
                card.setAttribute('data-index', idx);
                const badge = card.querySelector('.clip-index-badge');
                if (badge) badge.remove();

                const fn = card.getAttribute('data-filename');

                // Sync indexed elements & event bindings
                const dur = card.querySelector('.clip-duration-badge');
                if (dur) dur.id = `clip-dur-${id}-${idx}`;
                const range = card.querySelector('.clip-range-badge');
                if (range) range.id = `clip-range-${id}-${idx}`;
                const nameRow = card.querySelector('.clip-card-name-row');
                if (nameRow) nameRow.id = `clip-name-display-${id}-${idx}`;
                const nameText = card.querySelector('.clip-card-name');
                if (nameText) {
                    nameText.id = `clip-name-text-${id}-${idx}`;
                    nameText.onclick = () => startRenameClip(fn, idx);
                }
                const renameBtn = card.querySelector('.clip-rename-btn');
                if (renameBtn) renameBtn.onclick = () => startRenameClip(fn, idx);
                const renameBox = card.querySelector('.clip-rename-box');
                if (renameBox) renameBox.id = `clip-rename-box-${id}-${idx}`;
                const renameInput = card.querySelector('input[type="text"]');
                if (renameInput) {
                    renameInput.id = `clip-rename-input-${id}-${idx}`;
                    renameInput.onkeydown = (e) => handleRenameKey(e, fn, idx);
                }
                const saveBtn = card.querySelector('.clip-save-btn');
                if (saveBtn) saveBtn.onclick = () => saveRenameClip(fn, idx);
                const cancelBtn = card.querySelector('.clip-rename-box .btn-outline');
                if (cancelBtn) cancelBtn.onclick = () => cancelRenameClip(idx);
                const errDiv = card.querySelector('.clip-rename-box > div:last-child');
                if (errDiv) errDiv.id = `clip-rename-err-${id}-${idx}`;
                const prog = card.querySelector('.clip-progress-bar');
                if (prog) prog.id = `clip-prog-${id}-${idx}`;
                const splitBtn = card.querySelector('.clip-split-btn');
                if (splitBtn) splitBtn.onclick = () => openSplitClipModal(fn, idx);
                const playBtn = card.querySelector('.clip-play-btn');
                if (playBtn) playBtn.onclick = () => playSoloClip(fn, idx);
            });

            // Update clip count text in container header
            const countEl = container.querySelector('.timeline-clip-count-text') || 
                            document.getElementById(`timelineClipsCountText-${id}`) || 
                            document.getElementById('timelineClipsCountText');
            if (countEl) {
                countEl.innerHTML = `<strong>${cards.length} Clip${cards.length === 1 ? '' : 's'}</strong>`;
            }
        });

        if (isPlayingSequence && activePlayingTimelineId) {
            sequenceClips = getTimelineClipsOrder(activePlayingTimelineId);
        }
    }

    function getTimelineClipsOrder(timelineId = null) {
        let container;
        if (timelineId) {
            container = document.getElementById(`timelineContainer-${timelineId}`) || 
                        document.querySelector(`[data-timeline-id="${timelineId}"]`);
        } else {
            container = document.querySelector('.timeline-container');
        }
        if (!container) return currentClips;

        const cards = container.querySelectorAll('.timeline-clip-card');
        if (cards.length === 0) return [];

        const ordered = [];
        cards.forEach((card, i) => {
            const fn = card.getAttribute('data-filename');
            const found = currentClips.find(c => c.filename === fn);
            const start = parseFloat(card.getAttribute('data-start') || '0');
            const end = parseFloat(card.getAttribute('data-end') || '0');
            const dur = (end > start) ? (end - start) : (found ? found.duration : 0);

            if (found) {
                ordered.push({ ...found, timelineIndex: i, start_time: start, end_time: end, duration: dur });
            } else {
                ordered.push({ filename: fn, index: i + 1, timelineIndex: i, duration_formatted: '', duration: dur, start_time: start, end_time: end });
            }
        });
        return ordered;
    }

    function renderTimelineContainerHtml(timelineId, title, clips = []) {
        let totalSec = 0;
        clips.forEach(cl => {
            totalSec += (cl.duration || 0);
        });
        const th = Math.floor(totalSec / 3600);
        const tm = Math.floor((totalSec % 3600) / 60);
        const ts = (totalSec % 60).toFixed(1);
        const totalFormatted = th > 0 ? `${th}h ${tm}m ${ts}s` : `${tm}m ${ts}s`;

        let cardsHtml = '';
        if (clips.length > 0) {
            clips.forEach((cl, idx) => {
                cardsHtml += createTimelineClipCardHtml(cl.filename, idx, cl, clips.length);
            });
        } else {
            cardsHtml = `<div class="timeline-empty-notice" id="timelineEmptyNotice-${timelineId}">
                <span>📥 Drag clips here or duplicate from other timelines</span>
            </div>`;
        }

        return `
        <div class="timeline-container" id="timelineContainer-${timelineId}" data-timeline-id="${timelineId}">
            <div class="timeline-top-bar">
                <div class="timeline-meta-info">
                    <span class="timeline-title-badge" id="timelineTitleBadge-${timelineId}">🎞 ${title}</span>
                    <span>
                        <span class="timeline-clip-count-text" id="timelineClipsCountText-${timelineId}"><strong>${clips.length} Clip${clips.length === 1 ? '' : 's'}</strong></span>
                        &bull; Total: <span class="timeline-total-dur-text" id="timelineTotalDuration-${timelineId}" style="font-family:monospace; color:var(--accent-color); font-weight:600;">${totalFormatted}</span>
                    </span>
                </div>
                <div class="timeline-actions">
                    <button id="btnPlaySequence-${timelineId}" class="btn btn-sequence-play btn-sm" onclick="togglePlaySequence('${timelineId}')">
                        ▶ Play Sequence
                    </button>
                    <button id="btnRestartSequence-${timelineId}" class="btn btn-outline btn-sm" onclick="restartSequence('${timelineId}')">
                        ⏮ Restart
                    </button>
                    <button id="btnMergeOnly-${timelineId}" class="btn btn-merge-download btn-sm" onclick="mergeClips('merge', '${timelineId}')" title="Merge clips in original format and aspect ratio">
                        ⚡ Only Merge
                    </button>
                    <button id="btnMergeCrop-${timelineId}" class="btn btn-merge-crop btn-sm" onclick="mergeClips('merge_crop', '${timelineId}')" title="Merge clips and format/stack into 9:16 vertical video">
                        📐 Merge + Crop
                    </button>
                    <button class="btn btn-delete-timeline btn-sm" onclick="removeTimeline('${timelineId}')" title="Remove this timeline section">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        Delete Timeline
                    </button>
                </div>
            </div>
            <div class="timeline-track-wrapper" id="timelineTrackWrapper-${timelineId}">
                <div class="timeline-track" id="timelineTrack-${timelineId}" data-timeline-id="${timelineId}">
                    ${cardsHtml}
                </div>
            </div>
        </div>`;
    }

    function addNewTimeline(initialClips = []) {
        const outputs = document.getElementById('splitOutputs');
        if (!outputs) return;

        timelineCounter++;
        const timelineId = `timeline-${timelineCounter}`;
        const timelineTitle = `Timeline ${timelineCounter}`;

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = renderTimelineContainerHtml(timelineId, timelineTitle, initialClips);
        const newContainer = tempDiv.firstElementChild;
        newContainer.style.opacity = '0';
        newContainer.style.transform = 'translateY(12px)';
        newContainer.style.transition = 'opacity 0.25s ease, transform 0.25s ease';

        outputs.appendChild(newContainer);

        requestAnimationFrame(() => {
            newContainer.style.opacity = '1';
            newContainer.style.transform = 'translateY(0)';
        });

        updateTimelinesToolbarAndButtons();
        updateTimelineIndices(timelineId);
        updateTimelineTotalDuration(timelineId);

        setTimeout(() => {
            newContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 100);

        return timelineId;
    }

    function removeTimeline(timelineId) {
        const containers = document.querySelectorAll('.timeline-container');
        if (containers.length <= 1) {
            alert("At least one timeline must remain.");
            return;
        }

        const container = document.getElementById(`timelineContainer-${timelineId}`);
        if (!container) return;

        const cards = container.querySelectorAll('.timeline-clip-card');
        if (cards.length > 0) {
            if (!confirm(`This timeline contains ${cards.length} clip(s). Are you sure you want to delete it?`)) {
                return;
            }
        }

        // Stop playback if actively playing on this timeline
        if (activePlayingTimelineId === timelineId && isPlayingSequence) {
            pauseSequencePlayback(timelineId);
            activePlayingTimelineId = null;
        }

        container.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        container.style.opacity = '0';
        container.style.transform = 'scale(0.95)';

        setTimeout(() => {
            container.remove();
            updateTimelinesToolbarAndButtons();
        }, 200);
    }

    function updateTimelinesToolbarAndButtons() {
        const containers = document.querySelectorAll('.timeline-container');
        const badge = document.getElementById('timelinesCountBadge');
        if (badge) badge.innerText = containers.length;

        // Show toolbar if at least 1 container exists
        const bar = document.getElementById('timelinesControlBar');
        if (bar) {
            bar.style.display = containers.length > 0 ? 'flex' : 'none';
        }

        // Show delete timeline button only when more than 1 timeline exists
        containers.forEach(container => {
            const delBtn = container.querySelector('.btn-delete-timeline');
            if (delBtn) {
                delBtn.style.display = containers.length > 1 ? 'inline-flex' : 'none';
            }
        });
    }

    function createTimelineClipCardHtml(f, idx, detail = {}, totalCount = 1) {
        const durBadge = detail.duration_formatted ? detail.duration_formatted : `${detail.duration || 0}s`;
        const startVal = detail.start_time !== undefined ? detail.start_time : 0;
        const endVal = detail.end_time !== undefined ? detail.end_time : (detail.duration || 0);

        return `
            <div class="timeline-clip-card" draggable="true" data-filename="${f}" data-index="${idx}" data-start="${startVal}" data-end="${endVal}">
                <div class="clip-trim-handle trim-left" title="Drag to trim start (pull left to extend, right to shorten)" onmousedown="handleTrimHandleMouseDown(event, 'left')"></div>
                <div class="clip-trim-handle trim-right" title="Drag to trim end (pull right to extend, left to shorten)" onmousedown="handleTrimHandleMouseDown(event, 'right')"></div>
                <div class="clip-card-header">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span class="clip-duration-badge" id="clip-dur-${idx}">⏱ ${durBadge}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <a href="/download/${currentSession}/${f}" class="clip-download-btn" download title="Download this clip">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                        </a>
                        <button class="clip-split-btn" onclick="openSplitClipModal('${f}', ${idx})" title="Split this clip (✂️)">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="6" cy="6" r="3"></circle>
                                <circle cx="6" cy="18" r="3"></circle>
                                <line x1="20" y1="4" x2="8.12" y2="15.88"></line>
                                <line x1="14.47" y1="14.48" x2="20" y2="20"></line>
                                <line x1="8.12" y1="8.12" x2="12" y2="12"></line>
                            </svg>
                        </button>
                        <button class="clip-duplicate-btn" onclick="duplicateTimelineClip(this, '${f}')" title="Duplicate this clip">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        </button>
                        <button class="clip-delete-btn" onclick="deleteTimelineClip(this, '${f}')" title="Delete clip from timeline">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="clip-range-badge" id="clip-range-${idx}" style="font-size:0.71rem; font-weight:600; font-family:monospace; color:#1d4ed8; background:#eff6ff; padding:2px 6px; border-radius:4px; margin:4px 0 2px 0; border:1px solid #bfdbfe; text-align:center; ${detail.range_label ? '' : 'display:none;'}">📍 ${detail.range_label || ''}</div>
                <div class="clip-card-body">
                    <div class="clip-card-name-row" id="clip-name-display-${idx}" style="display: flex; align-items: center; justify-content: space-between; gap: 4px; margin-bottom: 4px;">
                        <div class="clip-card-name" id="clip-name-text-${idx}" title="${f}" style="cursor: pointer; font-weight: 500; font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" onclick="startRenameClip('${f}', ${idx})">📹 ${f}</div>
                        <button class="clip-rename-btn" onclick="startRenameClip('${f}', ${idx})" title="Rename this clip" style="background: none; border: none; cursor: pointer; font-size: 0.8rem; padding: 2px 4px; color: var(--text-secondary); border-radius: 4px; line-height: 1;">✏️</button>
                    </div>
                    <div class="clip-rename-box" id="clip-rename-box-${idx}" style="display: none; margin-bottom: 6px;">
                        <div style="display: flex; align-items: center; gap: 3px;">
                            <input type="text" id="clip-rename-input-${idx}" value="${f.replace(/\.mp4$/i, '')}" style="width: 100%; min-width: 0; padding: 3px 5px; font-size: 0.78rem; border: 1px solid var(--accent-color); border-radius: 4px; outline: none;" onkeydown="handleRenameKey(event, '${f}', ${idx})">
                            <button class="btn btn-sm btn-success clip-save-btn" onclick="saveRenameClip('${f}', ${idx})" style="padding: 3px 6px; font-size: 0.72rem; width: auto; line-height: 1;" title="Save name">✔</button>
                            <button class="btn btn-sm btn-outline" onclick="cancelRenameClip(${idx})" style="padding: 3px 6px; font-size: 0.72rem; width: auto; line-height: 1;" title="Cancel">✖</button>
                        </div>
                        <div id="clip-rename-err-${idx}" style="display: none; font-size: 0.7rem; color: var(--error-color); margin-top: 2px;"></div>
                    </div>
                    <div class="clip-progress-container">
                        <div class="clip-progress-bar" id="clip-prog-${idx}"></div>
                    </div>
                </div>
                <div class="clip-card-footer">
                    <button class="clip-action-btn clip-play-btn" onclick="playSoloClip('${f}', ${idx})" title="Play solo in workspace player">▶</button>
                </div>
            </div>`;
    }

    async function duplicateTimelineClip(btn, filename) {
        if (!currentSession) return;
        const card = btn.closest('.timeline-clip-card');
        if (!card) return;
        const container = card.closest('.timeline-container');
        const timelineId = container ? container.getAttribute('data-timeline-id') : null;

        btn.disabled = true;
        const origHtml = btn.innerHTML;
        btn.innerHTML = `<span style="font-size:0.75rem;">⏳</span>`;

        try {
            const res = await fetch('/duplicate-clip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: currentSession, filename: filename })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Duplication failed');

            const newFilename = data.new_filename;
            const origDetail = currentClips.find(c => c.filename === filename) || {};
            const meta = data.metadata || {};

            const newDetail = {
                filename: newFilename,
                index: currentClips.length + 1,
                duration: origDetail.duration || meta.duration || 0,
                duration_formatted: origDetail.duration_formatted || meta.duration_formatted || '',
                start_time: origDetail.start_time !== undefined ? origDetail.start_time : 0,
                end_time: origDetail.end_time !== undefined ? origDetail.end_time : (origDetail.duration || meta.duration || 0),
                start_formatted: origDetail.start_formatted || '',
                end_formatted: origDetail.end_formatted || '',
                range_label: origDetail.range_label || ''
            };

            // Insert into currentClips in-memory array
            const origIdx = currentClips.findIndex(c => c.filename === filename);
            if (origIdx !== -1) {
                currentClips.splice(origIdx + 1, 0, newDetail);
            } else {
                currentClips.push(newDetail);
            }

            // Build DOM element
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = createTimelineClipCardHtml(newFilename, 0, newDetail, currentClips.length);
            const newCard = tempDiv.firstElementChild;
            newCard.style.opacity = '0';
            newCard.style.transform = 'scale(0.85)';
            newCard.style.transition = 'opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1), transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)';

            if (card && card.parentNode) {
                card.insertAdjacentElement('afterend', newCard);
            } else {
                const track = container ? container.querySelector('.timeline-track') : document.getElementById('timelineTrack');
                if (track) track.appendChild(newCard);
            }

            // Remove empty notice in this track if present
            if (container) {
                const emptyNotice = container.querySelector('.timeline-empty-notice');
                if (emptyNotice) emptyNotice.remove();
            }

            // Trigger smooth entrance
            requestAnimationFrame(() => {
                newCard.style.opacity = '1';
                newCard.style.transform = 'scale(1)';
            });

            // Re-index this timeline's cards (#1, #2, etc.) and update duration
            updateTimelineIndices(timelineId);
            updateTimelineTotalDuration(timelineId);

            // Enable sequence / merge buttons on this timeline
            if (container) {
                const playSeq = container.querySelector('.btn-sequence-play');
                const mergeOnly = container.querySelector('.btn-merge-download');
                const mergeCrop = container.querySelector('.btn-merge-crop');
                if (playSeq) playSeq.disabled = false;
                if (mergeOnly) mergeOnly.disabled = false;
                if (mergeCrop) mergeCrop.disabled = false;
            }

            // Smooth scroll to the newly created clip card
            setTimeout(() => {
                newCard.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }, 100);

        } catch (err) {
            alert(`Could not duplicate clip: ${err.message}`);
        } finally {
            btn.disabled = false;
            btn.innerHTML = origHtml;
        }
    }

    async function deleteTimelineClip(btn, filename) {
        const card = btn.closest('.timeline-clip-card');
        if (!card) return;
        const container = card.closest('.timeline-container');
        const timelineId = container ? container.getAttribute('data-timeline-id') : null;

        // Visual feedback & animated exit transition
        card.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        card.style.opacity = '0';
        card.style.transform = 'scale(0.85)';
        card.style.pointerEvents = 'none';

        setTimeout(async () => {
            card.remove();

            // 1. Remove from in-memory currentClips array
            if (currentClips && Array.isArray(currentClips)) {
                currentClips = currentClips.filter(c => c.filename !== filename);
            }

            // 2. Re-index remaining cards (#1, #2, ...) & update shift button states
            updateTimelineIndices(timelineId);
            updateTimelineTotalDuration(timelineId);

            // 3. Handle empty timeline state for this track
            if (container) {
                const remainingCards = container.querySelectorAll('.timeline-clip-card');
                if (remainingCards.length === 0) {
                    const track = container.querySelector('.timeline-track');
                    if (track) {
                        track.innerHTML = `<div class="timeline-empty-notice" id="timelineEmptyNotice-${timelineId}">
                            <span>📥 Drag clips here or duplicate from other timelines</span>
                        </div>`;
                    }
                    const playSeq = container.querySelector('.btn-sequence-play');
                    const mergeOnly = container.querySelector('.btn-merge-download');
                    const mergeCrop = container.querySelector('.btn-merge-crop');
                    if (playSeq) playSeq.disabled = true;
                    if (mergeOnly) mergeOnly.disabled = true;
                    if (mergeCrop) mergeCrop.disabled = true;
                }
            }

            // 4. If workspace player is currently playing this deleted clip, stop it
            if (videoPlayer && videoPlayer.src && videoPlayer.src.includes(filename)) {
                videoPlayer.pause();
                const banner = document.getElementById('activeVideoBanner');
                if (banner) banner.style.display = 'none';
            }

            // 5. If sequence playback is active on this timeline, refresh the sequence queue
            if (isPlayingSequence && activePlayingTimelineId === timelineId) {
                sequenceClips = getTimelineClipsOrder(timelineId);
                if (sequenceClips.length === 0) {
                    isPlayingSequence = false;
                    updateSequencePlayButton(timelineId);
                    activeTimelineIndex = -1;
                    highlightTimelineCard(-1);
                }
            }

            // 6. Delete clip from server session directory in background
            if (currentSession && filename) {
                try {
                    await fetch('/delete-clip', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ session_id: currentSession, filename: filename })
                    });
                } catch (err) {
                    console.warn('Failed to delete clip file from server:', err);
                }
            }
        }, 200);
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


/* --- Clip Razor / Split Tool Logic --- */
    let activeSplitClipFilename = null;
    let activeSplitClipIndex = -1;
    let activeSplitTimelineId = null;
    let activeSplitClipDuration = 0.0;
    let activeSplitClipStartTime = 0.0;
    let activeSplitClipEndTime = 0.0;
    let activeSplitMarkers = [];

    function openSplitClipModal(filename, index, initialTime = null) {
        if (!currentSession) return;

        const card = document.querySelector(`.timeline-clip-card[data-filename="${filename}"]`);
        const container = card ? card.closest('.timeline-container') : null;
        const timelineId = container ? container.getAttribute('data-timeline-id') : 'timeline-1';

        activeSplitClipFilename = filename;
        activeSplitClipIndex = index;
        activeSplitTimelineId = timelineId;
        activeSplitMarkers = [];

        const detail = currentClips.find(c => c.filename === filename) || {};
        const cardStart = card ? parseFloat(card.getAttribute('data-start') || '0') : 0;
        const cardEnd = card ? parseFloat(card.getAttribute('data-end') || '0') : 0;

        activeSplitClipStartTime = (cardStart !== undefined && !isNaN(cardStart)) ? cardStart : (detail.start_time || 0);
        activeSplitClipEndTime = (cardEnd > activeSplitClipStartTime) ? cardEnd : (detail.end_time || (activeSplitClipStartTime + (detail.duration || 10)));
        
        activeSplitClipDuration = (activeSplitClipEndTime > activeSplitClipStartTime) 
            ? (activeSplitClipEndTime - activeSplitClipStartTime) 
            : (detail.duration || 10.0);

        const modal = document.getElementById('splitClipModal');
        if (!modal) return;

        const nameEl = document.getElementById('splitModalClipName');
        const metaEl = document.getElementById('splitModalClipMeta');
        const scrubber = document.getElementById('splitScrubber');
        const video = document.getElementById('splitModalVideoPlayer');

        if (nameEl) nameEl.innerText = `Split: ${filename}`;
        if (metaEl) metaEl.innerText = `Clip Duration: ${activeSplitClipDuration.toFixed(2)}s • Add cut marks on timeline`;

        if (scrubber) {
            scrubber.min = '0';
            scrubber.max = activeSplitClipDuration.toFixed(2);
            scrubber.step = '0.05';
            scrubber.value = '0';
        }

        if (initialTime !== null && initialTime >= 0.35 && initialTime <= (activeSplitClipDuration - 0.35)) {
            activeSplitMarkers.push(parseFloat(initialTime.toFixed(2)));
        }

        if (video) {
            video.src = `/media/${currentSession}/${filename}?t=${Date.now()}`;
            video.load();
            video.currentTime = parseFloat(scrubber ? scrubber.value : '0');
            
            video.onloadedmetadata = () => {
                if (video.duration && !isNaN(video.duration) && video.duration > 0.5) {
                    activeSplitClipDuration = video.duration;
                    if (scrubber) {
                        scrubber.max = activeSplitClipDuration.toFixed(2);
                    }
                }
                updateSplitModalDisplays();
            };

            video.ontimeupdate = () => {
                if (!video.paused && scrubber) {
                    scrubber.value = Math.min(activeSplitClipDuration, video.currentTime).toFixed(2);
                    updateCurrentTimeOnly();
                }
            };
        }

        updateSplitModalDisplays();
        modal.style.display = 'flex';
    }

    function addSplitMarker(timestamp = null) {
        const video = document.getElementById('splitModalVideoPlayer');
        const scrubber = document.getElementById('splitScrubber');
        
        let cutTime = (timestamp !== null) ? timestamp : (video ? video.currentTime : (scrubber ? parseFloat(scrubber.value) : 0));
        cutTime = parseFloat(cutTime.toFixed(2));

        const MIN_SLICE = 0.35;
        if (cutTime < MIN_SLICE) {
            alert(`Cut points must be at least ${MIN_SLICE}s from the start of the clip.`);
            return;
        }
        if (cutTime > (activeSplitClipDuration - MIN_SLICE)) {
            alert(`Cut points must be at least ${MIN_SLICE}s before the end of the clip.`);
            return;
        }

        for (let existing of activeSplitMarkers) {
            if (Math.abs(existing - cutTime) < MIN_SLICE) {
                alert(`Cut points must be at least ${MIN_SLICE}s apart from each other.`);
                return;
            }
        }

        activeSplitMarkers.push(cutTime);
        activeSplitMarkers.sort((a, b) => a - b);
        updateSplitModalDisplays();
    }

    function removeSplitMarker(idx) {
        if (idx >= 0 && idx < activeSplitMarkers.length) {
            activeSplitMarkers.splice(idx, 1);
            updateSplitModalDisplays();
        }
    }

    function clearSplitMarkers() {
        activeSplitMarkers = [];
        updateSplitModalDisplays();
    }

    function seekSplitTo(timestamp) {
        const video = document.getElementById('splitModalVideoPlayer');
        const scrubber = document.getElementById('splitScrubber');
        if (video) video.currentTime = timestamp;
        if (scrubber) scrubber.value = timestamp.toFixed(2);
        updateCurrentTimeOnly();
    }

    function updateCurrentTimeOnly() {
        const scrubber = document.getElementById('splitScrubber');
        const curVal = scrubber ? parseFloat(scrubber.value) : 0;
        const totalVal = activeSplitClipDuration || 0;

        const currentEl = document.getElementById('splitCurrentTimeDisplay');
        const totalEl = document.getElementById('splitTotalTimeDisplay');
        if (currentEl) currentEl.innerText = formatTimeSec(curVal);
        if (totalEl) totalEl.innerText = formatTimeSec(totalVal);
    }

    function updateSplitModalDisplays() {
        updateCurrentTimeOnly();

        const totalVal = activeSplitClipDuration || 0;

        // 1. Render Marker Pins over Scrubber
        const pinTrack = document.getElementById('splitMarkersPinTrack');
        if (pinTrack) {
            pinTrack.innerHTML = '';
            if (totalVal > 0) {
                activeSplitMarkers.forEach(m => {
                    const pct = (m / totalVal) * 100;
                    const pin = document.createElement('div');
                    pin.className = 'split-marker-pin';
                    pin.style.left = `${pct}%`;
                    pin.title = `Cut at ${formatTimeSec(m)} (Click to seek)`;
                    pin.onclick = (e) => {
                        e.stopPropagation();
                        seekSplitTo(m);
                    };
                    pinTrack.appendChild(pin);
                });
            }
        }

        // 2. Render Active Marker Chips
        const chipsContainer = document.getElementById('splitMarkersChipContainer');
        const clearBtn = document.getElementById('btnClearAllMarkers');
        if (chipsContainer) {
            chipsContainer.innerHTML = '';
            if (activeSplitMarkers.length === 0) {
                chipsContainer.innerHTML = `<span style="font-size: 0.76rem; color: #64748b;">No cut marks yet. Position the playhead and click <strong>"📍 Mark Cut Point"</strong> (or press <strong>M</strong>).</span>`;
                if (clearBtn) clearBtn.style.display = 'none';
            } else {
                if (clearBtn) clearBtn.style.display = 'inline-flex';
                activeSplitMarkers.forEach((m, idx) => {
                    const chip = document.createElement('div');
                    chip.className = 'split-marker-chip';
                    chip.title = `Click to seek to ${formatTimeSec(m)}`;
                    chip.onclick = () => seekSplitTo(m);
                    chip.innerHTML = `<span>📍 ${formatTimeSec(m)}</span><span class="split-marker-chip-del" onclick="event.stopPropagation(); removeSplitMarker(${idx})" title="Remove this cut mark">&times;</span>`;
                    chipsContainer.appendChild(chip);
                });
            }
        }

        // 3. Render Resulting Pieces Breakdown Grid
        const grid = document.getElementById('splitSegmentsGrid');
        const countBadge = document.getElementById('splitResultCountBadge');
        const confirmBtn = document.getElementById('btnConfirmSplitClip');

        const boundaries = [0.0, ...activeSplitMarkers, totalVal];
        const numPieces = boundaries.length - 1;

        if (grid) {
            grid.innerHTML = '';
            const colors = ['#38bdf8', '#a855f7', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4'];

            for (let i = 0; i < numPieces; i++) {
                const segStart = boundaries[i];
                const segEnd = boundaries[i + 1];
                const segDur = Math.max(0, segEnd - segStart);
                const absStart = activeSplitClipStartTime + segStart;
                const absEnd = activeSplitClipStartTime + segEnd;
                const col = colors[i % colors.length];

                const card = document.createElement('div');
                card.className = 'split-segment-card';
                card.innerHTML = `
                    <div style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; color: ${col}; font-weight: 700; margin-bottom: 2px;">
                        Piece #${i + 1}
                    </div>
                    <div style="font-family: monospace; font-size: 0.95rem; font-weight: 700; color: #f1f5f9;">
                        ${segDur.toFixed(2)}s
                    </div>
                    <div style="font-size: 0.72rem; color: #94a3b8; font-family: monospace; margin-top: 2px;">
                        ${formatTimeSec(absStart)} ➔ ${formatTimeSec(absEnd)}
                    </div>
                `;
                grid.appendChild(card);
            }
        }

        if (countBadge) {
            countBadge.innerText = `${numPieces} Clip${numPieces === 1 ? ' (No cuts)' : 's'}`;
        }

        if (confirmBtn) {
            if (activeSplitMarkers.length === 0) {
                confirmBtn.innerHTML = `✂️ Add at least 1 Cut Mark`;
                confirmBtn.disabled = true;
                confirmBtn.style.opacity = '0.6';
            } else {
                confirmBtn.innerHTML = `✂️ Split into ${numPieces} Clips`;
                confirmBtn.disabled = false;
                confirmBtn.style.opacity = '1';
            }
        }
    }

    function onSplitScrubberInput(val) {
        const video = document.getElementById('splitModalVideoPlayer');
        const num = parseFloat(val);
        if (video && !isNaN(num)) {
            if (!video.paused) video.pause();
            video.currentTime = num;
        }
        updateCurrentTimeOnly();
    }

    function onSplitScrubberChange(val) {
        onSplitScrubberInput(val);
    }

    function nudgeSplitScrubber(delta) {
        const scrubber = document.getElementById('splitScrubber');
        if (!scrubber) return;

        const min = parseFloat(scrubber.min) || 0;
        const max = parseFloat(scrubber.max) || activeSplitClipDuration;
        let current = parseFloat(scrubber.value) || min;

        let target = Math.max(min, Math.min(max, current + delta));
        scrubber.value = target.toFixed(2);
        onSplitScrubberInput(scrubber.value);
    }

    function toggleSplitModalPlayback() {
        const video = document.getElementById('splitModalVideoPlayer');
        const btn = document.getElementById('btnSplitModalPlayToggle');
        if (!video) return;

        if (video.paused) {
            video.play().catch(() => {});
            if (btn) btn.innerHTML = `⏸ Pause`;
        } else {
            video.pause();
            if (btn) btn.innerHTML = `▶ Play`;
        }
    }

    function handleSplitModalBackdropClick(e) {
        if (e.target.id === 'splitClipModal') {
            closeSplitClipModal();
        }
    }

    function closeSplitClipModal() {
        const modal = document.getElementById('splitClipModal');
        if (modal) modal.style.display = 'none';

        const video = document.getElementById('splitModalVideoPlayer');
        if (video) {
            video.pause();
            video.removeAttribute('src');
        }
        const btn = document.getElementById('btnSplitModalPlayToggle');
        if (btn) btn.innerHTML = `▶ Play`;

        const confirmBtn = document.getElementById('btnConfirmSplitClip');
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = `✂️ Split into Clips`;
        }
    }

    async function executeSplitClip() {
        if (!currentSession || !activeSplitClipFilename) return;

        if (activeSplitMarkers.length === 0) {
            alert("Please add at least one cut mark using '📍 Mark Cut Point' (or press M).");
            return;
        }

        const confirmBtn = document.getElementById('btnConfirmSplitClip');
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.innerHTML = `⏳ Slicing with FFmpeg...`;
        }

        try {
            const res = await fetch('/split-clip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: currentSession,
                    filename: activeSplitClipFilename,
                    source_filename: currentFilename,
                    split_points: activeSplitMarkers,
                    start_time: activeSplitClipStartTime,
                    end_time: activeSplitClipEndTime
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to split clip');

            const parts = data.parts || [data.part1, data.part2];
            if (!parts || parts.length < 2) throw new Error('Invalid response from server');

            const card1 = document.querySelector(`.timeline-clip-card[data-filename="${activeSplitClipFilename}"]`);
            const container = card1 ? card1.closest('.timeline-container') : null;
            const timelineId = container ? container.getAttribute('data-timeline-id') : (activeSplitTimelineId || 'timeline-1');

            const origIdx = currentClips.findIndex(c => c.filename === activeSplitClipFilename);

            // Update Part 1 in-place
            const p1 = parts[0];
            if (origIdx !== -1) {
                currentClips[origIdx] = { ...currentClips[origIdx], ...p1 };
            }

            if (card1) {
                card1.setAttribute('data-start', p1.start_time);
                card1.setAttribute('data-end', p1.end_time);

                const durBadge = card1.querySelector('.clip-duration-badge');
                if (durBadge) durBadge.innerText = `⏱ ${p1.duration_formatted}`;

                const rangeBadge = card1.querySelector('.clip-range-badge');
                if (rangeBadge) {
                    rangeBadge.innerText = `📍 ${p1.range_label}`;
                    rangeBadge.style.display = 'block';
                }
            }

            // Consecutively insert Part 2, Part 3, etc.
            let prevCard = card1;
            for (let k = 1; k < parts.length; k++) {
                const part = parts[k];
                if (origIdx !== -1) {
                    currentClips.splice(origIdx + k, 0, part);
                } else {
                    currentClips.push(part);
                }

                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = createTimelineClipCardHtml(part.filename, (origIdx !== -1 ? origIdx + k : 0), part, currentClips.length);
                const newCard = tempDiv.firstElementChild;
                newCard.style.opacity = '0';
                newCard.style.transform = 'scale(0.85)';
                newCard.style.transition = 'opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1), transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)';

                if (prevCard && prevCard.parentNode) {
                    prevCard.insertAdjacentElement('afterend', newCard);
                } else if (container) {
                    const track = container.querySelector('.timeline-track');
                    if (track) track.appendChild(newCard);
                }

                requestAnimationFrame(() => {
                    newCard.style.opacity = '1';
                    newCard.style.transform = 'scale(1)';
                });

                prevCard = newCard;
            }

            updateTimelineIndices(timelineId);
            updateTimelineTotalDuration(timelineId);

            if (videoPlayer && videoPlayer.src && videoPlayer.src.includes(activeSplitClipFilename)) {
                videoPlayer.src = `/media/${currentSession}/${activeSplitClipFilename}?t=${Date.now()}`;
                videoPlayer.load();
            }

            closeSplitClipModal();
            showStatus('splitStatus', 'success', `✂️ Clip successfully split into ${parts.length} clips! Delete any piece with 🗑 or rearrange on the timeline.`);

        } catch (err) {
            alert(`Failed to split clip: ${err.message}`);
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.innerHTML = `✂️ Split into Clips`;
            }
        }
    }

    // Keyboard shortcuts for split modal
    document.addEventListener('keydown', (e) => {
        const modal = document.getElementById('splitClipModal');
        if (!modal || modal.style.display === 'none') return;

        if (e.key === 'Escape') {
            closeSplitClipModal();
        } else if (e.key === ' ' && e.target.tagName !== 'INPUT') {
            e.preventDefault();
            toggleSplitModalPlayback();
        } else if ((e.key === 'm' || e.key === 'M') && e.target.tagName !== 'INPUT') {
            e.preventDefault();
            addSplitMarker();
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            nudgeSplitScrubber(-0.1);
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            nudgeSplitScrubber(0.1);
        }
    });
