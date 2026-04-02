/**
 * BlocklistService — manages Data-Shield IPv4 blocklists loaded into ipsets + iptables DROP rules.
 * Requires NET_ADMIN capability (Docker: cap_add: [NET_ADMIN]).
 * When running as non-root, uses sudo for privileged commands.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../../utils/logger.js';

const execFileAsync = promisify(execFile);

const LISTS: Record<string, {
    name: string;
    url: string;
    ipsetName: string;
    description: string;
    maxelem: number;
}> = {
    prod: {
        name: 'Data-Shield Prod',
        url: 'https://cdn.jsdelivr.net/gh/duggytuxy/Data-Shield_IPv4_Blocklist@main/prod_data-shield_ipv4_blocklist.txt',
        ipsetName: 'data-shield-prod',
        description: 'Web apps, WordPress, Nginx/Apache',
        maxelem: 150000,
    },
    critical: {
        name: 'Data-Shield Critical',
        url: 'https://cdn.jsdelivr.net/gh/duggytuxy/Data-Shield_IPv4_Blocklist@main/prod_critical_data-shield_ipv4_blocklist.txt',
        ipsetName: 'data-shield-critical',
        description: 'DMZ, APIs, infrastructure sensible',
        maxelem: 150000,
    },
};

export interface CustomListDef {
    id: string;         // = ipsetName (user-supplied, unique)
    name: string;
    url: string;
    ipsetName: string;
    description: string;
    maxelem: number;
}

export interface BlocklistStatus {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    lastUpdate: string | null;  // ISO
    count: number;
    error: string | null;
    updating: boolean;
    builtin: boolean;   // true for LISTS entries, false for user-added
}

/** Returns [cmd, args] — prepends sudo when not running as root. */
function priv(cmd: string, args: string[]): [string, string[]] {
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    return isRoot ? [cmd, args] : ['sudo', ['-n', cmd, ...args]];
}

/** Download a URL following one redirect. Returns the full body as string. */
function downloadUrl(url: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024; // 50 MB
        const timer = setTimeout(() => reject(new Error(`Download timeout after ${timeoutMs}ms`)), timeoutMs);

        const doRequest = (reqUrl: string, redirected: boolean) => {
            const lib: typeof https | typeof http = reqUrl.startsWith('https://') ? https : http;
            lib.get(reqUrl, (res) => {
                // Follow one redirect
                if (!redirected && res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    res.resume();
                    doRequest(res.headers.location, true);
                    return;
                }
                if (res.statusCode && res.statusCode !== 200) {
                    res.resume();
                    clearTimeout(timer);
                    reject(new Error(`HTTP ${res.statusCode} for ${reqUrl}`));
                    return;
                }
                const chunks: Buffer[] = [];
                let totalSize = 0;
                res.on('data', (chunk: Buffer) => {
                    totalSize += chunk.length;
                    if (totalSize > MAX_DOWNLOAD_BYTES) {
                        res.destroy();
                        clearTimeout(timer);
                        reject(new Error(`Download exceeds max size of ${MAX_DOWNLOAD_BYTES} bytes`));
                        return;
                    }
                    chunks.push(chunk);
                });
                res.on('end', () => {
                    clearTimeout(timer);
                    resolve(Buffer.concat(chunks).toString('utf8'));
                });
                res.on('error', (err: Error) => {
                    clearTimeout(timer);
                    reject(err);
                });
            }).on('error', (err: Error) => {
                clearTimeout(timer);
                reject(err);
            });
        };

        doRequest(url, false);
    });
}

export class BlocklistService {
    private _statusFile: string;
    private _customDefsFile: string;
    private _status: Map<string, BlocklistStatus>;
    private _customDefs: Map<string, CustomListDef>;
    private _refreshTimer: ReturnType<typeof setInterval> | null = null;
    private _refreshInProgress: Set<string> = new Set();

    constructor(dataDir: string) {
        this._statusFile = path.join(dataDir, 'blocklist-status.json');
        this._customDefsFile = path.join(dataDir, 'blocklist-custom.json');
        this._status = new Map();
        this._customDefs = new Map();
        this._loadCustomDefs();   // must run before _loadStatus
        this._loadStatus();
    }

    // ── Dynamic list registry ─────────────────────────────────────────────────

    private _allLists(): Record<string, { name: string; url: string; ipsetName: string; description: string; maxelem: number }> {
        const custom: Record<string, { name: string; url: string; ipsetName: string; description: string; maxelem: number }> = {};
        for (const [id, def] of this._customDefs.entries()) {
            custom[id] = { name: def.name, url: def.url, ipsetName: def.ipsetName, description: def.description, maxelem: def.maxelem };
        }
        return { ...LISTS, ...custom };
    }

