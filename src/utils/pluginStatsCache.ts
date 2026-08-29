/**
 * Module-level TTL cache for QuickPluginStatsCard's plugin stats API responses.
 *
 * The dashboard page fully unmounts on navigation, so a useState/useRef cache
 * would be lost on remount; a module-level object survives it. It also lets
 * collapsing and re-expanding the card within the TTL skip the refetch.
 */

import type { LogPluginStats } from '../types/logViewer';

interface CacheSlot {
    key: string;
    data: Record<string, LogPluginStats>;
    timestamp: number;
}

const CACHE_TTL_MS = 10 * 60_000;

let slot: CacheSlot | null = null;

function isFresh(s: CacheSlot | null, key: string): s is CacheSlot {
    return s !== null && s.key === key && (Date.now() - s.timestamp) < CACHE_TTL_MS;
}

export function getCachedPluginStats(key: string): Record<string, LogPluginStats> | null {
    return isFresh(slot, key) ? slot.data : null;
}

export function setCachedPluginStats(key: string, data: Record<string, LogPluginStats>): void {
    slot = { key, data, timestamp: Date.now() };
}
