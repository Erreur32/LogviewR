/**
 * Fail2ban Plugin
 *
 * Monitors fail2ban from Docker:
 *   - Stats & ban history → SQLite DB read directly (/host/var/lib/fail2ban/fail2ban.sqlite3)
 *   - Jail status, ban/unban → fail2ban-client via Unix socket (/var/run/fail2ban/fail2ban.sock)
 *
 * Prerequisites:
 *   - /var/run/fail2ban/fail2ban.sock mounted (rw) in docker-compose.yml
 *   - chmod 660 on socket (via systemd drop-in + docker-entrypoint.sh)
 *   - fail2ban installed in container (apk add fail2ban)
 */

import { Router } from 'express';
import Database from 'better-sqlite3';
import { BasePlugin } from '../base/BasePlugin.js';
import type { PluginStats } from '../base/PluginInterface.js';
import { Fail2banSqliteReader } from './Fail2banSqliteReader.js';
import { Fail2banClientExec } from './Fail2banClientExec.js';
import { IptablesService } from './IptablesService.js';
import { Fail2banSyncService } from '../../services/fail2banSyncService.js';
import { asyncHandler, createError } from '../../middleware/errorHandler.js';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { getDatabase } from '../../database/connection.js';
import * as dns from 'dns';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { logger } from '../../utils/logger.js';
import { webhookDispatchService } from '../../services/WebhookDispatchService.js';
import mysql from 'mysql2/promise';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_SQLITE_PATH = '/var/lib/fail2ban/fail2ban.sqlite3';
const SOCKET_PATH = '/var/run/fail2ban/fail2ban.sock';

/** Filenames only — no path traversal (matches fail2ban.log, fail2ban.log.1, etc.) */
const FAIL2BAN_LOG_NAME = /^fail2ban[a-zA-Z0-9._-]*\.log(\.\d+)?$/;

// ── Whois + Known-provider helpers ─────────────────────────────────────────────

interface WhoisInfo { org: string; country: string; asn: string; netname: string; cidr: string; }
interface KnownProvider { name: string; cidr: string; }

/** Runs system `whois <ip>` and parses key fields. Returns null on timeout/error. */
async function runWhois(ip: string): Promise<WhoisInfo | null> {
    try {
        const { stdout } = await execFileAsync('whois', [ip], { timeout: 6000 });
        const info: WhoisInfo = { org: '', country: '', asn: '', netname: '', cidr: '' };
        for (const raw of stdout.split('\n')) {
            const line = raw.trim();
            if (!line || line.startsWith('#') || line.startsWith('%')) continue;
            if (!info.org     && /^org(?:name)?:\s*(.+)/i.test(line))          info.org     = line.replace(/^org(?:name)?:\s*/i, '').trim();
            if (!info.country && /^country:\s*(.+)/i.test(line))               info.country = line.replace(/^country:\s*/i, '').trim().toUpperCase();
            if (!info.asn     && /^(?:origin|aut-num):\s*(AS\d+)/i.test(line)) info.asn     = line.match(/AS\d+/i)![0];
            if (!info.netname && /^netname:\s*(.+)/i.test(line))               info.netname = line.replace(/^netname:\s*/i, '').trim();
            if (!info.cidr    && /^(?:cidr|route):\s*(.+)/i.test(line))        info.cidr    = line.replace(/^(?:cidr|route):\s*/i, '').trim();
        }
        return (info.org || info.country || info.asn || info.netname) ? info : null;
    } catch { return null; }
}

/** Checks if IPv4 belongs to a known provider range (Cloudflare, Google, AWS, Microsoft). */
function checkKnownProvider(ip: string): KnownProvider | null {
    // IPv6 not supported for CIDR check
    if (!ip || ip.includes(':')) return null;
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return null;
    const ipLong = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;

    let ranges: Record<string, string[]>;
    try {
        ranges = JSON.parse(fs.readFileSync(path.join(__dirname, 'known-ip-ranges.json'), 'utf8'));
    } catch { return null; }

    for (const [provider, cidrs] of Object.entries(ranges)) {
        for (const cidr of cidrs) {
            const [subnet, bits] = cidr.split('/');
            const b = parseInt(bits, 10);
            if (!subnet || isNaN(b) || b < 1 || b > 32) continue;
            const sp = subnet.split('.').map(Number);
            if (sp.length !== 4) continue;
            const subnetLong = ((sp[0] << 24) | (sp[1] << 16) | (sp[2] << 8) | sp[3]) >>> 0;
            const mask = b === 32 ? 0xFFFFFFFF : (~(0xFFFFFFFF >>> b)) >>> 0;
            if ((ipLong & mask) === (subnetLong & mask)) return { name: provider, cidr };
        }
    }
    return null;
}

/** Greps a log file for an IP (literal match, last N lines). Returns [] on error. */
async function grepLogFile(resolvedPath: string, ip: string, maxLines = 30): Promise<string[]> {
    if (!resolvedPath || !fs.existsSync(resolvedPath)) return [];
    try {
        const { stdout } = await execFileAsync('grep', ['-F', ip, resolvedPath], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
        const lines = stdout.trim().split('\n').filter(Boolean);
        return lines.slice(-maxLines);
    } catch { return []; }
}

// ── Jail config parser ─────────────────────────────────────────────────────────

interface JailMeta {
    filter?: string;
    port?: string;
    actions?: string[];
    banaction?: string;
    bantime?: number;
    findtime?: number;
    maxretry?: number;
    enabled?: boolean;
    ignoreip?: string;
    logpath?: string;
}

/** Parse a simple fail2ban INI file, accumulating sections into result. */
function parseJailIniFile(filePath: string, defaults: Record<string, string>, result: Record<string, Record<string, string>>): void {
    let text: string;
    try { text = fs.readFileSync(filePath, 'utf8'); } catch { return; }
    let section = '';
    let lastKey = '';
    for (const raw of text.split(/\r?\n/)) {
        const isContinuation = /^\s+\S/.test(raw); // starts with whitespace = continuation
        const line = raw.replace(/#.*$/, '').trim();
        if (!line) { lastKey = ''; continue; }
        const secMatch = line.match(/^\[([^\]]+)\]$/);
        if (secMatch) { section = secMatch[1].toLowerCase(); lastKey = ''; continue; }
        // Continuation line — append to last key value
        if (isContinuation && lastKey && section) {
            if (section === 'default' || section === 'definition') {
                defaults[lastKey] = (defaults[lastKey] ?? '') + ' ' + line;
            } else {
                if (result[section]) result[section][lastKey] = (result[section][lastKey] ?? '') + ' ' + line;
            }
            continue;
        }
        const kvMatch = line.match(/^([a-zA-Z0-9_\-]+)\s*=\s*(.*)$/);
        if (!kvMatch || !section) { lastKey = ''; continue; }
        const key = kvMatch[1].toLowerCase();
        const val = kvMatch[2].trim();
        lastKey = key;
        if (section === 'default' || section === 'definition') {
            defaults[key] = val;
        } else {
            if (!result[section]) result[section] = {};
            result[section][key] = val;
        }
    }
}

/** Read all jail config files and return per-jail metadata. */
function parseJailConfigs(confBase: string): Record<string, JailMeta> {
    const defaults: Record<string, string> = {};
    const raw: Record<string, Record<string, string>> = {};

    // Read in override order: jail.conf → jail.d/*.conf → jail.local → jail.d/*.local
    const jailConf  = path.join(confBase, 'jail.conf');
    const jailLocal = path.join(confBase, 'jail.local');
    const jailD     = path.join(confBase, 'jail.d');

    let dConfs: string[] = [];
    let dLocals: string[] = [];
    try {
        const entries = fs.readdirSync(jailD).sort();
        dConfs  = entries.filter(f => f.endsWith('.conf')).map(f => path.join(jailD, f));
        dLocals = entries.filter(f => f.endsWith('.local')).map(f => path.join(jailD, f));
    } catch { /* jail.d may not exist */ }

    for (const f of [jailConf, ...dConfs, jailLocal, ...dLocals]) {
        parseJailIniFile(f, defaults, raw);
    }

    const result: Record<string, JailMeta> = {};
    for (const [jail, kv] of Object.entries(raw)) {
        const get = (k: string): string | undefined => kv[k] ?? defaults[k];
        const parseNum = (v?: string): number | undefined => {
            if (v === undefined) return undefined;
            // handle -1 (permanent ban) and time suffixes: 10m→600, 1h→3600, 1d→86400, 1w→604800
            const suffixMatch = v.trim().match(/^(-?\d+(?:\.\d+)?)\s*([smhdw])?$/i);
            if (!suffixMatch) return undefined;
            const n = parseFloat(suffixMatch[1]);
            if (n < 0) return n; // -1 = permanent, keep as-is
            const unit = (suffixMatch[2] ?? 's').toLowerCase();
            const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
            return Math.round(n * (mult[unit] ?? 1));
        };
        // Parse action names: action = %(action_)s → action_ = %(banaction)s[..] → banaction = nftables
        const resolveActionName = (raw: string): string | null => {
            const base = raw.trim().replace(/\[.*$/, '').trim();           // strip [params...]
            const varRef = base.match(/^%\(([^)]+)\)s$/);
            if (varRef) {
                const key = varRef[1];
                if (key === 'action_' || key === 'action') return null;     // self-ref, skip
                const resolved = get(key);
                return resolved ? resolved.replace(/\[.*$/, '').trim() : null;
            }
            return base || null;
        };
        // Resolve %(var)s interpolation — %(__name__)s = jail name, %(key)s = config value
        const resolveVars = (v: string | undefined): string | undefined => {
            if (!v) return v;
            return v.replace(/%\(([^)]+)\)s/g, (_, key) => {
                if (key === '__name__') return jail;
                return get(key) ?? `%(${key})s`;
            });
        };

        const actRaw = get('action') ?? get('action_') ?? '';
        const rawParts = actRaw ? actRaw.split('\n').map(s => s.trim()).filter(Boolean) : [];
        const resolvedActions = rawParts.map(resolveActionName).filter((a): a is string => Boolean(a));
        const actions = resolvedActions.length ? resolvedActions : undefined;
        const enabledRaw = get('enabled');
        result[jail] = {
            filter:    resolveVars(get('filter')),
            port:      get('port'),
            banaction: resolveVars(get('banaction')),
            ignoreip:  get('ignoreip'),
            actions:   actions?.length ? actions : undefined,
            bantime:   parseNum(get('bantime')),
            findtime:  parseNum(get('findtime')),
            maxretry:  get('maxretry') !== undefined ? parseInt(get('maxretry')!, 10) : undefined,
            enabled:   enabledRaw !== undefined ? (enabledRaw.toLowerCase() !== 'false' && enabledRaw !== '0') : true,
            logpath:   resolveVars(get('logpath')),
        };
    }
    return result;
}

interface GlobalConfig {
    loglevel: string;
    logtarget: string;
    socket: string;
    pidfile: string;
    dbfile: string;
    dbpurgeage: string;
    dbmaxmatches: string;
    local_values: Partial<Record<string, string>>;
    local_exists: boolean;
}

/** Parse fail2ban.conf + fail2ban.local and return merged global config values. */
function parseGlobalConfig(confBase: string): GlobalConfig {
    const defaults: Record<string, string> = {
        loglevel: 'INFO',
        logtarget: '/var/log/fail2ban.log',
        socket: '/var/run/fail2ban/fail2ban.sock',
        pidfile: '/var/run/fail2ban/fail2ban.pid',
        dbfile: '/var/lib/fail2ban/fail2ban.sqlite3',
        dbpurgeage: '86400',
        dbmaxmatches: '10',
    };
    const merged: Record<string, string> = { ...defaults };
    const localVals: Record<string, string> = {};

    const parseFile = (filePath: string, isLocal: boolean): void => {
        let text: string;
        try { text = fs.readFileSync(filePath, 'utf8'); } catch { return; }
        let inDefinition = false;
        for (const raw of text.split(/\r?\n/)) {
            const line = raw.replace(/#.*$/, '').trim();
            if (!line) continue;
            const secMatch = line.match(/^\[([^\]]+)\]$/);
            if (secMatch) { inDefinition = secMatch[1].toLowerCase() === 'definition'; continue; }
            if (!inDefinition) continue;
            const kvMatch = line.match(/^([a-zA-Z0-9_\-]+)\s*=\s*(.*)$/);
            if (!kvMatch) continue;
            const k = kvMatch[1].toLowerCase();
            const v = kvMatch[2].trim();
            merged[k] = v;
            if (isLocal) localVals[k] = v;
        }
    };

    parseFile(path.join(confBase, 'fail2ban.conf'), false);
    parseFile(path.join(confBase, 'fail2ban.local'), true);

    let localExists = false;
    try { fs.accessSync(path.join(confBase, 'fail2ban.local'), fs.constants.R_OK); localExists = true; } catch {}

    return {
        loglevel:     merged.loglevel ?? defaults.loglevel,
        logtarget:    merged.logtarget ?? defaults.logtarget,
        socket:       merged.socket ?? defaults.socket,
        pidfile:      merged.pidfile ?? defaults.pidfile,
        dbfile:       merged.dbfile ?? defaults.dbfile,
        dbpurgeage:   merged.dbpurgeage ?? defaults.dbpurgeage,
        dbmaxmatches: merged.dbmaxmatches ?? defaults.dbmaxmatches,
        local_values: localVals,
        local_exists: localExists,
    };
}

/**
 * Write or update a key=value in [Definition] section of a fail2ban INI file.
 * Creates the file if it doesn't exist.
 */
function writeIniValue(filePath: string, key: string, value: string): void {
    let text = '';
    try { text = fs.readFileSync(filePath, 'utf8'); } catch { /* create */ }

    const lines = text.split(/\r?\n/);
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const keyRegex = new RegExp(`^(\\s*${escapedKey}\\s*=)(.*)$`, 'i');

    let inDefinition = false;
    let keyFound = false;
    let defStart = -1;

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].replace(/#.*$/, '').trim();
        const secMatch = trimmed.match(/^\[([^\]]+)\]$/);
        if (secMatch) {
            inDefinition = secMatch[1].toLowerCase() === 'definition';
            if (inDefinition && defStart === -1) defStart = i;
        }
        if (inDefinition && keyRegex.test(lines[i])) {
            lines[i] = `${key} = ${value}`;
            keyFound = true;
        }
    }

    if (!keyFound) {
        if (defStart >= 0) {
            // Insert after [Definition] header
            lines.splice(defStart + 1, 0, `${key} = ${value}`);
        } else {
            // Append [Definition] section
            if (lines[lines.length - 1] !== '') lines.push('');
            lines.push('[Definition]', `${key} = ${value}`);
        }
    }

    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

function readLogTail(absPath: string, maxLines: number): { content: string; truncated: boolean; bytes: number } {
    const stat = fs.statSync(absPath);
    const size = stat.size;
    if (size === 0) return { content: '', truncated: false, bytes: 0 };
    const maxRead = 2 * 1024 * 1024;
    const readSize = Math.min(size, maxRead);
    const fd = fs.openSync(absPath, 'r');
    try {
        const buf = Buffer.alloc(readSize);
        const start = Math.max(0, size - readSize);
        fs.readSync(fd, buf, 0, readSize, start);
        const text = buf.toString('utf8');
        const lines = text.split(/\r?\n/);
        const dropped = size > readSize;
        const usable = dropped ? lines.slice(1) : lines;
        const tail = usable.slice(-maxLines);
        const prefix = dropped ? '[… truncated …]\n' : '';
        return { content: prefix + tail.join('\n'), truncated: dropped, bytes: size };
    } finally {
        fs.closeSync(fd);
    }
}

export interface Fail2banPluginConfig {
    sqliteDbPath?: string;   // host path (will be resolved to /host/... in Docker)
    npmDataPath?: string;    // host path to NPM data dir (contains database.sqlite + logs/)
    npmDbType?: 'sqlite' | 'mysql';
    npmMysqlHost?: string;
    npmMysqlPort?: number;
    npmMysqlUser?: string;
    npmMysqlPass?: string;
    npmMysqlDb?: string;
    enabled: boolean;
}

// ── NPM domain map helper — SQLite or MySQL ───────────────────────────────────

/**
 * Returns a map of proxy-host id → first domain from NPM's database.
 * Supports SQLite (file) and MySQL/MariaDB (network).
 */
async function getNpmDomainMap(
    settings: Fail2banPluginConfig,
    resolvePath: (p: string) => string
): Promise<{ idToDomain: Record<string, string>; source: 'sqlite' | 'mysql' }> {
    const dbType = settings.npmDbType ?? 'sqlite';

    if (dbType === 'mysql') {
        const conn = await mysql.createConnection({
            host:     settings.npmMysqlHost || '127.0.0.1',
            port:     settings.npmMysqlPort || 3306,
            user:     settings.npmMysqlUser || 'npm',
            password: settings.npmMysqlPass || '',
            database: settings.npmMysqlDb  || 'npm',
            connectTimeout: 5000,
        });
        try {
            const [rows] = await conn.execute<mysql.RowDataPacket[]>(
                'SELECT id, domain_names FROM proxy_host WHERE is_deleted = 0'
            );
            const idToDomain: Record<string, string> = {};
            for (const row of rows) {
                try {
                    const ns: string[] = JSON.parse(row.domain_names as string);
                    if (ns.length) idToDomain[String(row.id)] = ns[0].replace(/^www\./, '').toLowerCase();
                } catch { /* bad JSON */ }
            }
            return { idToDomain, source: 'mysql' };
        } finally {
            await conn.end();
        }
    }

    // SQLite fallback
    const npmDbPath = resolvePath(`${settings.npmDataPath}/database.sqlite`);
    const npmDb = new Database(npmDbPath, { readonly: true, fileMustExist: true });
    const proxyRows = npmDb.prepare('SELECT id, domain_names FROM proxy_host WHERE is_deleted=0').all() as { id: number; domain_names: string }[];
    npmDb.close();
    const idToDomain: Record<string, string> = {};
    for (const row of proxyRows) {
        try {
            const ns: string[] = JSON.parse(row.domain_names);
            if (ns.length) idToDomain[String(row.id)] = ns[0].replace(/^www\./, '').toLowerCase();
        } catch { /* bad JSON */ }
    }
    return { idToDomain, source: 'sqlite' };
}

// ── DNS reverse-lookup cache (TTL 10 min) ─────────────────────────────────────
const dnsCache = new Map<string, { hostname: string; ts: number }>();
const DNS_TTL  = 10 * 60 * 1000; // 10 min

async function reverseDns(ip: string): Promise<string | null> {
    const cached = dnsCache.get(ip);
    if (cached && Date.now() - cached.ts < DNS_TTL) return cached.hostname;
    try {
        const names = await Promise.race([
            dns.promises.reverse(ip),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
        ]);
        const hostname = (names as string[])[0] ?? null;
        if (hostname) dnsCache.set(ip, { hostname, ts: Date.now() });
        return hostname;
    } catch {
        dnsCache.set(ip, { hostname: '', ts: Date.now() }); // cache negative
        return null;
    }
}

// ── IPSet membership parser ────────────────────────────────────────────────────
function parseIpsetMembership(raw: string): Map<string, string[]> {
    const map = new Map<string, string[]>();
    let currentSet = '';
    let inMembers = false;
    for (const line of raw.split('\n')) {
        const nm = line.match(/^Name:\s*(.+)/);
        if (nm) { currentSet = nm[1].trim(); inMembers = false; continue; }
        if (line.trim() === 'Members:') { inMembers = true; continue; }
        if (inMembers && line.trim() && !line.startsWith(' ') && currentSet) {
            const ip = line.trim().split(/\s/)[0]; // strip timeout info
            if (ip && /^[\d:.a-fA-F/]+$/.test(ip)) {
                if (!map.has(ip)) map.set(ip, []);
                map.get(ip)!.push(currentSet);
            }
        }
        if (line.trim() === '') inMembers = false;
    }
    return map;
}

export class Fail2banPlugin extends BasePlugin {
    private reader!: Fail2banSqliteReader;
    private client!: Fail2banClientExec;
    private syncService: Fail2banSyncService | null = null;
    // Rollback state for iptables write operations
    private ipt_rollbackTimer: ReturnType<typeof setTimeout> | null = null;
    private ipt_rollbackSnapshot: string | null = null;
    private ipt_rollbackDeadline: number | null = null;

    // ── Route-level TTL cache — avoids re-running expensive socket/SQLite work ──
    // Key: opaque string (endpoint + params). Value: {data, ts}.
    // Cache is intentionally per-plugin-instance (process lifetime).
    private readonly _routeCache = new Map<string, { data: unknown; ts: number }>();

    private _cachePeek<T>(key: string, ttlMs: number): T | null {
        const e = this._routeCache.get(key);
        return (e && Date.now() - e.ts < ttlMs) ? e.data as T : null;
    }
    private _cachePut(key: string, data: unknown): void {
        this._routeCache.set(key, { data, ts: Date.now() });
    }
    /** Returns cache TTL in ms adapted to the time range: recent data expires fast, old data stays longer. */
    private _adaptiveTtl(days: number): number {
        if (days <= 0)  return 600_000; // all-time: 10min
        if (days <= 2)  return 30_000;  // 24h/48h: 30s
        if (days <= 7)  return 120_000; // 7j: 2min
        return 600_000;                 // 30j, 6m, 1an: 10min
    }

    constructor() {
        super('fail2ban', 'Fail2ban', '1.0.0');
    }

    async start(): Promise<void> {
        await super.start();
        if (!this.isEnabled()) return;

        const settings = this.config?.settings as unknown as Fail2banPluginConfig | undefined;
        const rawDbPath = settings?.sqliteDbPath || DEFAULT_SQLITE_PATH;
        const dbPath = this.resolveDockerPathSync(rawDbPath);

        this.reader = new Fail2banSqliteReader(dbPath);
        this.client = new Fail2banClientExec();

        if (!this.reader.isReadable()) {
            logger.warn('Fail2ban', `SQLite DB not readable at ${dbPath} — ban history unavailable`);
        } else {
            // Start sync service to replicate bans into internal dashboard.db
            this.syncService = new Fail2banSyncService(dbPath);
            this.syncService.start();
        }
        if (!this.client.isAvailable()) {
            logger.warn('Fail2ban', 'fail2ban-client or socket not available — actions disabled');
        }
        logger.info('Fail2ban', `Started. DB: ${dbPath} | Socket: ${SOCKET_PATH}`);
    }

    async getStats(): Promise<PluginStats> {
        if (!this.isEnabled()) throw new Error('Fail2ban plugin is not enabled');

        const dbStats = this.reader?.getStats() ?? { jails: {}, recentBans: [], totalBanned: 0, readable: false };
        return {
            fail2ban: {
                socketAvailable: this.client?.isAvailable() ?? false,
                dbReadable: dbStats.readable,
                totalActiveBanned: dbStats.totalBanned,
                jails: dbStats.jails,
                recentBans: dbStats.recentBans,
            }
        };
    }

