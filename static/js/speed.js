/* --- Video Speed Controller (Integrated Left-Panel Tool) --- */

let activeSpeedTargetType = 'master'; // 'master' | 'clip' | 'merged'
let activeSpeedTargetFilename = null;
let activeSpeedTargetIndex = -1;
let activeSpeedOriginalDuration = 0;
let activeSpeedTimelineId = null;
let activeSpeedTaskId = null;

// Time formatting helper matching state.js formatTimeSec
function formatTimestamp(seconds) {
    if (typeof formatTimeSec === 'function') {
        return formatTimeSec(seconds);
    }
    const s = Math.max(0, seconds || 0);
    const m = Math.floor(s / 60);
    const rem = (s % 60).toFixed(2);
    return `${m.toString().padStart(2, '0')}:${rem.padStart(5, '0')}`;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    setSpeedPreset(1.2);
});

/**
 * Select a video target (master, clip, or merged) and configure the sidebar Speed Tool.
 */
function selectSpeedTarget(type, filename, clipIndex = -1, customDuration = null, timelineId = null) {
    if (!currentSession) {
        return;
    }

    activeSpeedTargetType = type;
    activeSpeedTargetFilename = filename || currentFilename;
    activeSpeedTargetIndex = clipIndex;
    activeSpeedTimelineId = timelineId;

    // Detect duration
    let dur = 0;
    if (customDuration && customDuration > 0) {
        dur = customDuration;
    } else if (type === 'clip' && clipIndex >= 0 && currentClips && currentClips.length > 0) {
        const found = currentClips.find(c => c.filename === activeSpeedTargetFilename);
        if (found) dur = found.duration || 0;
    }

    if (!dur && type === 'clip') {
        const card = document.querySelector(`.timeline-clip-card[data-filename="${activeSpeedTargetFilename}"]`);
        if (card) {
            const s = parseFloat(card.getAttribute('data-start') || '0');
            const e = parseFloat(card.getAttribute('data-end') || '0');
            if (e > s) dur = e - s;
            const container = card.closest('.timeline-container');
            if (container) activeSpeedTimelineId = container.getAttribute('data-timeline-id');
        }
    }

    if (!dur && type === 'merged') {
        const player = document.getElementById('mergedVideoPlayer');
        if (player && player.duration && !isNaN(player.duration)) {
            dur = player.duration;
        }
    }

    if (!dur && videoMeta && videoMeta.duration) {
        dur = videoMeta.duration;
    }

    activeSpeedOriginalDuration = dur > 0 ? dur : 10.0;

    // Sync tab button active states
    const tabMaster = document.getElementById('tabSpeedMaster');
    const tabClip = document.getElementById('tabSpeedClip');
    const tabMerged = document.getElementById('tabSpeedMerged');

    if (tabMaster) {
        tabMaster.className = (type === 'master') ? 'btn btn-sm speed-tab-btn active' : 'btn btn-outline btn-sm speed-tab-btn';
    }
    if (tabClip) {
        tabClip.className = (type === 'clip') ? 'btn btn-sm speed-tab-btn active' : 'btn btn-outline btn-sm speed-tab-btn';
    }
    if (tabMerged) {
        tabMerged.className = (type === 'merged') ? 'btn btn-sm speed-tab-btn active' : 'btn btn-outline btn-sm speed-tab-btn';
    }

    // Populate sidebar UI badges and text
    const typeBadge = document.getElementById('speedTargetTypeBadge');
    const nameEl = document.getElementById('speedTargetName');
    const origDurEl = document.getElementById('speedOrigDurText');
    const replaceLabel = document.getElementById('speedModeReplaceLabel');
    const newLabel = document.getElementById('speedModeNewLabel');
    const cardEl = document.getElementById('speedCard');

    if (typeBadge) {
        if (type === 'clip') {
            typeBadge.innerText = `Clip #${clipIndex >= 0 ? clipIndex + 1 : 1}`;
            typeBadge.style.background = 'rgba(56, 189, 248, 0.15)';
            typeBadge.style.color = '#38bdf8';
            typeBadge.style.borderColor = 'rgba(56, 189, 248, 0.35)';
        } else if (type === 'merged') {
            typeBadge.innerText = `Merged Video`;
            typeBadge.style.background = 'rgba(168, 85, 247, 0.15)';
            typeBadge.style.color = '#c084fc';
            typeBadge.style.borderColor = 'rgba(168, 85, 247, 0.35)';
        } else {
            typeBadge.innerText = `Main Video`;
            typeBadge.style.background = 'rgba(245, 158, 11, 0.15)';
            typeBadge.style.color = '#f59e0b';
            typeBadge.style.borderColor = 'rgba(245, 158, 11, 0.35)';
        }
    }

    if (nameEl) {
        nameEl.innerText = activeSpeedTargetFilename || '(No video loaded)';
        nameEl.title = activeSpeedTargetFilename || '';
    }

    if (origDurEl) {
        origDurEl.innerText = formatTimeSec(activeSpeedOriginalDuration);
    }

    if (replaceLabel) {
        if (type === 'clip') {
            replaceLabel.innerText = `Replace this clip on timeline`;
        } else if (type === 'merged') {
            replaceLabel.innerText = `Replace merged video file`;
        } else {
            replaceLabel.innerText = `Replace original main video file`;
        }
    }

    if (newLabel) {
        if (type === 'clip') {
            newLabel.innerText = `Add as new clip to same timeline track`;
        } else if (type === 'merged') {
            newLabel.innerText = `Save as new merged video file`;
        } else {
            newLabel.innerText = `Add sped-up version as clip to timeline`;
        }
    }

    // Refresh slider readout & new duration
    const slider = document.getElementById('speedSliderInput');
    const curVal = slider ? parseFloat(slider.value) : 1.2;
    onSpeedSliderInput(curVal);

    // Smooth scroll sidebar to speedCard and highlight
    if (cardEl) {
        cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        cardEl.classList.remove('speed-card-highlight');
        void cardEl.offsetWidth; // Trigger reflow for animation restart
        cardEl.classList.add('speed-card-highlight');
        setTimeout(() => cardEl.classList.remove('speed-card-highlight'), 1300);
    }
}

