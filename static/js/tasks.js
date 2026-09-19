/* --- Dedicated Merge & Stack Engine --- */
    /* --- Dedicated Merge & Stack Engine --- */
    async function mergeClips(mode = 'merge') {
        if (!currentSession) return;
        const track = document.getElementById('timelineTrack');
        if (!track) return;
        
        const cards = track.querySelectorAll('.timeline-clip-card');
        const filesInOrder = Array.from(cards).map(c => c.getAttribute('data-filename'));
        
        if (filesInOrder.length < 1) {
            showStatus('mergeStatus', 'error', 'Need at least 1 clip on the timeline to merge.');
            return;
        }
        
        const btnOnly = document.getElementById('btnMergeOnly');
        const btnCrop = document.getElementById('btnMergeCrop');
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
            showStatus('mergeStatus', 'info', `Merging ${filesInOrder.length} clip(s), stacking halves, and padding with dark bars into 1080×1920 (9:16)...`);
        } else {
            showStatus('mergeStatus', 'info', `Merging ${filesInOrder.length} clip(s) sequentially into original dimensions...`);
        }
        
        try {
            const res = await fetch('/merge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: currentSession, files: filesInOrder, mode: mode })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Merge failed');
            
            const downloadUrl = `/download/${currentSession}/${data.file}`;
            const streamUrl = `/media/${currentSession}/${data.file}?t=${Date.now()}`;
            
            // 1. Display confirmation without forcing download
            const meta = data.metadata;
            const durInfo = meta && meta.duration_formatted ? ` (Duration: ${meta.duration_formatted})` : '';
            const statusEl = document.getElementById('mergeStatus');
            statusEl.className = 'status-box status-success';
            
            const modeDesc = mode === 'merge_crop' 
                ? ' (1080×1920, standard 9:16 vertical)' 
                : (meta && meta.width && meta.height ? ` (${meta.width}×${meta.height})` : '');
            const modeAction = mode === 'merge_crop' ? 'merged and cropped' : 'merged';
            
            statusEl.innerHTML = `✅ Successfully ${modeAction} ${filesInOrder.length} clip(s) into <strong>${data.file}</strong>${modeDesc}${durInfo}! Preview the video below or click Download.`;
            statusEl.style.display = 'block';

            // 2. Show preview player card & configure download button
            const previewContainer = document.getElementById('mergePreviewContainer');
            const previewPlayer = document.getElementById('mergedVideoPlayer');
            const previewDownloadBtn = document.getElementById('downloadMergedBtn');
            const metaBadge = document.getElementById('mergedMetaBadge');
            const titleSpan = document.getElementById('mergedTitleSpan');
            const wrapper = document.getElementById('mergedVideoWrapper');

            if (titleSpan) {
                titleSpan.innerHTML = mode === 'merge_crop' ? '🎬 Merged & Cropped Video (9:16)' : '🎬 Merged Video (Original)';
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
                previewDownloadBtn.setAttribute('download', data.file);
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
        showStatus(c.status, 'info', 'Processing... Please wait.');
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
            
            showStatus(c.status, 'success', 'Completed successfully!');
            
            if (taskName === 'split') {
                if (data.clip_details && data.clip_details.length > 0) {
                    currentClips = data.clip_details;
                } else if (data.files) {
                    currentClips = data.files.map((f, i) => ({
                        filename: f,
                        index: i + 1,
                        duration_formatted: '',
                        duration: 0
                    }));
                }
                
                // Calculate total duration for timeline header
                const totalSec = currentClips.reduce((sum, cl) => sum + (cl.duration || 0), 0);
                const th = Math.floor(totalSec / 3600);
                const tm = Math.floor((totalSec % 3600) / 60);
                const ts = (totalSec % 60).toFixed(1);
                const totalFormatted = th > 0 ? `${th}h ${tm}m ${ts}s` : `${tm}m ${ts}s`;

                let timelineHtml = `
                <div class="timeline-container" id="timelineContainer">
                    <div class="timeline-top-bar">
                        <div class="timeline-meta-info">
                            <span style="font-size:1.15rem;">🎞</span>
                            <span><span id="timelineClipsCountText"><strong>${data.files.length} Clips Generated</strong></span> &bull; Total: <span id="timelineTotalDuration" style="font-family:monospace; color:var(--accent-color); font-weight:600;">${totalFormatted}</span></span>
                        </div>
                        <div class="timeline-actions">
                            <button id="btnPlaySequence" class="btn btn-sequence-play btn-sm" onclick="togglePlaySequence()">
                                ▶ Play Sequence
                            </button>
                            <button id="btnRestartSequence" class="btn btn-outline btn-sm" onclick="restartSequence()">
                                ⏮ Restart
                            </button>
                            <button id="btnMergeOnly" class="btn btn-merge-download btn-sm" onclick="mergeClips('merge')" title="Merge all clips in original format and aspect ratio">
                                ⚡ Only Merge
                            </button>
                            <button id="btnMergeCrop" class="btn btn-merge-crop btn-sm" onclick="mergeClips('merge_crop')" title="Merge all clips and format/stack into 9:16 vertical video">
                                📐 Merge + Crop
                            </button>
                            <a href="/download-zip/${currentSession}" class="btn btn-outline btn-sm" download style="text-decoration:none;">
                                📦 Download ZIP
                            </a>
                        </div>
                    </div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
                        <span>💡 <strong>Drag left/right clip edges</strong> to trim duration with live scrubbing &bull; Drag cards or click <strong>◀ / ▶</strong> to change sequence.</span>
                        <span style="font-size: 0.75rem; color: #94a3b8;">Scroll horizontally ↔ to see all clips</span>
                    </div>
                    <div class="timeline-track-wrapper" id="timelineTrackWrapper">
                        <div class="timeline-track" id="timelineTrack">`;

                data.files.forEach((f, idx) => {
                    const detail = currentClips.find(cl => cl.filename === f) || {};
                    timelineHtml += createTimelineClipCardHtml(f, idx, detail, data.files.length);
                });

                timelineHtml += `
                        </div>
                    </div>
                </div>`;

                document.getElementById(c.outputs).innerHTML = timelineHtml;

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

            } else if (data.files && Array.isArray(data.files)) {
                let html = `<ul class="output-list">`;
                data.files.forEach((f) => {
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
            } else if (data.file) {
                let html = `
                    <ul class="output-list">
                        <li class="output-item">
                            <span style="font-weight: 500;">${data.file}</span>
                            <div style="display: flex; align-items: center; gap: 6px;">
                                ${taskName !== 'extract-audio' ? `
                                <button class="btn btn-sm btn-outline" onclick="loadIntoMainPlayer('${data.file}', '${data.file}')">▶ Play</button>` : ''}
                                <a href="/download/${currentSession}/${data.file}" class="btn btn-outline btn-sm" style="width:auto; padding:5px 8px" download>Download</a>
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
