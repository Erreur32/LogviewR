/**
 * Fail2ban SQLite Reader
 *
 * Reads the fail2ban database directly (/var/lib/fail2ban/fail2ban.sqlite3)
 * using better-sqlite3 (read-only). No fail2ban-client needed for stats.
 *
 * Fail2ban DB schema (relevant tables):
 *   bans(jail, ip, timeofban, bantime, bancount, data JSON)
 *   bips(ip, jail, timeofban, bantime, bancount, data JSON)
 *   failures stored in data JSON: json_extract(data, '$.failures')
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';

export interface F2bBan {
    ip: string;
    jail: string;
    timeofban: number;
    bantime: number;
    failures: number;
}

export interface F2bJailStats {
    jail: string;
    currentlyBanned: number;
    totalBanned: number;
    bannedIps: string[];
}

export interface F2bDbStats {
    jails: Record<string, F2bJailStats>;
    recentBans: F2bBan[];
    totalBanned: number;
    dbPath: string;
    readable: boolean;
}

export class Fail2banSqliteReader {
    private dbPath: string;

    constructor(dbPath: string) {
        this.dbPath = dbPath;
    }

    isReadable(): boolean {
        try {
            fs.accessSync(this.dbPath, fs.constants.R_OK);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Read current ban stats from fail2ban SQLite DB.
     * Opens read-only to avoid any locking issues with the live fail2ban process.
     */
    getStats(): F2bDbStats {
        if (!this.isReadable()) {
            return { jails: {}, recentBans: [], totalBanned: 0, dbPath: this.dbPath, readable: false };
        }

        let db: Database.Database | null = null;
        try {
            db = new Database(this.dbPath, { readonly: true, fileMustExist: true });

            // Current active bans (timeofban + bantime > now OR bantime = -1 = permanent)
            const now = Math.floor(Date.now() / 1000);
            const activeBans = db.prepare(`
                SELECT ip, jail, timeofban, bantime,
                       COALESCE(json_extract(data, '$.failures'), bancount) as failures
                FROM bans
                WHERE bantime = -1 OR (timeofban + bantime) > ?
                ORDER BY timeofban DESC
            `).all(now) as F2bBan[];

            // Aggregate per jail
            const jails: Record<string, F2bJailStats> = {};
            for (const ban of activeBans) {
                if (!jails[ban.jail]) {
                    jails[ban.jail] = { jail: ban.jail, currentlyBanned: 0, totalBanned: 0, bannedIps: [] };
                }
                jails[ban.jail].currentlyBanned++;
                jails[ban.jail].bannedIps.push(ban.ip);
            }

            // Total banned per jail (all time)
            const totals = db.prepare(`
                SELECT jail, COUNT(*) as cnt FROM bans GROUP BY jail
            `).all() as { jail: string; cnt: number }[];
            for (const row of totals) {
                if (!jails[row.jail]) {
                    jails[row.jail] = { jail: row.jail, currentlyBanned: 0, totalBanned: 0, bannedIps: [] };
                }
                jails[row.jail].totalBanned = row.cnt;
            }

            // Recent bans (last 50)
            const recentBans = db.prepare(`
                SELECT ip, jail, timeofban, bantime,
                       COALESCE(json_extract(data, '$.failures'), bancount) as failures
                FROM bans
                ORDER BY timeofban DESC
                LIMIT 50
            `).all() as F2bBan[];

            return {
                jails,
                recentBans,
                totalBanned: activeBans.length,
                dbPath: this.dbPath,
                readable: true,
            };
        } catch (err) {
            return { jails: {}, recentBans: [], totalBanned: 0, dbPath: this.dbPath, readable: false };
        } finally {
            db?.close();
        }
    }

    /**
     * Bans per jail for a given period (for "Bans période" in UI).
     * days <= 0 → all-time.
     */
    getBansInPeriodByJail(days: number): Record<string, number> {
        if (!this.isReadable()) return {};
        let db: Database.Database | null = null;
        try {
            db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
            const allTime = days <= 0;
            let rows: { jail: string; cnt: number }[];
            if (allTime) {
                rows = db.prepare(`SELECT jail, COUNT(*) as cnt FROM bans GROUP BY jail`).all() as { jail: string; cnt: number }[];
            } else {
                const since = Math.floor(Date.now() / 1000) - days * 86400;
                rows = db.prepare(`SELECT jail, COUNT(*) as cnt FROM bans WHERE timeofban >= ? GROUP BY jail`).all(since) as { jail: string; cnt: number }[];
            }
            return Object.fromEntries(rows.map(r => [r.jail, r.cnt]));
        } catch { return {}; }
        finally { db?.close(); }
    }

    /**
     * SQLite all-time total bans per jail (cumulative, regardless of period).
     */
    getTotalsByJail(): Record<string, number> {
        if (!this.isReadable()) return {};
        let db: Database.Database | null = null;
        try {
            db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
            const rows = db.prepare(`SELECT jail, COUNT(*) as cnt FROM bans GROUP BY jail`).all() as { jail: string; cnt: number }[];
            return Object.fromEntries(rows.map(r => [r.jail, r.cnt]));
        } catch { return {}; }
        finally { db?.close(); }
    }

    /** Top IPs by ban count in period. */
    getTopIps(days: number, limit: number): { ip: string; count: number }[] {
        if (!this.isReadable()) return [];
        let db: Database.Database | null = null;
        try {
            db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
            const allTime = days <= 0;
            const since = allTime ? 0 : Math.floor(Date.now() / 1000) - days * 86400;
            const rows = allTime
                ? db.prepare(`SELECT ip, COUNT(*) as count FROM bans GROUP BY ip ORDER BY count DESC LIMIT ?`).all(limit) as { ip: string; count: number }[]
                : db.prepare(`SELECT ip, COUNT(*) as count FROM bans WHERE timeofban >= ? GROUP BY ip ORDER BY count DESC LIMIT ?`).all(since, limit) as { ip: string; count: number }[];
            return rows;
        } catch { return []; }
        finally { db?.close(); }
    }

    /** Top jails by ban count in period. */
    getTopJails(days: number, limit: number): { jail: string; count: number }[] {
        if (!this.isReadable()) return [];
        let db: Database.Database | null = null;
        try {
            db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
            const allTime = days <= 0;
            const since = allTime ? 0 : Math.floor(Date.now() / 1000) - days * 86400;
            const rows = allTime
                ? db.prepare(`SELECT jail, COUNT(*) as count FROM bans GROUP BY jail ORDER BY count DESC LIMIT ?`).all(limit) as { jail: string; count: number }[]
                : db.prepare(`SELECT jail, COUNT(*) as count FROM bans WHERE timeofban >= ? GROUP BY jail ORDER BY count DESC LIMIT ?`).all(since, limit) as { jail: string; count: number }[];
            return rows;
        } catch { return []; }
        finally { db?.close(); }
    }

    /** Hourly ban heatmap (0–23). */
    getHeatmap(days: number): { hour: number; count: number }[] {
        if (!this.isReadable()) return [];
        let db: Database.Database | null = null;
        try {
            db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
            const allTime = days <= 0;
            const since = allTime ? 0 : Math.floor(Date.now() / 1000) - days * 86400;
            const rows = allTime
                ? db.prepare(`SELECT CAST(strftime('%H', timeofban, 'unixepoch') AS INTEGER) as hour, COUNT(*) as count FROM bans GROUP BY hour ORDER BY hour`).all() as { hour: number; count: number }[]
                : db.prepare(`SELECT CAST(strftime('%H', timeofban, 'unixepoch') AS INTEGER) as hour, COUNT(*) as count FROM bans WHERE timeofban >= ? GROUP BY hour ORDER BY hour`).all(since) as { hour: number; count: number }[];
            return rows;
        } catch { return []; }
        finally { db?.close(); }
    }

    /** Per-IP stats: ban count, last seen (unix ts), failures sum — all-time or period. */
    getIpStats(days: number): Record<string, { bans: number; lastSeen: number; failures: number }> {
        if (!this.isReadable()) return {};
        let db: Database.Database | null = null;
        try {
            db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
            const allTime = days <= 0;
            const since = allTime ? 0 : Math.floor(Date.now() / 1000) - days * 86400;
            const rows = allTime
                ? db.prepare(`SELECT ip, COUNT(*) as bans, MAX(timeofban) as lastSeen, SUM(COALESCE(json_extract(data,'$.failures'), bancount)) as failures FROM bans GROUP BY ip`).all() as { ip: string; bans: number; lastSeen: number; failures: number }[]
                : db.prepare(`SELECT ip, COUNT(*) as bans, MAX(timeofban) as lastSeen, SUM(COALESCE(json_extract(data,'$.failures'), bancount)) as failures FROM bans WHERE timeofban >= ? GROUP BY ip`).all(since) as { ip: string; bans: number; lastSeen: number; failures: number }[];
            const result: Record<string, { bans: number; lastSeen: number; failures: number }> = {};
            for (const r of rows) result[r.ip] = { bans: r.bans, lastSeen: r.lastSeen, failures: r.failures };
            return result;
        } catch { return {}; }
        finally { db?.close(); }
    }

    /** Hourly failures heatmap (0–23) — sum of failures from bans.data JSON. */
    getFailuresHeatmap(days: number): { hour: number; count: number }[] {
        if (!this.isReadable()) return [];
        let db: Database.Database | null = null;
        try {
            db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
            const allTime = days <= 0;
            const since = allTime ? 0 : Math.floor(Date.now() / 1000) - days * 86400;
            const rows = allTime
                ? db.prepare(`SELECT CAST(strftime('%H', timeofban, 'unixepoch') AS INTEGER) as hour, SUM(COALESCE(json_extract(data,'$.failures'), bancount)) as count FROM bans GROUP BY hour ORDER BY hour`).all() as { hour: number; count: number }[]
                : db.prepare(`SELECT CAST(strftime('%H', timeofban, 'unixepoch') AS INTEGER) as hour, SUM(COALESCE(json_extract(data,'$.failures'), bancount)) as count FROM bans WHERE timeofban >= ? GROUP BY hour ORDER BY hour`).all(since) as { hour: number; count: number }[];
            return rows;
        } catch { return []; }
        finally { db?.close(); }
    }

    /** Summary stats for a period: total bans, unique IPs, most active jail. */
    getPeriodSummary(days: number): { totalBans: number; uniqueIps: number; topJail: string | null; topJailCount: number } {
        if (!this.isReadable()) return { totalBans: 0, uniqueIps: 0, topJail: null, topJailCount: 0 };
        let db: Database.Database | null = null;
        try {
            db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
            const allTime = days <= 0;
            const since = allTime ? 0 : Math.floor(Date.now() / 1000) - days * 86400;
            const [totRow] = allTime
                ? [db.prepare(`SELECT COUNT(*) as total, COUNT(DISTINCT ip) as uniq FROM bans`).get() as { total: number; uniq: number }]
                : [db.prepare(`SELECT COUNT(*) as total, COUNT(DISTINCT ip) as uniq FROM bans WHERE timeofban >= ?`).get(since) as { total: number; uniq: number }];
            const [topRow] = allTime
                ? [db.prepare(`SELECT jail, COUNT(*) as cnt FROM bans GROUP BY jail ORDER BY cnt DESC LIMIT 1`).get() as { jail: string; cnt: number } | undefined ?? { jail: null, cnt: 0 }]
                : [db.prepare(`SELECT jail, COUNT(*) as cnt FROM bans WHERE timeofban >= ? GROUP BY jail ORDER BY cnt DESC LIMIT 1`).get(since) as { jail: string; cnt: number } | undefined ?? { jail: null, cnt: 0 }];
            return {
                totalBans: totRow?.total ?? 0,
                uniqueIps: totRow?.uniq ?? 0,
                topJail: (topRow as { jail: string | null; cnt: number }).jail,
                topJailCount: (topRow as { jail: string | null; cnt: number }).cnt,
            };
        } catch { return { totalBans: 0, uniqueIps: 0, topJail: null, topJailCount: 0 }; }
        finally { db?.close(); }
    }

    /**
     * Ban history for charts: ban counts per day over the last N days.
     */
    // 30-min slot size used for 24h granularity
    static readonly SLOT_SECS = 1800;

    getBanHistoryByJail(days = 30): { jailNames: string[]; data: Record<string, Record<string, number>>; granularity: 'hour' | 'day'; slotBase?: number } {
        if (!this.isReadable()) return { jailNames: [], data: {}, granularity: 'day' };
        const halfHour = days === 1; // 30-min rolling slots for 24h view
        let db: Database.Database | null = null;
        try {
            db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
            const rawSince = Math.floor(Date.now() / 1000) - (halfHour ? 86400 : Math.min(days <= 0 ? 3650 : days, 3650) * 86400);
            // Align 24h window to 30-min boundary so slot labels always land on HH:00 / HH:30
            const since = halfHour ? Math.floor(rawSince / Fail2banSqliteReader.SLOT_SECS) * Fail2banSqliteReader.SLOT_SECS : rawSince;
            const SLOT = Fail2banSqliteReader.SLOT_SECS;
            // Convert numeric slot_idx → "HH:MM" label anchored to `since`
            const slotLabel = (idx: number): string => {
                const ts = new Date((since + idx * SLOT) * 1000);
                return `${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`;
            };
            const rows: { jail: string; slot: string; cnt: number }[] = halfHour
                ? (db.prepare(`
                    SELECT jail,
                        CAST((timeofban - ?) / ? AS INTEGER) as slot_idx,
                        COUNT(*) as cnt
                    FROM bans WHERE timeofban >= ?
                    GROUP BY jail, slot_idx
                    ORDER BY slot_idx ASC
                  `).all(since, SLOT, since) as { jail: string; slot_idx: number; cnt: number }[])
                  .map(r => ({ jail: r.jail, slot: slotLabel(r.slot_idx), cnt: r.cnt }))
                : (days <= 0 || days > 3650)
                    ? (db.prepare(`SELECT jail, date(timeofban,'unixepoch') as slot, COUNT(*) as cnt FROM bans GROUP BY jail, slot ORDER BY slot ASC`).all() as { jail: string; slot: string; cnt: number }[])
                    : (db.prepare(`SELECT jail, date(timeofban,'unixepoch') as slot, COUNT(*) as cnt FROM bans WHERE timeofban >= ? GROUP BY jail, slot ORDER BY slot ASC`).all(since) as { jail: string; slot: string; cnt: number }[]);
            const data: Record<string, Record<string, number>> = {};
            const jailSet = new Set<string>();
            for (const r of rows) {
                jailSet.add(r.jail);
                if (!data[r.jail]) data[r.jail] = {};
                data[r.jail][r.slot] = r.cnt;
            }
            const jailNames = [...jailSet].sort((a, b) =>
                Object.values(data[b] ?? {}).reduce((s, v) => s + v, 0) -
                Object.values(data[a] ?? {}).reduce((s, v) => s + v, 0)
            );
            return { jailNames, data, granularity: halfHour ? 'hour' : 'day', slotBase: halfHour ? since : undefined };
        } catch { return { jailNames: [], data: {}, granularity: 'day' }; }
        finally { db?.close(); }
    }

    getBanHistory(days = 30): { date: string; count: number }[] {
        if (!this.isReadable()) return [];
        const halfHour = days === 1;
        let db: Database.Database | null = null;
        try {
            db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
            if (halfHour) {
                // 30-min slots — same logic as getBanHistoryByJail so sparkline matches chart
                const SLOT = Fail2banSqliteReader.SLOT_SECS;
                const since = Math.floor((Math.floor(Date.now() / 1000) - 86400) / SLOT) * SLOT;
                const rawRows = db.prepare(`
                    SELECT CAST((timeofban - ?) / ? AS INTEGER) as slot_idx, COUNT(*) as count
                    FROM bans WHERE timeofban >= ?
                    GROUP BY slot_idx ORDER BY slot_idx ASC
                `).all(since, SLOT, since) as { slot_idx: number; count: number }[];
                return rawRows.map(r => {
                    const ts = new Date((since + r.slot_idx * SLOT) * 1000);
                    const date = `${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`;
                    return { date, count: r.count };
                });
            }
            const allTime = days <= 0 || days > 3650;
            const effectiveDays = allTime ? 3650 : Math.max(1, Math.min(days, 3650));
            const since = Math.floor(Date.now() / 1000) - effectiveDays * 86400;
            const rows = allTime
                ? (db.prepare(`
                    SELECT date(timeofban, 'unixepoch') as date, COUNT(*) as count
                    FROM bans
                    GROUP BY date
                    ORDER BY date ASC
                `).all() as { date: string; count: number }[])
                : (db.prepare(`
                    SELECT date(timeofban, 'unixepoch') as date, COUNT(*) as count
                    FROM bans
                    WHERE timeofban >= ?
                    GROUP BY date
                    ORDER BY date ASC
                `).all(since) as { date: string; count: number }[]);
            return rows;
        } catch {
            return [];
        } finally {
            db?.close();
        }
    }

    /**
     * Total unique IPs ever banned (all-time, no period filter).
     */
    getUniqueIpsTotal(): number {
        if (!this.isReadable()) return 0;
        let db: Database.Database | null = null;
        try {
            db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
            const row = db.prepare(`SELECT COUNT(DISTINCT ip) as n FROM bans`).get() as { n: number };
            return row?.n ?? 0;
        } catch { return 0; }
        finally { db?.close(); }
    }

    /**
     * Bans expired in the last N hours (bantime elapsed, not permanent).
     */
    getExpiredBansInWindow(hours = 24): number {
        if (!this.isReadable()) return 0;
        let db: Database.Database | null = null;
        try {
            db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
            const now  = Math.floor(Date.now() / 1000);
            const from = now - hours * 3600;
            const row = db.prepare(`
                SELECT COUNT(*) as n FROM bans
                WHERE bantime > 0
                  AND (timeofban + bantime) >= ? AND (timeofban + bantime) <= ?
            `).get(from, now) as { n: number };
            return row?.n ?? 0;
        } catch { return 0; }
        finally { db?.close(); }
    }
}
