/**
 * Shared fetch for fail2ban /tops compare=1 limit=1 (prev period total for trend badge).
 * Deduplicates in-flight requests per days; TabStats can prime from a full /tops response
 * so BanHistoryChart may skip a redundant HTTP call when Stats loads first or wins the race.
 */
import { api } from '../../api/client';

type TopsCompareResult = { ok?: boolean; prevSummary?: { totalBans: number } | null };

let primed: { days: number; value: number | null; ts: number } | null = null;

export function primeTopsPrevTotalFromFullFetch(days: number, prevTotalBans: number | null): void {
    primed = { days, value: prevTotalBans, ts: Date.now() };
}

const inflight = new Map<number, Promise<number | null>>();

export function fetchTopsPrevTotalBans(days: number): Promise<number | null> {
    if (days === -1) return Promise.resolve(null);

    if (primed && primed.days === days && Date.now() - primed.ts < 8_000) {
        const v = primed.value;
        primed = null;
        return Promise.resolve(v);
    }

    let p = inflight.get(days);
    if (p) return p;

    p = api
        .get<TopsCompareResult>(`/api/plugins/fail2ban/tops?days=${days}&compare=1&limit=1`)
        .then(res => {
            if (res.success && res.result?.ok) {
                return res.result.prevSummary?.totalBans ?? null;
            }
            return null;
        })
        .catch(() => null)
        .finally(() => {
            inflight.delete(days);
        });
    inflight.set(days, p);
    return p;
}