    private _loadCustomDefs(): void {
        try {
            const raw = fs.readFileSync(this._customDefsFile, 'utf8');
            const defs = JSON.parse(raw) as CustomListDef[];
            for (const def of defs) {
                this._customDefs.set(def.id, def);
            }
        } catch {
            // File absent or invalid — no custom lists
        }
    }

    private _saveCustomDefs(): void {
        try {
            const arr = Array.from(this._customDefs.values());
            fs.writeFileSync(this._customDefsFile, JSON.stringify(arr, null, 2), 'utf8');
        } catch (err: unknown) {
            logger.error('BlocklistService', `Failed to save custom defs: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    // ── Persistence ───────────────────────────────────────────────────────────

    private _loadStatus(): void {
        let persisted: BlocklistStatus[] = [];
        try {
            const raw = fs.readFileSync(this._statusFile, 'utf8');
            persisted = JSON.parse(raw) as BlocklistStatus[];
        } catch {
            // File absent or invalid — start fresh
        }

        const byId = new Map(persisted.map(s => [s.id, s]));

        for (const [id, list] of Object.entries(this._allLists())) {
            const saved = byId.get(id);
            const entry: BlocklistStatus = {
                id,
                name: list.name,
                description: list.description,
                enabled: saved?.enabled ?? false,
                lastUpdate: saved?.lastUpdate ?? null,
                count: saved?.count ?? 0,
                error: saved?.error ?? null,
                // Crash recovery: reset any stuck updating flag
                updating: false,
                builtin: id in LISTS,
            };
            this._status.set(id, entry);
        }

        // Persist the recovered state (resets updating: true if any were stuck)
        this._saveStatus();
    }

    private _saveStatus(): void {
        try {
            const arr = Array.from(this._status.values());
            fs.writeFileSync(this._statusFile, JSON.stringify(arr, null, 2), 'utf8');
        } catch (err: unknown) {
            logger.error('BlocklistService', `Failed to save status: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    getStatus(): BlocklistStatus[] {
        return Array.from(this._status.values());
    }

    addCustomList(def: { name: string; url: string; ipsetName: string; description?: string; maxelem?: number }): { ok: boolean; error?: string } {
        const name = def.name.trim();
        const url = def.url.trim();
        const ipsetName = def.ipsetName.trim();
        const description = def.description?.trim() ?? '';
        const maxelem = def.maxelem ?? 150000;

        if (!name) return { ok: false, error: 'Le nom est requis' };
        if (!url || !url.startsWith('http')) return { ok: false, error: 'URL invalide (doit commencer par http)' };
        if (!ipsetName) return { ok: false, error: 'Le nom d\'ipset est requis' };
        if (!/^[a-z0-9][a-z0-9-]*$/.test(ipsetName)) {
            return { ok: false, error: 'Nom d\'ipset invalide: lettres minuscules, chiffres et tirets uniquement' };
        }

        const existing = this._allLists();
        if (ipsetName in existing) {
            return { ok: false, error: `Le nom d'ipset "${ipsetName}" est déjà utilisé` };
        }

        const id = ipsetName;
        const newDef: CustomListDef = { id, name, url, ipsetName, description, maxelem };
        this._customDefs.set(id, newDef);
        this._saveCustomDefs();

        this._status.set(id, {
            id, name, description,
            enabled: false, lastUpdate: null, count: 0, error: null, updating: false,
            builtin: false,
        });
        this._saveStatus();

        logger.info('BlocklistService', `Custom list added: ${id} (${url})`);
        return { ok: true };
    }

    async removeCustomList(id: string): Promise<{ ok: boolean; error?: string }> {
        if (id in LISTS) {
            return { ok: false, error: 'Les listes intégrées ne peuvent pas être supprimées' };
        }
        const def = this._customDefs.get(id);
        if (!def) {
            return { ok: false, error: `Liste inconnue: ${id}` };
        }

        // Disable first (removes iptables rule — errors are silently swallowed in disable())
        await this.disable(id);

        // Destroy ipset kernel object (ignore if already absent)
        try {
            const [c, a] = priv('ipset', ['destroy', def.ipsetName]);
            await execFileAsync(c, a, { timeout: 10_000 });
        } catch { /* ignore */ }

        this._customDefs.delete(id);
        this._saveCustomDefs();
        this._status.delete(id);
        this._saveStatus();

        logger.info('BlocklistService', `Custom list removed: ${id}`);
        return { ok: true };
    }

    async refresh(id: string): Promise<{ ok: boolean; count?: number; error?: string }> {
        const list = this._allLists()[id];
        if (!list) {
            return { ok: false, error: `Liste inconnue: ${id}` };
        }

        if (this._refreshInProgress.has(id)) {
            return { ok: false, error: 'Rafraîchissement déjà en cours' };
        }
        this._refreshInProgress.add(id);

        const status = this._status.get(id)!;
        status.updating = true;
        this._saveStatus();

        let tmpFile: string | null = null;

        try {
            // 1. Download
            logger.info('BlocklistService', `Downloading ${list.name} from ${list.url}`);
            const body = await downloadUrl(list.url, 30_000);

            // 2. Parse IPs
            const ipv4Re = /^(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
            const ips = [...new Set(
                body.split('\n')
                    .map(l => l.trim())
                    .filter(l => ipv4Re.test(l))
            )];

            if (ips.length === 0) {
                throw new Error(`Aucune IP valide dans la liste ${list.name} (liste vide ou format invalide)`);
            }

            logger.info('BlocklistService', `${list.name}: parsed ${ips.length} unique IPs`);

            // 3. Build ipset restore script
            const lines = [
                `create ${list.ipsetName}-new hash:ip family inet hashsize 32768 maxelem ${list.maxelem}`,
                ...ips.map(ip => `add ${list.ipsetName}-new ${ip}`),
            ];
            const script = lines.join('\n') + '\n';

            // 4a. Ensure main set exists (ignore "already exists")
            try {
                const [c, a] = priv('ipset', ['create', list.ipsetName, 'hash:ip', 'family', 'inet', 'maxelem', String(list.maxelem)]);
                await execFileAsync(c, a, { timeout: 10_000 });
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                if (!msg.includes('already exists') && !msg.includes('set with the same name')) {
                    throw new Error(`ipset create ${list.ipsetName}: ${msg}`);
                }
            }

            // 4b. Destroy old temp set (ignore errors)
            try {
                const [c, a] = priv('ipset', ['destroy', `${list.ipsetName}-new`]);
                await execFileAsync(c, a, { timeout: 10_000 });
            } catch {
                // Ignore — temp set may not exist
            }

            // 4c. Write restore script to tmp file
            tmpFile = path.join(os.tmpdir(), `${list.ipsetName}-restore-${Date.now()}.txt`);
            fs.writeFileSync(tmpFile, script, 'utf8');

            // 4d. ipset restore
            {
                const [c, a] = priv('ipset', ['restore', '-f', tmpFile]);
                await execFileAsync(c, a, { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
            }

            // 4e. Swap new set into production
            {
                const [c, a] = priv('ipset', ['swap', `${list.ipsetName}-new`, list.ipsetName]);
                await execFileAsync(c, a, { timeout: 10_000 });
            }

            // 4f. Destroy the now-old set (was the previous production set after swap)
            try {
                const [c, a] = priv('ipset', ['destroy', `${list.ipsetName}-new`]);
                await execFileAsync(c, a, { timeout: 10_000 });
            } catch {
                // Ignore
            }

            // 4g. Remove tmp file
            try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
            tmpFile = null;

            // 5. Update status
            status.updating = false;
            status.lastUpdate = new Date().toISOString();
            status.count = ips.length;
            status.error = null;
            this._saveStatus();

            logger.info('BlocklistService', `${list.name}: refresh OK (${ips.length} IPs)`);
            return { ok: true, count: ips.length };

        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('BlocklistService', `${list.name}: refresh failed — ${msg}`);

            // Cleanup tmp file on error
            if (tmpFile) {
                try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
            }

            status.updating = false;
            status.error = msg;
            this._saveStatus();

            return { ok: false, error: msg };
        } finally {
            this._refreshInProgress.delete(id);
        }
    }

    async enable(id: string): Promise<{ ok: boolean; error?: string }> {
        const list = this._allLists()[id];
        if (!list) {
            return { ok: false, error: `Liste inconnue: ${id}` };
        }

        const status = this._status.get(id)!;

        // If no IPs loaded yet, refresh first
        if (status.count === 0) {
            const r = await this.refresh(id);
            if (!r.ok) {
                return { ok: false, error: r.error };
            }
        }

        // Check if iptables rule already exists
        try {
            const [c, a] = priv('iptables', ['-C', 'INPUT', '-m', 'set', '--match-set', list.ipsetName, 'src', '-j', 'DROP']);
            await execFileAsync(c, a, { timeout: 10_000 });
            // exit 0 → rule exists, skip insertion
        } catch {
            // Rule absent — insert at top
            try {
                const [c, a] = priv('iptables', ['-I', 'INPUT', '-m', 'set', '--match-set', list.ipsetName, 'src', '-j', 'DROP']);
                await execFileAsync(c, a, { timeout: 10_000 });
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                logger.error('BlocklistService', `enable ${id}: iptables -I failed — ${msg}`);
                return { ok: false, error: msg };
            }
        }

        status.enabled = true;
        this._saveStatus();

        logger.info('BlocklistService', `${list.name}: enabled`);
        return { ok: true };
    }

    async disable(id: string): Promise<{ ok: boolean; error?: string }> {
        const list = this._allLists()[id];
        if (!list) {
            return { ok: false, error: `Liste inconnue: ${id}` };
        }

        // Remove iptables rule (ignore if absent)
        try {
            const [c, a] = priv('iptables', ['-D', 'INPUT', '-m', 'set', '--match-set', list.ipsetName, 'src', '-j', 'DROP']);
            await execFileAsync(c, a, { timeout: 10_000 });
        } catch {
            // Ignore — rule may not exist
        }

        const status = this._status.get(id)!;
        status.enabled = false;
        this._saveStatus();

        logger.info('BlocklistService', `${list.name}: disabled`);
        return { ok: true };
    }

    /**
     * Re-applies kernel state (ipset + iptables rule) for all enabled lists.
     * Called once at startup: container restarts wipe kernel state while
     * blocklist-status.json survives, so enabled lists must be restored.
     */
    async restoreOnStartup(): Promise<void> {
        for (const [id, status] of this._status.entries()) {
            if (!status.enabled) continue;
            const list = this._allLists()[id];
            if (!list) continue;

            logger.info('BlocklistService', `Startup restore: ${id} — re-applying ipset + iptables rule`);

            // Repopulate ipset (downloads + swap). This is idempotent.
            const r = await this.refresh(id);
            if (!r.ok) {
                logger.error('BlocklistService', `Startup restore: ${id} refresh failed — ${r.error}`);
                continue;
            }

            // Re-add iptables DROP rule if absent.
            try {
                const [cc, ca] = priv('iptables', ['-C', 'INPUT', '-m', 'set', '--match-set', list.ipsetName, 'src', '-j', 'DROP']);
                await execFileAsync(cc, ca, { timeout: 10_000 });
                logger.info('BlocklistService', `Startup restore: ${id} iptables rule already present`);
            } catch {
                try {
                    const [ic, ia] = priv('iptables', ['-I', 'INPUT', '-m', 'set', '--match-set', list.ipsetName, 'src', '-j', 'DROP']);
                    await execFileAsync(ic, ia, { timeout: 10_000 });
                    logger.info('BlocklistService', `Startup restore: ${id} iptables rule re-added`);
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    logger.error('BlocklistService', `Startup restore: ${id} iptables -I failed — ${msg}`);
                    status.error = `Restauration au démarrage échouée: ${msg}`;
                    this._saveStatus();
                }
            }
        }
    }

    startAutoRefresh(): void {
        if (this._refreshTimer) return;

        const SIX_HOURS = 6 * 60 * 60 * 1000;

        this._refreshTimer = setInterval(async () => {
            for (const [id, status] of this._status.entries()) {
                if (!status.enabled) continue;
                logger.info('BlocklistService', `Auto-refresh: starting ${id}`);
                // refresh() restores ipset data but not iptables — re-add rule if absent.
                const r = await this.refresh(id);
                if (r.ok) {
                    logger.info('BlocklistService', `Auto-refresh: ${id} OK (${r.count} IPs)`);
                    const list = this._allLists()[id];
                    if (list) {
                        try {
                            const [cc, ca] = priv('iptables', ['-C', 'INPUT', '-m', 'set', '--match-set', list.ipsetName, 'src', '-j', 'DROP']);
                            await execFileAsync(cc, ca, { timeout: 10_000 });
                        } catch {
                            try {
                                const [ic, ia] = priv('iptables', ['-I', 'INPUT', '-m', 'set', '--match-set', list.ipsetName, 'src', '-j', 'DROP']);
                                await execFileAsync(ic, ia, { timeout: 10_000 });
                                logger.info('BlocklistService', `Auto-refresh: ${id} iptables rule re-added after refresh`);
                            } catch (err: unknown) {
                                logger.error('BlocklistService', `Auto-refresh: ${id} iptables rule restore failed — ${err instanceof Error ? err.message : String(err)}`);
                            }
                        }
                    }
                } else {
                    logger.error('BlocklistService', `Auto-refresh: ${id} failed — ${r.error}`);
                }
            }
        }, SIX_HOURS);
    }

    stopAutoRefresh(): void {
        if (this._refreshTimer) {
            clearInterval(this._refreshTimer);
            this._refreshTimer = null;
        }
    }
}