/**
 * Focus timeline clip target. If no clip selected, picks the first clip on the active timeline.
 */
function focusCurrentOrFirstClip() {
    if (!currentSession) {
        alert("Please import a video first.");
        return;
    }

    if (!currentClips || currentClips.length === 0) {
        showStatus('speedStatus', 'warning', 'No timeline clips created yet. Generate clips first or speed up the Main Video.');
        const statusBox = document.getElementById('speedStatus');
        if (statusBox) statusBox.style.display = 'block';
        return;
    }

    let targetClip = null;
    let targetIdx = 0;

    // Check if a clip is currently previewing in the active banner
    const titleEl = document.getElementById('activeVideoTitle');
    const text = titleEl ? titleEl.innerText : '';
    const match = text.match(/\((.*?)\)/);
    const activeFn = match ? match[1] : null;

    if (activeFn) {
        const foundIdx = currentClips.findIndex(c => c.filename === activeFn);
        if (foundIdx !== -1) {
            targetClip = currentClips[foundIdx];
            targetIdx = foundIdx;
        }
    }

    if (!targetClip) {
        targetClip = currentClips[0];
        targetIdx = 0;
    }

    openSpeedModal(targetClip.filename, targetIdx);
}

/**
 * Open speed control targeting a timeline clip.
 */
function openSpeedModal(filename, clipIndex = -1, customDuration = null) {
    let card = null;
    if (clipIndex >= 0) {
        card = document.querySelector(`.timeline-clip-card[data-filename="${filename}"][data-index="${clipIndex}"]`) ||
               document.querySelector(`.timeline-clip-card[data-filename="${filename}"]`);
    } else {
        card = document.querySelector(`.timeline-clip-card[data-filename="${filename}"]`);
    }

    const container = card ? card.closest('.timeline-container') : null;
    const timelineId = container ? container.getAttribute('data-timeline-id') : null;

    selectSpeedTarget('clip', filename, clipIndex, customDuration, timelineId);
}

/**
 * Open speed control targeting the original main video.
 */
function openSpeedForMasterVideo() {
    if (!currentSession || !currentFilename) {
        return;
    }
    const dur = videoMeta ? videoMeta.duration : null;
    selectSpeedTarget('master', currentFilename, -1, dur, null);
}

/**
 * Open speed control targeting the merged video.
 */
