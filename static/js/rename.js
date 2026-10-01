/* --- Clip Renaming Engine --- */

function getClipCard(param1, param2, param3, param4) {
    // 1. Direct HTMLElement or Event passed
    if (param4 && param4.nodeType) return param4.closest('.timeline-clip-card');
    if (param1 && typeof param1 === 'object') {
        if (param1.nodeType) return param1.closest('.timeline-clip-card');
        if (param1.target && param1.target.closest) return param1.target.closest('.timeline-clip-card');
    }
    // 2. Active event target
    if (typeof window !== 'undefined' && window.event && window.event.target && window.event.target.closest) {
        const cardFromEvent = window.event.target.closest('.timeline-clip-card');
        if (cardFromEvent) return cardFromEvent;
    }
    // 3. By timelineId and index
    if (param3 && param2 !== undefined && param2 !== null) {
        const container = document.getElementById(`timelineContainer-${param3}`) || 
                          document.querySelector(`[data-timeline-id="${param3}"]`);
        if (container) {
            const card = container.querySelector(`.timeline-clip-card[data-index="${param2}"]`);
            if (card) return card;
        }
    }
    // 4. By filename and index
    if (typeof param1 === 'string' && param1) {
        if (param2 !== undefined && param2 !== null && typeof param2 === 'number') {
            const card = document.querySelector(`.timeline-clip-card[data-filename="${param1}"][data-index="${param2}"]`);
            if (card) return card;
        }
        const card = document.querySelector(`.timeline-clip-card[data-filename="${param1}"]`);
        if (card) return card;
    }
    // 5. By index only
    if (typeof param2 === 'number') {
        const card = document.querySelector(`.timeline-clip-card[data-index="${param2}"]`);
        if (card) return card;
    }
    if (typeof param1 === 'number') {
        const card = document.querySelector(`.timeline-clip-card[data-index="${param1}"]`);
        if (card) return card;
    }
    return null;
}

function startRenameClip(filename, idx, timelineId, el) {
    const card = getClipCard(filename, idx, timelineId, el);
    
    const displayRow = card ? card.querySelector('.clip-card-name-row') : document.getElementById(`clip-name-display-${idx}`);
    const renameBox = card ? card.querySelector('.clip-rename-box') : document.getElementById(`clip-rename-box-${idx}`);
    const input = card ? (card.querySelector('.clip-rename-box input[type="text"]') || card.querySelector('input[type="text"]')) 
                       : document.getElementById(`clip-rename-input-${idx}`);
    const errEl = card ? (card.querySelector('.clip-rename-err') || card.querySelector('.clip-rename-box > div:last-child')) 
                       : document.getElementById(`clip-rename-err-${idx}`);

    if (!displayRow || !renameBox || !input) return;

    if (errEl) {
        errEl.style.display = 'none';
        errEl.innerText = '';
    }
    displayRow.style.display = 'none';
    renameBox.style.display = 'block';

    const currentFn = (card ? card.getAttribute('data-filename') : null) || (typeof filename === 'string' ? filename : '') || '';
    input.value = currentFn.replace(/\.mp4$/i, '');
    input.focus();
    input.select();
}

function cancelRenameClip(idx, timelineId, el) {
    const card = getClipCard(el, idx, timelineId, el);

    const displayRow = card ? card.querySelector('.clip-card-name-row') : document.getElementById(`clip-name-display-${idx}`);
    const renameBox = card ? card.querySelector('.clip-rename-box') : document.getElementById(`clip-rename-box-${idx}`);
    const errEl = card ? (card.querySelector('.clip-rename-err') || card.querySelector('.clip-rename-box > div:last-child')) 
                       : document.getElementById(`clip-rename-err-${idx}`);

    if (displayRow) displayRow.style.display = 'flex';
    if (renameBox) renameBox.style.display = 'none';
    if (errEl) {
        errEl.style.display = 'none';
        errEl.innerText = '';
    }
}

function handleRenameKey(e, oldFilename, idx, timelineId, el) {
    if (e.key === 'Enter') {
        e.preventDefault();
        saveRenameClip(oldFilename, idx, timelineId, el || e.target);
    } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelRenameClip(idx, timelineId, el || e.target);
    }
}

