/**
 * Shared module-level cache utilities for fail2ban tabs.
 * Survives tab navigation (module singleton).
 */

const _cache: Record<string, { data: unknown; ts: number }> = {};

export function getCached<T>(key: string, ttl = 60_000): T | null {
    const e = _cache[key];
    return e && Date.now() - e.ts < ttl ? (e.data as T) : null;
}

export function setCached(key: string, data: unknown): void {
    _cache[key] = { data, ts: Date.now() };
}

export function deleteCached(key: string): void {
    delete _cache[key];
}