    async testConnection(): Promise<boolean> {
        if (!this.isEnabled()) return false;

        // Test socket with read+write permissions (not just existence)
        let socketOk = false;
        if (fs.existsSync(SOCKET_PATH)) {
            try {
                fs.accessSync(SOCKET_PATH, fs.constants.R_OK | fs.constants.W_OK);
                socketOk = true;
            } catch (err) {
                logger.warn('Fail2ban', `testConnection: socket exists but not accessible R/W — ${(err as NodeJS.ErrnoException).code}`);
            }
        } else {
            logger.warn('Fail2ban', `testConnection: socket not found at ${SOCKET_PATH}`);
        }

        // Test SQLite readability
        const dbOk = this.reader?.isReadable() ?? false;
        if (!dbOk) {
            logger.warn('Fail2ban', 'testConnection: SQLite DB not readable');
        }

        // Both are needed for full functionality — warn if only one works
        if (socketOk && !dbOk) logger.warn('Fail2ban', 'testConnection: socket OK but SQLite not readable');
        if (!socketOk && dbOk) logger.warn('Fail2ban', 'testConnection: SQLite OK but socket not accessible');

        return socketOk && dbOk;
    }

    getRoutes(): Router {
        const router = Router();

        // GET /api/plugins/fail2ban/check
        // Diagnostic complet : socket, client, SQLite, daemon
        router.get('/check', requireAuth, asyncHandler(async (_req, res) => {
            const HOST_ROOT = process.env.HOST_ROOT_PATH || '/host';

            // ── 1. Socket ─────────────────────────────────────────────────────
            const socketExists  = fs.existsSync(SOCKET_PATH);
            let socketReadable  = false;
            let socketWritable  = false;
            let socketPerms     = '';
            if (socketExists) {
                try { fs.accessSync(SOCKET_PATH, fs.constants.R_OK); socketReadable = true; } catch {}
                try { fs.accessSync(SOCKET_PATH, fs.constants.W_OK); socketWritable = true; } catch {}
                try {
                    const st = fs.statSync(SOCKET_PATH);
                    const mode = (st.mode & 0o777).toString(8).padStart(3, '0');
                    socketPerms = `${mode} uid=${st.uid} gid=${st.gid}`;
                } catch {}
            }

            // ── 2. fail2ban-client binary ─────────────────────────────────────
            let clientBinPath = '';
            for (const p of ['/usr/bin/fail2ban-client', '/bin/fail2ban-client']) {
                try { fs.accessSync(p, fs.constants.X_OK); clientBinPath = p; break; } catch {}
            }
            const clientBinExists = !!clientBinPath;
            const F2B_CLIENT = clientBinPath || '/usr/bin/fail2ban-client';

            // ── 3. fail2ban-client ping + version check ───────────────────────
            // Use a fresh instance so the check works even when the plugin is not yet enabled.
            let daemonAlive = false;
            let versionInfo: { client: string; server: string; mismatch: boolean } | null = null;
            if (clientBinExists && socketExists && socketReadable && socketWritable) {
                try {
                    const tmpClient = new Fail2banClientExec();
                    daemonAlive = await tmpClient.ping();
                    if (daemonAlive) versionInfo = await tmpClient.versions();
                } catch { daemonAlive = false; }
            }

            // ── 4. SQLite DB ──────────────────────────────────────────────────
            const rawDbPath = (this.config?.settings as unknown as { sqliteDbPath?: string })?.sqliteDbPath
                || '/var/lib/fail2ban/fail2ban.sqlite3';
            const dbPath = this.resolveDockerPathSync(rawDbPath);
            let dbExists   = false;
            let dbReadable = false;
            try { fs.accessSync(dbPath); dbExists = true; } catch {}
            if (dbExists) {
                try { fs.accessSync(dbPath, fs.constants.R_OK); dbReadable = true; } catch {}
            }

            // ── 5. Systemd drop-in on host ────────────────────────────────────
            // In dev mode the server runs directly on the host — no /host prefix needed
            const dropinRelPath = '/etc/systemd/system/fail2ban.service.d/docker-access.conf';
            const dropinCandidates = [
                dropinRelPath,                      // dev: direct host path
                `${HOST_ROOT}${dropinRelPath}`,     // docker: via /host mount
            ];
            let dropinExists = false;
            let dropinContent = '';
            let dropinFoundPath = '';
            for (const p of dropinCandidates) {
                try { dropinContent = fs.readFileSync(p, 'utf8'); dropinExists = true; dropinFoundPath = p; break; } catch {}
            }
            const dropinOk = dropinExists && dropinContent.includes('chmod') && dropinContent.includes('fail2ban.sock');

            // ── Bilan ─────────────────────────────────────────────────────────
            const socketAccessible = socketExists && socketReadable && socketWritable;
            const checks = {
                socket: {
                    ok: socketAccessible,
                    exists: socketExists,
                    readable: socketReadable,
                    writable: socketWritable,
                    perms: socketPerms,
                    path: SOCKET_PATH,
                    fix: !socketExists
                        ? 'Docker: add the volume in docker-compose.yml:\n  - /var/run/fail2ban/fail2ban.sock:/var/run/fail2ban/fail2ban.sock\nDev: the socket must exist on the local machine.'
                        : (!socketReadable || !socketWritable)
                            ? 'Socket inaccessible (permissions insuffisantes — souvent root:root 660).\n\nDev:\n  sudo chmod 666 /var/run/fail2ban/fail2ban.sock\n\nDocker — mettez à jour le drop-in systemd sur le host :\n  Fichier : /etc/systemd/system/fail2ban.service.d/docker-access.conf\n  Contenu :\n    [Service]\n    ExecStartPost=/bin/sh -c \'i=0; while [ $i -lt 20 ] && ! [ -S /var/run/fail2ban/fail2ban.sock ]; do sleep 0.5; i=$((i+1)); done; chmod 666 /var/run/fail2ban/fail2ban.sock\'\n\n  Puis :\n    sudo systemctl daemon-reload && sudo systemctl restart fail2ban\n\nNote : chmod 666 rend le socket accessible sans changer le groupe (recommandé pour Docker).'
                            : null,
                },
                client: {
                    ok: clientBinExists,
                    path: clientBinExists ? F2B_CLIENT : 'introuvable (/usr/bin ou /bin)',
                    fix: !clientBinExists
                        ? 'fail2ban-client introuvable. Docker: vérifiez le Dockerfile : RUN apk add --no-cache fail2ban\nDev: sudo apt install fail2ban (ou équivalent)'
                        : null,
                },
                daemon: {
                    ok: daemonAlive,
                    fix: !daemonAlive
                        ? !socketAccessible
                            ? 'Impossible de vérifier — socket non accessible (voir Socket Unix ci-dessus).\nUne fois le socket corrigé, relancez la vérification.'
                            : !clientBinExists
                                ? 'fail2ban-client introuvable — impossible de pinguer le daemon.'
                                : 'fail2ban-client ping échoue malgré le socket accessible.\n\n1. Vérifiez que fail2ban tourne sur le host :\n   sudo systemctl status fail2ban\n\n2. Vérifiez que le container est dans le groupe fail2ban :\n   docker exec logviewr id\n   → doit afficher gid=... (fail2ban)\n\n3. Si le groupe est absent, ajoutez FAIL2BAN_GID dans .env :\n   FAIL2BAN_GID=$(getent group fail2ban | cut -d: -f3)\n   puis relancez : docker compose up -d'
                        : null,
                },
                ...(versionInfo ? {
                    version: {
                        ok: !versionInfo.mismatch,
                        client: versionInfo.client,
                        server: versionInfo.server,
                        fix: versionInfo.mismatch
                            ? `Version mismatch : client ${versionInfo.client} (container) vs server ${versionInfo.server} (host).\nLe reload peut échouer. Mettez à jour LogviewR pour correspondre à la version du host, ou mettez à jour fail2ban sur le host.\n  sudo apt upgrade fail2ban`
                            : null,
                    }
                } : {}),
                sqlite: {
                    ok: dbExists && dbReadable,
                    exists: dbExists,
                    readable: dbReadable,
                    path: rawDbPath,
                    fix: !dbExists
                        ? `SQLite introuvable à ${rawDbPath}. fail2ban utilise-t-il bien SQLite ? (backend ≥ 0.8)`
                        : !dbReadable
                            ? `Permissions insuffisantes sur ${rawDbPath}.\nSur le host : sudo chmod o+r /var/lib/fail2ban/fail2ban.sqlite3`
                            : null,
                },
                dropin: {
                    ok: dropinOk,
                    exists: dropinExists,
                    path: dropinFoundPath || dropinRelPath,
                    fix: !dropinExists
                        ? 'Drop-in introuvable. Créez-le sur le host :\n\n  sudo mkdir -p /etc/systemd/system/fail2ban.service.d/\n  sudo tee /etc/systemd/system/fail2ban.service.d/docker-access.conf << \'EOF\'\n[Service]\nExecStartPost=/bin/sh -c \'i=0; while [ $i -lt 20 ] && ! [ -S /var/run/fail2ban/fail2ban.sock ]; do sleep 0.5; i=$((i+1)); done; chmod 666 /var/run/fail2ban/fail2ban.sock\'\nEOF\n\n  sudo systemctl daemon-reload && sudo systemctl restart fail2ban'
                        : !dropinOk
                            ? 'Drop-in trouvé mais contenu invalide (chmod ou fail2ban.sock absent).\nVérifiez le fichier :\n  sudo cat /etc/systemd/system/fail2ban.service.d/docker-access.conf'
                            : null,
                },
            };

            const allOk = checks.socket.ok && checks.client.ok && checks.daemon.ok && checks.sqlite.ok;
            res.json({ success: true, result: { ok: allOk, checks } });
        }));

        // GET /api/plugins/fail2ban/check-npm
        // Validates NPM connectivity: SQLite file or MySQL/MariaDB connection
        router.get('/check-npm', requireAuth, asyncHandler(async (_req, res) => {
            const settings = this.config?.settings as unknown as Fail2banPluginConfig | undefined;
            const dbType = settings?.npmDbType ?? 'sqlite';

            // MySQL mode — no npmDataPath required
            if (dbType === 'mysql') {
                if (!settings?.npmMysqlHost || !settings?.npmMysqlUser || !settings?.npmMysqlDb) {
                    return res.json({ success: true, result: { ok: false, step: 'config', error: 'Hôte, utilisateur et base de données MySQL requis', source: 'mysql', domains: 0, jailMatches: 0 } });
                }
                try {
                    const { idToDomain } = await getNpmDomainMap(settings, this.resolveDockerPathSync.bind(this));
                    const domains = Object.keys(idToDomain).length;
                    const evDb = getDatabase();
                    const cachedWithDomain = (evDb.prepare(`SELECT COUNT(*) AS cnt FROM f2b_jail_domain WHERE domain != ''`).get() as { cnt: number }).cnt;
                    return res.json({ success: true, result: { ok: true, step: 'ok', error: null, source: 'mysql', resolvedPath: `${settings.npmMysqlHost}:${settings.npmMysqlPort ?? 3306}/${settings.npmMysqlDb}`, domains, jailMatches: cachedWithDomain } });
                } catch (e: any) {
                    return res.json({ success: true, result: { ok: false, step: 'db', error: `Erreur MySQL : ${e?.message ?? String(e)}`, source: 'mysql', domains: 0, jailMatches: 0 } });
                }
            }

            // SQLite mode
            const configuredPath = settings?.npmDataPath ?? '';
            if (!configuredPath) {
                return res.json({ success: true, result: { ok: false, step: 'config', error: 'Chemin NPM non configuré', source: 'sqlite', resolvedPath: '', domains: 0, jailMatches: 0 } });
            }
            const resolvedPath = this.resolveDockerPathSync(`${configuredPath}/database.sqlite`);
            if (!fs.existsSync(resolvedPath)) {
                return res.json({ success: true, result: { ok: false, step: 'file', error: `Fichier non trouvé : ${resolvedPath}`, source: 'sqlite', resolvedPath, domains: 0, jailMatches: 0 } });
            }
            try {
                const { idToDomain } = await getNpmDomainMap(settings, this.resolveDockerPathSync.bind(this));
                const domains = Object.keys(idToDomain).length;
                const evDb = getDatabase();
                const cachedWithDomain = (evDb.prepare(`SELECT COUNT(*) AS cnt FROM f2b_jail_domain WHERE domain != ''`).get() as { cnt: number }).cnt;
                const confBase = this.resolveDockerPathSync('/etc/fail2ban');
                const jailMeta = parseJailConfigs(confBase);
                const jailLogpaths: Record<string, string> = {};
                for (const [jail, meta] of Object.entries(jailMeta)) {
                    if (meta.logpath) jailLogpaths[jail] = meta.logpath;
                }
                const proxyHostJails = Object.entries(jailLogpaths)
                    .filter(([, lp]) => /proxy-host-(\d+)[_-]/i.test(lp))
                    .map(([jail, lp]) => ({ jail, logpath: lp }));
                return res.json({ success: true, result: { ok: true, step: 'ok', error: null, source: 'sqlite', resolvedPath, domains, jailMatches: cachedWithDomain, jailLogpaths, proxyHostJails } });
            } catch (e: any) {
                return res.json({ success: true, result: { ok: false, step: 'db', error: `Erreur ouverture DB : ${e?.message ?? String(e)}`, source: 'sqlite', resolvedPath, domains: 0, jailMatches: 0, jailLogpaths: {}, proxyHostJails: [] } });
            }
        }));

        // GET /api/plugins/fail2ban/status?days=1
        // Returns live jail status from fail2ban-client (or DB fallback), enriched with
        // jail config metadata + SQLite per-jail totals + bans in requested period.
        router.get('/status', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Fail2ban plugin not enabled', 503, 'PLUGIN_DISABLED');

            const rawDays = parseInt(String(req.query.days ?? '1'), 10);
            const days = Number.isNaN(rawDays) ? 1 : rawDays;

            // TTL cache: 8s (short — live ban counts change frequently)
            const _sCacheKey = `status:${days}`;
            const _sCached = this._cachePeek<unknown>(_sCacheKey, 8_000);
            if (_sCached) return res.json({ success: true, result: _sCached });

            // Jail config metadata (read-only file parse, no socket needed)
            const confBase = this.resolveDockerPathSync('/etc/fail2ban');
            const jailMeta = parseJailConfigs(confBase);

            // Stats from our f2b_events (never purged, single connection)
            const evDb = getDatabase();
            const now  = Math.floor(Date.now() / 1000);
            const since = days > 0 ? now - days * 86400 : 0;

            const periodRows = (since > 0
                ? evDb.prepare(`SELECT jail, COUNT(*) as cnt FROM f2b_events WHERE event_type='ban' AND timeofban >= ? GROUP BY jail`).all(since)
                : evDb.prepare(`SELECT jail, COUNT(*) as cnt FROM f2b_events WHERE event_type='ban' GROUP BY jail`).all()
            ) as { jail: string; cnt: number }[];
            const periodByJail: Record<string, number> = Object.fromEntries(periodRows.map(r => [r.jail, r.cnt]));

            const totalRows = evDb.prepare(`SELECT jail, COUNT(*) as cnt FROM f2b_events WHERE event_type='ban' GROUP BY jail`).all() as { jail: string; cnt: number }[];
            const totalsByJail: Record<string, number> = Object.fromEntries(totalRows.map(r => [r.jail, r.cnt]));

            const uniqueIpsTotal  = (evDb.prepare(`SELECT COUNT(DISTINCT ip) as n FROM f2b_events WHERE event_type='ban'`).get() as { n: number }).n;
            const firstEventAt    = ((evDb.prepare(`SELECT MIN(timeofban) as t FROM f2b_events WHERE event_type='ban'`).get() as { t: number | null }).t) ?? null;
            const periodStart     = days > 0 ? now - days * 86400 : 0;
            const uniqueIpsPeriod = (evDb.prepare(`SELECT COUNT(DISTINCT ip) as n FROM f2b_events WHERE event_type='ban' AND timeofban >= ?`).get(periodStart) as { n: number }).n;
            const from24h = now - 86400;
            const expiredLast24h = (evDb.prepare(`SELECT COUNT(*) as n FROM f2b_events WHERE event_type='ban' AND bantime > 0 AND (timeofban+bantime) >= ? AND (timeofban+bantime) <= ?`).get(from24h, now) as { n: number }).n;

            const clientAvailable = this.client?.isAvailable();

            if (clientAvailable) {
                const alive = await this.client.ping();
                if (!alive) {
                    return res.json({ success: true, result: { ok: false, source: 'client', error: 'fail2ban daemon not responding' } });
                }
                const jailNames = await this.client.listJails();
                const statuses = await Promise.all(jailNames.map(j => this.client.getJailStatus(j)));

                // For jails missing bantime/findtime/maxretry from config files,
                // query the live values via fail2ban-client (socket). Run in parallel.
                const jailsWithMeta = await Promise.all(
                    statuses.filter(Boolean).map(async j => {
                        const meta = jailMeta[j!.jail] ?? {};
                        const bantime  = j!.bantime  ?? meta.bantime  ?? await this.client.getJailParam(j!.jail, 'bantime');
                        const findtime = j!.findtime ?? meta.findtime ?? await this.client.getJailParam(j!.jail, 'findtime');
                        const maxretry = j!.maxretry ?? meta.maxretry ?? await this.client.getJailParam(j!.jail, 'maxretry');
                        return {
                            ...j,
                            filter:    j!.filter    ?? meta.filter,
                            port:      j!.port      ?? meta.port,
                            actions:   j!.actions   ?? meta.actions,
                            banaction: j!.banaction ?? meta.banaction,
                            bantime,
                            findtime,
                            maxretry,
                            bansInPeriod:      periodByJail[j!.jail] ?? 0,
                            totalBannedSqlite: totalsByJail[j!.jail] ?? undefined,
                            active: true,
                        };
                    })
                );
                const jails = jailsWithMeta;
                // Inactive jails: in config but not running (skip DEFAULT/INCLUDES sections)
                const RESERVED = new Set(['default', 'includes', 'sshd-ddos']);
                const activeNames = new Set(jailNames);
                const inactiveJails = Object.entries(jailMeta)
                    .filter(([name]) => !activeNames.has(name) && !RESERVED.has(name))
                    .map(([name, meta]) => ({
                        jail: name,
                        currentlyFailed: 0,
                        totalFailed: 0,
                        currentlyBanned: 0,
                        totalBanned: 0,
                        bannedIps: [] as string[],
                        filter:    meta.filter,
                        port:      meta.port,
                        actions:   meta.actions,
                        banaction: meta.banaction,
                        bantime:   meta.bantime,
                        findtime:  meta.findtime,
                        maxretry:  meta.maxretry,
                        bansInPeriod:      periodByJail[name] ?? 0,
                        totalBannedSqlite: totalsByJail[name] ?? undefined,
                        active: false,
                    }));
                const _sResult = { ok: true, source: 'client', days, jails, inactiveJails, uniqueIpsTotal, uniqueIpsPeriod, expiredLast24h, firstEventAt };
                this._cachePut(_sCacheKey, _sResult);
                return res.json({ success: true, result: _sResult });
            }

            // Fallback: no fail2ban-client — build jail snapshots from f2b_events
            const activeBanRows = evDb.prepare(`
                SELECT ip, jail, timeofban, bantime, failures
                FROM f2b_events
                WHERE event_type='ban' AND (bantime = -1 OR (timeofban + bantime) > ?)
                ORDER BY timeofban DESC
            `).all(now) as { ip: string; jail: string; timeofban: number; bantime: number; failures: number }[];

            const jailsMap: Record<string, { jail: string; currentlyBanned: number; totalBanned: number; bannedIps: string[] }> = {};
            for (const ban of activeBanRows) {
                if (!jailsMap[ban.jail]) jailsMap[ban.jail] = { jail: ban.jail, currentlyBanned: 0, totalBanned: 0, bannedIps: [] };
                jailsMap[ban.jail].currentlyBanned++;
                jailsMap[ban.jail].bannedIps.push(ban.ip);
            }
            for (const [jail, cnt] of Object.entries(totalsByJail)) {
                if (!jailsMap[jail]) jailsMap[jail] = { jail, currentlyBanned: 0, totalBanned: cnt, bannedIps: [] };
                else jailsMap[jail].totalBanned = cnt;
            }
            const recentBans = evDb.prepare(`SELECT ip, jail, timeofban, bantime, failures FROM f2b_events WHERE event_type='ban' ORDER BY timeofban DESC LIMIT 50`).all();
            const _sFallbackResult = {
                ok: true, source: 'sqlite', days,
                jails: Object.values(jailsMap), recentBans, totalBanned: activeBanRows.length,
                uniqueIpsTotal, uniqueIpsPeriod, expiredLast24h, firstEventAt,
            };
            this._cachePut(_sCacheKey, _sFallbackResult);
            return res.json({ success: true, result: _sFallbackResult });
        }));

        // GET /api/plugins/fail2ban/history?days=30
        router.get('/history', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Fail2ban plugin not enabled', 503, 'PLUGIN_DISABLED');
            const raw  = parseInt(String(req.query.days ?? '30'), 10);
            const days = Number.isNaN(raw) ? 30 : raw;

            // TTL cache: 30s — ban history is slow to query and doesn't change second-by-second
            const _hCacheKey = `history:${days}`;
            const _hCached = this._cachePeek<unknown>(_hCacheKey, this._adaptiveTtl(days));
            if (_hCached) return res.json({ success: true, result: _hCached });

            const evDb    = getDatabase();
            const SLOT    = 1800; // 30-min slots for 24h view
            const halfHour = days === 1;
            const allTime  = days <= 0 || days > 3650;
            const rawSince = Math.floor(Date.now() / 1000) - (halfHour ? 86400 : Math.min(allTime ? 3650 : days, 3650) * 86400);
            const since    = halfHour ? Math.floor(rawSince / SLOT) * SLOT : rawSince;

            // Global ban history (sparkline)
            let history: { date: string; count: number }[];
            if (halfHour) {
                const rawRows = evDb.prepare(`
                    SELECT CAST((timeofban - ?) / ? AS INTEGER) as slot_idx, COUNT(*) as count
                    FROM f2b_events WHERE event_type='ban' AND timeofban >= ?
                    GROUP BY slot_idx ORDER BY slot_idx ASC
                `).all(since, SLOT, since) as { slot_idx: number; count: number }[];
                history = rawRows.map(r => {
                    const ts = new Date((since + r.slot_idx * SLOT) * 1000);
                    return { date: `${String(ts.getHours()).padStart(2,'0')}:${String(ts.getMinutes()).padStart(2,'0')}`, count: r.count };
                });
            } else {
                history = (allTime
                    ? evDb.prepare(`SELECT date(timeofban,'unixepoch') as date, COUNT(*) as count FROM f2b_events WHERE event_type='ban' GROUP BY date ORDER BY date ASC`).all()
                    : evDb.prepare(`SELECT date(timeofban,'unixepoch') as date, COUNT(*) as count FROM f2b_events WHERE event_type='ban' AND timeofban >= ? GROUP BY date ORDER BY date ASC`).all(since)
                ) as { date: string; count: number }[];
            }

            // Per-jail breakdown (stacked chart)
            let jailRows: { jail: string; slot: string; cnt: number }[];
            if (halfHour) {
                const slotLabel = (idx: number) => {
                    const ts = new Date((since + idx * SLOT) * 1000);
                    return `${String(ts.getHours()).padStart(2,'0')}:${String(ts.getMinutes()).padStart(2,'0')}`;
                };
                jailRows = (evDb.prepare(`
                    SELECT jail, CAST((timeofban - ?) / ? AS INTEGER) as slot_idx, COUNT(*) as cnt
                    FROM f2b_events WHERE event_type='ban' AND timeofban >= ?
                    GROUP BY jail, slot_idx ORDER BY slot_idx ASC
                `).all(since, SLOT, since) as { jail: string; slot_idx: number; cnt: number }[])
                    .map(r => ({ jail: r.jail, slot: slotLabel(r.slot_idx), cnt: r.cnt }));
            } else {
                jailRows = (allTime
                    ? evDb.prepare(`SELECT jail, date(timeofban,'unixepoch') as slot, COUNT(*) as cnt FROM f2b_events WHERE event_type='ban' GROUP BY jail, slot ORDER BY slot ASC`).all()
                    : evDb.prepare(`SELECT jail, date(timeofban,'unixepoch') as slot, COUNT(*) as cnt FROM f2b_events WHERE event_type='ban' AND timeofban >= ? GROUP BY jail, slot ORDER BY slot ASC`).all(since)
                ) as { jail: string; slot: string; cnt: number }[];
            }

            const byJail: Record<string, Record<string, number>> = {};
            const jailSet = new Set<string>();
            for (const r of jailRows) {
                jailSet.add(r.jail);
                if (!byJail[r.jail]) byJail[r.jail] = {};
                byJail[r.jail][r.slot] = r.cnt;
            }
            const jailNames = [...jailSet].sort((a, b) =>
                Object.values(byJail[b] ?? {}).reduce((s, v) => s + v, 0) -
                Object.values(byJail[a] ?? {}).reduce((s, v) => s + v, 0)
            );
            const granularity: 'hour' | 'day' = halfHour ? 'hour' : 'day';

            const _hResult = { ok: true, days, history, byJail, jailNames, granularity, slotBase: halfHour ? since : undefined };
            this._cachePut(_hCacheKey, _hResult);
            res.json({ success: true, result: _hResult });
        }));

        // GET /events/since?rowid=N  — new ban events from internal f2b_events since rowid
        // rowid=0 (bootstrap): returns current max rowid + empty events array
        router.get('/events/since', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const sinceRowid = parseInt(String(req.query.rowid ?? '0'), 10);
            const appDb = getDatabase();

            if (sinceRowid === 0) {
                const row = appDb.prepare('SELECT MAX(rowid) as maxid FROM f2b_events').get() as { maxid: number | null };
                return res.json({ success: true, result: { ok: true, events: [], maxRowid: row.maxid ?? 0 } });
            }

            const events = appDb.prepare(`
                SELECT rowid, ip, jail, timeofban, bantime, failures
                FROM f2b_events
                WHERE rowid > ?
                ORDER BY rowid ASC
                LIMIT 50
            `).all(sinceRowid) as { rowid: number; ip: string; jail: string; timeofban: number; bantime: number | null; failures: number | null }[];

            const maxRowid = events.length > 0 ? events[events.length - 1].rowid : sinceRowid;
            res.json({ success: true, result: { ok: true, events, maxRowid } });
        }));

        // GET /sync-state  — compare fail2ban SQLite max rowid vs internal sync position
        router.get('/sync-state', requireAuth, asyncHandler(async (_req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const appDb = getDatabase();
            const syncState = appDb.prepare('SELECT last_rowid, last_sync_at FROM f2b_sync_state WHERE id = 1').get() as { last_rowid: number; last_sync_at: string | null } | undefined;
            const internalCount = (appDb.prepare('SELECT COUNT(*) as n FROM f2b_events').get() as { n: number }).n;
            const lastRowid = syncState?.last_rowid ?? 0;

            let f2bMaxRowid: number | null = null;
            let f2bTotalBans: number | null = null;
            try {
                const f2bPath = this.reader?.getStats()?.dbPath ?? '/var/lib/fail2ban/fail2ban.sqlite3';
                const f2bDb = new (await import('better-sqlite3')).default(f2bPath, { readonly: true, fileMustExist: true });
                try {
                    f2bMaxRowid  = (f2bDb.prepare('SELECT MAX(rowid) as m FROM bans').get() as { m: number | null }).m;
                    f2bTotalBans = (f2bDb.prepare('SELECT COUNT(*) as n FROM bans').get() as { n: number }).n;
                } finally { f2bDb.close(); }
            } catch { /* not readable */ }

            const synced = f2bMaxRowid !== null ? lastRowid >= f2bMaxRowid : null;
            res.json({ success: true, result: {
                ok: true,
                internalEvents: internalCount,
                lastSyncedRowid: lastRowid,
                f2bMaxRowid,
                f2bTotalBans,
                lastSyncAt: syncState?.last_sync_at ?? null,
                synced,
            } });
        }));

        // POST /api/plugins/fail2ban/ban   { jail, ip }
        router.post('/ban', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) return res.json({ success: true, result: { ok: false, error: 'Plugin fail2ban désactivé' } });
            if (!this.client?.isAvailable()) return res.json({ success: true, result: { ok: false, error: 'Socket fail2ban inaccessible (sudo chmod 660 /var/run/fail2ban/fail2ban.sock)' } });
            const { jail, ip } = req.body as { jail?: string; ip?: string };
            if (!jail || !ip) throw createError('jail and ip are required', 400, 'MISSING_PARAMS');
            const result = await this.client.banIp(jail, ip);
            webhookDispatchService.dispatch('action', {
                action: 'ban', ip, jail,
                username: (req as AuthenticatedRequest).user?.username,
            }).catch(() => { /* ignore dispatch errors */ });
            res.json({ success: true, result });
        }));

        // POST /api/plugins/fail2ban/unban   { jail, ip }
        router.post('/unban', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) return res.json({ success: true, result: { ok: false, error: 'Plugin fail2ban désactivé' } });
            if (!this.client?.isAvailable()) return res.json({ success: true, result: { ok: false, error: 'Socket fail2ban inaccessible (sudo chmod 660 /var/run/fail2ban/fail2ban.sock)' } });
            const { jail, ip } = req.body as { jail?: string; ip?: string };
            if (!jail || !ip) throw createError('jail and ip are required', 400, 'MISSING_PARAMS');
            const result = await this.client.unbanIp(jail, ip);
            webhookDispatchService.dispatch('action', {
                action: 'unban', ip, jail,
                username: (req as AuthenticatedRequest).user?.username,
            }).catch(() => { /* ignore dispatch errors */ });
            res.json({ success: true, result });
        }));

        // POST /api/plugins/fail2ban/reload   { jail? }
        router.post('/reload', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) return res.json({ success: true, result: { ok: false, error: 'Plugin fail2ban désactivé' } });
            if (!this.client?.isAvailable()) return res.json({ success: true, result: { ok: false, error: 'Socket fail2ban inaccessible — lancez : sudo chmod 660 /var/run/fail2ban/fail2ban.sock' } });
            const { jail } = req.body as { jail?: string };
            const result = jail ? await this.client.reloadJail(jail) : await this.client.reload();
            res.json({ success: true, result });
        }));

        // ── Jail configuration routes ─────────────────────────────────────────────

        // GET /whitelist/stats  — global [DEFAULT] ignoreip + per-jail overrides
        router.get('/whitelist/stats', requireAuth, asyncHandler(async (_req, res) => {
            if (!this.isEnabled()) return res.json({ success: true, result: { ok: false, error: 'Plugin désactivé' } });
            const confBase = this.resolveDockerPathSync('/etc/fail2ban');
            const jailD = path.join(confBase, 'jail.d');
            let dConfs: string[] = [];
            let dLocals: string[] = [];
            try {
                const entries = fs.readdirSync(jailD).sort();
                dConfs  = entries.filter(f => f.endsWith('.conf')).map(f => path.join(jailD, f));
                dLocals = entries.filter(f => f.endsWith('.local')).map(f => path.join(jailD, f));
            } catch { /* jail.d may not exist */ }

            // Global DEFAULT ignoreip (merge order: jail.conf → jail.d/*.conf → jail.local → jail.d/*.local)
            const rawDefaults: Record<string, string> = {};
            for (const f of [path.join(confBase, 'jail.conf'), ...dConfs, path.join(confBase, 'jail.local'), ...dLocals]) {
                parseJailIniFile(f, rawDefaults, {});
            }
            const globalIps = (rawDefaults['ignoreip'] ?? '').split(/\s+/).map((s: string) => s.trim()).filter(Boolean);
            const globalSet = new Set(globalIps);

            // Per-jail explicit ignoreip overrides in jail.d/*.local
            const perJail: { jail: string; ips: string[]; extra: string[]; missing: string[] }[] = [];
            for (const localFile of dLocals) {
                const localRaw: Record<string, Record<string, string>> = {};
                parseJailIniFile(localFile, {}, localRaw);
                for (const [jailName, kv] of Object.entries(localRaw)) {
                    if (!kv['ignoreip']) continue;
                    const ips = kv['ignoreip'].split(/\s+/).map((s: string) => s.trim()).filter(Boolean);
                    const ipSet = new Set(ips);
                    const extra   = ips.filter(ip => !globalSet.has(ip));
                    const missing = globalIps.filter(ip => !ipSet.has(ip));
                    if (extra.length || missing.length) {
                        perJail.push({ jail: jailName, ips, extra, missing });
                    }
                }
            }

            res.json({ success: true, result: { ok: true, globalIps, perJail } });
        }));

        // GET /whitelist/safe-banned  — currently-active bans that match known-safe IP ranges
        router.get('/whitelist/safe-banned', requireAuth, asyncHandler(async (_req, res) => {
            if (!this.isEnabled()) return res.json({ success: true, result: { ok: false, error: 'Plugin désactivé' } });

            // Load safe ranges
            interface SafeProvider { color: string; desc: string; ranges: string[] }
            let safeRanges: Record<string, SafeProvider>;
            try {
                safeRanges = JSON.parse(fs.readFileSync(path.join(__dirname, 'safe-ip-ranges.json'), 'utf8'));
            } catch { return res.json({ success: true, result: { ok: false, error: 'safe-ip-ranges.json introuvable' } }); }

            // CIDR match helper (IPv4 only)
            function ipInCidr(ip: string, cidr: string): boolean {
                if (ip.includes(':')) return false; // skip IPv6
                const [subnet, bits] = cidr.split('/');
                const b = parseInt(bits, 10);
                const toL = (s: string) => { const p = s.split('.').map(Number); return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0; };
                const mask = b === 32 ? 0xFFFFFFFF : (~(0xFFFFFFFF >>> b)) >>> 0;
                return (toL(ip) & mask) === (toL(subnet) & mask);
            }

            // Get currently-active bans from app DB
            const evDb = getDatabase();
            const now = Math.floor(Date.now() / 1000);
            const activeBans = evDb.prepare(`
                SELECT ip, jail, timeofban, bantime
                FROM f2b_events
                WHERE event_type='ban' AND (bantime = -1 OR (timeofban + bantime) > ?)
                ORDER BY timeofban DESC
            `).all(now) as { ip: string; jail: string; timeofban: number; bantime: number }[];

            // Match against safe ranges
            interface Hit { ip: string; jail: string; timeofban: number; bantime: number; provider: string; cidr: string; color: string }
            const hits: Hit[] = [];
            for (const ban of activeBans) {
                for (const [provider, info] of Object.entries(safeRanges)) {
                    for (const cidr of info.ranges) {
                        if (ipInCidr(ban.ip, cidr)) {
                            hits.push({ ...ban, provider, cidr, color: info.color });
                            break; // one match per ban is enough
                        }
                    }
                    if (hits.length > 0 && hits[hits.length - 1].ip === ban.ip) break; // already matched
                }
            }

            // Metadata for providers (colors + desc) for frontend rendering
            const providers = Object.fromEntries(
                Object.entries(safeRanges).map(([name, info]) => [name, { color: info.color, desc: info.desc }])
            );

            res.json({ success: true, result: { ok: true, hits, providers } });
        }));

        // GET /jails/:name/params  — read current effective + local override values
        router.get('/jails/:name/params', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const jailName = req.params.name.replace(/[^a-zA-Z0-9._-]/g, '');
            const confBase = this.resolveDockerPathSync('/etc/fail2ban');
            const jailMeta = parseJailConfigs(confBase);
            const meta = jailMeta[jailName] ?? {};
            // Also read jail.d/<name>.local for current local overrides
            const localPath = path.join(confBase, 'jail.d', `${jailName}.local`);
            let localContent = '';
            try { localContent = fs.readFileSync(localPath, 'utf8'); } catch { /* no local file */ }
            // Parse local overrides
            const localDefaults: Record<string, string> = {};
            const localRaw: Record<string, Record<string, string>> = {};
            parseJailIniFile(localPath, localDefaults, localRaw);
            const localKv = localRaw[jailName] ?? {};
            // Parse ignoreip from jail.d/<name>.local or jail.conf
            const ignoreip = (localKv['ignoreip'] ?? jailMeta[jailName]?.ignoreip ?? '').split(/\s+/).map((s: string) => s.trim()).filter(Boolean);
            res.json({ success: true, result: {
                ok: true, jailName,
                bantime:  meta.bantime,
                findtime: meta.findtime,
                maxretry: meta.maxretry,
                filter:   meta.filter,
                actions:  meta.actions,
                banaction: meta.banaction,
                logpath:  localKv['logpath'] ?? '',
                port:     localKv['port'] ?? meta.port ?? '',
                usedns:   localKv['usedns'] ?? 'warn',
                ignoreip,
                localContent,
                hasLocalFile: localContent !== '',
            } });
        }));

        // POST /jails/:name/params  — write params to jail.d/<name>.local + reload
        router.post('/jails/:name/params', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) return res.json({ success: true, result: { ok: false, error: 'Plugin désactivé' } });
            const jailName = req.params.name.replace(/[^a-zA-Z0-9._-]/g, '');
            if (!jailName) return res.json({ success: true, result: { ok: false, error: 'Jail invalide' } });
            const { bantime, findtime, maxretry, ignoreip, usedns, logpath, port } = req.body as {
                bantime?: number; findtime?: number; maxretry?: number;
                ignoreip?: string; usedns?: string; logpath?: string; port?: string;
            };
            const confBase = this.resolveDockerPathSync('/etc/fail2ban');
            const localPath = path.join(confBase, 'jail.d', `${jailName}.local`);
            // Build content
            const lines: string[] = [`[${jailName}]`, ''];
            if (bantime  !== undefined) lines.push(`bantime  = ${bantime}`);
            if (findtime !== undefined) lines.push(`findtime = ${findtime}`);
            if (maxretry !== undefined) lines.push(`maxretry = ${maxretry}`);
            if (ignoreip !== undefined && ignoreip.trim()) lines.push(`ignoreip = ${ignoreip.trim()}`);
            if (usedns   !== undefined && usedns.trim())   lines.push(`usedns   = ${usedns.trim()}`);
            if (logpath  !== undefined && logpath.trim())  lines.push(`logpath  = ${logpath.trim()}`);
            if (port     !== undefined && port.trim())     lines.push(`port     = ${port.trim()}`);
            try {
                fs.writeFileSync(localPath, lines.join('\n') + '\n', 'utf8');
            } catch (e) {
                return res.json({ success: true, result: { ok: false, error: `Écriture impossible : ${e instanceof Error ? e.message : String(e)}` } });
            }
            let reloadResult = null;
            if (this.client?.isAvailable()) {
                reloadResult = await this.client.reloadJail(jailName);
            }
            res.json({ success: true, result: { ok: true, jailName, reloadResult } });
        }));

        // POST /jails/:name/stop
        router.post('/jails/:name/stop', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) return res.json({ success: true, result: { ok: false, error: 'Plugin désactivé' } });
            if (!this.client?.isAvailable()) return res.json({ success: true, result: { ok: false, error: 'Socket fail2ban inaccessible' } });
            const jailName = req.params.name.replace(/[^a-zA-Z0-9._-]/g, '');
            res.json({ success: true, result: await this.client.stopJail(jailName) });
        }));

        // POST /jails/:name/start
        router.post('/jails/:name/start', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) return res.json({ success: true, result: { ok: false, error: 'Plugin désactivé' } });
            if (!this.client?.isAvailable()) return res.json({ success: true, result: { ok: false, error: 'Socket fail2ban inaccessible' } });
            const jailName = req.params.name.replace(/[^a-zA-Z0-9._-]/g, '');
            res.json({ success: true, result: await this.client.startJail(jailName) });
        }));

        // ── Read-only filesystem routes ──────────────────────────────────────

        // GET /filters  — liste filter.d/
        router.get('/filters', requireAuth, asyncHandler(async (_req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const dir = this.resolveDockerPathSync('/etc/fail2ban/filter.d');
            try {
                const files = fs.readdirSync(dir).filter(f => f.endsWith('.conf') || f.endsWith('.local')).sort();
                res.json({ success: true, result: { ok: true, dir, files } });
            } catch { res.json({ success: true, result: { ok: false, dir, files: [], error: `Cannot read ${dir}` } }); }
        }));

        // GET /filters/:name
        router.get('/filters/:name', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const name = req.params.name.replace(/[^a-zA-Z0-9._-]/g, '');
            try {
                const content = fs.readFileSync(this.resolveDockerPathSync(`/etc/fail2ban/filter.d/${name}`), 'utf8');
                res.json({ success: true, result: { ok: true, name, content } });
            } catch { throw createError(`Filter ${name} not found`, 404, 'NOT_FOUND'); }
        }));

        // POST /filters/:name/save  — write filter file then reload affected jails
        router.post('/filters/:name/save', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) return res.json({ success: true, result: { ok: false, error: 'Plugin désactivé' } });
            const name = req.params.name.replace(/[^a-zA-Z0-9._-]/g, '');
            if (!name.endsWith('.conf') && !name.endsWith('.local')) {
                return res.json({ success: true, result: { ok: false, error: 'Nom de fichier invalide (doit finir par .conf ou .local)' } });
            }
            const { content, jails } = req.body as { content?: string; jails?: string[] };
            if (typeof content !== 'string') {
                return res.json({ success: true, result: { ok: false, error: 'Contenu manquant' } });
            }
            const filePath = this.resolveDockerPathSync(`/etc/fail2ban/filter.d/${name}`);
            try {
                fs.writeFileSync(filePath, content, 'utf8');
            } catch (e) {
                return res.json({ success: true, result: { ok: false, error: `Écriture impossible : ${e instanceof Error ? e.message : String(e)}` } });
            }
            // Reload only jails that use this filter
            const reloadResults: { jail: string; ok: boolean; output: string; error?: string }[] = [];
            if (Array.isArray(jails) && jails.length > 0 && this.client?.isAvailable()) {
                for (const jail of jails) {
                    const r = await this.client.reloadJail(jail.replace(/[^a-zA-Z0-9._-]/g, ''));
                    reloadResults.push({ jail, ok: r.ok, output: r.output, error: r.error });
                }
            }
            res.json({ success: true, result: { ok: true, name, reloadResults } });
        }));

        // POST /filters/:name/test  — test failregex against log lines (JS-side regex match)
        router.post('/filters/:name/test', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) return res.json({ success: true, result: { ok: false, error: 'Plugin désactivé' } });
            const name = req.params.name.replace(/[^a-zA-Z0-9._-]/g, '');
            const { failregex, log_lines } = req.body as { failregex?: string; log_lines?: string };
            if (!failregex || !log_lines) {
                return res.json({ success: true, result: { ok: false, error: 'failregex et log_lines requis' } });
            }
            const lines = log_lines.split('\n').map((l: string) => l.trim()).filter(Boolean);
            const patterns = failregex.split('\n').map((l: string) => l.trim()).filter((l: string) => l && !l.startsWith('#'));
            const matched: { line: string; pattern: string; host?: string }[] = [];
            const missed:  string[] = [];
            for (const line of lines) {
                let found = false;
                for (const pat of patterns) {
                    const jsPatStr = pat.replace(/<HOST>/g, '(?:[0-9]{1,3}\\.){3}[0-9]{1,3}|[0-9a-fA-F:]{2,39}');
                    try {
                        const re = new RegExp(jsPatStr);
                        const m = re.exec(line);
                        if (m) {
                            const hostMatch = /(?:[0-9]{1,3}\.){3}[0-9]{1,3}|[0-9a-fA-F:]{2,39}/.exec(m[0] || line);
                            matched.push({ line, pattern: pat, host: hostMatch?.[0] });
                            found = true; break;
                        }
                    } catch { /* invalid regex */ }
                }
                if (!found) missed.push(line);
            }
            res.json({ success: true, result: { ok: true, name, match_count: matched.length, total: lines.length, matched, missed } });
        }));

        // GET /actions  — liste action.d/
        router.get('/actions', requireAuth, asyncHandler(async (_req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const dir = this.resolveDockerPathSync('/etc/fail2ban/action.d');
            try {
                const files = fs.readdirSync(dir).filter(f => f.endsWith('.conf') || f.endsWith('.local')).sort();
                res.json({ success: true, result: { ok: true, dir, files } });
            } catch { res.json({ success: true, result: { ok: false, dir, files: [], error: `Cannot read ${dir}` } }); }
        }));

        // GET /actions/:name
        router.get('/actions/:name', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const name = req.params.name.replace(/[^a-zA-Z0-9._-]/g, '');
            try {
                const content = fs.readFileSync(this.resolveDockerPathSync(`/etc/fail2ban/action.d/${name}`), 'utf8');
                res.json({ success: true, result: { ok: true, name, content } });
            } catch { throw createError(`Action ${name} not found`, 404, 'NOT_FOUND'); }
        }));

        // POST /actions/:name/save  — write action file then reload affected jails
        router.post('/actions/:name/save', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) return res.json({ success: true, result: { ok: false, error: 'Plugin désactivé' } });
            const name = req.params.name.replace(/[^a-zA-Z0-9._-]/g, '');
            if (!name.endsWith('.conf') && !name.endsWith('.local')) {
                return res.json({ success: true, result: { ok: false, error: 'Nom de fichier invalide (doit finir par .conf ou .local)' } });
            }
            const { content, jails } = req.body as { content?: string; jails?: string[] };
            if (typeof content !== 'string') {
                return res.json({ success: true, result: { ok: false, error: 'Contenu manquant' } });
            }
            const filePath = this.resolveDockerPathSync(`/etc/fail2ban/action.d/${name}`);
            try {
                fs.writeFileSync(filePath, content, 'utf8');
            } catch (e) {
                return res.json({ success: true, result: { ok: false, error: `Écriture impossible : ${e instanceof Error ? e.message : String(e)}` } });
            }
            const reloadResults: { jail: string; ok: boolean; output: string; error?: string }[] = [];
            if (Array.isArray(jails) && jails.length > 0 && this.client?.isAvailable()) {
                for (const jail of jails) {
                    const r = await this.client.reloadJail(jail.replace(/[^a-zA-Z0-9._-]/g, ''));
                    reloadResults.push({ jail, ok: r.ok, output: r.output, error: r.error });
                }
            }
            res.json({ success: true, result: { ok: true, name, reloadResults } });
        }));

        // GET /config  — raw file content (fail2ban.conf + jail.conf + .local)
        router.get('/config', requireAuth, asyncHandler(async (_req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const result: Record<string, string | null> = {};
            const mtimes: Record<string, number | null> = {};
            for (const f of ['fail2ban.conf', 'fail2ban.local', 'jail.conf', 'jail.local']) {
                try {
                    const p = this.resolveDockerPathSync(`/etc/fail2ban/${f}`);
                    result[f] = fs.readFileSync(p, 'utf8');
                    mtimes[f] = Math.floor(fs.statSync(p).mtimeMs / 1000);
                } catch {
                    result[f] = null;
                    mtimes[f] = null;
                }
            }
            res.json({ success: true, result: { ok: true, files: result, mtimes } });
        }));

        // GET /config/parsed  — parsed global config values + DB info
        router.get('/config/parsed', requireAuth, asyncHandler(async (_req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');

            // TTL cache: 60s — opens fail2ban.sqlite3 for PRAGMA integrity_check (slow)
            const _cpCached = this._cachePeek<unknown>('config/parsed', 60_000);
            if (_cpCached) return res.json({ success: true, result: _cpCached });

            const confBase = this.resolveDockerPathSync('/etc/fail2ban');
            const cfg = parseGlobalConfig(confBase);

            // Version via fail2ban-client
            let version = '';
            try { version = await this.client.getVersion(); } catch {}

            // SQLite DB info
            const dbHostPath = this.resolveDockerPathSync(cfg.dbfile || '/var/lib/fail2ban/fail2ban.sqlite3');
            let dbInfo: { size: number; sizeFmt: string; readable: boolean; integrity: string; pageCount: number; freePages: number; fragPct: number; bans: number; jails: number; logs: number } | null = null;
            try {
                const stat = fs.statSync(dbHostPath);
                const readable = (() => { try { fs.accessSync(dbHostPath, fs.constants.R_OK); return true; } catch { return false; } })();
                let integrity = 'unknown';
                let pageCount = 0;
                let freePages = 0;
                let bans = 0;
                let jails = 0;
                let logs = 0;
                if (readable) {
                    const Database = (await import('better-sqlite3')).default;
                    const db = new Database(dbHostPath, { readonly: true, fileMustExist: true });
                    try {
                        integrity = (db.pragma('integrity_check', { simple: true }) as string) ?? 'unknown';
                        pageCount = (db.pragma('page_count', { simple: true }) as number) ?? 0;
                        freePages = (db.pragma('freelist_count', { simple: true }) as number) ?? 0;
                        bans  = ((db.prepare('SELECT COUNT(*) as n FROM bans').get() as { n: number } | undefined)?.n) ?? 0;
                        jails = ((db.prepare('SELECT COUNT(DISTINCT jail) as n FROM bans').get() as { n: number } | undefined)?.n) ?? 0;
                        try { logs = ((db.prepare('SELECT COUNT(*) as n FROM logs').get() as { n: number } | undefined)?.n) ?? 0; } catch {}
                    } finally { db.close(); }
                }
                const fragPct = pageCount > 0 ? Math.round(freePages / pageCount * 100 * 10) / 10 : 0;
                const size = stat.size;
                const sizeFmt = size >= 1048576 ? `${(size / 1048576).toFixed(2)} Mo` : `${(size / 1024).toFixed(1)} Ko`;
                dbInfo = { size, sizeFmt, readable, integrity, pageCount, freePages, fragPct, bans, jails, logs };
            } catch { /* db not found or not readable */ }

            // App DB (dashboard.db) info + fragmentation
            const appDbPath = path.join(process.cwd(), 'data', 'dashboard.db');
            let appDbInfo: { size: number; sizeFmt: string; exists: boolean; fragPct: number } = { size: 0, sizeFmt: '0 Ko', exists: false, fragPct: 0 };
            try {
                const stat = fs.statSync(appDbPath);
                const size = stat.size;
                const sizeFmt = size >= 1048576 ? `${(size / 1048576).toFixed(2)} Mo` : `${(size / 1024).toFixed(1)} Ko`;
                // Read fragmentation from open connection (WAL mode — use getDatabase())
                const appDb = getDatabase();
                const appPageCount  = (appDb.pragma('page_count',     { simple: true }) as number) ?? 0;
                const appFreePages  = (appDb.pragma('freelist_count', { simple: true }) as number) ?? 0;
                const appFragPct    = appPageCount > 0 ? Math.round(appFreePages / appPageCount * 100 * 10) / 10 : 0;
                appDbInfo = { size, sizeFmt, exists: true, fragPct: appFragPct };
            } catch {}

            // Internal DB stats (f2b_events synced from fail2ban.sqlite3)
            let internalDbStats = null;
            try { internalDbStats = Fail2banSyncService.getInternalStats(); } catch {}

            const _cpResult = { ok: true, cfg, version, dbInfo, dbHostPath, appDbInfo, internalDbStats };
            this._cachePut('config/parsed', _cpResult);
            res.json({ success: true, result: _cpResult });
        }));

        // POST /config/sqlite-vacuum  — run VACUUM on fail2ban SQLite DB
        // Note: in Docker with /:/host:ro, the DB is on a read-only mount and VACUUM will fail.
        // The route detects this case and returns a structured error with Docker fix instructions.
        router.post('/config/sqlite-vacuum', requireAuth, asyncHandler(async (_req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const confBase = this.resolveDockerPathSync('/etc/fail2ban');
            const cfg = parseGlobalConfig(confBase);
            const dbHostPath = this.resolveDockerPathSync(cfg.dbfile || '/var/lib/fail2ban/fail2ban.sqlite3');
            const BetterSqlite = (await import('better-sqlite3')).default;
            let db: InstanceType<typeof BetterSqlite> | null = null;
            try {
                db = new BetterSqlite(dbHostPath, { readonly: false, fileMustExist: true });
                db.exec('VACUUM');
                this._routeCache.delete('config/parsed'); // invalidate fragmentation stats
                res.json({ success: true, result: { ok: true } });
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                // Read-only filesystem (Docker /:/host:ro) or SQLite readonly error
                const isReadOnly = /EROFS|read.only|SQLITE_READONLY|CANTOPEN/i.test(msg);
                if (isReadOnly) {
                    return res.json({ success: true, result: {
                        ok: false,
                        error: 'Système de fichiers en lecture seule (Docker)',
                        dockerReadOnly: true,
                    } });
                }
                throw e;
            } finally {
                try { if (db) db.close(); } catch { /* ignore */ }
            }
        }));

        // POST /config/dashboard-vacuum  — run VACUUM on internal dashboard.db
        router.post('/config/dashboard-vacuum', requireAuth, asyncHandler(async (_req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const appDb = getDatabase();
            appDb.exec('VACUUM');
            res.json({ success: true, result: { ok: true } });
        }));

        // POST /config/runtime  — apply runtime settings via fail2ban-client

        router.post('/config/runtime', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const { loglevel, logtarget } = req.body as { loglevel?: string; logtarget?: string };
            const results: Record<string, { ok: boolean; output: string; error?: string }> = {};
            const VALID_LOGLEVELS = ['CRITICAL', 'ERROR', 'WARNING', 'NOTICE', 'INFO', 'DEBUG'];
            if (loglevel) {
                if (!VALID_LOGLEVELS.includes(loglevel.toUpperCase())) throw createError('Invalid loglevel', 400, 'BAD_PARAM');
                results.loglevel = await this.client.setLoglevel(loglevel.toUpperCase());
            }
            if (logtarget !== undefined) {
                results.logtarget = await this.client.setLogtarget(logtarget);
            }
            const allOk = Object.values(results).every(r => r.ok);
            res.json({ success: true, result: { ok: allOk, results } });
        }));

        // POST /config/write  — persist settings to fail2ban.local
        router.post('/config/write', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const allowed: Record<string, (v: string) => boolean> = {
                loglevel:     v => ['CRITICAL', 'ERROR', 'WARNING', 'NOTICE', 'INFO', 'DEBUG'].includes(v.toUpperCase()),
                logtarget:    v => !!v && v.length < 500,
                dbpurgeage:   v => /^\d+$/.test(v) && parseInt(v, 10) >= 0,
                dbmaxmatches: v => /^\d+$/.test(v) && parseInt(v, 10) >= 1 && parseInt(v, 10) <= 10000,
            };
            const body = req.body as Record<string, string>;
            const confBase = this.resolveDockerPathSync('/etc/fail2ban');
            const localFile = path.join(confBase, 'fail2ban.local');
            const written: string[] = [];
            const errors: string[] = [];
            for (const [key, val] of Object.entries(body)) {
                if (!allowed[key]) { errors.push(`Unknown key: ${key}`); continue; }
                if (!allowed[key](val)) { errors.push(`Invalid value for ${key}: ${val}`); continue; }
                try {
                    writeIniValue(localFile, key, key === 'loglevel' ? val.toUpperCase() : val);
                    written.push(key);
                } catch (e) { errors.push(`Failed to write ${key}: ${e instanceof Error ? e.message : String(e)}`); }
            }
            res.json({ success: true, result: { ok: errors.length === 0, written, errors } });
        }));

        // POST /config/test-raw  — validate INI content without writing (syntax + key whitelist)
        router.post('/config/test-raw', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const { filename, content } = req.body as { filename?: string; content?: string };
            const ALLOWED = ['fail2ban.local', 'jail.local'];
            if (!filename || !ALLOWED.includes(filename))
                return res.json({ success: true, result: { ok: false, errors: [`Fichier non autorisé. Seuls ${ALLOWED.join(', ')} sont éditables.`], warnings: [] } });
            if (typeof content !== 'string')
                return res.json({ success: true, result: { ok: false, errors: ['Contenu manquant'], warnings: [] } });

            const errors: string[] = [];
            const warnings: string[] = [];

            // ── Constants ────────────────────────────────────────────────────────
            const F2B_LOCAL_KEYS  = new Set(['loglevel','logtarget','socket','pidfile','dbfile','dbpurgeage','dbmaxmatches','syslogsocket','allowipv6']);
            const LOGLEVELS       = new Set(['CRITICAL','ERROR','WARNING','NOTICE','INFO','DEBUG']);
            const JAIL_KEYS       = new Set([
                'enabled','port','filter','logpath','maxretry','bantime','findtime',
                'action','banaction','ignoreip','ignoreself','maxmatches','destemail',
                'sender','mta','protocol','chain','mode','journalmatch','backend',
                'usedns','failregex','ignoreregex','logencoding','datepattern',
                'prefregex','maxlines','bantime.increment','bantime.factor',
                'bantime.formula','bantime.multipliers','bantime.maxtime',
                'bantime.overalljails','fail2ban_agent',
            ]);
            const DANGEROUS = [
                /`[^`]+`/,
                /\$\(/,
                /\|\s*(bash|sh|python|perl|ruby|nc|ncat|netcat)\b/i,
                /;\s*(rm|dd|mkfs|wget|curl|chmod|chown)\b/i,
                /\.\.\//,
            ];

            // ── Pre-checks ───────────────────────────────────────────────────────
            if (content.charCodeAt(0) === 0xFEFF)
                warnings.push('BOM UTF-8 détecté en début de fichier — peut causer des erreurs de parsing');
            if (content.includes('\r\n'))
                warnings.push('Fins de ligne Windows (CRLF) détectées — préférer LF Unix');
            if (content.trim() === '')
                return res.json({ success: true, result: { ok: true, errors: [], warnings: ['Fichier vide — fail2ban utilisera les valeurs par défaut'] } });
            if (content.length > 512 * 1024)
                errors.push('Fichier trop volumineux (> 512 Ko) — vérifiez le contenu');

            // ── Line-by-line parse ───────────────────────────────────────────────
            const lines = content.split(/\r?\n/);
            let section = '';
            const foundSections: string[] = [];
            const sectionKeys: Record<string, Set<string>> = {};
            let lastSectionLine = 0;
            let prevLineWasSection = false;

            for (let i = 0; i < lines.length; i++) {
                const ln = i + 1;
                const raw = lines[i];
                const t = raw.trim();

                // Blank / comment
                if (!t || t.startsWith('#') || t.startsWith(';')) {
                    prevLineWasSection = false;
                    continue;
                }

                // Continuation line (indented, belongs to previous key)
                if (/^\s/.test(raw) && section) continue;

                // ── Section header ───────────────────────────────────────────────
                if (t.startsWith('[')) {
                    // Unclosed bracket
                    if (!t.endsWith(']'))
                        errors.push(`Ligne ${ln}: section mal formée — crochet fermant manquant : "${t.slice(0, 60)}"`);
                    const secM = t.match(/^\[([^\]]+)\]$/);
                    if (secM) {
                        const secName = secM[1].trim();
                        // Leading/trailing spaces inside brackets
                        if (secName !== secM[1])
                            warnings.push(`Ligne ${ln}: espaces superflus dans le nom de section [${secM[1]}]`);
                        // Invalid section name chars
                        if (!/^[A-Za-z0-9_\-\.]+$/.test(secName))
                            errors.push(`Ligne ${ln}: nom de section invalide "[${secName}]" — utilisez uniquement lettres, chiffres, - _ .`);
                        // Duplicate section
                        if (foundSections.includes(secName))
                            errors.push(`Ligne ${ln}: section "[${secName}]" définie plusieurs fois`);
                        else {
                            foundSections.push(secName);
                            sectionKeys[secName] = new Set();
                        }
                        // Warn empty previous section
                        if (prevLineWasSection && section && sectionKeys[section]?.size === 0)
                            warnings.push(`Ligne ${lastSectionLine}: section "[${section}]" est vide`);
                        section = secName;
                        lastSectionLine = ln;
                        prevLineWasSection = true;
                    }
                    continue;
                }

                prevLineWasSection = false;

                // Key before any section
                if (!section) {
                    errors.push(`Ligne ${ln}: clé hors section — toutes les clés doivent être dans une section [...]`);
                    continue;
                }

                // ── Key = value ──────────────────────────────────────────────────
                const kvM = t.match(/^([A-Za-z0-9_.\/\-]+)\s*=\s*(.*)$/);
                if (!kvM) {
                    errors.push(`Ligne ${ln}: syntaxe invalide — attendu "clé = valeur", reçu : "${raw.slice(0, 80)}"`);
                    continue;
                }
                const key = kvM[1].toLowerCase();
                const val = kvM[2].trim();

                // Duplicate key in section
                if (sectionKeys[section]?.has(key))
                    warnings.push(`Ligne ${ln}: clé « ${key} » définie plusieurs fois dans [${section}]`);
                sectionKeys[section]?.add(key);

                // Dangerous patterns
                for (const pat of DANGEROUS) {
                    if (pat.test(val)) { errors.push(`Ligne ${ln}: valeur potentiellement dangereuse pour « ${key} » — "${val.slice(0, 60)}"`); break; }
                }

                // ── fail2ban.local [Definition] checks ───────────────────────────
                if (filename === 'fail2ban.local' && section.toLowerCase() === 'definition') {
                    if (!F2B_LOCAL_KEYS.has(key))
                        warnings.push(`Ligne ${ln}: clé inconnue « ${key} » dans [Definition] — clés valides: ${[...F2B_LOCAL_KEYS].join(', ')}`);
                    if (key === 'loglevel' && !LOGLEVELS.has(val.toUpperCase()))
                        errors.push(`Ligne ${ln}: loglevel invalide « ${val} » — valeurs acceptées: ${[...LOGLEVELS].join(', ')}`);
                    if (key === 'dbpurgeage' && !/^\d+$/.test(val))
                        errors.push(`Ligne ${ln}: dbpurgeage doit être un entier positif (secondes), reçu: "${val}"`);
                    if (key === 'dbmaxmatches' && (!/^\d+$/.test(val) || parseInt(val, 10) < 1))
                        errors.push(`Ligne ${ln}: dbmaxmatches doit être un entier >= 1, reçu: "${val}"`);
                    if (key === 'logtarget' && !/^(STDOUT|STDERR|SYSLOG|SYSTEMD-JOURNAL|\/\S+)$/i.test(val))
                        warnings.push(`Ligne ${ln}: logtarget inhabituel « ${val} » — valeurs typiques: STDOUT, STDERR, SYSLOG, /var/log/fail2ban.log`);
                }

                // ── jail.local checks ────────────────────────────────────────────
                if (filename === 'jail.local') {
                    const secLower = section.toLowerCase();
                    const isDefault = secLower === 'default' || secLower === 'default_';

                    if (!isDefault && !JAIL_KEYS.has(key))
                        warnings.push(`Ligne ${ln}: clé inconnue « ${key} » dans [${section}]`);

                    if (key === 'enabled' && !/^(true|false|1|0)$/i.test(val))
                        errors.push(`Ligne ${ln}: enabled doit être true/false/1/0, reçu: "${val}"`);

                    if (key === 'maxretry') {
                        if (!/^\d+$/.test(val) || parseInt(val, 10) < 1)
                            errors.push(`Ligne ${ln}: maxretry doit être un entier >= 1, reçu: "${val}"`);
                        else if (parseInt(val, 10) > 100)
                            warnings.push(`Ligne ${ln}: maxretry = ${val} est très élevé — valeur typique entre 3 et 10`);
                    }

                    // All time suffixes supported by fail2ban (seconds/minutes/hours/days/weeks/months/years)
                    const reDuration = /^-?\d+(s(ec(s|ond[s]?)?)?|m(in(s|ute[s]?)?|o(n(th[s]?)?)?)?|h(r[s]?|our[s]?)?|d(ay[s]?)?|w(k[s]?|eek[s]?)?|y(r[s]?|ear[s]?)?)?$/i;

                    if (key === 'bantime') {
                        if (!reDuration.test(val) && !/^-1$/.test(val))
                            errors.push(`Ligne ${ln}: bantime invalide « ${val} » — entier (secondes) ou suffixe s/m/h/d/w/mo/y, -1 pour ban permanent`);
                        else if (/^\d+$/.test(val) && parseInt(val, 10) > 0 && parseInt(val, 10) < 30)
                            warnings.push(`Ligne ${ln}: bantime = ${val}s est très court — valeur typique 600s (10 min) ou plus`);
                    }

                    if (key === 'findtime' && !reDuration.test(val))
                        errors.push(`Ligne ${ln}: findtime invalide « ${val} » — entier (secondes) ou suffixe s/m/h/d/w/mo/y`);

                    if (key === 'port') {
                        const ports = val.split(/[\s,]+/);
                        for (const p of ports) {
                            if (!p) continue;
                            if (/^\d+$/.test(p)) {
                                const pn = parseInt(p, 10);
                                if (pn < 1 || pn > 65535)
                                    errors.push(`Ligne ${ln}: port invalide ${p} — doit être entre 1 et 65535`);
                            } else if (/^\d+:\d+$/.test(p)) {
                                const [a, b] = p.split(':').map(Number);
                                if (a >= b) errors.push(`Ligne ${ln}: plage de ports invalide ${p} — début doit être < fin`);
                            }
                        }
                    }

                    if (key === 'logpath' && val && !val.startsWith('/') && !val.startsWith('%(') && !val.includes('*'))
                        warnings.push(`Ligne ${ln}: logpath « ${val} » n'est pas un chemin absolu — vérifiez le chemin`);

                    if (key === 'backend' && !['auto','pyinotify','gamin','polling','systemd'].includes(val.toLowerCase()))
                        warnings.push(`Ligne ${ln}: backend inconnu « ${val} » — valeurs: auto, pyinotify, gamin, polling, systemd`);

                    if (key === 'usedns' && !['yes','no','warn','raw'].includes(val.toLowerCase()))
                        errors.push(`Ligne ${ln}: usedns invalide « ${val} » — valeurs: yes, no, warn, raw`);
                }
            }

            // ── Post-parse checks ────────────────────────────────────────────────
            if (filename === 'fail2ban.local') {
                if (foundSections.length > 0 && !foundSections.map(s => s.toLowerCase()).includes('definition'))
                    errors.push('Section [Definition] manquante — fail2ban.local doit contenir [Definition]');
                if (foundSections.some(s => !['definition','thread'].includes(s.toLowerCase())))
                    warnings.push('fail2ban.local ne devrait contenir que [Definition] — les règles de jail vont dans jail.local');
            }

            if (filename === 'jail.local' && foundSections.length === 0)
                warnings.push('Aucune section trouvée — jail.local doit contenir au moins [DEFAULT] ou un nom de jail');

            // Warn last section empty
            if (section && sectionKeys[section]?.size === 0)
                warnings.push(`Section "[${section}]" est vide`);

            res.json({ success: true, result: { ok: errors.length === 0, errors, warnings } });
        }));

        // POST /config/write-raw  — write .local file content then reload
        router.post('/config/write-raw', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const { filename, content } = req.body as { filename?: string; content?: string };
            const ALLOWED = ['fail2ban.local', 'jail.local'];
            if (!filename || !ALLOWED.includes(filename))
                return res.json({ success: true, result: { ok: false, error: `Fichier non autorisé. Seuls ${ALLOWED.join(', ')} sont éditables.` } });
            if (typeof content !== 'string')
                return res.json({ success: true, result: { ok: false, error: 'Contenu manquant' } });
            const confBase = this.resolveDockerPathSync('/etc/fail2ban');
            const filePath = path.join(confBase, filename);
            // Normalize line endings — CRLF from browser/editor would make fail2ban
            // read logpath as "/var/log/auth.log\r" and fail with "no log file found"
            const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            try {
                fs.writeFileSync(filePath, normalized, 'utf8');
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                const isEROFS = /EROFS|read.only file system/i.test(msg);
                const isEACCES = /EACCES|permission denied/i.test(msg);
                let hint = '';
                if (isEROFS)
                    hint = ' — Montage Docker en lecture seule. Décommentez le volume rw /etc/fail2ban dans docker-compose.yml et exécutez : sudo ./scripts/setup-fail2ban-access.sh';
                else if (isEACCES)
                    hint = ' — Permission refusée. Exécutez : sudo ./scripts/setup-fail2ban-access.sh';
                return res.json({ success: true, result: { ok: false, error: `Écriture impossible : ${msg}${hint}` } });
            }
            // Reload fail2ban if socket available
            // ⚠️ Do NOT fallback to restart — fail2ban-client restart stops the host
            //    systemd service and the container cannot bring it back.
            let reloadOk = false;
            let reloadOutput = 'Socket non disponible — rechargement manuel requis';
            const reloadMethod = 'reload';
            if (this.client?.isAvailable()) {
                const r = await this.client.reload();
                reloadOk = r.ok;
                reloadOutput = r.output || r.error || '';
            }
            res.json({ success: true, result: { ok: true, reloadOk, reloadOutput, reloadMethod } });
        }));

        // POST /config/service  — reload or restart fail2ban service
        router.post('/config/service', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const { action } = req.body as { action: 'reload' | 'restart' };
            if (action !== 'reload' && action !== 'restart') throw createError('Invalid action', 400, 'BAD_PARAM');
            const r = action === 'reload' ? await this.client.reload() : await this.client.restart();
            res.json({ success: true, result: r });
        }));

        // GET /tracker  — ALL historical IPs from internal f2b_events (dashboard.db)
        // Source is the project DB, not fail2ban SQLite — survives fail2ban dbpurge
        router.get('/tracker', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const limit = Math.min(parseInt(String(req.query.limit ?? '2000'), 10), 5000);

            // All unique IPs with aggregated stats from internal DB
            const appDb = getDatabase();
            const nowTracker = Math.floor(Date.now() / 1000);
            const rows = appDb.prepare(`
                SELECT ip,
                       COUNT(*)                                                        AS bans,
                       SUM(COALESCE(failures, 0))                                     AS failures,
                       MAX(timeofban)                                                  AS lastSeen,
                       GROUP_CONCAT(DISTINCT jail)                                     AS jails,
                       SUM(CASE WHEN bantime > 0 AND (timeofban + bantime) < ? THEN 1 ELSE 0 END) AS unbans
                FROM f2b_events
                WHERE event_type = 'ban'
                GROUP BY ip
                ORDER BY lastSeen DESC
                LIMIT ?
            `).all(nowTracker, limit) as { ip: string; bans: number; failures: number; lastSeen: number; jails: string; unbans: number }[];

            const total = (appDb.prepare('SELECT COUNT(DISTINCT ip) as n FROM f2b_events').get() as { n: number }).n;

            // Currently banned IPs from internal f2b_events (survives fail2ban purge)
            const nowTs = Math.floor(Date.now() / 1000);
            const activeJails = new Map<string, string[]>();
            const activeRows = appDb.prepare(`
                SELECT ip, GROUP_CONCAT(DISTINCT jail) AS jails
                FROM f2b_events
                WHERE event_type='ban' AND (bantime = -1 OR (timeofban + bantime) > ?)
                GROUP BY ip
            `).all(nowTs) as { ip: string; jails: string }[];
            for (const r of activeRows) {
                activeJails.set(r.ip, r.jails.split(',').filter(Boolean));
            }

            const baseIps = rows.map(r => ({
                ip:              r.ip,
                bans:            r.bans,
                unbans:          r.unbans,
                failures:        r.failures,
                lastSeen:        r.lastSeen,
                currentlyBanned: activeJails.has(r.ip),
                // Active jails if currently banned, else historical jails from DB
                jails: activeJails.get(r.ip) ?? r.jails.split(',').filter(Boolean),
            }));

            res.json({ success: true, result: { ok: true, total, ips: baseIps } });
        }));

        // GET /map?source=live|history  — IPs + cached geo (for map tab)
        // live    : currently banned IPs from fail2ban SQLite (real-time)
        // history : all distinct IPs from internal f2b_events (survives fail2ban purge)
        router.get('/map', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const source = String(req.query.source ?? 'live') === 'history' ? 'history' : 'live';
            const appDb = getDatabase();
            const TTL = 30 * 86400;
            const now = Math.floor(Date.now() / 1000);

            const ipJails = new Map<string, string[]>();

            if (source === 'live') {
                // Active bans from internal f2b_events (survives fail2ban purge)
                const liveRows = appDb.prepare(`
                    SELECT ip, GROUP_CONCAT(DISTINCT jail) AS jails
                    FROM f2b_events
                    WHERE event_type='ban' AND (bantime = -1 OR (timeofban + bantime) > ?)
                    GROUP BY ip
                    LIMIT 2000
                `).all(now) as { ip: string; jails: string }[];
                for (const r of liveRows) {
                    ipJails.set(r.ip, r.jails.split(',').filter(Boolean));
                }
            } else {
                // Historical: all distinct IPs from f2b_events with their jails
                const rows = appDb.prepare(`
                    SELECT ip, GROUP_CONCAT(DISTINCT jail) AS jails
                    FROM f2b_events
                    GROUP BY ip
                    LIMIT 5000
                `).all() as { ip: string; jails: string }[];
                for (const r of rows) {
                    ipJails.set(r.ip, r.jails.split(',').filter(Boolean));
                }
            }

            // Fetch cached geo (TTL 30 days)
            const geoCache = new Map<string, { lat: number; lng: number; country: string; countryCode: string; region: string; city: string; org: string }>();
            const ipList = Array.from(ipJails.keys());
            for (let i = 0; i < ipList.length; i += 400) {
                const chunk = ipList.slice(i, i + 400);
                const placeholders = chunk.map(() => '?').join(',');
                const rows = appDb.prepare(`SELECT ip, lat, lng, country, countryCode, region, city, org, ts FROM f2b_ip_geo WHERE ip IN (${placeholders})`).all(...chunk) as { ip: string; lat: number; lng: number; country: string; countryCode: string; region: string; city: string; org: string; ts: number }[];
                for (const r of rows) {
                    if (now - r.ts <= TTL) geoCache.set(r.ip, { lat: r.lat, lng: r.lng, country: r.country, countryCode: r.countryCode, region: r.region, city: r.city, org: r.org });
                }
            }

            const points = Array.from(ipJails.entries()).map(([ip, jails]) => ({
                ip, jails, cached: geoCache.get(ip) ?? null,
            }));
            res.json({ success: true, result: { ok: true, points, source, resolveDelayMs: 380, cacheTtlDays: 30 } });
        }));

        // GET /map/resolve/:ip  — geo lookup + cache in f2b_ip_geo
        router.get('/map/resolve/:ip', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const ip = req.params.ip;
            if (!/^[\d:.a-fA-F]{2,45}$/.test(ip)) throw createError('Invalid IP', 400, 'BAD_PARAM');
            const TTL = 30 * 86400;
            const now = Math.floor(Date.now() / 1000);
            const appDb = getDatabase();
            // Return from cache if still valid
            const cached = appDb.prepare('SELECT lat, lng, country, countryCode, region, city, org, ts FROM f2b_ip_geo WHERE ip = ?').get(ip) as { lat: number; lng: number; country: string; countryCode: string; region: string; city: string; org: string; ts: number } | undefined;
            if (cached && now - cached.ts <= TTL) {
                return res.json({ success: true, result: { ok: true, lat: cached.lat, lng: cached.lng, country: cached.country, countryCode: cached.countryCode, region: cached.region, city: cached.city, org: cached.org } });
            }
            // Resolve via ip-api.com (includes lat/lon/region this time)
            try {
                const r = await globalThis.fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,region,city,org,lat,lon`, { signal: AbortSignal.timeout(5000) });
                const data = await r.json() as Record<string, unknown>;
                if (data.status === 'success' && typeof data.lat === 'number' && typeof data.lon === 'number') {
                    const geo = { lat: data.lat, lng: data.lon as number, country: String(data.country ?? ''), countryCode: String(data.countryCode ?? ''), region: String(data.region ?? ''), city: String(data.city ?? ''), org: String(data.org ?? '') };
                    appDb.prepare('INSERT OR REPLACE INTO f2b_ip_geo (ip, lat, lng, country, countryCode, region, city, org, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(ip, geo.lat, geo.lng, geo.country, geo.countryCode, geo.region, geo.city, geo.org, now);
                    return res.json({ success: true, result: { ok: true, ...geo } });
                }
                res.json({ success: true, result: { ok: false, error: String(data.message ?? 'ip-api returned non-success') } });
            } catch (e) {
                res.json({ success: true, result: { ok: false, error: String(e) } });
            }
        }));

        // GET /bans-today  — Bans depuis minuit (heure locale)
        router.get('/bans-today', requireAuth, asyncHandler(async (_req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');

            // TTL cache: 5s — counter updates frequently but SQLite contention is costly
            const _btCached = this._cachePeek<unknown>('bans-today', 5_000);
            if (_btCached) return res.json({ success: true, result: _btCached });

            const evDb = getDatabase();
            const now  = new Date();
            const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
            const since = Math.floor(midnight.getTime() / 1000);
            const row = evDb.prepare(`SELECT COUNT(*) as total, COUNT(DISTINCT ip) as uniq FROM f2b_events WHERE event_type='ban' AND timeofban >= @since`).get({ since }) as { total: number; uniq: number };
            const _btResult = { ok: true, count: row?.total ?? 0, uniqIps: row?.uniq ?? 0, since };
            this._cachePut('bans-today', _btResult);
            res.json({ success: true, result: _btResult });
        }));

        // GET /tops  — Top IPs, Jails, Récidivistes + heatmap
        router.get('/tops', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const days  = parseInt(String(req.query.days  ?? '30'), 10);
            const limit = Math.min(parseInt(String(req.query.limit ?? '10'), 10), 100);
            const compareFlag = req.query.compare === '1' ? 1 : 0;

            // TTL cache: 30s — cache key ignores `limit` (full dataset stored, sliced on return).
            // This deduplicates concurrent TabStats (limit=100) and BanHistoryChart (limit=1) requests.
            const _tCacheKey = `tops:${days}:${compareFlag}`;
            type TopsPayload = { ok: boolean; topIps: unknown[]; topJails: unknown[]; topRecidivists: unknown[]; topDomains: unknown[]; heatmap: unknown; heatmapFailed: unknown; heatmapWeek: unknown; heatmapFailedWeek: unknown; summary: unknown; prevSummary: unknown };
            const _tCached = this._cachePeek<TopsPayload>(_tCacheKey, this._adaptiveTtl(days));
            if (_tCached) {
                return res.json({ success: true, result: {
                    ..._tCached,
                    topIps:         _tCached.topIps.slice(0, limit),
                    topJails:       _tCached.topJails.slice(0, limit),
                    topRecidivists: _tCached.topRecidivists.slice(0, limit),
                    topDomains:     _tCached.topDomains.slice(0, limit),
                } });
            }

            // All stats from our f2b_events (dashboard.db) — never purged unlike fail2ban's own DB.
            // One shared connection, all queries in the same session.
            // STORE_LIMIT: always fetch 100 items for cache storage; `limit` is applied on the response.
            const STORE_LIMIT = 100;
            const evDb   = getDatabase();
            const allTime = days <= 0;
            const since  = allTime ? 0 : Math.floor(Date.now() / 1000) - days * 86400;

            const topIps = (allTime
                ? evDb.prepare(`SELECT ip, COUNT(*) as count FROM f2b_events WHERE event_type='ban' GROUP BY ip ORDER BY count DESC LIMIT @limit`).all({ limit: STORE_LIMIT })
                : evDb.prepare(`SELECT ip, COUNT(*) as count FROM f2b_events WHERE event_type='ban' AND timeofban >= @since GROUP BY ip ORDER BY count DESC LIMIT @limit`).all({ since, limit: STORE_LIMIT })
            ) as { ip: string; count: number }[];

            const topJailsWF = (allTime
                ? evDb.prepare(`SELECT jail, COUNT(*) as bans, COALESCE(SUM(failures),0) as failures FROM f2b_events WHERE event_type='ban' GROUP BY jail ORDER BY bans DESC LIMIT @limit`).all({ limit: STORE_LIMIT })
                : evDb.prepare(`SELECT jail, COUNT(*) as bans, COALESCE(SUM(failures),0) as failures FROM f2b_events WHERE event_type='ban' AND timeofban >= @since GROUP BY jail ORDER BY bans DESC LIMIT @limit`).all({ since, limit: STORE_LIMIT })
            ) as { jail: string; bans: number; failures: number }[];
            const topJails = topJailsWF.map(j => ({ jail: j.jail, count: j.bans }));

            const topRecidivists = (allTime
                ? evDb.prepare(`SELECT ip, COUNT(*) as count FROM f2b_events WHERE event_type='ban' GROUP BY ip HAVING count >= 2 ORDER BY count DESC LIMIT 100`).all()
                : evDb.prepare(`SELECT ip, COUNT(*) as count FROM f2b_events WHERE event_type='ban' AND timeofban >= @since GROUP BY ip HAVING count >= 2 ORDER BY count DESC LIMIT 100`).all({ since })
            ) as { ip: string; count: number }[];

            const heatmap = (allTime
                ? evDb.prepare(`SELECT CAST(strftime('%H',timeofban,'unixepoch') AS INTEGER) as hour, COUNT(*) as count FROM f2b_events WHERE event_type='ban' GROUP BY hour ORDER BY hour`).all()
                : evDb.prepare(`SELECT CAST(strftime('%H',timeofban,'unixepoch') AS INTEGER) as hour, COUNT(*) as count FROM f2b_events WHERE event_type='ban' AND timeofban >= @since GROUP BY hour ORDER BY hour`).all({ since })
            ) as { hour: number; count: number }[];

            const heatmapFailed = (allTime
                ? evDb.prepare(`SELECT CAST(strftime('%H',timeofban,'unixepoch') AS INTEGER) as hour, COALESCE(SUM(failures),0) as count FROM f2b_events WHERE event_type='ban' GROUP BY hour ORDER BY hour`).all()
                : evDb.prepare(`SELECT CAST(strftime('%H',timeofban,'unixepoch') AS INTEGER) as hour, COALESCE(SUM(failures),0) as count FROM f2b_events WHERE event_type='ban' AND timeofban >= @since GROUP BY hour ORDER BY hour`).all({ since })
            ) as { hour: number; count: number }[];

            const buildWeekGrid = (rows: { dow: number; hour: number; count: number }[]): number[][] => {
                const g: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
                for (const r of rows) { if (r.dow >= 0 && r.dow < 7 && r.hour >= 0 && r.hour < 24) g[r.dow][r.hour] = r.count; }
                return g;
            };
            const heatmapWeek = buildWeekGrid((allTime
                ? evDb.prepare(`SELECT (CAST(strftime('%w',timeofban,'unixepoch') AS INTEGER)+6)%7 as dow, CAST(strftime('%H',timeofban,'unixepoch') AS INTEGER) as hour, COUNT(*) as count FROM f2b_events WHERE event_type='ban' GROUP BY dow, hour`).all()
                : evDb.prepare(`SELECT (CAST(strftime('%w',timeofban,'unixepoch') AS INTEGER)+6)%7 as dow, CAST(strftime('%H',timeofban,'unixepoch') AS INTEGER) as hour, COUNT(*) as count FROM f2b_events WHERE event_type='ban' AND timeofban >= @since GROUP BY dow, hour`).all({ since })
            ) as { dow: number; hour: number; count: number }[]);

            const heatmapFailedWeek = buildWeekGrid((allTime
                ? evDb.prepare(`SELECT (CAST(strftime('%w',timeofban,'unixepoch') AS INTEGER)+6)%7 as dow, CAST(strftime('%H',timeofban,'unixepoch') AS INTEGER) as hour, COALESCE(SUM(failures),0) as count FROM f2b_events WHERE event_type='ban' GROUP BY dow, hour`).all()
                : evDb.prepare(`SELECT (CAST(strftime('%w',timeofban,'unixepoch') AS INTEGER)+6)%7 as dow, CAST(strftime('%H',timeofban,'unixepoch') AS INTEGER) as hour, COALESCE(SUM(failures),0) as count FROM f2b_events WHERE event_type='ban' AND timeofban >= @since GROUP BY dow, hour`).all({ since })
            ) as { dow: number; hour: number; count: number }[]);

            const now = Math.floor(Date.now() / 1000);
            const summaryRow = (allTime
                ? evDb.prepare(`SELECT COUNT(*) as total, COUNT(DISTINCT ip) as uniq, COALESCE(SUM(failures),0) as failures FROM f2b_events WHERE event_type='ban'`).get()
                : evDb.prepare(`SELECT COUNT(*) as total, COUNT(DISTINCT ip) as uniq, COALESCE(SUM(failures),0) as failures FROM f2b_events WHERE event_type='ban' AND timeofban >= @since`).get({ since })
            ) as { total: number; uniq: number; failures: number };
            const topJailRow = (allTime
                ? evDb.prepare(`SELECT jail, COUNT(*) as cnt FROM f2b_events WHERE event_type='ban' GROUP BY jail ORDER BY cnt DESC LIMIT 1`).get()
                : evDb.prepare(`SELECT jail, COUNT(*) as cnt FROM f2b_events WHERE event_type='ban' AND timeofban >= @since GROUP BY jail ORDER BY cnt DESC LIMIT 1`).get({ since })
            ) as { jail: string; cnt: number } | undefined;
            const expiredRow = allTime ? { n: 0 } : (evDb.prepare(`SELECT COUNT(*) as n FROM f2b_events WHERE event_type='ban' AND bantime > 0 AND (timeofban+bantime) >= @s AND (timeofban+bantime) <= @e`).get({ s: since, e: now }) as { n: number });
            const summary = {
                totalBans:        summaryRow?.total    ?? 0,
                uniqueIps:        summaryRow?.uniq     ?? 0,
                topJail:          topJailRow?.jail     ?? null,
                topJailCount:     topJailRow?.cnt      ?? 0,
                totalFailures:    summaryRow?.failures ?? 0,
                expiredInPeriod:  expiredRow.n,
            };

            // Previous period for trend comparison (compare=1, only when bounded period)
            let prevSummary: typeof summary | null = null;
            if (!allTime && req.query.compare === '1') {
                const prevSince = since - days * 86400;
                const prevRow = evDb.prepare(`SELECT COUNT(*) as total, COUNT(DISTINCT ip) as uniq, COALESCE(SUM(failures),0) as failures FROM f2b_events WHERE event_type='ban' AND timeofban >= @s AND timeofban < @e`).get({ s: prevSince, e: since }) as { total: number; uniq: number; failures: number };
                const prevJailRow = evDb.prepare(`SELECT jail, COUNT(*) as cnt FROM f2b_events WHERE event_type='ban' AND timeofban >= @s AND timeofban < @e GROUP BY jail ORDER BY cnt DESC LIMIT 1`).get({ s: prevSince, e: since }) as { jail: string; cnt: number } | undefined;
                const prevExpiredRow = evDb.prepare(`SELECT COUNT(*) as n FROM f2b_events WHERE event_type='ban' AND bantime > 0 AND (timeofban+bantime) >= @s AND (timeofban+bantime) < @e`).get({ s: prevSince, e: since }) as { n: number };
                prevSummary = {
                    totalBans:        prevRow?.total    ?? 0,
                    uniqueIps:        prevRow?.uniq     ?? 0,
                    topJail:          prevJailRow?.jail ?? null,
                    topJailCount:     prevJailRow?.cnt  ?? 0,
                    totalFailures:    prevRow?.failures ?? 0,
                    expiredInPeriod:  prevExpiredRow.n,
                };
            }

            // Top Domaines: scan NPM access logs directly for banned IPs
            // No dependency on fail2ban config — pure NPM logs + NPM DB
            const topDomains: { domain: string; count: number; failures: number }[] = [];
            const npmSettings = this.config?.settings as unknown as Fail2banPluginConfig | undefined;
            const npmDataPath = npmSettings?.npmDataPath ?? '';
            const npmEnabled = npmSettings?.npmDbType === 'mysql'
                ? !!(npmSettings?.npmMysqlHost && npmSettings?.npmMysqlUser && npmSettings?.npmMysqlDb)
                : !!npmDataPath;
            if (npmEnabled) {
                try {
                    // 1. Build proxy-host id → domain from NPM DB (SQLite or MySQL)
                    const { idToDomain } = await getNpmDomainMap(npmSettings!, this.resolveDockerPathSync.bind(this));

                    // 2. Build jail → log files map from fail2ban config
                    //    Only jails that explicitly watch a proxy-host log file are relevant here.
                    //    This ensures SSH/recidive jails never pollute domain stats.
                    const confBase = this.resolveDockerPathSync('/etc/fail2ban');
                    const jailMeta = parseJailConfigs(confBase);
                    const logsDir = this.resolveDockerPathSync(`${npmDataPath}/logs`);

                    // Map: proxy-host log filename → jails that watch it (direct or via glob)
                    // A jail logpath matches a proxy-host log if:
                    //   a) exact match after docker path resolution
                    //   b) contains "proxy-host-N" substring (wildcard jail watching all NPM logs)
                    const logFileToJails = new Map<string, Set<string>>();
                    for (const [jailName, meta] of Object.entries(jailMeta)) {
                        if (!meta.logpath) continue;
                        // Expand comma/space separated logpaths
                        const logpaths = meta.logpath.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
                        for (const lp of logpaths) {
                            const resolved = this.resolveDockerPathSync(lp);
                            // Wildcard jail watching all proxy-host logs
                            if (/proxy-host/i.test(resolved) && resolved.includes('*')) {
                                // This jail is responsible for ALL proxy-host-N logs
                                try {
                                    const files = fs.readdirSync(logsDir)
                                        .filter(f => /^proxy-host-(\d+)[_.-]/i.test(f) && /access/i.test(f));
                                    for (const f of files) {
                                        if (!logFileToJails.has(f)) logFileToJails.set(f, new Set());
                                        logFileToJails.get(f)!.add(jailName);
                                    }
                                } catch { /* logs dir not readable */ }
                            } else if (/proxy-host-(\d+)/i.test(resolved)) {
                                // Direct reference to a specific proxy-host log
                                const fname = path.basename(resolved);
                                if (!logFileToJails.has(fname)) logFileToJails.set(fname, new Set());
                                logFileToJails.get(fname)!.add(jailName);
                            }
                        }
                    }

                    // 3. Banned IPs per jail in the period, with their jail-specific failures
                    const bannedRows = (allTime
                        ? evDb.prepare(`SELECT ip, jail, COALESCE(failures,0) AS tf FROM f2b_events WHERE event_type='ban'`).all()
                        : evDb.prepare(`SELECT ip, jail, COALESCE(failures,0) AS tf FROM f2b_events WHERE event_type='ban' AND timeofban >= ?`).all(since)
                    ) as { ip: string; jail: string; tf: number }[];

                    // jailBannedIps: jail → Map<ip, failures> (only for that jail's bans)
                    const jailBannedIps = new Map<string, Map<string, number>>();
                    for (const row of bannedRows) {
                        if (!jailBannedIps.has(row.jail)) jailBannedIps.set(row.jail, new Map());
                        const m = jailBannedIps.get(row.jail)!;
                        m.set(row.ip, (m.get(row.ip) ?? 0) + row.tf);
                    }

                    // 4. Scan only proxy-host logs that have at least one responsible jail
                    //    Count IPs banned by THOSE jails that appear in the log.
                    const logFiles = fs.readdirSync(logsDir)
                        .filter(f => /^proxy-host-(\d+)[_.-]/i.test(f) && /access/i.test(f));

                    const domainBans: Record<string, { bans: number; failures: number }> = {};
                    for (const logFile of logFiles) {
                        const mf = logFile.match(/^proxy-host-(\d+)/i);
                        if (!mf) continue;
                        const domain = idToDomain[mf[1]];
                        if (!domain) continue;

                        // Jails responsible for this log file
                        const responsibleJails = logFileToJails.get(logFile);
                        if (!responsibleJails || responsibleJails.size === 0) {
                            // No fail2ban jail watches this domain's log → 0 bans, skip
                            continue;
                        }

                        // Merge banned IPs from all responsible jails
                        const candidateIps = new Map<string, number>(); // ip → failures
                        for (const jail of responsibleJails) {
                            const jailMap = jailBannedIps.get(jail);
                            if (!jailMap) continue;
                            for (const [ip, tf] of jailMap) {
                                candidateIps.set(ip, (candidateIps.get(ip) ?? 0) + tf);
                            }
                        }
                        if (candidateIps.size === 0) continue;

                        const filePath = path.join(logsDir, logFile);
                        try {
                            const stat = fs.statSync(filePath);
                            const readSize = Math.min(stat.size, 5 * 1024 * 1024);
                            const buf = Buffer.alloc(readSize);
                            const fd = fs.openSync(filePath, 'r');
                            fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
                            fs.closeSync(fd);
                            const content = buf.toString('utf8');
                            let bans = 0, failures = 0;
                            for (const [ip, tf] of candidateIps) {
                                if (content.includes(ip)) { bans++; failures += tf; }
                            }
                            if (bans > 0) {
                                if (!domainBans[domain]) domainBans[domain] = { bans: 0, failures: 0 };
                                domainBans[domain].bans += bans;
                                domainBans[domain].failures += failures;
                            }
                        } catch { /* unreadable file — skip */ }
                    }

                    for (const [domain, { bans, failures }] of Object.entries(domainBans)
                            .sort((a, b) => b[1].bans - a[1].bans)
                            .slice(0, STORE_LIMIT)) {
                        topDomains.push({ domain, count: bans, failures });
                    }
                } catch { /* non-critical */ }
            }

            // Cache the full dataset (STORE_LIMIT items), then slice to `limit` for the response.
            const _tResult: TopsPayload = { ok: true, topIps, topJails, topRecidivists, topDomains, heatmap, heatmapFailed, heatmapWeek, heatmapFailedWeek, summary, prevSummary };
            this._cachePut(_tCacheKey, _tResult);
            res.json({ success: true, result: {
                ..._tResult,
                topIps:         topIps.slice(0, limit),
                topJails:       topJails.slice(0, limit),
                topRecidivists: topRecidivists.slice(0, limit),
                topDomains:     topDomains.slice(0, limit),
            } });
        }));

        // GET /tops/domain-detail  — detail bans counted for one domain (same algo as topDomains)
        router.get('/tops/domain-detail', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const domain   = String(req.query.domain ?? '').toLowerCase().trim();
            const days     = parseInt(String(req.query.days ?? '30'), 10);
            if (!domain) return res.json({ success: true, result: { ok: false, error: 'domain required' } });

            const npmDataPath = (this.config?.settings as unknown as Fail2banPluginConfig | undefined)?.npmDataPath ?? '';
            if (!npmDataPath) return res.json({ success: true, result: { ok: true, domain, jails: [], bans: [] } });

            const evDb   = getDatabase();
            const now    = Math.floor(Date.now() / 1000);
            const since  = days === 0 ? 0 : now - days * 86400;
            const allTime = days === 0;

            // Build jail → log files mapping (same logic as /tops)
            const confBase = this.resolveDockerPathSync('/etc/fail2ban');
            const jailMeta = parseJailConfigs(confBase);
            const logsDir  = this.resolveDockerPathSync(`${npmDataPath}/logs`);

            // Find the proxy-host log file(s) for this specific domain
            const npmDbPath = this.resolveDockerPathSync(`${npmDataPath}/database.sqlite`);
            const idToDomain: Record<string, string> = {};
            let domainLogFile: string | null = null;
            try {
                const npmDb = new (await import('better-sqlite3')).default(npmDbPath, { readonly: true, fileMustExist: true });
                const proxyRows = npmDb.prepare('SELECT id, domain_names FROM proxy_host WHERE is_deleted=0').all() as { id: number; domain_names: string }[];
                npmDb.close();
                for (const row of proxyRows) {
                    try {
                        const ns: string[] = JSON.parse(row.domain_names);
                        if (ns.length) {
                            const d = ns[0].replace(/^www\./, '').toLowerCase();
                            idToDomain[String(row.id)] = d;
                            if (d === domain) domainLogFile = `proxy-host-${row.id}_access.log`;
                        }
                    } catch { /* bad JSON */ }
                }
            } catch { return res.json({ success: true, result: { ok: false, error: 'NPM DB inaccessible' } }); }

            if (!domainLogFile) return res.json({ success: true, result: { ok: true, domain, jails: [], bans: [] } });

            // Find responsible jails for this log file
            const responsibleJails = new Set<string>();
            for (const [jailName, meta] of Object.entries(jailMeta)) {
                if (!meta.logpath) continue;
                const logpaths = meta.logpath.split(/[\s,]+/).map((s: string) => s.trim()).filter(Boolean);
                for (const lp of logpaths) {
                    const resolved = this.resolveDockerPathSync(lp);
                    if (/proxy-host/i.test(resolved) && resolved.includes('*')) {
                        responsibleJails.add(jailName);
                        break;
                    } else if (path.basename(resolved) === domainLogFile) {
                        responsibleJails.add(jailName);
                        break;
                    }
                }
            }

            // Get all bans from responsible jails in period
            const jailList = [...responsibleJails];
            if (jailList.length === 0) return res.json({ success: true, result: { ok: true, domain, jails: [], bans: [] } });

            const placeholders = jailList.map(() => '?').join(',');
            const banRows = (allTime
                ? evDb.prepare(`SELECT ip, jail, timeofban, bantime, COALESCE(failures,0) as failures FROM f2b_events WHERE event_type='ban' AND jail IN (${placeholders}) ORDER BY timeofban DESC`).all(...jailList)
                : evDb.prepare(`SELECT ip, jail, timeofban, bantime, COALESCE(failures,0) as failures FROM f2b_events WHERE event_type='ban' AND jail IN (${placeholders}) AND timeofban >= ? ORDER BY timeofban DESC`).all(...jailList, since)
            ) as { ip: string; jail: string; timeofban: number; bantime: number; failures: number }[];

            // Scan the domain's log file for matching IPs
            const logFilePath = path.join(logsDir, domainLogFile);
            let content = '';
            try {
                const stat = fs.statSync(logFilePath);
                const readSize = Math.min(stat.size, 5 * 1024 * 1024);
                const buf = Buffer.alloc(readSize);
                const fd = fs.openSync(logFilePath, 'r');
                fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
                fs.closeSync(fd);
                content = buf.toString('utf8');
            } catch { return res.json({ success: true, result: { ok: true, domain, jails: jailList, bans: [] } }); }

            // Filter: only IPs that appear in this domain's log
            const matchedBans = banRows.filter(b => content.includes(b.ip));

            res.json({ success: true, result: { ok: true, domain, jails: jailList, bans: matchedBans } });
        }));

        // GET /audit  — historique bans (f2b_events — notre DB, historique complet) + enrichissements
        // GET /sync-status — real-time sync progress (polled by frontend banner)
        router.get('/sync-status', requireAuth, (_req, res) => {
            res.json({ success: true, result: this.syncService?.getStatus() ?? { phase: 'idle', message: '', detail: '', progress: -1, updatedAt: 0 } });
        });

        router.get('/audit', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const limit      = Math.min(parseInt(String(req.query.limit ?? '200'), 10), 1000);
            const daysParam  = parseInt(String(req.query.days  ?? '0'),  10);
            const jailFilter = req.query.jail ? String(req.query.jail) : null;

            // Read from our long-term f2b_events (never purged, unlike fail2ban's own DB)
            const evDb    = getDatabase();
            const allTime = daysParam <= 0;
            const since   = allTime ? 0 : Math.floor(Date.now() / 1000) - daysParam * 86400;
            let bans: { ip: string; jail: string; timeofban: number; bantime: number; failures: number; domain: string }[];
            if (jailFilter) {
                bans = (allTime
                    ? evDb.prepare(`SELECT ip, jail, timeofban, bantime, failures, COALESCE(domain,'') as domain FROM f2b_events WHERE event_type='ban' AND jail=? ORDER BY timeofban DESC LIMIT ?`).all(jailFilter, limit)
                    : evDb.prepare(`SELECT ip, jail, timeofban, bantime, failures, COALESCE(domain,'') as domain FROM f2b_events WHERE event_type='ban' AND jail=? AND timeofban >= ? ORDER BY timeofban DESC LIMIT ?`).all(jailFilter, since, limit)
                ) as typeof bans;
            } else {
                bans = (allTime
                    ? evDb.prepare(`SELECT ip, jail, timeofban, bantime, failures, COALESCE(domain,'') as domain FROM f2b_events WHERE event_type='ban' ORDER BY timeofban DESC LIMIT ?`).all(limit)
                    : evDb.prepare(`SELECT ip, jail, timeofban, bantime, failures, COALESCE(domain,'') as domain FROM f2b_events WHERE event_type='ban' AND timeofban >= ? ORDER BY timeofban DESC LIMIT ?`).all(since, limit)
                ) as typeof bans;
            }

            // ── Enrichissements ──────────────────────────────────────────────
            const confBase  = this.resolveDockerPathSync('/etc/fail2ban');
            const jailMeta  = parseJailConfigs(confBase);

            // jail_actions + jail_logs + jail_servers
            const jail_actions: Record<string, string> = {};
            const jail_logs:    Record<string, string> = {};
            const jail_servers: Record<string, string> = {};
            const detectServer = (jailName: string, logpath: string): string => {
                const p = logpath.toLowerCase();
                const j = jailName.toLowerCase();
                if (p.includes('nginx-proxy-manager') || p.includes('nginx_proxy') || p.includes('/npm/')) return 'npm';
                if (p.includes('apache'))  return 'apache2';
                if (p.includes('nginx'))   return 'nginx';
                if (p.includes('traefik')) return 'traefik';
                if (p.includes('haproxy')) return 'haproxy';
                if (p.includes('lighttpd'))return 'lighttpd';
                if (j.includes('npm') || j.includes('nginx-proxy-manager')) return 'npm';
                if (j.includes('apache'))  return 'apache2';
                if (j.includes('nginx'))   return 'nginx';
                if (j.includes('traefik')) return 'traefik';
                if (j.includes('haproxy')) return 'haproxy';
                if (j.includes('lighttpd'))return 'lighttpd';
                return '';
            };

            // Seed from config parsing first (cheap, synchronous)
            for (const [jailName, meta] of Object.entries(jailMeta)) {
                if (meta.banaction) jail_actions[jailName] = meta.banaction;
                if (meta.logpath)   jail_logs[jailName]    = meta.logpath;
            }

            // Override / fill gaps with runtime fail2ban-client status (authoritative source).
            // Also collect ALL logpaths per jail (not just first) for multi-domain detection.
            const jail_all_logpaths: Record<string, string[]> = {};
            for (const [jailName, logpath] of Object.entries(jail_logs)) {
                jail_all_logpaths[jailName] = [logpath];
            }

            if (this.client?.isAvailable()) {
                const uniqueJails = [...new Set((bans as { jail: string }[]).map((b: { jail: string }) => b.jail))];
                await Promise.all(uniqueJails.map(async (jailName: string) => {
                    try {
                        const status = await this.client.getJailStatus(jailName);
                        if (status?.fileList) {
                            const paths = status.fileList.trim().split(/\s+/).filter(Boolean);
                            if (paths.length > 0) {
                                jail_logs[jailName] = paths[0];
                                jail_all_logpaths[jailName] = paths;
                            }
                        }
                    } catch { /* socket unavailable for this jail */ }
                }));
            }

            // Populate jail_servers from final jail_logs
            for (const [jailName, logpath] of Object.entries(jail_logs)) {
                const srv = detectServer(jailName, logpath);
                if (srv) jail_servers[jailName] = srv;
            }

            // jail_domains / jail_all_domains: domain(s) of the targeted site, keyed by jail name
            // Strategy 1 — filename heuristic: /var/log/nginx/example.com_access.log → "example.com"
            const domainFromLogpath = (logpath: string): string => {
                const fname = logpath.replace(/.*\//, '');
                const stripped = fname
                    .replace(/[._-]?(ssl_access|ssl_error|other_vhosts_access|access|error)\.log$/i, '')
                    .replace(/\.log$/i, '');
                return /^[a-zA-Z0-9][a-zA-Z0-9._-]+\.[a-zA-Z]{2,}$/.test(stripped) ? stripped.toLowerCase() : '';
            };

            // Strategy 2 — LogviewR sources DB
            const domainFromSources = (() => {
                try {
                    const db = getDatabase();
                    const rows = db.prepare(`
                        SELECT lf.file_path, ls.name
                        FROM log_files lf JOIN log_sources ls ON lf.source_id = ls.id
                        WHERE lf.enabled = 1
                    `).all() as { file_path: string; name: string }[];
                    const basenameMap: Record<string, string> = {};
                    const fullPathMap: Record<string, string> = {};
                    for (const r of rows) {
                        fullPathMap[r.file_path] = r.name;
                        const bn = r.file_path.replace(/.*\//, '');
                        if (!basenameMap[bn]) basenameMap[bn] = r.name;
                    }
                    return (logpath: string): string => {
                        const name = fullPathMap[logpath] ?? basenameMap[logpath.replace(/.*\//, '')] ?? '';
                        if (!name) return '';
                        const n = name.trim();
                        return /^[a-zA-Z0-9][a-zA-Z0-9._-]+\.[a-zA-Z]{2,}/.test(n) ? n.toLowerCase() : '';
                    };
                } catch {
                    return (_lp: string) => '';
                }
            })();

            // Strategy 3 — NPM SQLite: scan ALL logpaths to find npm_base, load full id→domain map
            let npmLogsBase: string | null = null;
            const npmDbDomains: Record<string, string> = (() => {
                const allLogpaths = Object.values(jail_all_logpaths).flat();
                for (const logpath of allLogpaths) {
                    const m = logpath.match(/proxy-host-(\d+)[_-]/);
                    if (!m) continue;
                    const logsIdx = logpath.lastIndexOf('/logs/');
                    const npmBase = logsIdx >= 0 ? logpath.slice(0, logsIdx) : null;
                    if (!npmBase) continue;
                    const dbPath = this.resolveDockerPathSync(`${npmBase}/database.sqlite`);
                    try {
                        const npmDb = new Database(dbPath, { readonly: true, fileMustExist: true });
                        const rows = npmDb.prepare('SELECT id, domain_names FROM proxy_host WHERE is_deleted=0').all() as { id: number; domain_names: string }[];
                        npmDb.close();
                        const map: Record<string, string> = {};
                        for (const row of rows) {
                            try {
                                const names: string[] = JSON.parse(row.domain_names);
                                if (names.length > 0) map[String(row.id)] = names[0].replace(/^www\./, '').toLowerCase();
                            } catch { /* bad JSON */ }
                        }
                        npmLogsBase = `${npmBase}/logs`;
                        return map;
                    } catch { /* db not accessible */ }
                    break;
                }
                return {};
            })();

            const domainFromNpmDb = (logpath: string): string => {
                const m = logpath.match(/proxy-host-(\d+)[_-]/);
                if (!m) return '';
                return npmDbDomains[m[1]] ?? '';
            };

            // Build per-jail domain lists (one domain if single logpath, multiple if e.g. NPM jail)
            const jail_domains: Record<string, string> = {};
            const jail_all_domains: Record<string, string[]> = {};
            for (const [jailName, logpaths] of Object.entries(jail_all_logpaths)) {
                const domains = [...new Set(
                    logpaths
                        .map(lp => domainFromLogpath(lp) || domainFromSources(lp) || domainFromNpmDb(lp))
                        .filter(d => d !== '')
                )];
                if (domains.length > 0) {
                    jail_domains[jailName] = domains[0];
                    jail_all_domains[jailName] = domains;
                }
            }

            // ── Geo cache — country codes for all IPs (cache only, no new API calls) ──
            const uniqueIps = [...new Set(bans.map(b => b.ip))];
            const geoByIp: Record<string, string> = {};
            for (let i = 0; i < uniqueIps.length; i += 500) {
                const chunk = uniqueIps.slice(i, i + 500);
                const placeholders = chunk.map(() => '?').join(',');
                const geoRows = evDb.prepare(`SELECT ip, countryCode FROM f2b_ip_geo WHERE ip IN (${placeholders})`).all(...chunk) as { ip: string; countryCode: string }[];
                for (const r of geoRows) geoByIp[r.ip] = r.countryCode;
            }
            // Build domain→logpath reverse map for per-ban logfile resolution
            // When a ban has a specific domain, find the matching logpath in jail_all_logpaths
            const domainToLogpath: Record<string, string> = {};
            for (const [, logpaths] of Object.entries(jail_all_logpaths)) {
                for (const lp of logpaths) {
                    const d = domainFromLogpath(lp) || domainFromSources(lp) || domainFromNpmDb(lp);
                    if (d && !domainToLogpath[d]) domainToLogpath[d] = lp;
                }
            }
            // Augment with ALL NPM proxy hosts (not just those referenced by jail configs)
            // This ensures domains from multi-host jails (wildcard) resolve to their own log
            if (npmLogsBase) {
                for (const [id, domain] of Object.entries(npmDbDomains)) {
                    if (!domainToLogpath[domain]) {
                        domainToLogpath[domain] = `${npmLogsBase}/proxy-host-${id}_access.log`;
                    }
                }
            }

            const bansWithGeo = bans.map(b => {
                // Resolve per-ban logfile: use domain→logpath if available, else jail default
                const logfile = (b.domain && domainToLogpath[b.domain])
                    ? domainToLogpath[b.domain]
                    : (jail_logs[b.jail] ?? '');
                return { ...b, countryCode: geoByIp[b.ip] ?? '', logfile };
            });

            res.json({ success: true, result: { ok: true, bans: bansWithGeo, jail_actions, jail_logs, jail_servers, jail_domains, jail_all_domains } });
        }));

        // GET /ip/:ip  — données agrégées pour le modal détail IP
        // Returns: active jails, ipset membership, hostname, whois, known provider, log lines
        router.get('/ip/:ip', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const ip = String(req.params.ip);
            if (!/^[\d:.a-fA-F]{2,45}$/.test(ip)) throw createError('Invalid IP', 400, 'BAD_PARAM');

            const db    = getDatabase();
            const nowSec = Math.floor(Date.now() / 1000);

            // Active jails: IPs still within ban window in our internal f2b_events store
            const activeJailRows = db.prepare(`
                SELECT DISTINCT jail FROM f2b_events
                WHERE ip = ? AND event_type='ban' AND (bantime = -1 OR (timeofban + bantime) > ?)
            `).all(ip, nowSec) as { jail: string }[];
            const activeJails = activeJailRows.map(r => r.jail);

            // All jails ever seen for this IP: active + historical (from internal DB)
            const histJails: string[] = [];
            try {
                const hist = Fail2banSyncService.getIpHistory(ip, 500);
                for (const row of hist) {
                    if (row.jail && !histJails.includes(row.jail)) histJails.push(row.jail);
                }
            } catch { /* ignore */ }
            const allJails = [...new Set([...activeJails, ...histJails])];

            // Jail log paths for all jails (runtime fail2ban-client status, like PHP does)
            // fileList is space-separated and can contain multiple paths — keep ALL of them
            const jailLogPaths: Record<string, string[]> = {};
            await Promise.all(allJails.map(async jail => {
                const status = await this.client?.getJailStatus(jail).catch(() => null);
                if (status?.fileList?.trim()) {
                    const paths = status.fileList.trim().split(/\s+/).filter(Boolean);
                    if (paths.length > 0) jailLogPaths[jail] = paths;
                }
            }));

            // Whois — serve from cache (7 days TTL), otherwise run whois command
            const WHOIS_TTL = 7 * 86400;
            let whois: WhoisInfo | null = null;
            const whoisCached = db.prepare('SELECT org,country,asn,netname,cidr,ts FROM f2b_whois_cache WHERE ip=?').get(ip) as { org:string; country:string; asn:string; netname:string; cidr:string; ts:number } | undefined;
            if (whoisCached && (Date.now() / 1000 - whoisCached.ts) < WHOIS_TTL) {
                whois = { org: whoisCached.org, country: whoisCached.country, asn: whoisCached.asn, netname: whoisCached.netname, cidr: whoisCached.cidr };
            } else {
                whois = await runWhois(ip);
                if (whois) {
                    db.prepare('INSERT OR REPLACE INTO f2b_whois_cache(ip,org,country,asn,netname,cidr,ts) VALUES(?,?,?,?,?,?,?)')
                        .run(ip, whois.org, whois.country, whois.asn, whois.netname, whois.cidr, Math.floor(Date.now() / 1000));
                }
            }

            // Parallel: ipset, hostname, known-provider check
            const [ipsetResult, hostname] = await Promise.all([
                this.client?.ipsetList().catch(() => ({ ok: false, output: '', error: '' }))
                    ?? Promise.resolve({ ok: false, output: '', error: '' }),
                reverseDns(ip),
            ]);
            const knownProvider = checkKnownProvider(ip);

            const ipsetMap    = ipsetResult.ok ? parseIpsetMembership(ipsetResult.output) : new Map<string, string[]>();
            const allIpsetNames: string[] = [];
            if (ipsetResult.ok) {
                for (const line of ipsetResult.output.split('\n')) {
                    const m = line.match(/^Name:\s+(.+)/);
                    if (m && !m[1].startsWith('docker-')) allIpsetNames.push(m[1].trim());
                }
            }
            const ipsets = ipsetMap.get(ip)?.filter(s => !s.startsWith('docker-')) ?? [];

            // Build NPM domain map (proxy-host-N → domain) from the first NPM log path found
            const allLogPathsList = Object.values(jailLogPaths).flat();
            const npmDomainMap: Record<string, string> = (() => {
                for (const logpath of allLogPathsList) {
                    const m = logpath.match(/proxy-host-(\d+)[_-]/);
                    if (!m) continue;
                    const logsIdx = logpath.lastIndexOf('/logs/');
                    const npmBase = logsIdx >= 0 ? logpath.slice(0, logsIdx) : null;
                    if (!npmBase) continue;
                    const dbPath = this.resolveDockerPathSync(`${npmBase}/database.sqlite`);
                    try {
                        const npmDb = new Database(dbPath, { readonly: true, fileMustExist: true });
                        const rows = npmDb.prepare('SELECT id, domain_names FROM proxy_host WHERE is_deleted=0').all() as { id: number; domain_names: string }[];
                        npmDb.close();
                        const map: Record<string, string> = {};
                        for (const row of rows) {
                            try {
                                const names: string[] = JSON.parse(row.domain_names);
                                if (names.length > 0) map[String(row.id)] = names[0].replace(/^www\./, '').toLowerCase();
                            } catch { /* bad JSON */ }
                        }
                        return map;
                    } catch { /* db not accessible */ }
                    break;
                }
                return {};
            })();

            /** Resolve domain for a log file path */
            const domainForLogpath = (logpath: string): string | null => {
                // NPM: proxy-host-N → look up in DB map
                const npmM = logpath.match(/proxy-host-(\d+)[_-]/);
                if (npmM) return npmDomainMap[npmM[1]] ?? null;
                // Filename heuristic: strip _access.log / _error.log etc.
                const fname = logpath.replace(/.*\//, '');
                const stripped = fname.replace(/[._-]?(ssl_access|ssl_error|other_vhosts_access|access|error)\.log$/i, '').replace(/\.log$/i, '');
                return /^[a-zA-Z0-9][a-zA-Z0-9._-]+\.[a-zA-Z]{2,}$/.test(stripped) ? stripped.toLowerCase() : null;
            };

            // Source log lines: grep each unique log file for this IP (30 lines per file, no file limit)
            const LOG_MAX_LINES = 30;
            // Deduplicate log paths (multiple jails can share the same log file)
            const uniqueLogPaths = new Map<string, string>(); // logpath → first jail
            for (const [jail, paths] of Object.entries(jailLogPaths)) {
                for (const logpath of paths) {
                    if (!uniqueLogPaths.has(logpath)) uniqueLogPaths.set(logpath, jail);
                }
            }
            const logFilesToGrep = [...uniqueLogPaths.entries()];
            const totalLogFiles = uniqueLogPaths.size;

            interface LogFileEntry { jail: string; filepath: string; domain: string | null; type: string; lines: string[] }
            const logEntries: LogFileEntry[] = [];
            await Promise.all(logFilesToGrep.map(async ([logpath, jail]) => {
                const resolved = this.resolveDockerPathSync(logpath);
                const lines = await grepLogFile(resolved, ip, LOG_MAX_LINES);
                if (lines.length > 0) {
                    const fname = logpath.replace(/.*\//, '');
                    const type = /error/i.test(fname) ? 'error' : /access/i.test(fname) ? 'access' : 'other';
                    logEntries.push({ jail, filepath: logpath, domain: domainForLogpath(logpath), type, lines });
                }
            }));
            // Sort by domain then filepath for consistent display
            logEntries.sort((a, b) => (a.domain ?? a.filepath).localeCompare(b.domain ?? b.filepath));

            res.json({ success: true, result: {
                ok: true,
                activeJails,
                ipsets,
                allIpsets: allIpsetNames,
                hostname,
                whois,
                knownProvider,
                logEntries,
                logFilesTotal: totalLogFiles,
                logFilesShown: totalLogFiles,
            }});
        }));

        // GET /audit/internal  — historique bans depuis la DB interne (dashboard.db)
        // Supports ?ip=X for single-IP history (modal), ?days=N, ?limit=N
        router.get('/audit/internal', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const days  = parseInt(String(req.query.days  ?? '-1'), 10);
            const limit = Math.min(parseInt(String(req.query.limit ?? '500'), 10), 5000);
            const ipFilter = req.query.ip ? String(req.query.ip) : null;
            // Basic IPv4/IPv6 validation
            if (ipFilter && !/^[\d:.a-fA-F]{2,45}$/.test(ipFilter)) throw createError('Invalid IP', 400, 'BAD_PARAM');
            try {
                const bans = ipFilter
                    ? Fail2banSyncService.getIpHistory(ipFilter, limit)
                    : Fail2banSyncService.getHistory(days, limit);
                const stats = Fail2banSyncService.getInternalStats();
                res.json({ success: true, result: { ok: true, bans, stats } });
            } catch (e) {
                res.json({ success: true, result: { ok: false, bans: [], error: String(e) } });
            }
        }));

        // GET /app-audit  — santé de l'application LogviewR (DB, process, droits, fichiers)
        router.get('/app-audit', requireAuth, asyncHandler(async (_req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');

            const cwd      = process.cwd();
            const dataDir  = path.join(cwd, 'data');
            const appDbPath = path.join(dataDir, 'dashboard.db');
            const backupDir = path.join(dataDir, 'iptables-backups');

            const fileCheck = (p: string, mode: number) => {
                try { fs.accessSync(p, mode); return true; } catch { return false; }
            };
            const dirExists = (p: string) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
            const sizeOf    = (p: string): string => {
                try {
                    const s = fs.statSync(p).size;
                    return s >= 1048576 ? `${(s / 1048576).toFixed(2)} Mo` : `${(s / 1024).toFixed(1)} Ko`;
                } catch { return '—'; }
            };

            // dashboard.db checks
            const dbExists   = fileCheck(appDbPath, fs.constants.F_OK);
            const dbReadable = fileCheck(appDbPath, fs.constants.R_OK);
            const dbWritable = fileCheck(appDbPath, fs.constants.W_OK);
            const dbSize     = sizeOf(appDbPath);

            // data/ directory
            const dataDirExists   = dirExists(dataDir);
            const dataDirWritable = fileCheck(dataDir, fs.constants.W_OK);

            // fail2ban socket
            const sockPath    = this.resolveDockerPathSync('/var/run/fail2ban/fail2ban.sock');
            const sockExists  = fileCheck(sockPath, fs.constants.F_OK);
            const sockWritable = fileCheck(sockPath, fs.constants.W_OK);

            // fail2ban SQLite + config files
            const confBase    = this.resolveDockerPathSync('/etc/fail2ban');
            const cfg         = parseGlobalConfig(confBase);
            const f2bDbPath   = this.resolveDockerPathSync(cfg.dbfile || '/var/lib/fail2ban/fail2ban.sqlite3');
            const f2bDbExists   = fileCheck(f2bDbPath, fs.constants.F_OK);
            const f2bDbReadable = fileCheck(f2bDbPath, fs.constants.R_OK);

            // fail2ban config files
            const jailLocalPath = path.join(confBase, 'jail.local');
            const f2bConfPath   = path.join(confBase, 'fail2ban.conf');
            const jailLocalOk   = fileCheck(jailLocalPath, fs.constants.R_OK);
            const f2bConfOk     = fileCheck(f2bConfPath,   fs.constants.R_OK);

            // backup dir
            const backupDirOk = dirExists(backupDir) && fileCheck(backupDir, fs.constants.W_OK);

            // Process info
            const mem = process.memoryUsage();
            const procInfo = {
                pid:     process.pid,
                uptime:  Math.round(process.uptime()),
                memRssMB: Math.round(mem.rss / 1048576),
                memHeapMB: Math.round(mem.heapUsed / 1048576),
                nodeVersion: process.version,
                platform: process.platform,
                arch:     process.arch,
            };

            res.json({ success: true, result: {
                ok: dbExists && dbReadable && dbWritable && dataDirWritable,
                dashboardDb: { exists: dbExists, readable: dbReadable, writable: dbWritable, size: dbSize, path: appDbPath },
                dataDir:     { exists: dataDirExists, writable: dataDirWritable, path: dataDir },
                backupDir:   { ok: backupDirOk, path: backupDir },
                socket:      { exists: sockExists, writable: sockWritable, path: sockPath },
                fail2banDb:  { exists: f2bDbExists, readable: f2bDbReadable, path: f2bDbPath },
                configFiles: { jailLocal: jailLocalOk, fail2banConf: f2bConfOk },
                process:     procInfo,
            }});
        }));

        // GET /geo/:ip  — géolocalisation IP via ip-api.com (proxy, no key needed)
        router.get('/geo/:ip', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const ip = req.params.ip;
            if (!/^[\d:.a-fA-F]{2,45}$/.test(ip)) throw createError('Invalid IP', 400, 'BAD_PARAM');
            try {
                const r = await globalThis.fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,city,org,isp,as,query`, { signal: AbortSignal.timeout(5000) });
                const data = await r.json() as Record<string, unknown>;
                res.json({ success: true, result: { ok: data.status === 'success', geo: data } });
            } catch (e) {
                res.json({ success: true, result: { ok: false, error: String(e) } });
            }
        }));

        // ── Network tabs (NET_ADMIN + binaries required) ─────────────────────

        router.get('/iptables', requireAuth, asyncHandler(async (_req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const r = await this.client?.iptablesSave() ?? { ok: false, output: '', error: 'client not initialized' };
            res.json({ success: true, result: r });
        }));

        router.get('/ipset', requireAuth, asyncHandler(async (_req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const r = await this.client?.ipsetList() ?? { ok: false, output: '', error: 'client not initialized' };
            res.json({ success: true, result: r });
        }));

        // GET /ipset/sets — structured list of ipset names + entry counts
        router.get('/ipset/sets', requireAuth, asyncHandler(async (_req, res) => {
            if (!this.isEnabled()) return res.json({ success: true, result: { ok: false, sets: [], error: 'Plugin désactivé' } });
            try {
                const sets = await this.client?.ipsetSets() ?? [];
                res.json({ success: true, result: { ok: true, sets } });
            } catch (e) {
                res.json({ success: true, result: { ok: false, sets: [], error: String(e) } });
            }
        }));

        // POST /ipset/add  { set: string, entry: string }
        router.post('/ipset/add', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) return res.json({ success: true, result: { ok: false, error: 'Plugin désactivé' } });
            const { set, entry } = req.body as { set?: string; entry?: string };
            if (!set || !entry) return res.json({ success: true, result: { ok: false, error: 'Paramètres manquants' } });
            const safeSet   = set.replace(/[^a-zA-Z0-9_.-]/g, '');
            const safeEntry = entry.replace(/[^0-9a-fA-F.:\/]/g, '');
            if (!safeSet || !safeEntry) return res.json({ success: true, result: { ok: false, error: 'Valeurs invalides' } });
            const r = await this.client?.ipsetAdd(safeSet, safeEntry) ?? { ok: false, output: '', error: 'client not initialized' };
            res.json({ success: true, result: r });
        }));

        // GET /ipset/info — full set metadata (type, maxelem, size, entry count)
        // Also records a daily snapshot for the historical chart.
        router.get('/ipset/info', requireAuth, asyncHandler(async (_req, res) => {
            if (!this.isEnabled()) return res.json({ success: true, result: { ok: false, sets: [], error: 'Plugin désactivé' } });
            const r = await this.client?.ipsetInfo() ?? { ok: false, sets: [], error: 'client not initialized' };
            if (r.ok && r.sets.length > 0) {
                try {
                    const appDb  = getDatabase();
                    const today  = new Date().toISOString().slice(0, 10);
                    const upsert = appDb.prepare(`
                        INSERT INTO f2b_ipset_snapshots(name, date, entries)
                        VALUES(?,?,?)
                        ON CONFLICT(name, date) DO UPDATE SET entries=excluded.entries, ts=strftime('%s','now')
                    `);
                    for (const s of r.sets.filter(s => !s.name.startsWith('docker-'))) {
                        upsert.run(s.name, today, s.entries);
                    }
                } catch { /* non-critical */ }
            }
            res.json({ success: true, result: r });
        }));

        // GET /ipset/history?days=30 — historical IPSet entry counts per day
        router.get('/ipset/history', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) return res.json({ success: true, result: { ok: false, ipset_names: [], ipset_days: {} } });
            const days = Math.min(Math.max(1, parseInt(String(req.query.days ?? '30'), 10)), 365);
            const appDb = getDatabase();
            const rows = appDb.prepare(`
                SELECT name, date, entries
                FROM f2b_ipset_snapshots
                WHERE date >= date('now', '-' || ? || ' days')
                ORDER BY date ASC
            `).all(days) as { name: string; date: string; entries: number }[];
            const ipset_names = [...new Set(rows.map(r => r.name))];
            const ipset_days: Record<string, Record<string, number>> = {};
            for (const r of rows) {
                if (!ipset_days[r.date]) ipset_days[r.date] = {};
                ipset_days[r.date][r.name] = r.entries;
            }
            res.json({ success: true, result: { ok: true, ipset_names, ipset_days } });
        }));

        // GET /ipset/entries/:set — list members of a specific set
        router.get('/ipset/entries/:set', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) return res.json({ success: true, result: { ok: false, entries: [], error: 'Plugin désactivé' } });
            const setName = String(req.params.set).replace(/[^a-zA-Z0-9_.-]/g, '');
            if (!setName) return res.json({ success: true, result: { ok: false, entries: [], error: 'Nom de set invalide' } });
            const r = await this.client?.ipsetEntries(setName) ?? { ok: false, entries: [], error: 'client not initialized' };
            res.json({ success: true, result: r });
        }));

        // POST /ipset/del  { set: string, entry: string }
        router.post('/ipset/del', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) return res.json({ success: true, result: { ok: false, error: 'Plugin désactivé' } });
            const { set, entry } = req.body as { set?: string; entry?: string };
            if (!set || !entry) return res.json({ success: true, result: { ok: false, error: 'Paramètres manquants' } });
            const safeSet   = set.replace(/[^a-zA-Z0-9_.-]/g, '');
            const safeEntry = entry.replace(/[^0-9a-fA-F.:\/]/g, '');
            if (!safeSet || !safeEntry) return res.json({ success: true, result: { ok: false, error: 'Valeurs invalides' } });
            const r = await this.client?.ipsetDel(safeSet, safeEntry) ?? { ok: false, output: '', error: 'client not initialized' };
            res.json({ success: true, result: r });
        }));

        // GET /dns/batch?ips=1.2.3.4,5.6.7.8 — reverse DNS pour une liste d'IPs (max 50)
        router.get('/dns/batch', requireAuth, asyncHandler(async (req, res) => {
            const raw = (req.query.ips as string) ?? '';
            const ips = raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 50);
            if (!ips.length) return res.json({ success: true, result: {} });
            const resolved = await Promise.all(ips.map(ip => reverseDns(ip).then(h => [ip, h ?? ''] as [string, string])));
            const result: Record<string, string> = {};
            for (const [ip, h] of resolved) result[ip] = h;
            res.json({ success: true, result });
        }));

        router.get('/nftables', requireAuth, asyncHandler(async (_req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const r = await this.client?.nftList() ?? { ok: false, output: '', error: 'client not initialized' };
            res.json({ success: true, result: r });
        }));

        // GET /logs — fichiers fail2ban* sous /var/log (monté host en Docker)
        router.get('/logs', requireAuth, asyncHandler(async (_req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const dir = this.resolveDockerPathSync('/var/log');
            try {
                const files = fs.readdirSync(dir)
                    .filter(f => FAIL2BAN_LOG_NAME.test(f))
                    .flatMap(f => {
                        try {
                            const st = fs.statSync(path.join(dir, f));
                            if (!st.isFile()) return [];
                            return [{ name: f, mtime: st.mtimeMs, size: st.size }];
                        } catch { return []; }
                    })
                    .sort((a, b) => {
                        if (a.name === 'fail2ban.log') return -1;
                        if (b.name === 'fail2ban.log') return 1;
                        return a.name.localeCompare(b.name, undefined, { numeric: true });
                    });
                res.json({ success: true, result: { ok: true, dir: '/var/log', files } });
            } catch (e) {
                res.json({
                    success: true,
                    result: { ok: false, dir: '/var/log', files: [], error: e instanceof Error ? e.message : String(e) },
                });
            }
        }));

        // GET /logs/tail?name=fail2ban.log&lines=400 — dernières lignes (lecture seule)
        router.get('/logs/tail', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const name = String(req.query.name ?? '');
            if (!FAIL2BAN_LOG_NAME.test(name)) {
                throw createError('Invalid log file name', 400, 'BAD_PARAM');
            }
            const lines = Math.min(Math.max(parseInt(String(req.query.lines ?? '400'), 10) || 400, 1), 5000);
            const abs = this.resolveDockerPathSync(path.join('/var/log', name));
            const logRoot = this.resolveDockerPathSync('/var/log');
            if (!abs.startsWith(logRoot)) {
                throw createError('Invalid path', 400, 'BAD_PARAM');
            }
            try {
                fs.accessSync(abs, fs.constants.R_OK);
            } catch {
                throw createError(`Cannot read ${name}`, 404, 'NOT_FOUND');
            }
            const { content, truncated, bytes } = readLogTail(abs, lines);
            res.json({ success: true, result: { ok: true, name, lines, bytes, truncated, content } });
        }));

        // ── GET /db-export ────────────────────────────────────────────────────────────
        // Exports only the f2b_* tables from the app database as a downloadable JSON file.
        // General app tables (users, logs, plugin_configs, …) are never included.
        router.get('/db-export', requireAuth, asyncHandler(async (_req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const db = getDatabase();
            const F2B_TABLES = [
                'f2b_events', 'f2b_sync_state', 'f2b_jail_domain',
                'f2b_ipset_snapshots', 'f2b_ip_geo', 'f2b_whois_cache',
            ];
            const tables: Record<string, unknown[]> = {};
            const counts: Record<string, number>    = {};
            for (const t of F2B_TABLES) {
                const rows = db.prepare(`SELECT * FROM ${t}`).all();
                tables[t] = rows;
                counts[t] = rows.length;
            }
            const payload = { version: 1, type: 'f2b_db_export', exported_at: new Date().toISOString(), counts, tables };
            const json = JSON.stringify(payload, null, 2);
            const pad = (n: number) => String(n).padStart(2, '0');
            const d = new Date();
            const stamp = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="f2b-db-${stamp}.json"`);
            res.send(json);
        }));

        // ── POST /db-import ───────────────────────────────────────────────────────────
        // Imports f2b_* tables from a previously exported JSON.
        // mode=merge (default): INSERT OR REPLACE — keeps rows not in the file.
        // mode=replace: DELETE all rows first, then INSERT — full restore.
        router.post('/db-import', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const { data, mode = 'merge' } = req.body as { data: unknown; mode?: string };
            if (!data || typeof data !== 'object') throw createError('Invalid payload', 400, 'INVALID_PAYLOAD');
            const payload = data as { version?: number; type?: string; tables?: Record<string, unknown[]> };
            if (payload.version !== 1 || payload.type !== 'f2b_db_export') {
                throw createError('Invalid export file — wrong type or version', 400, 'INVALID_FILE');
            }
            const F2B_TABLES = [
                'f2b_events', 'f2b_sync_state', 'f2b_jail_domain',
                'f2b_ipset_snapshots', 'f2b_ip_geo', 'f2b_whois_cache',
            ];
            const db = getDatabase();
            const inserted: Record<string, number> = {};
            const skipped: string[] = [];

            db.transaction(() => {
                for (const t of F2B_TABLES) {
                    const rows = payload.tables?.[t];
                    if (!rows || !Array.isArray(rows) || rows.length === 0) { skipped.push(t); continue; }
                    if (mode === 'replace') db.prepare(`DELETE FROM ${t}`).run();
                    const cols = Object.keys(rows[0] as object);
                    const placeholders = cols.map(() => '?').join(', ');
                    const stmt = db.prepare(`INSERT OR REPLACE INTO ${t} (${cols.join(', ')}) VALUES (${placeholders})`);
                    let count = 0;
                    for (const row of rows) {
                        stmt.run(cols.map(c => (row as Record<string, unknown>)[c]));
                        count++;
                    }
                    inserted[t] = count;
                }
            })();

            res.json({ success: true, result: { ok: true, mode, inserted, skipped } });
        }));

        // ── Config snapshot helpers ───────────────────────────────────────────────────
        const CFG_SNAP_DIR  = path.join(process.cwd(), 'data', 'f2b-config-backups');
        const CFG_SNAP_MAX  = 10;
        const DB_SNAP_DIR   = path.join(process.cwd(), 'data', 'f2b-db-backups');
        const DB_SNAP_MAX   = 5;
        const F2B_TABLES    = ['f2b_events', 'f2b_sync_state', 'f2b_jail_domain', 'f2b_ipset_snapshots', 'f2b_ip_geo', 'f2b_whois_cache'];

        function pruneDir(dir: string, maxFiles: number, ext: string): void {
            try {
                const entries = fs.readdirSync(dir).filter(f => f.endsWith(ext))
                    .map(f => ({ f, ts: fs.statSync(path.join(dir, f)).mtimeMs }))
                    .sort((a, b) => a.ts - b.ts);
                while (entries.length >= maxFiles) fs.unlinkSync(path.join(dir, entries.shift()!.f));
            } catch { /* ignore */ }
        }

        function listSnapshots(dir: string, ext: string) {
            try {
                fs.mkdirSync(dir, { recursive: true });
                return fs.readdirSync(dir).filter(f => f.endsWith(ext))
                    .map(f => { const st = fs.statSync(path.join(dir, f)); return { filename: f, size: st.size, ts: Math.floor(st.mtimeMs) }; })
                    .sort((a, b) => b.ts - a.ts).slice(0, 50);
            } catch { return []; }
        }

        function snapshotPad(n: number) { return String(n).padStart(2, '0'); }
        function snapshotStamp() {
            const d = new Date();
            return `${d.getFullYear()}-${snapshotPad(d.getMonth()+1)}-${snapshotPad(d.getDate())}_${snapshotPad(d.getHours())}${snapshotPad(d.getMinutes())}${snapshotPad(d.getSeconds())}`;
        }

        // ── GET /backup/snapshots — list local config snapshots ───────────────────────
        router.get('/backup/snapshots', requireAuth, asyncHandler(async (_req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            res.json({ success: true, result: { ok: true, snapshots: listSnapshots(CFG_SNAP_DIR, '.json') } });
        }));

        // ── POST /backup/snapshot — create a local config snapshot ────────────────────
        router.post('/backup/snapshot', requireAuth, asyncHandler(async (_req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const payload = await this.buildConfigBackupPayload();
            const json = JSON.stringify(payload, null, 2);
            fs.mkdirSync(CFG_SNAP_DIR, { recursive: true });
            pruneDir(CFG_SNAP_DIR, CFG_SNAP_MAX, '.json');
            const filename = `f2b-config-${snapshotStamp()}.json`;
            fs.writeFileSync(path.join(CFG_SNAP_DIR, filename), json, 'utf8');
            res.json({ success: true, result: { ok: true, filename } });
        }));

        // ── GET /backup/snapshot/:filename/download — download a stored config snapshot
        router.get('/backup/snapshot/:filename/download', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const safe = path.basename(req.params.filename);
            if (!safe.endsWith('.json') || !safe.startsWith('f2b-config-')) throw createError('Invalid filename', 400, 'INVALID_FILENAME');
            const fullPath = path.join(CFG_SNAP_DIR, safe);
            if (!fullPath.startsWith(CFG_SNAP_DIR + path.sep)) throw createError('Invalid path', 400, 'INVALID_PATH');
            try { fs.accessSync(fullPath, fs.constants.R_OK); } catch { throw createError('File not found', 404, 'NOT_FOUND'); }
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
            res.sendFile(fullPath);
        }));

        // ── POST /backup/snapshot/:filename/restore — restore from stored config snapshot
        router.post('/backup/snapshot/:filename/restore', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const safe = path.basename(req.params.filename);
            if (!safe.endsWith('.json') || !safe.startsWith('f2b-config-')) throw createError('Invalid filename', 400, 'INVALID_FILENAME');
            const fullPath = path.join(CFG_SNAP_DIR, safe);
            if (!fullPath.startsWith(CFG_SNAP_DIR + path.sep)) throw createError('Invalid path', 400, 'INVALID_PATH');
            let content: string;
            try { content = fs.readFileSync(fullPath, 'utf8'); } catch { throw createError('File not found', 404, 'NOT_FOUND'); }
            // Re-use existing restore logic by forwarding the parsed body
            req.body = JSON.parse(content);
            const doReload = req.query['reload'] === '1';
            const body = req.body as Record<string, unknown>;
            if (body?.type !== 'f2b_full_backup' || body?.version !== 1) {
                throw createError('Invalid snapshot file', 400, 'INVALID_FILE');
            }
            const files = body.files as Record<string, string> | undefined;
            if (!files) throw createError('Missing files map', 400, 'INVALID_FILE');
            const confBase = this.resolveDockerPathSync('/etc/fail2ban');
            const written: string[] = []; const skipped: string[] = []; const errors: string[] = [];
            for (const [key, fileContent] of Object.entries(files)) {
                if (key.includes('..')) { errors.push(`${key}: path traversal rejected`); continue; }
                if (typeof fileContent !== 'string') { errors.push(`${key}: not a string`); continue; }
                if (!key.endsWith('.local')) { skipped.push(key); continue; }
                if (!key.startsWith('/etc/fail2ban/')) { skipped.push(key); continue; }
                const rel = key.replace(/^\/etc\/fail2ban\//, '');
                const resolved = path.join(confBase, rel);
                if (!resolved.startsWith(confBase + path.sep) && resolved !== confBase) { errors.push(`${key}: outside confBase`); continue; }
                try {
                    fs.mkdirSync(path.dirname(resolved), { recursive: true });
                    fs.writeFileSync(resolved, fileContent, 'utf8');
                    written.push(key);
                } catch (e: unknown) { errors.push(`${key}: ${e instanceof Error ? e.message : String(e)}`); }
            }
            let reloadOk: boolean | undefined; let reloadOut: string | undefined;
            if (doReload) {
                try { const r = await this.client.reload(); reloadOk = r.ok; reloadOut = r.output; } catch { reloadOk = false; }
            }
            res.json({ success: true, result: { ok: errors.length === 0, written, skipped, errors, reloadOk, reloadOut } });
        }));

        // ── DELETE /backup/snapshot/:filename — delete a stored config snapshot ────────
        router.delete('/backup/snapshot/:filename', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const safe = path.basename(req.params.filename);
            if (!safe.endsWith('.json') || !safe.startsWith('f2b-config-')) throw createError('Invalid filename', 400, 'INVALID_FILENAME');
            const fullPath = path.join(CFG_SNAP_DIR, safe);
            if (!fullPath.startsWith(CFG_SNAP_DIR + path.sep)) throw createError('Invalid path', 400, 'INVALID_PATH');
            try { fs.unlinkSync(fullPath); } catch { throw createError('File not found', 404, 'NOT_FOUND'); }
            res.json({ success: true, result: { ok: true } });
        }));

        // ── GET /db-snapshots — list local DB snapshots ───────────────────────────────
        router.get('/db-snapshots', requireAuth, asyncHandler(async (_req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            res.json({ success: true, result: { ok: true, snapshots: listSnapshots(DB_SNAP_DIR, '.json') } });
        }));

        // ── POST /db-snapshot — create a local DB snapshot ───────────────────────────
        router.post('/db-snapshot', requireAuth, asyncHandler(async (_req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const db = getDatabase();
            const tables: Record<string, unknown[]> = {};
            const counts: Record<string, number>    = {};
            for (const t of F2B_TABLES) {
                const rows = db.prepare(`SELECT * FROM ${t}`).all();
                tables[t] = rows; counts[t] = rows.length;
            }
            const payload = { version: 1, type: 'f2b_db_export', exported_at: new Date().toISOString(), counts, tables };
            const json = JSON.stringify(payload, null, 2);
            fs.mkdirSync(DB_SNAP_DIR, { recursive: true });
            pruneDir(DB_SNAP_DIR, DB_SNAP_MAX, '.json');
            const filename = `f2b-db-${snapshotStamp()}.json`;
            fs.writeFileSync(path.join(DB_SNAP_DIR, filename), json, 'utf8');
            res.json({ success: true, result: { ok: true, filename, counts } });
        }));

        // ── GET /db-snapshot/:filename/download — download a stored DB snapshot ───────
        router.get('/db-snapshot/:filename/download', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const safe = path.basename(req.params.filename);
            if (!safe.endsWith('.json') || !safe.startsWith('f2b-db-')) throw createError('Invalid filename', 400, 'INVALID_FILENAME');
            const fullPath = path.join(DB_SNAP_DIR, safe);
            if (!fullPath.startsWith(DB_SNAP_DIR + path.sep)) throw createError('Invalid path', 400, 'INVALID_PATH');
            try { fs.accessSync(fullPath, fs.constants.R_OK); } catch { throw createError('File not found', 404, 'NOT_FOUND'); }
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
            res.sendFile(fullPath);
        }));

        // ── POST /db-snapshot/:filename/restore — restore from a stored DB snapshot ────
        router.post('/db-snapshot/:filename/restore', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const safe = path.basename(req.params.filename);
            if (!safe.endsWith('.json') || !safe.startsWith('f2b-db-')) throw createError('Invalid filename', 400, 'INVALID_FILENAME');
            const fullPath = path.join(DB_SNAP_DIR, safe);
            if (!fullPath.startsWith(DB_SNAP_DIR + path.sep)) throw createError('Invalid path', 400, 'INVALID_PATH');
            let content: string;
            try { content = fs.readFileSync(fullPath, 'utf8'); } catch { throw createError('File not found', 404, 'NOT_FOUND'); }
            const payload = JSON.parse(content) as { version?: number; type?: string; tables?: Record<string, unknown[]> };
            if (payload.version !== 1 || payload.type !== 'f2b_db_export') throw createError('Invalid snapshot file', 400, 'INVALID_FILE');
            const mode = (req.query['mode'] as string) ?? 'merge';
            const db = getDatabase();
            const inserted: Record<string, number> = {}; const skipped: string[] = [];
            db.transaction(() => {
                for (const t of F2B_TABLES) {
                    const rows = payload.tables?.[t];
                    if (!rows || !Array.isArray(rows) || rows.length === 0) { skipped.push(t); continue; }
                    if (mode === 'replace') db.prepare(`DELETE FROM ${t}`).run();
                    const cols = Object.keys(rows[0] as object);
                    const stmt = db.prepare(`INSERT OR REPLACE INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
                    let count = 0;
                    for (const row of rows) { stmt.run(cols.map(c => (row as Record<string, unknown>)[c])); count++; }
                    inserted[t] = count;
                }
            })();
            res.json({ success: true, result: { ok: true, mode, inserted, skipped } });
        }));

        // ── DELETE /db-snapshot/:filename — delete a stored DB snapshot ───────────────
        router.delete('/db-snapshot/:filename', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const safe = path.basename(req.params.filename);
            if (!safe.endsWith('.json') || !safe.startsWith('f2b-db-')) throw createError('Invalid filename', 400, 'INVALID_FILENAME');
            const fullPath = path.join(DB_SNAP_DIR, safe);
            if (!fullPath.startsWith(DB_SNAP_DIR + path.sep)) throw createError('Invalid path', 400, 'INVALID_PATH');
            try { fs.unlinkSync(fullPath); } catch { throw createError('File not found', 404, 'NOT_FOUND'); }
            res.json({ success: true, result: { ok: true } });
        }));

        // ── GET /backup/full ──────────────────────────────────────────────────────────
        router.get('/backup/full', requireAuth, asyncHandler(async (_req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const payload = await this.buildConfigBackupPayload();
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', 'attachment');
            res.json(payload);
        }));

        // ── POST /backup/restore ──────────────────────────────────────────────────────
        router.post('/backup/restore', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const body = req.body as Record<string, unknown>;

            // Validate backup envelope
            if (body?.type !== 'f2b_full_backup' || body?.version !== 1) {
                res.status(400).json({ success: false, error: 'Invalid backup: type or version mismatch' });
                return;
            }

            const files = body.files as Record<string, string> | undefined;
            if (!files || typeof files !== 'object') {
                res.status(400).json({ success: false, error: 'Invalid backup: missing files map' });
                return;
            }

            const doReload = req.query['reload'] === '1';
            const confBase = this.resolveDockerPathSync('/etc/fail2ban');

            const written: string[] = [];
            const skipped: string[] = [];
            const errors: string[] = [];

            for (const [key, content] of Object.entries(files)) {
                // Security layer 1: no path traversal
                if (key.includes('..')) {
                    errors.push(`${key}: path traversal rejected`);
                    continue;
                }

                // Validate content is a string
                if (typeof content !== 'string') {
                    errors.push(`${key}: content is not a string, skipped`);
                    continue;
                }

                // Only restore .local files
                if (!key.endsWith('.local')) {
                    skipped.push(key);
                    continue;
                }

                // Keys must be under /etc/fail2ban/
                if (!key.startsWith('/etc/fail2ban/')) {
                    skipped.push(key);
                    continue;
                }

                // Derive the relative path under /etc/fail2ban/
                const rel = key.replace(/^\/etc\/fail2ban\//, '');
                const resolved = path.join(confBase, rel);

                // Security layer 2: resolved path must stay within confBase
                if (!resolved.startsWith(confBase + path.sep) && resolved !== confBase) {
                    errors.push(`${key}: outside confBase, rejected`);
                    continue;
                }

                try {
                    const dir = path.dirname(resolved);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(resolved, content, 'utf8');
                    written.push(key);
                } catch (err: unknown) {
                    errors.push(`${key}: ${err instanceof Error ? err.message : String(err)}`);
                }
            }

            // ok = true if no write errors (reload failure does not affect ok)
            const ok = errors.length === 0;

            let reloadOk: boolean | undefined;
            let reloadOut: string | undefined;

            if (doReload) {
                try {
                    const result = await this.client.reload();
                    reloadOk = result.ok;
                    reloadOut = result.output || result.error;
                } catch (err: unknown) {
                    reloadOk = false;
                    reloadOut = err instanceof Error ? err.message : String(err);
                }
            }

            res.json({ success: true, result: { ok, written, skipped, errors, ...(doReload ? { reloadOk, reloadOut } : {}) } });
        }));

        // POST /config/maintenance/reset  — wipe f2b_events, f2b_ip_geo, reset sync state
        router.post('/config/maintenance/reset', requireAuth, asyncHandler(async (_req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const appDb = getDatabase();
            appDb.prepare('DELETE FROM f2b_events').run();
            appDb.prepare('DELETE FROM f2b_ip_geo').run();
            appDb.prepare('UPDATE f2b_sync_state SET last_rowid = 0, last_sync_at = NULL WHERE id = 1').run();
            res.json({ success: true, result: { ok: true } });
        }));

        // ── IPTables extended routes ─────────────────────────────────────────

        // GET /iptables/tables — list table names from iptables-save output
        router.get('/iptables/tables', requireAuth, asyncHandler(async (_req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const r = await IptablesService.save();
            if (!r.ok) return res.json({ success: true, result: { ok: false, tables: [], error: r.error } });
            const tables = IptablesService.parseTables(r.output);
            res.json({ success: true, result: { ok: true, tables } });
        }));

        // GET /iptables/rules?table=filter — full iptables-save (or filtered by table)
        router.get('/iptables/rules', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const r = await IptablesService.save();
            if (!r.ok) return res.json({ success: true, result: { ok: false, output: '', error: r.error } });
            const table = typeof req.query.table === 'string' ? req.query.table : '';
            if (!table) return res.json({ success: true, result: { ok: true, output: r.output } });
            // Filter to just the requested table section
            const lines = r.output.split('\n');
            const out: string[] = [];
            let inTable = false;
            for (const line of lines) {
                if (line === `*${table}`) { inTable = true; }
                if (inTable) { out.push(line); if (line === 'COMMIT') break; }
            }
            res.json({ success: true, result: { ok: true, output: out.join('\n') } });
        }));

        // GET /iptables/parsed?table=filter — structured chains from iptables -L -v -n --line-numbers
        router.get('/iptables/parsed', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const table = typeof req.query.table === 'string' ? req.query.table.replace(/[^a-z]/g, '') : 'filter';
            const r = await IptablesService.listParsed(table || 'filter');
            res.json({ success: true, result: r });
        }));

        // GET /iptables/backups — list available backups
        router.get('/iptables/backups', requireAuth, asyncHandler(async (_req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const backups = IptablesService.listBackups();
            res.json({ success: true, result: { ok: true, backups } });
        }));

        // POST /iptables/backup — create a backup
        router.post('/iptables/backup', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const label = typeof req.body?.label === 'string' ? req.body.label : undefined;
            const r = await IptablesService.saveBackup(label);
            res.json({ success: true, result: r });
        }));

        // POST /iptables/restore/:filename — restore from backup file
        router.post('/iptables/restore/:filename', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const { filename } = req.params;
            const r = await IptablesService.restoreFromFile(filename);
            res.json({ success: true, result: r });
        }));

        // DELETE /iptables/backup/:filename — delete a backup
        router.delete('/iptables/backup/:filename', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const { filename } = req.params;
            const r = IptablesService.deleteBackup(filename);
            res.json({ success: true, result: r });
        }));

        // GET /iptables/backup/:filename/download — download a backup file
        router.get('/iptables/backup/:filename/download', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const safe = path.basename(req.params.filename);
            if (!safe.endsWith('.rules')) throw createError('Invalid filename', 400, 'INVALID_FILENAME');
            const fullPath = path.join(process.cwd(), 'data', 'iptables-backups', safe);
            if (!fullPath.startsWith(path.join(process.cwd(), 'data', 'iptables-backups') + path.sep)) {
                throw createError('Invalid path', 400, 'INVALID_PATH');
            }
            try { fs.accessSync(fullPath, fs.constants.R_OK); } catch { throw createError('File not found', 404, 'NOT_FOUND'); }
            res.setHeader('Content-Type', 'text/plain');
            res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
            res.sendFile(fullPath);
        }));

        // GET /ipset/backups — list available ipset backups
        router.get('/ipset/backups', requireAuth, asyncHandler(async (_req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const backups = IptablesService.listIpsetBackups();
            res.json({ success: true, result: { ok: true, backups } });
        }));

        // POST /ipset/backup — create an ipset backup
        router.post('/ipset/backup', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const label = typeof req.body?.label === 'string' ? req.body.label : undefined;
            const r = await IptablesService.saveIpsetBackup(label);
            res.json({ success: true, result: r });
        }));

        // POST /ipset/restore/:filename — restore ipset from backup file
        router.post('/ipset/restore/:filename', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const { filename } = req.params;
            const r = await IptablesService.restoreIpsetFromFile(filename);
            res.json({ success: true, result: r });
        }));

        // DELETE /ipset/backup/:filename — delete an ipset backup
        router.delete('/ipset/backup/:filename', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const { filename } = req.params;
            const r = IptablesService.deleteIpsetBackup(filename);
            res.json({ success: true, result: r });
        }));

        // GET /ipset/backup/:filename/download — download an ipset backup file
        router.get('/ipset/backup/:filename/download', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const safe = path.basename(req.params.filename);
            if (!safe.endsWith('.ipset')) throw createError('Invalid filename', 400, 'INVALID_FILENAME');
            const fullPath = path.join(process.cwd(), 'data', 'iptables-backups', safe);
            if (!fullPath.startsWith(path.join(process.cwd(), 'data', 'iptables-backups') + path.sep)) {
                throw createError('Invalid path', 400, 'INVALID_PATH');
            }
            try { fs.accessSync(fullPath, fs.constants.R_OK); } catch { throw createError('File not found', 404, 'NOT_FOUND'); }
            res.setHeader('Content-Type', 'text/plain');
            res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
            res.sendFile(fullPath);
        }));

        // POST /iptables/rule/add — add a rule (starts rollback timer)
        router.post('/iptables/rule/add', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const { table, chain, rule } = req.body ?? {};
            if (!table || !chain || !rule) return res.json({ success: true, result: { ok: false, error: 'table, chain, rule requis' } });
            // Parse rule string into args (simple split — no shell expansion)
            const ruleArgs = String(rule).trim().split(/\s+/).filter(Boolean);
            // Take snapshot before mutation
            const snap = await IptablesService.save();
            if (!snap.ok) return res.json({ success: true, result: { ok: false, error: `Snapshot impossible: ${snap.error}` } });
            const r = await IptablesService.addRule(String(table), String(chain), ruleArgs);
            if (!r.ok) return res.json({ success: true, result: r });
            this._startRollback(snap.output, 30);
            res.json({ success: true, result: { ...r, rollbackDeadline: this.ipt_rollbackDeadline } });
        }));

        // POST /iptables/rule/delete — delete rule by number (starts rollback timer)
        router.post('/iptables/rule/delete', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const { table, chain, rulenum } = req.body ?? {};
            if (!table || !chain || !rulenum) return res.json({ success: true, result: { ok: false, error: 'table, chain, rulenum requis' } });
            const snap = await IptablesService.save();
            if (!snap.ok) return res.json({ success: true, result: { ok: false, error: `Snapshot impossible: ${snap.error}` } });
            const r = await IptablesService.deleteRule(String(table), String(chain), parseInt(String(rulenum), 10));
            if (!r.ok) return res.json({ success: true, result: r });
            this._startRollback(snap.output, 30);
            res.json({ success: true, result: { ...r, rollbackDeadline: this.ipt_rollbackDeadline } });
        }));

        // POST /iptables/ip/ban — insert DROP rule for an IP at top of chain
        router.post('/iptables/ip/ban', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const { table = 'filter', chain = 'INPUT', ip } = req.body ?? {};
            if (!ip) return res.json({ success: true, result: { ok: false, error: 'ip requis' } });
            if (!/^[\d./]+$/.test(String(ip)) && !/^[0-9a-fA-F:]+$/.test(String(ip)))
                return res.json({ success: true, result: { ok: false, error: 'IP invalide' } });
            const snap = await IptablesService.save();
            if (!snap.ok) return res.json({ success: true, result: { ok: false, error: `Snapshot impossible: ${snap.error}` } });
            const r = await IptablesService.insertRule(String(table), String(chain), 1, ['-s', String(ip), '-j', 'DROP']);
            if (!r.ok) return res.json({ success: true, result: r });
            this._startRollback(snap.output, 30);
            res.json({ success: true, result: { ...r, rollbackDeadline: this.ipt_rollbackDeadline } });
        }));

        // POST /iptables/ip/unban — delete DROP rule for an IP from chain
        router.post('/iptables/ip/unban', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const { table = 'filter', chain = 'INPUT', ip } = req.body ?? {};
            if (!ip) return res.json({ success: true, result: { ok: false, error: 'ip requis' } });
            if (!/^[\d./]+$/.test(String(ip)) && !/^[0-9a-fA-F:]+$/.test(String(ip)))
                return res.json({ success: true, result: { ok: false, error: 'IP invalide' } });
            const snap = await IptablesService.save();
            if (!snap.ok) return res.json({ success: true, result: { ok: false, error: `Snapshot impossible: ${snap.error}` } });
            const r = await IptablesService.deleteRuleSpec(String(table), String(chain), ['-s', String(ip), '-j', 'DROP']);
            if (!r.ok) return res.json({ success: true, result: r });
            this._startRollback(snap.output, 30);
            res.json({ success: true, result: { ...r, rollbackDeadline: this.ipt_rollbackDeadline } });
        }));

        // GET /iptables/rollback/status — is a rollback pending?
        router.get('/iptables/rollback/status', requireAuth, asyncHandler(async (_req, res) => {
            const pending = this.ipt_rollbackTimer !== null;
            res.json({ success: true, result: { ok: true, pending, deadline: this.ipt_rollbackDeadline } });
        }));

        // POST /iptables/rollback/confirm — confirm changes (cancel rollback timer)
        router.post('/iptables/rollback/confirm', requireAuth, asyncHandler(async (_req, res) => {
            this._cancelRollback();
            res.json({ success: true, result: { ok: true } });
        }));

        // POST /iptables/rollback/now — rollback immediately
        router.post('/iptables/rollback/now', requireAuth, asyncHandler(async (_req, res) => {
            if (!this.ipt_rollbackSnapshot) return res.json({ success: true, result: { ok: false, error: 'Aucun snapshot disponible' } });
            this._cancelRollback();
            const r = await IptablesService.restore(this.ipt_rollbackSnapshot);
            this.ipt_rollbackSnapshot = null;
            res.json({ success: true, result: r });
        }));

        return router;
    }

    // ── Rollback helpers ──────────────────────────────────────────────────────

    private _startRollback(snapshot: string, secs: number): void {
        this._cancelRollback();
        this.ipt_rollbackSnapshot = snapshot;
        this.ipt_rollbackDeadline = Date.now() + secs * 1000;
        this.ipt_rollbackTimer = setTimeout(async () => {
            logger.warn('[iptables]', 'Rollback automatique (délai expiré)');
            if (this.ipt_rollbackSnapshot) await IptablesService.restore(this.ipt_rollbackSnapshot);
            this.ipt_rollbackSnapshot = null;
            this.ipt_rollbackTimer   = null;
            this.ipt_rollbackDeadline = null;
        }, secs * 1000);
    }

    private _cancelRollback(): void {
        if (this.ipt_rollbackTimer) { clearTimeout(this.ipt_rollbackTimer); this.ipt_rollbackTimer = null; }
        this.ipt_rollbackDeadline = null;
    }

    /** Builds the full config backup payload (shared between /backup/full and /backup/snapshot). */
    private async buildConfigBackupPayload(): Promise<Record<string, unknown>> {
        const confBase = this.resolveDockerPathSync('/etc/fail2ban');
        try { fs.accessSync(confBase); } catch { throw createError('Config dir not accessible', 503, 'CONFIG_UNAVAILABLE'); }

        const ROOT_FILES = ['fail2ban.conf', 'fail2ban.local', 'jail.conf', 'jail.local', 'paths-common.conf', 'paths-debian.conf'];
        const SUB_DIRS   = ['jail.d', 'filter.d', 'action.d'];
        const files: Record<string, string> = {};

        for (const name of ROOT_FILES) {
            try { files[`/etc/fail2ban/${name}`] = fs.readFileSync(path.join(confBase, name), 'utf8'); } catch { /* skip */ }
        }
        for (const sub of SUB_DIRS) {
            try {
                for (const e of fs.readdirSync(path.join(confBase, sub), { withFileTypes: true })) {
                    if (!e.isFile()) continue;
                    try { files[`/etc/fail2ban/${sub}/${e.name}`] = fs.readFileSync(path.join(confBase, sub, e.name), 'utf8'); } catch { /* skip */ }
                }
            } catch { /* dir missing */ }
        }

        const runtime: Record<string, unknown> = { total_banned: 0, jails: {} };
        try {
            const jailNames = await this.client.listJails();
            let totalBanned = 0;
            const jailsMap: Record<string, unknown> = {};
            for (const jail of jailNames) {
                const st = await this.client.getJailStatus(jail);
                if (st) { totalBanned += st.currentlyBanned; jailsMap[jail] = { currently_banned: st.currentlyBanned, banned_ips: st.bannedIps }; }
            }
            runtime.total_banned = totalBanned;
            runtime.jails = jailsMap;
        } catch { /* best-effort */ }

        return { version: 1, type: 'f2b_full_backup', exported_at: new Date().toISOString(), exported_by: 'LogviewR', host: os.hostname(), files, runtime };
    }
}
