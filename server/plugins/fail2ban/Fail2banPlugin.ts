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
import { BasePlugin } from '../base/BasePlugin.js';
import type { PluginStats } from '../base/PluginInterface.js';
import { Fail2banSqliteReader } from './Fail2banSqliteReader.js';
import { Fail2banClientExec } from './Fail2banClientExec.js';
import { Fail2banSyncService } from '../../services/fail2banSyncService.js';
import { asyncHandler, createError } from '../../middleware/errorHandler.js';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { getDatabase } from '../../database/connection.js';
import * as dns from 'dns';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../utils/logger.js';

const DEFAULT_SQLITE_PATH = '/var/lib/fail2ban/fail2ban.sqlite3';
const SOCKET_PATH = '/var/run/fail2ban/fail2ban.sock';

/** Filenames only — no path traversal (matches fail2ban.log, fail2ban.log.1, etc.) */
const FAIL2BAN_LOG_NAME = /^fail2ban[a-zA-Z0-9._-]*\.log(\.\d+)?$/;

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
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/#.*$/, '').trim();
        if (!line) continue;
        const secMatch = line.match(/^\[([^\]]+)\]$/);
        if (secMatch) { section = secMatch[1].toLowerCase(); continue; }
        const kvMatch = line.match(/^([a-zA-Z0-9_\-]+)\s*=\s*(.*)$/);
        if (!kvMatch || !section) continue;
        const key = kvMatch[1].toLowerCase();
        const val = kvMatch[2].trim();
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

    return {
        loglevel:     merged.loglevel ?? defaults.loglevel,
        logtarget:    merged.logtarget ?? defaults.logtarget,
        socket:       merged.socket ?? defaults.socket,
        pidfile:      merged.pidfile ?? defaults.pidfile,
        dbfile:       merged.dbfile ?? defaults.dbfile,
        dbpurgeage:   merged.dbpurgeage ?? defaults.dbpurgeage,
        dbmaxmatches: merged.dbmaxmatches ?? defaults.dbmaxmatches,
        local_values: localVals,
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
    enabled: boolean;
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
        const socketOk = fs.existsSync(SOCKET_PATH);
        const dbOk = this.reader?.isReadable() ?? false;
        return socketOk || dbOk;
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

            // ── 3. fail2ban-client ping (daemon alive?) ───────────────────────
            // Use a fresh instance so the check works even when the plugin is not yet enabled.
            let daemonAlive = false;
            if (clientBinExists && socketExists && socketReadable && socketWritable) {
                try {
                    const tmpClient = new Fail2banClientExec();
                    daemonAlive = await tmpClient.ping();
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
                                : 'fail2ban-client ping échoue. Vérifiez que fail2ban tourne sur le host :\n  sudo systemctl status fail2ban'
                        : null,
                },
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

        // GET /api/plugins/fail2ban/status?days=1
        // Returns live jail status from fail2ban-client (or DB fallback), enriched with
        // jail config metadata + SQLite per-jail totals + bans in requested period.
        router.get('/status', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Fail2ban plugin not enabled', 503, 'PLUGIN_DISABLED');

            const rawDays = parseInt(String(req.query.days ?? '1'), 10);
            const days = Number.isNaN(rawDays) ? 1 : rawDays;

            // Jail config metadata (read-only file parse, no socket needed)
            const confBase = this.resolveDockerPathSync('/etc/fail2ban');
            const jailMeta = parseJailConfigs(confBase);

            // SQLite enrichment (period bans + all-time totals)
            const periodByJail = this.reader?.getBansInPeriodByJail(days) ?? {};
            const totalsByJail = this.reader?.getTotalsByJail() ?? {};

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
                const uniqueIpsTotal = this.reader?.getUniqueIpsTotal() ?? 0;
                const expiredLast24h = this.reader?.getExpiredBansInWindow(24) ?? 0;
                return res.json({ success: true, result: { ok: true, source: 'client', days, jails, inactiveJails, uniqueIpsTotal, expiredLast24h } });
            }

            // Fallback: SQLite
            const dbStats = this.reader?.getStats();
            if (dbStats?.readable) {
                const uniqueIpsTotal = this.reader?.getUniqueIpsTotal() ?? 0;
                const expiredLast24h = this.reader?.getExpiredBansInWindow(24) ?? 0;
                return res.json({ success: true, result: { ok: true, source: 'sqlite', days, ...dbStats, uniqueIpsTotal, expiredLast24h } });
            }

            return res.json({ success: true, result: { ok: false, source: 'none', error: 'No data source available' } });
        }));

        // GET /api/plugins/fail2ban/history?days=30
        router.get('/history', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Fail2ban plugin not enabled', 503, 'PLUGIN_DISABLED');
            const raw = parseInt(String(req.query.days ?? '30'), 10);
            // Frontend sends -1 for « Tous » → all-time aggregation in reader
            const days = Number.isNaN(raw) ? 30 : raw;
            const history = this.reader?.getBanHistory(days) ?? [];
            const { jailNames, data: byJail, granularity } = this.reader?.getBanHistoryByJail(days) ?? { jailNames: [], data: {}, granularity: 'day' as const };
            res.json({ success: true, result: { ok: true, days, history, byJail, jailNames, granularity } });
        }));

        // POST /api/plugins/fail2ban/ban   { jail, ip }
        router.post('/ban', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) return res.json({ success: true, result: { ok: false, error: 'Plugin fail2ban désactivé' } });
            if (!this.client?.isAvailable()) return res.json({ success: true, result: { ok: false, error: 'Socket fail2ban inaccessible (sudo chmod 660 /var/run/fail2ban/fail2ban.sock)' } });
            const { jail, ip } = req.body as { jail?: string; ip?: string };
            if (!jail || !ip) throw createError('jail and ip are required', 400, 'MISSING_PARAMS');
            const result = await this.client.banIp(jail, ip);
            res.json({ success: true, result });
        }));

        // POST /api/plugins/fail2ban/unban   { jail, ip }
        router.post('/unban', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) return res.json({ success: true, result: { ok: false, error: 'Plugin fail2ban désactivé' } });
            if (!this.client?.isAvailable()) return res.json({ success: true, result: { ok: false, error: 'Socket fail2ban inaccessible (sudo chmod 660 /var/run/fail2ban/fail2ban.sock)' } });
            const { jail, ip } = req.body as { jail?: string; ip?: string };
            if (!jail || !ip) throw createError('jail and ip are required', 400, 'MISSING_PARAMS');
            const result = await this.client.unbanIp(jail, ip);
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
            for (const f of ['fail2ban.conf', 'fail2ban.local', 'jail.conf', 'jail.local']) {
                try { result[f] = fs.readFileSync(this.resolveDockerPathSync(`/etc/fail2ban/${f}`), 'utf8'); }
                catch { result[f] = null; }
            }
            res.json({ success: true, result: { ok: true, files: result } });
        }));

        // GET /config/parsed  — parsed global config values + DB info
        router.get('/config/parsed', requireAuth, asyncHandler(async (_req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const confBase = this.resolveDockerPathSync('/etc/fail2ban');
            const cfg = parseGlobalConfig(confBase);

            // Version via fail2ban-client
            let version = '';
            try { version = await this.client.getVersion(); } catch {}

            // SQLite DB info
            const dbHostPath = this.resolveDockerPathSync(cfg.dbfile || '/var/lib/fail2ban/fail2ban.sqlite3');
            let dbInfo: { size: number; sizeFmt: string; readable: boolean; integrity: string; pageCount: number; freePages: number; fragPct: number } | null = null;
            try {
                const stat = fs.statSync(dbHostPath);
                const readable = (() => { try { fs.accessSync(dbHostPath, fs.constants.R_OK); return true; } catch { return false; } })();
                let integrity = 'unknown';
                let pageCount = 0;
                let freePages = 0;
                if (readable) {
                    const Database = (await import('better-sqlite3')).default;
                    const db = new Database(dbHostPath, { readonly: true, fileMustExist: true });
                    try {
                        integrity = (db.pragma('integrity_check', { simple: true }) as string) ?? 'unknown';
                        pageCount = (db.pragma('page_count', { simple: true }) as number) ?? 0;
                        freePages = (db.pragma('freelist_count', { simple: true }) as number) ?? 0;
                    } finally { db.close(); }
                }
                const fragPct = pageCount > 0 ? Math.round(freePages / pageCount * 100 * 10) / 10 : 0;
                const size = stat.size;
                const sizeFmt = size >= 1048576 ? `${(size / 1048576).toFixed(2)} Mo` : `${(size / 1024).toFixed(1)} Ko`;
                dbInfo = { size, sizeFmt, readable, integrity, pageCount, freePages, fragPct };
            } catch { /* db not found or not readable */ }

            // App DB (dashboard.db) info
            const appDbPath = path.join(process.cwd(), 'data', 'dashboard.db');
            let appDbInfo: { size: number; sizeFmt: string; exists: boolean } = { size: 0, sizeFmt: '0 Ko', exists: false };
            try {
                const stat = fs.statSync(appDbPath);
                const size = stat.size;
                appDbInfo = { size, sizeFmt: size >= 1048576 ? `${(size / 1048576).toFixed(2)} Mo` : `${(size / 1024).toFixed(1)} Ko`, exists: true };
            } catch {}

            // Internal DB stats (f2b_events synced from fail2ban.sqlite3)
            let internalDbStats = null;
            try { internalDbStats = Fail2banSyncService.getInternalStats(); } catch {}

            res.json({ success: true, result: { ok: true, cfg, version, dbInfo, dbHostPath, appDbInfo, internalDbStats } });
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

        // POST /config/service  — reload or restart fail2ban service
        router.post('/config/service', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const { action } = req.body as { action: 'reload' | 'restart' };
            if (action !== 'reload' && action !== 'restart') throw createError('Invalid action', 400, 'BAD_PARAM');
            const r = action === 'reload' ? await this.client.reload() : await this.client.restart();
            res.json({ success: true, result: r });
        }));

        // GET /tracker  — IPs bannies actuelles (SQLite) enriched with per-IP stats
        // Supports ?days=N to scope bans/failures stats to period (default: all time)
        router.get('/tracker', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const limit = Math.min(parseInt(String(req.query.limit ?? '500'), 10), 2000);
            const days  = parseInt(String(req.query.days ?? '-1'), 10);
            const stats = this.reader?.getStats();
            if (!stats?.readable) return res.json({ success: true, result: { ok: false, ips: [], error: 'SQLite not readable' } });
            const map = new Map<string, string[]>();
            for (const [jail, data] of Object.entries(stats.jails)) {
                for (const ip of data.bannedIps) {
                    if (!map.has(ip)) map.set(ip, []);
                    map.get(ip)!.push(jail);
                }
            }
            const ipStats = this.reader?.getIpStats(days) ?? {};
            const baseIps = Array.from(map.entries()).map(([ip, jails]) => {
                const s = ipStats[ip];
                return { ip, jails, bans: s?.bans, lastSeen: s?.lastSeen, failures: s?.failures };
            }).slice(0, limit);

            // Parallel: ipset membership + DNS reverse lookup
            const [ipsetMap, hostnames] = await Promise.all([
                this.client?.ipsetList().then(r => r.ok ? parseIpsetMembership(r.output) : new Map<string, string[]>())
                    .catch(() => new Map<string, string[]>()),
                Promise.all(baseIps.map(e => reverseDns(e.ip))),
            ]);

            const ips = baseIps.map((e, i) => ({
                ...e,
                hostname: hostnames[i] ?? undefined,
                ipsets:   ipsetMap.get(e.ip)?.filter(s => !s.startsWith('docker-')) ?? [],
            }));

            res.json({ success: true, result: { ok: true, total: ips.length, ips } });
        }));

        // GET /map  — currently banned IPs + cached geo (for map tab)
        router.get('/map', requireAuth, asyncHandler(async (_req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const stats = this.reader?.getStats();
            if (!stats?.readable) {
                return res.json({ success: true, result: { ok: false, points: [], error: 'SQLite not readable' } });
            }
            // Build ip → jails map from currently banned
            const ipJails = new Map<string, string[]>();
            for (const [jail, data] of Object.entries(stats.jails)) {
                for (const ip of data.bannedIps) {
                    if (!ipJails.has(ip)) ipJails.set(ip, []);
                    ipJails.get(ip)!.push(jail);
                }
            }
            // Fetch cached geo (TTL 30 days)
            const TTL = 30 * 86400;
            const now = Math.floor(Date.now() / 1000);
            const appDb = getDatabase();
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
            res.json({ success: true, result: { ok: true, points, resolveDelayMs: 380, cacheTtlDays: 30 } });
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

        // GET /tops  — Top IPs, Jails, Récidivistes + heatmap
        router.get('/tops', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const days  = parseInt(String(req.query.days  ?? '30'), 10);
            const limit = Math.min(parseInt(String(req.query.limit ?? '10'), 10), 100);
            if (!this.reader?.isReadable()) {
                return res.json({ success: true, result: { ok: false, error: 'SQLite not readable' } });
            }
            const topIps         = this.reader.getTopIps(days, limit);
            const topJails       = this.reader.getTopJails(days, limit);
            const topRecidivists = this.reader.getTopIps(days, 100).filter(r => r.count >= 2).slice(0, limit);
            const heatmap        = this.reader.getHeatmap(days);
            const heatmapFailed  = this.reader.getFailuresHeatmap(days);
            const summary        = this.reader.getPeriodSummary(days);
            res.json({ success: true, result: { ok: true, topIps, topJails, topRecidivists, heatmap, heatmapFailed, summary } });
        }));

        // GET /audit  — historique bans (fail2ban SQLite) + enrichissements jail/IP
        router.get('/audit', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
            const limit     = Math.min(parseInt(String(req.query.limit ?? '200'), 10), 1000);
            const jailFilter = req.query.jail ? String(req.query.jail) : null;
            const stats     = this.reader?.getStats();
            let bans        = stats?.recentBans?.slice(0, limit) ?? [];
            if (jailFilter) bans = bans.filter((b: { jail: string }) => b.jail === jailFilter);

            // ── Enrichissements ──────────────────────────────────────────────
            const confBase  = this.resolveDockerPathSync('/etc/fail2ban');
            const jailMeta  = parseJailConfigs(confBase);

            // jail_actions + jail_logs + jail_servers (déduit du logpath / nom jail)
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
            for (const [jailName, meta] of Object.entries(jailMeta)) {
                if (meta.banaction) jail_actions[jailName] = meta.banaction;
                if (meta.logpath)   jail_logs[jailName]    = meta.logpath;
                const srv = detectServer(jailName, meta.logpath ?? '');
                if (srv) jail_servers[jailName] = srv;
            }

            // ip_domains: domain of the targeted site (extracted from jail log filename, like PHP fail2ban-web)
            // e.g. /var/log/nginx/example.com_access.log → "example.com"
            const domainFromLogpath = (logpath: string): string => {
                const fname = logpath.replace(/.*\//, '');
                const stripped = fname
                    .replace(/[._-]?(ssl_access|ssl_error|other_vhosts_access|access|error)\.log$/i, '')
                    .replace(/\.log$/i, '');
                return /^[a-zA-Z0-9][a-zA-Z0-9._-]+\.[a-zA-Z]{2,}$/.test(stripped) ? stripped.toLowerCase() : '';
            };
            const ip_domains: Record<string, string> = {};
            for (const ban of bans as { ip: string; jail: string }[]) {
                if (ip_domains[ban.ip]) continue;
                const lp = jail_logs[ban.jail] ?? '';
                const dom = lp ? domainFromLogpath(lp) : '';
                if (dom) ip_domains[ban.ip] = dom;
            }

            res.json({ success: true, result: { ok: true, bans, jail_actions, jail_logs, jail_servers, ip_domains } });
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
                const names = fs.readdirSync(dir).filter((f) => {
                    if (!FAIL2BAN_LOG_NAME.test(f)) return false;
                    try {
                        return fs.statSync(path.join(dir, f)).isFile();
                    } catch {
                        return false;
                    }
                });
                names.sort();
                res.json({ success: true, result: { ok: true, dir: '/var/log', files: names } });
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

        return router;
    }
}
