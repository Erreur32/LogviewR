// Shared types for Fail2ban tabs

export interface GeoInfo {
    country: string; countryCode: string; city: string;
    org: string; isp: string; as: string;
}

export const toFlag = (cc: string) =>
    cc.toUpperCase().split('').map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join('');

export const fmtBantime = (s: number | null) => {
    if (s === null) return '—';
    if (s === -1)   return '∞ permanent';
    if (s < 60)     return `${s}s`;
    if (s < 3600)   return `${Math.round(s / 60)}m`;
    if (s < 86400)  return `${Math.round(s / 3600)}h`;
    return `${Math.round(s / 86400)}j`;
};

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
    uniqueIpsPeriod?: number;
    expiredLast24h?: number;
    firstEventAt?: number | null;
}

export interface HistoryEntry { date: string; count: number; }

export interface BanEntry {
    ip: string;
    jail: string;
    timeofban: number;
    bantime: number;
    failures: number;
    countryCode?: string;
    domain?: string;   // extracted from fail2ban data.matches (per-ban, more accurate than jail-level)
    logfile?: string;  // resolved log file path for this specific ban
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
    currentlyBanned?: boolean;
}

export type TabId =
    | 'jails' | 'filtres' | 'actions' | 'tracker' | 'ban' | 'stats' | 'carte'
    | 'iptables' | 'ipset' | 'blocklists' | 'config' | 'audit' | 'aide' | 'backup';