async function saveRenameClip(oldFilename, idx, timelineId, el) {
    if (!currentSession) return;
    const card = getClipCard(oldFilename, idx, timelineId, el);

    const input = card ? (card.querySelector('.clip-rename-box input[type="text"]') || card.querySelector('input[type="text"]')) 
                       : document.getElementById(`clip-rename-input-${idx}`);
    const errEl = card ? (card.querySelector('.clip-rename-err') || card.querySelector('.clip-rename-box > div:last-child')) 
                       : document.getElementById(`clip-rename-err-${idx}`);
    if (!input) return;

    let newName = input.value.trim();
    if (!newName) {
        if (errEl) { 
            errEl.innerText = 'Name cannot be empty'; 
            errEl.style.display = 'block'; 
        }
        return;
    }
    if (!newName.toLowerCase().endsWith('.mp4')) {
        newName += '.mp4';
    }

    const actualOldName = (card ? card.getAttribute('data-filename') : null) || (typeof oldFilename === 'string' ? oldFilename : '');
    if (newName === actualOldName) {
        cancelRenameClip(idx, timelineId, card);
        return;
    }

    try {
        const res = await fetch('/rename-clip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: currentSession,
                old_name: actualOldName,
                new_name: newName
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Rename failed');

        const confirmedName = data.new_name;

        pushCurrentStateToUndo();

        // 1. Update all matching timeline clip cards across all containers
        const matchingCards = document.querySelectorAll(`.timeline-clip-card[data-filename="${actualOldName}"]`);
        matchingCards.forEach(c => {
            c.setAttribute('data-filename', confirmedName);

            const nameText = c.querySelector('.clip-card-name');
            if (nameText) {
                nameText.innerText = `📹 ${confirmedName}`;
                nameText.title = confirmedName;
            }

            const inputEl = c.querySelector('.clip-rename-box input[type="text"]') || c.querySelector('input[type="text"]');
            if (inputEl) {
                inputEl.value = confirmedName.replace(/\.mp4$/i, '');
            }

            const dlBtn = c.querySelector('.clip-download-btn');
            if (dlBtn) {
                dlBtn.href = `/download/${currentSession}/${confirmedName}`;
                dlBtn.setAttribute('download', confirmedName);
            }
        });

        // 2. Update in-memory references
        if (typeof currentClips !== 'undefined' && currentClips && Array.isArray(currentClips)) {
            currentClips.forEach(c => {
                if (c.filename === actualOldName) {
                    c.filename = confirmedName;
                }
            });
        }
        if (typeof sequenceClips !== 'undefined' && sequenceClips && Array.isArray(sequenceClips)) {
            sequenceClips.forEach(c => {
                if (c.filename === actualOldName) {
                    c.filename = confirmedName;
                }
            });
        }

        cancelRenameClip(idx, timelineId, card);

        // Re-synchronize indices and event bindings across all timeline containers
        if (typeof updateTimelineIndices === 'function') {
            updateTimelineIndices();
        }

        if (typeof saveWorkspaceState === 'function') {
            saveWorkspaceState();
        }

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

        pushCurrentStateToUndo();

        clip.filename = confirmedName;

        // Update all in-memory arrays
        if (typeof currentClips !== 'undefined' && currentClips && Array.isArray(currentClips)) {
            currentClips.forEach(c => {
                if (c.filename === oldName) c.filename = confirmedName;
            });
        }
        if (typeof sequenceClips !== 'undefined' && sequenceClips && Array.isArray(sequenceClips)) {
            sequenceClips.forEach(c => {
                if (c.filename === oldName) c.filename = confirmedName;
            });
        }

        // Update timeline cards
        const matchingCards = document.querySelectorAll(`.timeline-clip-card[data-filename="${oldName}"]`);
        matchingCards.forEach(card => {
            card.setAttribute('data-filename', confirmedName);
            const nameText = card.querySelector('.clip-card-name');
            if (nameText) {
                nameText.innerText = `📹 ${confirmedName}`;
                nameText.title = confirmedName;
            }
            const inputEl = card.querySelector('.clip-rename-box input[type="text"]') || card.querySelector('input[type="text"]');
            if (inputEl) {
                inputEl.value = confirmedName.replace(/\.mp4$/i, '');
            }
            const dlBtn = card.querySelector('.clip-download-btn');
            if (dlBtn) {
                dlBtn.href = `/download/${currentSession}/${confirmedName}`;
                dlBtn.setAttribute('download', confirmedName);
            }
        });

        if (typeof updateTimelineIndices === 'function') {
            updateTimelineIndices();
        }

        if (typeof renderModalClip === 'function') {
            renderModalClip();
        }

        if (typeof saveWorkspaceState === 'function') {
            saveWorkspaceState();
        }
    } catch (err) {
        alert(err.message);
    }
}
