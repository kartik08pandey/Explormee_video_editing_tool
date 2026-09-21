/* --- Clip Renaming Engine --- */
    /* --- Clip Renaming Engine --- */
    function startRenameClip(filename, idx) {
        const displayRow = document.getElementById(`clip-name-display-${idx}`);
        const renameBox = document.getElementById(`clip-rename-box-${idx}`);
        const input = document.getElementById(`clip-rename-input-${idx}`);
        if (!displayRow || !renameBox || !input) return;
        
        displayRow.style.display = 'none';
        renameBox.style.display = 'block';
        input.value = filename.replace(/\.mp4$/i, '');
        input.focus();
        input.select();
    }

    function cancelRenameClip(idx) {
        const displayRow = document.getElementById(`clip-name-display-${idx}`);
        const renameBox = document.getElementById(`clip-rename-box-${idx}`);
        const errEl = document.getElementById(`clip-rename-err-${idx}`);
        if (displayRow) displayRow.style.display = 'flex';
        if (renameBox) renameBox.style.display = 'none';
        if (errEl) errEl.style.display = 'none';
    }

    function handleRenameKey(e, oldFilename, idx) {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveRenameClip(oldFilename, idx);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelRenameClip(idx);
        }
    }

    async function saveRenameClip(oldFilename, idx) {
        if (!currentSession) return;
        const input = document.getElementById(`clip-rename-input-${idx}`);
        const errEl = document.getElementById(`clip-rename-err-${idx}`);
        if (!input) return;
        
        let newName = input.value.trim();
        if (!newName) {
            if (errEl) { errEl.innerText = 'Name cannot be empty'; errEl.style.display = 'block'; }
            return;
        }
        if (!newName.toLowerCase().endsWith('.mp4')) {
            newName += '.mp4';
        }
        
        if (newName === oldFilename) {
            cancelRenameClip(idx);
            return;
        }
        
        try {
            const res = await fetch('/rename-clip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: currentSession,
                    old_name: oldFilename,
                    new_name: newName
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Rename failed');
            
            const confirmedName = data.new_name;
            
            // 1. Update card DOM
            const card = document.querySelector(`.timeline-clip-card[data-index="${idx}"]`);
            if (card) {
                card.setAttribute('data-filename', confirmedName);
                
                const nameText = document.getElementById(`clip-name-text-${idx}`);
                if (nameText) {
                    nameText.innerText = `📹 ${confirmedName}`;
                    nameText.title = confirmedName;
                    nameText.onclick = () => startRenameClip(confirmedName, idx);
                }
                
                const renameBtn = card.querySelector('.clip-rename-btn');
                if (renameBtn) renameBtn.onclick = () => startRenameClip(confirmedName, idx);
                
                const saveBtn = card.querySelector('.clip-save-btn');
                if (saveBtn) saveBtn.onclick = () => saveRenameClip(confirmedName, idx);
                
                const inputEl = document.getElementById(`clip-rename-input-${idx}`);
                if (inputEl) inputEl.onkeydown = (e) => handleRenameKey(e, confirmedName, idx);
                
                const dlBtn = card.querySelector('.clip-download-btn');
                if (dlBtn) {
                    dlBtn.href = `/download/${currentSession}/${confirmedName}`;
                    dlBtn.setAttribute('download', confirmedName);
                }
                
                const playBtn = card.querySelector('.clip-play-btn');
                if (playBtn) playBtn.onclick = () => playSoloClip(confirmedName, idx);
                
                const reviewBtn = card.querySelector('.clip-review-btn');
                if (reviewBtn) reviewBtn.onclick = () => openClipReviewByFilename(confirmedName);
            }
            
            // 2. Update in-memory references
            if (currentClips && Array.isArray(currentClips)) {
                const found = currentClips.find(c => c.filename === oldFilename);
                if (found) found.filename = confirmedName;
            }
            if (sequenceClips && Array.isArray(sequenceClips)) {
                const foundSeq = sequenceClips.find(c => c.filename === oldFilename);
                if (foundSeq) foundSeq.filename = confirmedName;
            }
            
            cancelRenameClip(idx);
            saveWorkspaceState();
            
        } catch (err) {
            if (errEl) {
                errEl.innerText = err.message;
                errEl.style.display = 'block';
            } else {
                alert(err.message);
            }
        }
    }

    async function renameCurrentModalClip() {
        if (!currentSession || !currentClips || currentClips.length === 0) return;
        const clip = currentClips[activeClipIndex];
        if (!clip) return;
        
        const currentBase = clip.filename.replace(/\.mp4$/i, '');
        const newNameInput = prompt('Enter new name for this clip:', currentBase);
        if (!newNameInput) return;
        
        let newName = newNameInput.trim();
        if (!newName) return;
        if (!newName.toLowerCase().endsWith('.mp4')) newName += '.mp4';
        if (newName === clip.filename) return;
        
        try {
            const res = await fetch('/rename-clip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: currentSession,
                    old_name: clip.filename,
                    new_name: newName
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Rename failed');
            
            const oldName = clip.filename;
            const confirmedName = data.new_name;
            clip.filename = confirmedName;
            
            // Update timeline card if present
            const card = document.querySelector(`.timeline-clip-card[data-filename="${oldName}"]`);
            if (card) {
                const idx = card.getAttribute('data-index');
                card.setAttribute('data-filename', confirmedName);
                const nameText = document.getElementById(`clip-name-text-${idx}`);
                if (nameText) {
                    nameText.innerText = `📹 ${confirmedName}`;
                    nameText.title = confirmedName;
                    nameText.onclick = () => startRenameClip(confirmedName, idx);
                }
                const dlBtn = card.querySelector('.clip-download-btn');
                if (dlBtn) {
                    dlBtn.href = `/download/${currentSession}/${confirmedName}`;
                    dlBtn.setAttribute('download', confirmedName);
                }
            }
            
            renderModalClip();
            saveWorkspaceState();
        } catch (err) {
            alert(err.message);
        }
    }
