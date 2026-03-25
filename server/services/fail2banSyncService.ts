/**
 * Fail2ban Sync Service
 *
 * Periodically syncs ban events from fail2ban's SQLite DB into the internal
 * dashboard.db for long-term retention (fail2ban purges its own DB; we keep forever).
 *
 * Runs every 60s. Inserts only new rows (dedup via f2b_rowid UNIQUE index).
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import { getDatabase } from '../database/connection.js';

const SYNC_INTERVAL_MS = 60_000;

interface F2bBanRow {
    rowid: number;
    ip: string;
    jail: string;
    timeofban: number;
    bantime: number;
    failures: number | null;
}

export class Fail2banSyncService {
    private f2bDbPath: string;
    private timer: ReturnType<typeof setInterval> | null = null;
    private running = false;

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
            return this.doSync();
        } catch (e) {
            console.error('[Fail2banSync] Error during sync:', e);
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

        // Read new rows from fail2ban DB
        let newRows: F2bBanRow[] = [];
        let f2bDb: Database.Database | null = null;
        try {
            f2bDb = new Database(this.f2bDbPath, { readonly: true, fileMustExist: true });
            // Real schema: bans(jail, ip, timeofban, bantime, bancount, data JSON)
            // failures is stored inside data JSON as json_extract(data, '$.failures')
            newRows = f2bDb.prepare(`
                SELECT rowid, ip, jail, timeofban, bantime,
                       COALESCE(json_extract(data, '$.failures'), bancount) as failures
                FROM bans
                WHERE rowid > ?
                ORDER BY rowid ASC
                LIMIT 1000
            `).all(lastRowid) as F2bBanRow[];
        } finally {
            f2bDb?.close();
        }

        if (newRows.length === 0) return 0;

        // Insert into internal DB (ignore duplicates via UNIQUE index)
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
            console.log(`[Fail2banSync] Synced ${count} new ban(s) from fail2ban.sqlite3`);
        }
        return count;
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
