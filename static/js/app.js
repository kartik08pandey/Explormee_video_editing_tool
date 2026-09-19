// --- Global App Shortcuts & Key Handlers ---
    // Modal keyboard controls
    document.addEventListener('keydown', (e) => {
        const modal = document.getElementById('clipReviewModal');
        if (modal && modal.style.display === 'flex') {
            if (e.key === 'Escape') {
                closeClipReview();
            } else if (e.key === 'ArrowLeft') {
                navigateClip(-1);
            } else if (e.key === 'ArrowRight') {
                navigateClip(1);
            } else if (e.key === ' ' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                e.preventDefault();
                const mv = document.getElementById('modalVideoPlayer');
                if (mv.paused) mv.play(); else mv.pause();
            }
        }
    });
