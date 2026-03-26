/**
 * Fail2ban Sync Service
 *
 * Periodically syncs ban events from fail2ban's SQLite DB into the internal
 * dashboard.db for long-term retention (fail2ban purges its own DB; we keep forever).
 *
 * Runs every 60s. Inserts only new rows (dedup via f2b_rowid UNIQUE index).
 *
 * After each sync, resolves geo for new IPs via ip-api.com batch API (100/req)
 * and stores in f2b_ip_geo. This ensures the map loads instantly with no
 * progressive resolution delay.
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import { getDatabase } from '../database/connection.js';
import { logger } from '../utils/logger.js';

const SYNC_INTERVAL_MS = 60_000;
const GEO_BATCH_SIZE   = 100;   // ip-api.com batch limit
const GEO_BATCH_DELAY  = 1_500; // ms between batches (free tier: 45 req/min)
const GEO_TTL          = 30 * 86400; // 30 days

interface F2bBanRow {
    rowid: number;
    ip: string;
    jail: string;
    timeofban: number;
    bantime: number;
    failures: number | null;
}

interface IpApiResult {
    query: string;
    status: string;
    country?: string;
    countryCode?: string;
    region?: string;
    city?: string;
    org?: string;
    lat?: number;
    lon?: number;
}

export class Fail2banSyncService {
    private f2bDbPath: string;
    private timer: ReturnType<typeof setInterval> | null = null;
    private running = false;
    private geoRunning = false;

    constructor(f2bDbPath: string) {
        this.f2bDbPath = f2bDbPath;
    }

    start(): void {
        if (this.timer) return;
        // Initial sync after 5s (let server boot first)
        setTimeout(() => this.sync(), 5_000);
        this.timer = setInterval(() => this.sync(), SYNC_INTERVAL_MS);
    }

    stop(): void {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
    }

    /** Returns count of events synced this run, or -1 on error. */
    async sync(): Promise<number> {
        if (this.running) return 0;
        this.running = true;
        try {
            const count = this.doSync();
            // After sync: resolve geo for all IPs not yet in cache (fire & forget)
            void this.resolveUnknownGeo();
            return count;
        } catch (e) {
            logger.error('Fail2banSync', `Error during sync: ${e instanceof Error ? e.message : String(e)}`);
            return -1;
        } finally {
            this.running = false;
        }
    }

    private doSync(): number {
        // Check source DB readable
        try { fs.accessSync(this.f2bDbPath, fs.constants.R_OK); } catch { return 0; }

        const appDb = getDatabase();
        const syncState = appDb.prepare('SELECT last_rowid FROM f2b_sync_state WHERE id = 1').get() as { last_rowid: number } | undefined;
        const lastRowid = syncState?.last_rowid ?? 0;

        // First sync (lastRowid=0): full import without limit — critical for fresh install
        // Subsequent syncs: batch of 1000 to stay lightweight
        const batchLimit = lastRowid === 0 ? 1_000_000 : 1000;

        let newRows: F2bBanRow[] = [];
        let f2bDb: Database.Database | null = null;
        try {
            f2bDb = new Database(this.f2bDbPath, { readonly: true, fileMustExist: true });
            newRows = f2bDb.prepare(`
                SELECT rowid, ip, jail, timeofban, bantime,
                       COALESCE(json_extract(data, '$.failures'), bancount) as failures
                FROM bans
                WHERE rowid > ?
                ORDER BY rowid ASC
                LIMIT ?
            `).all(lastRowid, batchLimit) as F2bBanRow[];
        } finally {
            f2bDb?.close();
        }

        if (newRows.length === 0) return 0;

        const insert = appDb.prepare(`
            INSERT OR IGNORE INTO f2b_events(f2b_rowid, ip, jail, event_type, timeofban, bantime, failures)
            VALUES(@rowid, @ip, @jail, 'ban', @timeofban, @bantime, @failures)
        `);
        const updateState = appDb.prepare(`
            UPDATE f2b_sync_state SET last_rowid = ?, last_sync_at = CURRENT_TIMESTAMP WHERE id = 1
        `);

        const insertMany = appDb.transaction((rows: F2bBanRow[]) => {
            let maxRowid = lastRowid;
            for (const row of rows) {
                insert.run(row);
                if (row.rowid > maxRowid) maxRowid = row.rowid;
            }
            updateState.run(maxRowid);
            return rows.length;
        });

        const count = insertMany(newRows) as number;
        if (count > 0) {
            logger.info('Fail2banSync', `Synced ${count} ban(s)${lastRowid === 0 ? ' (initial full import)' : ''}`);
        }
        return count;
    }

    /**
     * Resolve geo for all IPs in f2b_events not yet in f2b_ip_geo (or with expired cache).
     * Uses ip-api.com batch endpoint — 100 IPs per request, 1.5s between batches.
     * Fire & forget — errors are logged but don't block sync.
     */
    private async resolveUnknownGeo(): Promise<void> {
        if (this.geoRunning) return;
        this.geoRunning = true;
        try {
            const appDb = getDatabase();
            const now = Math.floor(Date.now() / 1000);

            // IPs in f2b_events without valid geo cache
            const missing = appDb.prepare(`
                SELECT DISTINCT e.ip
                FROM f2b_events e
                LEFT JOIN f2b_ip_geo g ON g.ip = e.ip
                WHERE g.ip IS NULL OR g.ts < ?
                LIMIT 2000
            `).all(now - GEO_TTL) as { ip: string }[];

            if (missing.length === 0) return;

            logger.info('Fail2banGeo', `Resolving geo for ${missing.length} IPs…`);

            const upsert = appDb.prepare(`
                INSERT OR REPLACE INTO f2b_ip_geo (ip, lat, lng, country, countryCode, region, city, org, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            let resolved = 0;
            const ips = missing.map(r => r.ip);

            for (let i = 0; i < ips.length; i += GEO_BATCH_SIZE) {
                const batch = ips.slice(i, i + GEO_BATCH_SIZE);
                try {
                    const res = await globalThis.fetch(
                        'http://ip-api.com/batch?fields=status,query,country,countryCode,region,city,org,lat,lon',
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(batch.map(ip => ({ query: ip }))),
                            signal: AbortSignal.timeout(10_000),
                        }
                    );
                    const results = await res.json() as IpApiResult[];
                    const ts = Math.floor(Date.now() / 1000);
                    for (const r of results) {
                        if (r.status === 'success' && typeof r.lat === 'number') {
                            upsert.run(r.query, r.lat, r.lon ?? 0, r.country ?? '', r.countryCode ?? '', r.region ?? '', r.city ?? '', r.org ?? '', ts);
                            resolved++;
                        }
                    }
                } catch (e) {
                    logger.warn('Fail2banGeo', `Batch ${i / GEO_BATCH_SIZE + 1} failed: ${e instanceof Error ? e.message : String(e)}`);
                }

                // Respect rate limit between batches (not needed after last batch)
                if (i + GEO_BATCH_SIZE < ips.length) {
                    await new Promise(r => setTimeout(r, GEO_BATCH_DELAY));
                }
            }

            if (resolved > 0) {
                logger.info('Fail2banGeo', `Geo resolved for ${resolved}/${missing.length} IPs`);
            }
        } catch (e) {
            logger.error('Fail2banGeo', `resolveUnknownGeo error: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            this.geoRunning = false;
        }
    }

    /** Query stats from internal DB for the config tab. */
    static getInternalStats(): {
        totalEvents: number;
        last24h: number;
        last7d: number;
        lastSync: string | null;
        lastRowid: number;
    } {
        const appDb = getDatabase();
        const now = Math.floor(Date.now() / 1000);
        const total   = (appDb.prepare('SELECT COUNT(*) as n FROM f2b_events').get() as { n: number }).n;
        const last24h = (appDb.prepare('SELECT COUNT(*) as n FROM f2b_events WHERE timeofban > ?').get(now - 86400) as { n: number }).n;
        const last7d  = (appDb.prepare('SELECT COUNT(*) as n FROM f2b_events WHERE timeofban > ?').get(now - 604800) as { n: number }).n;
        const state   = appDb.prepare('SELECT last_rowid, last_sync_at FROM f2b_sync_state WHERE id = 1').get() as { last_rowid: number; last_sync_at: string | null } | undefined;
        return {
            totalEvents: total,
            last24h,
            last7d,
            lastSync: state?.last_sync_at ?? null,
            lastRowid: state?.last_rowid ?? 0,
        };
    }

    /** Query history for a single IP — for the details modal. */
    static getIpHistory(ip: string, limit: number): {
        ip: string; jail: string; timeofban: number; bantime: number | null; failures: number | null;
    }[] {
        const appDb = getDatabase();
        return appDb.prepare(`
            SELECT ip, jail, timeofban, bantime, failures
            FROM f2b_events
            WHERE ip = ?
            ORDER BY timeofban DESC
            LIMIT ?
        `).all(ip, limit) as { ip: string; jail: string; timeofban: number; bantime: number | null; failures: number | null }[];
    }

    /** Query history from internal DB — bypasses fail2ban's own purge window. */
    static getHistory(days: number, limit: number): {
        ip: string; jail: string; timeofban: number; bantime: number | null; failures: number | null;
    }[] {
        const appDb = getDatabase();
        const since = days < 0 ? 0 : Math.floor(Date.now() / 1000) - days * 86400;
        return appDb.prepare(`
            SELECT ip, jail, timeofban, bantime, failures
            FROM f2b_events
            WHERE timeofban >= ?
            ORDER BY timeofban DESC
            LIMIT ?
        `).all(since, limit) as { ip: string; jail: string; timeofban: number; bantime: number | null; failures: number | null }[];
    }
}
