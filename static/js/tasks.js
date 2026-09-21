/* --- Asynchronous Background Task Poller --- */
async function pollTask(taskId, { onProgress = null, statusElementId = null, intervalMs = 500 } = {}) {
    return new Promise((resolve, reject) => {
        let isDone = false;
        const timer = setInterval(async () => {
            if (isDone) return;
            try {
                const res = await fetch(`/tasks/${taskId}`);
                if (!res.ok) {
                    isDone = true;
                    clearInterval(timer);
                    const err = await res.json().catch(() => ({}));
                    return reject(new Error(err.error || `Task request failed (HTTP ${res.status})`));
                }
                const task = await res.json();
                
                if (task.status === 'processing' || task.status === 'queued') {
                    const pct = task.progress || 0;
                    const msg = task.message || (task.status === 'queued' ? 'Queued in background...' : 'Processing...');
                    if (onProgress) {
                        onProgress(pct, msg);
                    } else if (statusElementId) {
                        showStatus(statusElementId, 'info', `${msg} (${pct}%)`);
                    }
                } else if (task.status === 'completed') {
                    isDone = true;
                    clearInterval(timer);
                    resolve(task.result || {});
                } else if (task.status === 'failed') {
                    isDone = true;
                    clearInterval(timer);
                    reject(new Error(task.error || 'Background task failed'));
                } else if (task.status === 'cancelled') {
                    isDone = true;
                    clearInterval(timer);
                    reject(new Error('Task was cancelled'));
                }
            } catch (err) {
                isDone = true;
                clearInterval(timer);
                reject(err);
            }
        }, intervalMs);
    });
}

