/**
 * Tab load timer — measures time from navigation click to first data render.
 * Call startTabTimer() on navigation, dispatchTabLoaded() when content is ready.
 * Footer listens for the 'tab-loaded' CustomEvent to display elapsed time.
 */

let _startMs = 0;

export function startTabTimer(): void {
    _startMs = performance.now();
}

export function getTabElapsedMs(): number {
    if (_startMs === 0) return 0;
    return Math.round(performance.now() - _startMs);
}

/** Dispatch tab-loaded event. No-op if startTabTimer() was never called. */
export function dispatchTabLoaded(): void {
    if (_startMs === 0) return;
    window.dispatchEvent(new CustomEvent('tab-loaded', { detail: { ms: getTabElapsedMs() } }));
}