function openSpeedForMergedVideo() {
    if (!currentSession) {
        alert("Please import a video first.");
        return;
    }

    const downloadBtn = document.getElementById('downloadMergedBtn');
    let mergedFn = downloadBtn ? downloadBtn.getAttribute('download') : null;

    if (!mergedFn && downloadBtn && downloadBtn.href) {
        const parts = downloadBtn.href.split('/');
        mergedFn = parts[parts.length - 1];
    }

    const previewContainer = document.getElementById('mergePreviewContainer');
    if (!mergedFn || !previewContainer || previewContainer.style.display === 'none') {
        alert("Please merge clips first to adjust the merged video speed.");
        return;
    }

    const player = document.getElementById('mergedVideoPlayer');
    const dur = (player && player.duration && !isNaN(player.duration)) ? player.duration : null;

    // Reveal the merged tab if hidden
    const tabMerged = document.getElementById('tabSpeedMerged');
    if (tabMerged) tabMerged.style.display = 'inline-flex';

    selectSpeedTarget('merged', mergedFn, -1, dur, null);
}

/**
 * Open speed control targeting whatever video is currently playing/active.
 */
function openSpeedForActiveVideo() {
    if (!currentSession) {
        alert("Please import a video first.");
        return;
    }

    const titleEl = document.getElementById('activeVideoTitle');
    const banner = document.getElementById('activeVideoBanner');
    const isBannerVisible = banner && banner.style.display !== 'none';
    const text = titleEl ? titleEl.innerText : '';
    const match = text.match(/\((.*?)\)/);
    const activeFn = match ? match[1] : null;

    if (isBannerVisible && activeFn) {
        const idx = (currentClips && currentClips.length > 0) ? currentClips.findIndex(c => c.filename === activeFn) : -1;
        if (idx >= 0) {
            openSpeedModal(activeFn, idx);
            return;
        }
    }

    // Default to main video
    openSpeedForMasterVideo();
}

