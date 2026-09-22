/**
 * Shared module-level cache utilities for fail2ban tabs.
 * Survives tab navigation (module singleton).
 */

const _cache: Record<string, { data: unknown; ts: number }> = {};

/** Hard cap on the number of distinct keys — evicts the oldest entry once exceeded (FIFO-by-age). */
const MAX_ENTRIES = 200;

export function getCached<T>(key: string, ttl = 60_000): T | null {
    const e = _cache[key];
    return e && Date.now() - e.ts < ttl ? (e.data as T) : null;
}

export function setCached(key: string, data: unknown): void {
    if (!(key in _cache) && Object.keys(_cache).length >= MAX_ENTRIES) {
        let oldestKey: string | null = null;
        let oldestTs = Infinity;
        for (const k in _cache) {
            if (_cache[k].ts < oldestTs) { oldestTs = _cache[k].ts; oldestKey = k; }
        }
        if (oldestKey) delete _cache[oldestKey];
    }
    _cache[key] = { data, ts: Date.now() };
}

export function deleteCached(key: string): void {
    delete _cache[key];
}
