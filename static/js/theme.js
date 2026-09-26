/**
 * theme.js - Theme manager for Dark and Light modes
 * Supports system preference detection, localStorage persistence, and smooth UI toggling.
 */

const THEME_STORAGE_KEY = 'video_editor_theme';

function getPreferredTheme() {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') {
        return saved;
    }
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
    }
    return 'light';
}

function updateThemeToggleUI(theme) {
    const toggleBtn = document.getElementById('themeToggleBtn');
    if (!toggleBtn) return;

    const isDark = theme === 'dark';
    toggleBtn.setAttribute('aria-checked', isDark ? 'true' : 'false');
    toggleBtn.setAttribute('title', isDark ? 'Switch to light mode (Alt+T)' : 'Switch to dark mode (Alt+T)');
}

function applyTheme(theme, persist = true) {
    const validTheme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', validTheme);
    document.documentElement.style.colorScheme = validTheme;

    if (persist) {
        try {
            localStorage.setItem(THEME_STORAGE_KEY, validTheme);
        } catch (e) {
            console.warn('[Theme] Could not persist theme to localStorage:', e);
        }
    }

    updateThemeToggleUI(validTheme);
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: validTheme } }));
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || getPreferredTheme();
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme, true);
}

// Global initialization
function initTheme() {
    const current = getPreferredTheme();
    applyTheme(current, false);

    const toggleBtn = document.getElementById('themeToggleBtn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            toggleTheme();
        });
    }

    // Listen for OS theme changes if user has not explicitly chosen a preference
    if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (!localStorage.getItem(THEME_STORAGE_KEY)) {
                applyTheme(e.matches ? 'dark' : 'light', false);
            }
        });
    }

    // Keyboard shortcut: Alt+T to toggle theme
    document.addEventListener('keydown', (e) => {
        if (e.altKey && (e.key === 't' || e.key === 'T')) {
            e.preventDefault();
            toggleTheme();
        }
    });
}

// Immediate initial sync for fast paint
const initialTheme = getPreferredTheme();
document.documentElement.setAttribute('data-theme', initialTheme);
document.documentElement.style.colorScheme = initialTheme;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
} else {
    initTheme();
}