function setSpeedPreset(speed) {
    const slider = document.getElementById('speedSliderInput');
    if (slider) {
        slider.value = speed;
    }
    onSpeedSliderInput(speed);

    // Highlight active preset chip in sidebar
    document.querySelectorAll('.speed-preset-chip').forEach(btn => {
        const txt = btn.innerText.trim();
        if (txt.startsWith(`${speed}x`)) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

function onSpeedSliderInput(val) {
    const speed = parseFloat(val);
    const speedStr = speed.toFixed(2);

    const readout = document.getElementById('speedValueReadout');
    const previewBtnText = document.getElementById('previewSpeedBtnText');
    const newDurEl = document.getElementById('speedNewDurText');
    const diffBadge = document.getElementById('speedDiffBadge');

    if (readout) readout.innerText = `${speedStr}x`;
    if (previewBtnText) previewBtnText.innerText = `${speedStr}x`;

    if (activeSpeedOriginalDuration > 0) {
        const newDur = activeSpeedOriginalDuration / speed;
        if (newDurEl) newDurEl.innerText = formatTimeSec(newDur);

        const diff = newDur - activeSpeedOriginalDuration;
        if (diffBadge) {
            const sign = diff >= 0 ? '+' : '';
            diffBadge.innerText = `${sign}${diff.toFixed(1)}s`;
            diffBadge.style.color = diff <= 0 ? '#38bdf8' : '#f59e0b';
            diffBadge.style.background = diff <= 0 ? 'rgba(56, 189, 248, 0.15)' : 'rgba(245, 158, 11, 0.15)';
        }
    }

    // Live update player rate if previewing
    if (videoPlayer && !videoPlayer.paused) {
        videoPlayer.playbackRate = speed;
    }
    const mergedPlayer = document.getElementById('mergedVideoPlayer');
    if (mergedPlayer && !mergedPlayer.paused) {
        mergedPlayer.playbackRate = speed;
    }
}

function previewCurrentSpeedInPlayer() {
    const slider = document.getElementById('speedSliderInput');
    const speed = parseFloat(slider ? slider.value : '1.0');

    if (activeSpeedTargetType === 'merged') {
        const mergedPlayer = document.getElementById('mergedVideoPlayer');
        if (mergedPlayer) {
            mergedPlayer.playbackRate = speed;
            mergedPlayer.play().catch(() => {});
            mergedPlayer.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
    }

    if (videoPlayer && activeSpeedTargetFilename) {
        if (!videoPlayer.src.includes(encodeURIComponent(activeSpeedTargetFilename))) {
            videoPlayer.src = `/media/${currentSession}/${activeSpeedTargetFilename}?t=${Date.now()}`;
        }
        videoPlayer.playbackRate = speed;
        videoPlayer.play().catch(() => {});
        document.getElementById('videoContainer')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

/**
 * Cancel the currently running speed processing task.
 */
async function cancelSpeedTask() {
    if (!activeSpeedTaskId) return;

    const cancelBtn = document.getElementById('btnCancelSpeed');
    const msgEl = document.getElementById('speedProgressMsg');

    if (cancelBtn) {
        cancelBtn.disabled = true;
        cancelBtn.innerHTML = '<span>⏳ Aborting FFmpeg...</span>';
    }
    if (msgEl) {
        msgEl.innerText = 'Aborting process...';
    }

    try {
        const res = await fetch(`/tasks/${activeSpeedTaskId}/cancel`, { method: 'POST' });
        const data = await res.json();
        showStatus('speedStatus', 'warning', data.message || 'Speed conversion aborted by user.');
    } catch (err) {
        console.warn('Speed cancel error:', err);
    }
}

/**
 * Execute speed conversion and manage real-time progress and cancellation.
 */
async function executeSpeedChange() {
    if (!currentSession) {
        alert("Please import a video first.");
        return;
    }

    if (!activeSpeedTargetFilename) {
        activeSpeedTargetFilename = currentFilename;
        activeSpeedTargetType = 'master';
    }

    const slider = document.getElementById('speedSliderInput');
    const speed = parseFloat(slider ? slider.value : '1.0');

    const modeRadio = document.querySelector('input[name="speedOutputMode"]:checked');
    const mode = modeRadio ? modeRadio.value : 'replace';

    const preservePitchCheckbox = document.getElementById('speedPreservePitch');
    const preservePitch = preservePitchCheckbox ? preservePitchCheckbox.checked : true;

    const actionsContainer = document.getElementById('speedActionsContainer');
    const progressWrap = document.getElementById('speedProgressWrap');
    const progressMsg = document.getElementById('speedProgressMsg');
    const progressPct = document.getElementById('speedProgressPct');
    const progressBar = document.getElementById('speedProgressBar');
    const cancelBtn = document.getElementById('btnCancelSpeed');
    const statusBox = document.getElementById('speedStatus');

    if (statusBox) statusBox.style.display = 'block';

    // Reveal progress UI and hide apply button
    if (actionsContainer) actionsContainer.style.display = 'none';
    if (progressWrap) progressWrap.style.display = 'block';
    if (progressBar) progressBar.style.width = '0%';
    if (progressPct) progressPct.innerText = '0%';
    if (progressMsg) progressMsg.innerText = `Starting ${speed}x conversion...`;
    if (cancelBtn) {
        cancelBtn.disabled = false;
        cancelBtn.innerHTML = '<span>⛔ Stop / Cancel Processing</span>';
    }

    showStatus('speedStatus', 'info', `Queuing speed change (${speed}x) for ${activeSpeedTargetFilename}...`);

    try {
        const res = await fetch('/change-speed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: currentSession,
                filename: activeSpeedTargetFilename,
                speed: speed,
                mode: mode,
                preserve_pitch: preservePitch
            })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to start speed conversion');

        activeSpeedTaskId = data.task_id;

        // Poll task progress
        const taskResult = await pollTask(activeSpeedTaskId, {
            onProgress: (pct, msg) => {
                if (progressBar) progressBar.style.width = `${pct}%`;
                if (progressPct) progressPct.innerText = `${pct}%`;
                if (progressMsg) progressMsg.innerText = `${msg}`;
                showStatus('speedStatus', 'info', `[Speed ${speed}x] ${msg} (${pct}%)`);
            }
        });

        // Conversion successful!
        const resultFile = taskResult.file || data.target_filename;
        const newMeta = taskResult.metadata || {};
        const newDuration = newMeta.duration || (activeSpeedOriginalDuration / speed);

        pushCurrentStateToUndo();

        if (activeSpeedTargetType === 'merged') {
            // Merged video was sped up
            const mergedPlayer = document.getElementById('mergedVideoPlayer');
            const downloadMergedBtn = document.getElementById('downloadMergedBtn');
            const streamUrl = `/media/${currentSession}/${resultFile}?t=${Date.now()}`;
            const downloadUrl = `/download/${currentSession}/${resultFile}`;

            if (downloadMergedBtn) {
                downloadMergedBtn.href = downloadUrl;
                downloadMergedBtn.setAttribute('download', resultFile);
            }
            if (mergedPlayer) {
                mergedPlayer.src = streamUrl;
                mergedPlayer.load();
            }

            activeSpeedTargetFilename = resultFile;
            activeSpeedOriginalDuration = newDuration;

            showStatus('speedStatus', 'success', `✓ Successfully sped up merged video to ${speed}x!`);
            showStatus('mergeStatus', 'success', `⚡ Merged video sped up to ${speed}x (${resultFile})!`);

        } else if (activeSpeedTargetType === 'master') {
            // Master video was sped up
            if (videoMeta) {
                videoMeta.duration = newDuration;
                videoMeta.duration_formatted = `${formatTimeSec(newDuration)}`;
                const durCell = document.querySelector('#metaTable tbody tr:first-child td');
                if (durCell) durCell.innerText = videoMeta.duration_formatted;
            }

            if (mode === 'replace') {
                if (videoPlayer) {
                    videoPlayer.src = `/media/${currentSession}/${currentFilename}?t=${Date.now()}`;
                    videoPlayer.load();
                }
                activeSpeedOriginalDuration = newDuration;
                showStatus('speedStatus', 'success', `✓ Successfully sped up main video to ${speed}x!`);
            } else {
                // Add sped-up version as a new clip to timeline
                const newDetail = {
                    filename: resultFile,
                    index: currentClips.length + 1,
                    duration: newDuration,
                    duration_formatted: `${newDuration.toFixed(2)}s`,
                    start_time: 0,
                    end_time: newDuration,
                    range_label: `${formatTimestamp(0)} -> ${formatTimestamp(newDuration)} (${speed}x)`
                };

                // Find active timeline or create one
                let targetContainer = activePlayingTimelineId ? document.getElementById(`timelineContainer-${activePlayingTimelineId}`) : document.querySelector('.timeline-container');
                let targetTimelineId = targetContainer ? targetContainer.getAttribute('data-timeline-id') : 'timeline-1';

                if (!targetContainer) {
                    addNewTimeline([newDetail]);
                } else {
                    const track = targetContainer.querySelector('.timeline-track');
                    if (track) {
                        const emptyNotice = track.querySelector('.timeline-empty-notice');
                        if (emptyNotice) emptyNotice.remove();

                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = createTimelineClipCardHtml(resultFile, currentClips.length, newDetail, currentClips.length + 1);
                        const newCard = tempDiv.firstElementChild;
                        track.appendChild(newCard);
                    }
                    currentClips.push(newDetail);
                    updateTimelineIndices(targetTimelineId);
                    updateTimelineTotalDuration(targetTimelineId);
                    saveWorkspaceState();
                }

                showStatus('speedStatus', 'success', `✓ Added sped-up clip "${resultFile}" (${speed}x) to timeline!`);
            }
        } else if (mode === 'replace') {
            // Updated clip in-place
            const foundClip = currentClips.find(c => c.filename === activeSpeedTargetFilename);
            if (foundClip) {
                foundClip.duration = newDuration;
                foundClip.duration_formatted = `${newDuration.toFixed(2)}s`;
                if (foundClip.end_time !== undefined && foundClip.start_time !== undefined) {
                    foundClip.end_time = foundClip.start_time + newDuration;
                }
            }

            // Update card DOM badges
            document.querySelectorAll(`.timeline-clip-card[data-filename="${activeSpeedTargetFilename}"]`).forEach(card => {
                card.setAttribute('data-end', (parseFloat(card.getAttribute('data-start') || '0') + newDuration).toFixed(2));
                const durBadge = card.querySelector('.clip-duration-badge');
                if (durBadge) durBadge.innerText = `⏱ ${newDuration.toFixed(2)}s (${speed}x)`;
            });

            // Reload video player if currently showing this clip
            if (videoPlayer && videoPlayer.src.includes(encodeURIComponent(activeSpeedTargetFilename))) {
                videoPlayer.src = `/media/${currentSession}/${activeSpeedTargetFilename}?t=${Date.now()}`;
                videoPlayer.load();
            }

            activeSpeedOriginalDuration = newDuration;
            showStatus('speedStatus', 'success', `✓ Successfully sped up "${activeSpeedTargetFilename}" to ${speed}x!`);
            updateTimelineIndices(activeSpeedTimelineId);
            updateTimelineTotalDuration(activeSpeedTimelineId);
            saveWorkspaceState();
        } else {
            // Mode === 'new' on a timeline clip: ADD TO THE EXACT SAME TIMELINE RIGHT AFTER ORIGINAL CLIP
            const origCard = document.querySelector(`.timeline-clip-card[data-filename="${activeSpeedTargetFilename}"]`);
            let targetContainer = null;
            let targetTimelineId = activeSpeedTimelineId;

            if (origCard) {
                targetContainer = origCard.closest('.timeline-container');
                if (targetContainer) {
                    targetTimelineId = targetContainer.getAttribute('data-timeline-id');
                }
            }
            if (!targetContainer && targetTimelineId) {
                targetContainer = document.getElementById(`timelineContainer-${targetTimelineId}`);
            }
            if (!targetContainer) {
                targetContainer = document.querySelector('.timeline-container');
                if (targetContainer) targetTimelineId = targetContainer.getAttribute('data-timeline-id');
            }

            const track = targetContainer ? targetContainer.querySelector('.timeline-track') : null;

            const origClip = currentClips.find(c => c.filename === activeSpeedTargetFilename) || {};
            const newDetail = {
                filename: resultFile,
                index: currentClips.length + 1,
                duration: newDuration,
                duration_formatted: `${newDuration.toFixed(2)}s`,
                start_time: 0,
                end_time: newDuration,
                range_label: `${formatTimestamp(0)} -> ${formatTimestamp(newDuration)} (${speed}x)`
            };

            // Insert into in-memory currentClips directly after the original clip
            const origIdx = currentClips.findIndex(c => c.filename === activeSpeedTargetFilename);
            if (origIdx !== -1) {
                currentClips.splice(origIdx + 1, 0, newDetail);
            } else {
                currentClips.push(newDetail);
            }

            // Insert into DOM right after original clip in the SAME timeline track
            if (track) {
                const emptyNotice = track.querySelector('.timeline-empty-notice');
                if (emptyNotice) emptyNotice.remove();

                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = createTimelineClipCardHtml(resultFile, origIdx !== -1 ? origIdx + 1 : currentClips.length - 1, newDetail, currentClips.length);
                const newCard = tempDiv.firstElementChild;
                newCard.style.opacity = '0';
                newCard.style.transform = 'scale(0.92)';
                newCard.style.transition = 'opacity 0.25s ease, transform 0.25s ease';

                if (origCard && origCard.parentNode === track) {
                    origCard.insertAdjacentElement('afterend', newCard);
                } else {
                    track.appendChild(newCard);
                }

                requestAnimationFrame(() => {
                    newCard.style.opacity = '1';
                    newCard.style.transform = 'scale(1)';
                });
            }

            // Target the newly created clip in the speed card
            activeSpeedTargetFilename = resultFile;
            activeSpeedOriginalDuration = newDuration;

            showStatus('speedStatus', 'success', `✓ Added new sped-up clip "${resultFile}" (${speed}x) to the same timeline!`);

            // Re-index and update duration of this timeline
            updateTimelineIndices(targetTimelineId);
            updateTimelineTotalDuration(targetTimelineId);
            saveWorkspaceState();
        }

        // Update display readout in left panel
        const origDurEl = document.getElementById('speedOrigDurText');
        const nameEl = document.getElementById('speedTargetName');
        if (origDurEl) origDurEl.innerText = formatTimeSec(activeSpeedOriginalDuration);
        if (nameEl) nameEl.innerText = activeSpeedTargetFilename;
        onSpeedSliderInput(speed);

    } catch (err) {
        if (err.message && err.message.toLowerCase().includes('cancel')) {
            showStatus('speedStatus', 'warning', 'Speed adjustment stopped by user.');
        } else {
            showStatus('speedStatus', 'error', `Speed adjustment failed: ${err.message}`);
        }
    } finally {
        activeSpeedTaskId = null;
        if (progressWrap) progressWrap.style.display = 'none';
        if (actionsContainer) actionsContainer.style.display = 'block';
    }
}
