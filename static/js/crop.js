/* --- Visual Crop Editor Logic --- */
    function toggleCropOverlay() {
        if (!videoMeta) return;
        isCropToolActive = !isCropToolActive;
        const btn = document.getElementById('btnToggleCropOverlay');
        const text = document.getElementById('cropToggleText');
        
        if (isCropToolActive) {
            if (btn) btn.classList.add('active');
            if (text) text.innerText = 'Close Crop';
            renderCropOverlay();
            const cropCard = document.getElementById('cropCard');
            if (cropCard) cropCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            if (btn) btn.classList.remove('active');
            if (text) text.innerText = 'Crop Video';
            if (cropEditor) cropEditor.style.display = 'none';
        }
    }
    
    const cropEditor = document.getElementById('cropEditor');
    const cropBox = document.getElementById('cropBox');
    const cropBadge = document.getElementById('cropBadge');
    
    // Calculate the physical rectangle of the video displayed inside the <video> tag
    function getVideoDisplayRect() {
        if (!videoMeta || !videoMeta.width || !videoMeta.height) return null;
        
        const vw = videoMeta.width;
        const vh = videoMeta.height;
        const cw = videoPlayer.clientWidth;
        const ch = videoPlayer.clientHeight;
        
        const videoRatio = vw / vh;
        const containerRatio = cw / ch;
        
        let dispW, dispH, dispX, dispY;
        
        if (containerRatio > videoRatio) {
            // Pillarboxing
            dispH = ch;
            dispW = ch * videoRatio;
            dispX = (cw - dispW) / 2;
            dispY = 0;
        } else {
            // Letterboxing
            dispW = cw;
            dispH = cw / videoRatio;
            dispX = 0;
            dispY = (ch - dispH) / 2;
        }
        
        return {
            x: dispX, y: dispY,
            w: dispW, h: dispH,
            scaleX: dispW / vw,
            scaleY: dispH / vh
        };
    }

    // Re-render the visual crop box overlay based on actual coordinates
    function renderCropOverlay() {
        if (!videoMeta) return;
        if (!isCropToolActive) {
            if (cropEditor) cropEditor.style.display = 'none';
            return;
        }
        const rect = getVideoDisplayRect();
        if (!rect) return;
        
        // 1. Position the main mask exactly over the visible video
        cropEditor.style.display = 'block';
        cropEditor.style.left = `${rect.x}px`;
        cropEditor.style.top = `${rect.y}px`;
        cropEditor.style.width = `${rect.w}px`;
        cropEditor.style.height = `${rect.h}px`;
        
        // 2. Map actual crop to screen pixels
        const screenX = actualCrop.x * rect.scaleX;
        const screenY = actualCrop.y * rect.scaleY;
        const screenW = actualCrop.w * rect.scaleX;
        const screenH = actualCrop.h * rect.scaleY;
        
        // 3. Apply to box
        cropBox.style.left = `${screenX}px`;
        cropBox.style.top = `${screenY}px`;
        cropBox.style.width = `${screenW}px`;
        cropBox.style.height = `${screenH}px`;
        
        cropBadge.innerText = `${Math.round(actualCrop.w)}x${Math.round(actualCrop.h)}`;
    }

    // Update variables from manual inputs
    function syncCropFromInputs() {
        if (!videoMeta) return;
        
        let nx = parseInt(document.getElementById('cropX').value) || 0;
        let ny = parseInt(document.getElementById('cropY').value) || 0;
        let nw = parseInt(document.getElementById('cropW').value) || videoMeta.width;
        let nh = parseInt(document.getElementById('cropH').value) || videoMeta.height;
        
        // Clamp to video boundaries
        nx = Math.max(0, Math.min(nx, videoMeta.width - 1));
        ny = Math.max(0, Math.min(ny, videoMeta.height - 1));
        nw = Math.max(1, Math.min(nw, videoMeta.width - nx));
        nh = Math.max(1, Math.min(nh, videoMeta.height - ny));
        
        actualCrop = { x: nx, y: ny, w: nw, h: nh };
        updateInputFields(); // Push clamped values back to UI
        if (!isCropToolActive) {
            toggleCropOverlay();
        } else {
            renderCropOverlay();
        }
    }

    // Update manual input DOM fields from the actual variables
    function updateInputFields() {
        document.getElementById('cropX').value = Math.round(actualCrop.x);
        document.getElementById('cropY').value = Math.round(actualCrop.y);
        document.getElementById('cropW').value = Math.round(actualCrop.w);
        document.getElementById('cropH').value = Math.round(actualCrop.h);
    }

    function resetCrop() {
        if (!videoMeta) return;
        actualCrop = { x: 0, y: 0, w: videoMeta.width, h: videoMeta.height };
        document.getElementById('cropRatio').value = 'free';
        updateInputFields();
        if (!isCropToolActive) {
            toggleCropOverlay();
        } else {
            renderCropOverlay();
        }
    }

    function applyAspectRatio() {
        if (!videoMeta) return;
        const ratioVal = document.getElementById('cropRatio').value;
        if (ratioVal === 'free') return;
        
        const ratio = parseFloat(ratioVal);
        let nw = actualCrop.w;
        let nh = actualCrop.h;
        
        // Center-based adjustment to snap to aspect ratio
        if (nw / nh > ratio) {
            nw = nh * ratio;
        } else {
            nh = nw / ratio;
        }
        
        actualCrop.w = Math.round(nw);
        actualCrop.h = Math.round(nh);
        
        // Re-center if possible, or clamp
        actualCrop.x = Math.min(actualCrop.x, videoMeta.width - actualCrop.w);
        actualCrop.y = Math.min(actualCrop.y, videoMeta.height - actualCrop.h);
        
        updateInputFields();
        if (!isCropToolActive) {
            toggleCropOverlay();
        } else {
            renderCropOverlay();
        }
    }

    /* Interaction logic for dragging and resizing */


