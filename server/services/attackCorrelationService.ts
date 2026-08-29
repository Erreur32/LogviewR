/**
 * Attack Correlation Service
 *
 * Fail2ban-only detection of active attack campaigns: cross-jail escalation
 * (same IP hitting several jails) and coordinated campaigns (several IPs
 * sharing the same ASN/netname). Reads only from data already collected —
 * f2b_events plus the existing whois cache — no live network calls.
 */

import { getDatabase } from '../database/connection.js';

export type ThreatKind = 'ip_escalation' | 'asn_campaign';

export interface ThreatCluster {
    clusterKey: string;
    kind: ThreatKind;
    ips: string[];
    jails: string[];
    totalBans: number;
    firstSeen: number;
    lastSeen: number;
    org?: string;
    asn?: string;
    severity: number;
}

interface BanRow {
    ip: string;
    jail: string;
    timeofban: number;
    asn: string | null;
    netname: string | null;
    org: string | null;
}

class AttackCorrelationService {
    /** Active threats over the trailing window, sorted by severity descending. */
    async getActiveThreats(windowHours = 6): Promise<ThreatCluster[]> {
        const db = getDatabase();
        const since = Math.floor(Date.now() / 1000) - windowHours * 3600;

        const rows = db.prepare(`
            SELECT e.ip AS ip, e.jail AS jail, e.timeofban AS timeofban,
                   w.asn AS asn, w.netname AS netname, w.org AS org
            FROM f2b_events e
            LEFT JOIN f2b_whois_cache w ON w.ip = e.ip
            WHERE e.event_type = 'ban' AND e.timeofban >= ?
            ORDER BY e.timeofban ASC
        `).all(since) as BanRow[];

        const clusters = [
            ...this.buildIpEscalationClusters(rows),
            ...this.buildAsnCampaignClusters(rows),
        ];
        clusters.sort((a, b) => b.severity - a.severity);
        return clusters;
    }

    /** Same IP banned across >=2 distinct jails within the window. */
    private buildIpEscalationClusters(rows: BanRow[]): ThreatCluster[] {
        const byIp = new Map<string, { jails: Set<string>; timestamps: number[]; org?: string; asn?: string }>();
        for (const row of rows) {
            let entry = byIp.get(row.ip);
            if (!entry) {
                entry = { jails: new Set(), timestamps: [], org: row.org ?? undefined, asn: row.asn ?? undefined };
                byIp.set(row.ip, entry);
            }
            entry.jails.add(row.jail);
            entry.timestamps.push(row.timeofban);
        }

        const clusters: ThreatCluster[] = [];
        for (const [ip, entry] of byIp) {
            if (entry.jails.size < 2) continue;
            const jails = [...entry.jails];
            clusters.push({
                clusterKey: `ip:${ip}`,
                kind: 'ip_escalation',
                ips: [ip],
                jails,
                totalBans: entry.timestamps.length,
                firstSeen: Math.min(...entry.timestamps),
                lastSeen: Math.max(...entry.timestamps),
                org: entry.org || undefined,
                asn: entry.asn || undefined,
                severity: jails.length,
            });
        }
        return clusters;
    }

    /** >=3 distinct IPs sharing the same ASN (fallback netname) within the window. */
    private buildAsnCampaignClusters(rows: BanRow[]): ThreatCluster[] {
        const byAsn = new Map<string, { ips: Set<string>; jails: Set<string>; timestamps: number[]; org?: string }>();
        for (const row of rows) {
            const key = row.asn || row.netname;
            if (!key) continue;
            let entry = byAsn.get(key);
            if (!entry) {
                entry = { ips: new Set(), jails: new Set(), timestamps: [], org: row.org ?? undefined };
                byAsn.set(key, entry);
            }
            entry.ips.add(row.ip);
            entry.jails.add(row.jail);
            entry.timestamps.push(row.timeofban);
        }

        const clusters: ThreatCluster[] = [];
        for (const [asn, entry] of byAsn) {
            if (entry.ips.size < 3) continue;
            const ips = [...entry.ips];
            const jails = [...entry.jails];
            clusters.push({
                clusterKey: `asn:${asn}`,
                kind: 'asn_campaign',
                ips,
                jails,
                totalBans: entry.timestamps.length,
                firstSeen: Math.min(...entry.timestamps),
                lastSeen: Math.max(...entry.timestamps),
                org: entry.org || undefined,
                asn,
                severity: ips.length * jails.length,
            });
        }
        return clusters;
    }
}

export const attackCorrelationService = new AttackCorrelationService();
