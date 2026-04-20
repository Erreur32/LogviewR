// Handles "stale chunk" errors after a new deployment.
// Vite regenerates hashed chunk filenames on each build; tabs that were open
// before the deploy still reference the old hashes and fail to dynamically
// import them. We reload the page once per session on such failures, with a
// short reset window so a second deploy during the same session is covered.

const STORAGE_KEY = 'chunk_reload_attempted';
const RESET_DELAY_MS = 10_000;

const CHUNK_ERROR_PATTERNS: readonly string[] = [
    'Failed to fetch dynamically imported module',
    'Importing a module script failed',
    'error loading dynamically imported module',
];

export function isChunkLoadError(error: unknown): boolean {
    if (!error) return false;
    if (error instanceof Error) {
        if (error.name === 'ChunkLoadError') return true;
        return CHUNK_ERROR_PATTERNS.some((p) => error.message.includes(p));
    }
    const msg = typeof error === 'string' ? error : String(error);
    return CHUNK_ERROR_PATTERNS.some((p) => msg.includes(p));
}

function readFlag(): boolean {
    try {
        return sessionStorage.getItem(STORAGE_KEY) === '1';
    } catch {
        // sessionStorage may be unavailable (private mode, disabled storage)
        return false;
    }
}

function writeFlag(): void {
    try {
        sessionStorage.setItem(STORAGE_KEY, '1');
    } catch {
        // sessionStorage unavailable — proceed with reload anyway
    }
}

function clearFlag(): void {
    try {
        sessionStorage.removeItem(STORAGE_KEY);
    } catch {
        // sessionStorage unavailable — nothing to clear
    }
}

// Reloads the page unless a reload was already attempted in this session.
// Returns true if a reload was triggered.
export function reloadIfNotAttempted(): boolean {
    if (readFlag()) return false;
    writeFlag();
    window.location.reload();
    return true;
}

// Registers global listeners for Vite preload failures and unhandled
// rejections so lazy() failures that bypass the React error boundary are
// still recovered. Safe to call once at startup.
export function initChunkReloadHandler(): void {
    window.addEventListener('vite:preloadError', () => {
        reloadIfNotAttempted();
    });

    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
        if (isChunkLoadError(event.reason)) {
            reloadIfNotAttempted();
        }
    });

    // Once the page has been stable for a short period, allow future chunk
    // errors (e.g. a later redeploy in the same long-lived tab) to trigger
    // another reload.
    window.setTimeout(clearFlag, RESET_DELAY_MS);
}