/* Interaction logic for dragging and resizing */

    cropBox.addEventListener('mousedown', (e) => {
        e.preventDefault(); // prevent selection
        isDragging = true;
        startMouseX = e.clientX;
        startMouseY = e.clientY;
        startActualCrop = { ...actualCrop };
        
        if (e.target.classList.contains('crop-handle')) {
            dragAction = e.target.getAttribute('data-dir');
        } else {
            dragAction = 'move';
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging || !startActualCrop || !videoMeta) return;
        
        const rect = getVideoDisplayRect();
        if (!rect) return;
        
        // Delta converted from screen pixels to actual video pixels
        const deltaX = (e.clientX - startMouseX) / rect.scaleX;
        const deltaY = (e.clientY - startMouseY) / rect.scaleY;
        
        let newX = startActualCrop.x;
        let newY = startActualCrop.y;
        let newW = startActualCrop.w;
        let newH = startActualCrop.h;
        
        const ratioVal = document.getElementById('cropRatio').value;
        const ratio = ratioVal === 'free' ? null : parseFloat(ratioVal);
        
        if (dragAction === 'move') {
            newX += deltaX;
            newY += deltaY;
            // Clamp Move
            newX = Math.max(0, Math.min(newX, videoMeta.width - newW));
            newY = Math.max(0, Math.min(newY, videoMeta.height - newH));
        } else {
            // Resize handling based on direction
            if (dragAction.includes('l')) { newX += deltaX; newW -= deltaX; }
            if (dragAction.includes('r')) { newW += deltaX; }
            if (dragAction.includes('t')) { newY += deltaY; newH -= deltaY; }
            if (dragAction.includes('b')) { newH += deltaY; }
            
            // Enforce Minimums
            if (newW < 10) { newX = startActualCrop.x + startActualCrop.w - 10; newW = 10; }
            if (newH < 10) { newY = startActualCrop.y + startActualCrop.h - 10; newH = 10; }
            
            // Apply Aspect Ratio Constraint (approximated on primary drag axis)
            if (ratio) {
                // Determine primary changing axis to drive the other
                if (dragAction === 'ml' || dragAction === 'mr' || Math.abs(deltaX) > Math.abs(deltaY)) {
                    // Width drives Height
                    const targetH = newW / ratio;
                    if (dragAction.includes('t')) newY = (startActualCrop.y + startActualCrop.h) - targetH;
                    newH = targetH;
                } else {
                    // Height drives Width
                    const targetW = newH * ratio;
                    if (dragAction.includes('l')) newX = (startActualCrop.x + startActualCrop.w) - targetW;
                    newW = targetW;
                }
            }
            
            // Clamp to boundaries safely (shrinking if necessary)
            if (newX < 0) { newW += newX; newX = 0; }
            if (newY < 0) { newH += newY; newY = 0; }
            if (newX + newW > videoMeta.width) { newW = videoMeta.width - newX; }
            if (newY + newH > videoMeta.height) { newH = videoMeta.height - newY; }
            
            // Re-apply ratio strictly if boundary hit
            if (ratio) {
                if (newW / newH > ratio) {
                    newW = newH * ratio;
                } else {
                    newH = newW / ratio;
                }
            }
        }
        
        actualCrop = { x: newX, y: newY, w: newW, h: newH };
        updateInputFields();
        renderCropOverlay();
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
        dragAction = null;
    });

    // Window resize handling
    window.addEventListener('resize', renderCropOverlay);
    
    // Initialize crop tool when video finishes loading metadata
    videoPlayer.addEventListener('loadedmetadata', () => {
        // Only reset to full if it's the first time processing this video
        actualCrop = { x: 0, y: 0, w: videoMeta.width, h: videoMeta.height };
        updateInputFields();
        if (isCropToolActive) {
            renderCropOverlay();
        } else {
            if (cropEditor) cropEditor.style.display = 'none';
        }
    });