/* --- Dedicated Merge & Stack Engine --- */
async function mergeClips(mode = 'merge', timelineId = null) {
    if (!currentSession) return;
    
    let container = null;
    if (timelineId) {
        container = document.getElementById(`timelineContainer-${timelineId}`) || 
                    document.querySelector(`[data-timeline-id="${timelineId}"]`);
    } else {
        container = document.querySelector('.timeline-container');
    }
    if (!container) return;

    const track = container.querySelector('.timeline-track');
    if (!track) return;
    const actualTimelineId = container.getAttribute('data-timeline-id') || timelineId;
    const timelineTitle = container.querySelector('.timeline-title-badge')?.innerText || 'Timeline';
    
    const cards = track.querySelectorAll('.timeline-clip-card');
    const filesInOrder = Array.from(cards).map(c => c.getAttribute('data-filename'));
    
    if (filesInOrder.length < 1) {
        showStatus('mergeStatus', 'error', `${timelineTitle}: Need at least 1 clip on this timeline to merge.`);
        return;
    }
    
    const btnOnly = container.querySelector('.btn-merge-download') || document.getElementById(`btnMergeOnly-${actualTimelineId}`) || document.getElementById('btnMergeOnly');
    const btnCrop = container.querySelector('.btn-merge-crop') || document.getElementById(`btnMergeCrop-${actualTimelineId}`) || document.getElementById('btnMergeCrop');
    const activeBtn = mode === 'merge_crop' ? btnCrop : btnOnly;
    
    const origOnlyText = btnOnly ? btnOnly.innerHTML : '';
    const origCropText = btnCrop ? btnCrop.innerHTML : '';
    
    if (btnOnly) btnOnly.disabled = true;
    if (btnCrop) btnCrop.disabled = true;
    
    if (activeBtn) {
        activeBtn.innerHTML = mode === 'merge_crop' ? `⏳ Merging & Cropping...` : `⏳ Merging...`;
    }
    
    const mergeSection = document.getElementById('mergeSection');
    if (mergeSection) mergeSection.style.display = 'block';
    
    if (mode === 'merge_crop') {
        showStatus('mergeStatus', 'info', `[${timelineTitle}] Queued: Merging ${filesInOrder.length} clip(s), stacking halves, and padding with dark bars into 1080×1920 (9:16)...`);
    } else {
        showStatus('mergeStatus', 'info', `[${timelineTitle}] Queued: Merging ${filesInOrder.length} clip(s) sequentially into original dimensions...`);
    }
    
    try {
        const res = await fetch('/merge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: currentSession, files: filesInOrder, mode: mode })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Merge failed');
        
        let finalResult = data;
        if (data.task_id) {
            finalResult = await pollTask(data.task_id, {
                statusElementId: 'mergeStatus',
                onProgress: (pct, msg) => {
                    const statusEl = document.getElementById('mergeStatus');
                    if (statusEl) {
                        statusEl.className = 'status-box status-info';
                        statusEl.style.display = 'block';
                        statusEl.innerText = `⏳ [${timelineTitle}] ${msg} (${pct}%)`;
                    }
                    if (activeBtn) {
                        activeBtn.innerHTML = `⏳ ${pct}%`;
                    }
                }
            });
        }
        
        const downloadUrl = `/download/${currentSession}/${finalResult.file}`;
        const streamUrl = `/media/${currentSession}/${finalResult.file}?t=${Date.now()}`;
        
        // 1. Display confirmation without forcing download
        const meta = finalResult.metadata;
        const durInfo = meta && meta.duration_formatted ? ` (Duration: ${meta.duration_formatted})` : '';
        const statusEl = document.getElementById('mergeStatus');
        statusEl.className = 'status-box status-success';
        
        const modeDesc = mode === 'merge_crop' 
            ? ' (1080×1920, standard 9:16 vertical)' 
            : (meta && meta.width && meta.height ? ` (${meta.width}×${meta.height})` : '');
        const modeAction = mode === 'merge_crop' ? 'merged and cropped' : 'merged';
        
        statusEl.innerHTML = `✅ [${timelineTitle}] Successfully ${modeAction} ${filesInOrder.length} clip(s) into <strong>${finalResult.file}</strong>${modeDesc}${durInfo}! Preview the video below or click Download.`;
        statusEl.style.display = 'block';

        // 2. Show preview player card & configure download button
        const previewContainer = document.getElementById('mergePreviewContainer');
        const previewPlayer = document.getElementById('mergedVideoPlayer');
        const previewDownloadBtn = document.getElementById('downloadMergedBtn');
        const metaBadge = document.getElementById('mergedMetaBadge');
        const titleSpan = document.getElementById('mergedTitleSpan');
        const wrapper = document.getElementById('mergedVideoWrapper');

        if (titleSpan) {
            titleSpan.innerHTML = mode === 'merge_crop' ? `🎬 ${timelineTitle} - Merged & Cropped Video (9:16)` : `🎬 ${timelineTitle} - Merged Video (Original)`;
        }

        if (meta && meta.width && meta.height && metaBadge) {
            metaBadge.innerText = `${meta.width}×${meta.height}`;
        }

        if (wrapper) {
            if (mode === 'merge_crop') {
                wrapper.style.maxWidth = '340px';
                wrapper.style.aspectRatio = '9/16';
            } else {
                const aspect = (meta && meta.width && meta.height) ? `${meta.width}/${meta.height}` : '16/9';
                wrapper.style.maxWidth = '640px';
                wrapper.style.aspectRatio = aspect;
            }
        }

        if (previewDownloadBtn) {
            previewDownloadBtn.href = downloadUrl;
            previewDownloadBtn.setAttribute('download', finalResult.file);
        }

        if (previewPlayer) {
            previewPlayer.src = streamUrl;
            previewPlayer.load();
        }

        if (previewContainer) {
            previewContainer.style.display = 'block';
            previewContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        
    } catch (err) {
        showStatus('mergeStatus', 'error', err.message);
    } finally {
        if (btnOnly) {
            btnOnly.disabled = false;
            btnOnly.innerHTML = origOnlyText;
        }
        if (btnCrop) {
            btnCrop.disabled = false;
            btnCrop.innerHTML = origCropText;
        }
    }
}

/* --- Task Processing Engine (Split, Crop, Audio) --- */
async function processTask(taskName) {
    if (!currentSession) return;
    
    const config = {
        'split': { btn: 'btnSplit', status: 'splitStatus', outputs: 'splitOutputs', getBody: () => ({ durations: document.getElementById('durations').value }) },
        'crop': { btn: 'btnCrop', status: 'cropStatus', outputs: 'cropOutputs', getBody: () => ({ 
            x: Math.round(actualCrop.x), 
            y: Math.round(actualCrop.y), 
            w: Math.round(actualCrop.w), 
            h: Math.round(actualCrop.h) 
        }) },
        'extract-audio': { btn: 'btnAudio', status: 'audioStatus', outputs: 'audioOutputs', getBody: () => ({ format: document.getElementById('audioFormat').value, bitrate: document.getElementById('audioBitrate').value, sample_rate: document.getElementById('audioSampleRate').value }) }
    };
    
    const c = config[taskName];
    const btn = document.getElementById(c.btn);
    
    btn.disabled = true;
    showStatus(c.status, 'info', 'Queued for processing... Please wait.');
    document.getElementById(c.outputs).innerHTML = '';
    
    try {
        const bodyData = { session_id: currentSession, filename: currentFilename, ...c.getBody() };
        const res = await fetch(`/${taskName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyData)
        });
        const data = await res.json();
        
        if (!res.ok) throw new Error(data.error || 'Processing failed');
        
        let finalResult = data;
        if (data.task_id) {
            finalResult = await pollTask(data.task_id, {
                statusElementId: c.status,
                onProgress: (pct, msg) => {
                    showStatus(c.status, 'info', `${msg} (${pct}%)`);
                }
            });
        }
        
        showStatus(c.status, 'success', 'Completed successfully!');
        
        if (taskName === 'split') {
            if (finalResult.clip_details && finalResult.clip_details.length > 0) {
                currentClips = finalResult.clip_details;
            } else if (finalResult.files) {
                currentClips = finalResult.files.map((f, i) => ({
                    filename: f,
                    index: i + 1,
                    duration_formatted: '',
                    duration: 0
                }));
            }
            
            timelineCounter = 1;
            const timelineHtml = renderTimelineContainerHtml('timeline-1', 'Timeline 1', currentClips);
            document.getElementById(c.outputs).innerHTML = timelineHtml;
            updateTimelinesToolbarAndButtons();
            updateTimelineIndices('timeline-1');
            updateTimelineTotalDuration('timeline-1');

            const mergeSection = document.getElementById('mergeSection');
            if (mergeSection) {
                mergeSection.style.display = 'none';
                document.getElementById('mergeStatus').style.display = 'none';
                const prevC = document.getElementById('mergePreviewContainer');
                if (prevC) prevC.style.display = 'none';
                const prevP = document.getElementById('mergedVideoPlayer');
                if (prevP) { prevP.pause(); prevP.removeAttribute('src'); }
            }

            isPlayingSequence = false;
            activeTimelineIndex = -1;
            updateSequencePlayButton();

        } else if (finalResult.files && Array.isArray(finalResult.files)) {
            let html = `<ul class="output-list">`;
            finalResult.files.forEach((f) => {
                html += `
                    <li class="output-item">
                        <span style="font-weight: 500;">${f}</span>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <button class="btn btn-sm btn-outline" onclick="loadIntoMainPlayer('${f}', '${f}')">▶ Play</button>
                            <a href="/download/${currentSession}/${f}" class="btn btn-outline btn-sm" style="width:auto; padding:5px 8px" download>Download</a>
                        </div>
                    </li>`;
            });
            html += '</ul>';
            document.getElementById(c.outputs).innerHTML = html;
        } else if (finalResult.file) {
            let html = `
                <ul class="output-list">
                    <li class="output-item">
                        <span style="font-weight: 500;">${finalResult.file}</span>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            ${taskName !== 'extract-audio' ? `
                            <button class="btn btn-sm btn-outline" onclick="loadIntoMainPlayer('${finalResult.file}', '${finalResult.file}')">▶ Play</button>` : ''}
                            <a href="/download/${currentSession}/${finalResult.file}" class="btn btn-outline btn-sm" style="width:auto; padding:5px 8px" download>Download</a>
                        </div>
                    </li>
                </ul>`;
            document.getElementById(c.outputs).innerHTML = html;
        }
        
    } catch (err) {
        showStatus(c.status, 'error', err.message);
    } finally {
        btn.disabled = false;
    }
}
