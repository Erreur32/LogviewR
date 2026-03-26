// Shared types for Fail2ban tabs

export interface JailStatus {
    jail: string;
    currentlyFailed: number;
    totalFailed: number;
    currentlyBanned: number;
    totalBanned: number;
    bannedIps: string[];
    fileList?: string;
    filter?: string;
    port?: string;
    actions?: string[];
    banaction?: string;
    bantime?: number;
    findtime?: number;
    maxretry?: number;
    /** SQLite bans in the currently selected period (days from /status?days=) */
    bansInPeriod?: number;
    /** SQLite all-time total bans (cumulative) */
    totalBannedSqlite?: number;
    /** false = jail exists in config but is not currently running */
    active?: boolean;
}

export interface StatusResponse {
    ok: boolean;
    source: string;
    error?: string;
    jails?: JailStatus[];
    inactiveJails?: JailStatus[];
    totalBanned?: number;
    days?: number;
    uniqueIpsTotal?: number;
    expiredLast24h?: number;
}

export interface HistoryEntry { date: string; count: number; }

export interface BanEntry {
    ip: string;
    jail: string;
    timeofban: number;
    bantime: number;
    failures: number;
}

export interface TrackerEntry {
    ip: string;
    jails: string[];
    bans?: number;
    unbans?: number;
    failures?: number;
    lastSeen?: number;
    hostname?: string;
    ipsets?: string[];
}

export type TabId =
    | 'jails' | 'filtres' | 'actions' | 'tracker' | 'ban' | 'stats' | 'carte'
    | 'iptables' | 'ipset' | 'nftables' | 'config' | 'audit' | 'aide' | 'backup';
