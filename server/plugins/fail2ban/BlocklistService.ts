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

export type ListDirection = 'in' | 'out' | 'both';
export type IpsetType = 'hash:ip' | 'hash:net';

interface BuiltinListDef {
    name: string;
    url: string;
    ipsetName: string;
    description: string;
    maxelem: number;
    direction: ListDirection;
    sourceUrl: string;
    ipsetType: IpsetType;
}

const LISTS: Record<string, BuiltinListDef> = {
    prod: {
        name: 'Data-Shield Prod',
        url: 'https://cdn.jsdelivr.net/gh/duggytuxy/Data-Shield_IPv4_Blocklist@main/prod_data-shield_ipv4_blocklist.txt',
        ipsetName: 'data-shield-prod',
        description: 'Web apps, WordPress, Nginx/Apache',
        maxelem: 200000,
        direction: 'in',
        sourceUrl: 'https://github.com/duggytuxy/Data-Shield_IPv4_Blocklist',
        ipsetType: 'hash:ip',
    },
    critical: {
        name: 'Data-Shield Critical',
        url: 'https://cdn.jsdelivr.net/gh/duggytuxy/Data-Shield_IPv4_Blocklist@main/prod_critical_data-shield_ipv4_blocklist.txt',
        ipsetName: 'data-shield-critical',
        description: 'DMZ, APIs, infrastructure sensible',
        maxelem: 200000,
        direction: 'in',
        sourceUrl: 'https://github.com/duggytuxy/Data-Shield_IPv4_Blocklist',
        ipsetType: 'hash:ip',
    },
    // bitwire-in / bitwire-out removed: list contains ~3.3M entries which exceeds
    // the kernel ipset hash:ip limit (~520K) on most Docker hosts. Add as a custom
    // list only if your kernel supports larger ipsets.
    'tor-exit': {
        name: 'TOR Exit Nodes',
        url: 'https://check.torproject.org/cgi-bin/TorBulkExitList.py?ip=1.1.1.1',
        ipsetName: 'tor-exit',
        description: 'Nœuds de sortie TOR — anonymisation / contournement',
        maxelem: 15000,
        direction: 'in',
        sourceUrl: 'https://check.torproject.org',
        ipsetType: 'hash:ip',
    },
    bruteforce: {
        name: 'BruteForceBlocker',
        url: 'http://danger.rulez.sk/projects/bruteforceblocker/blist.php',
        ipsetName: 'bruteforce',
        description: 'IPs actives en brute-force SSH/FTP — danger.rulez.sk',
        maxelem: 50000,
        direction: 'in',
        sourceUrl: 'http://danger.rulez.sk/projects/bruteforceblocker/',
        ipsetType: 'hash:ip',
    },
    'spamhaus-drop': {
        name: 'Spamhaus DROP',
        url: 'https://www.spamhaus.org/drop/drop.txt',
        ipsetName: 'spamhaus-drop',
        description: 'Spamhaus Don\'t Route Or Peer — réseaux non routables / hijackés (CIDRs)',
        maxelem: 10000,
        direction: 'in',
        sourceUrl: 'https://www.spamhaus.org/drop/',
        ipsetType: 'hash:net',
    },
    'cins-army': {
        name: 'CINS Army',
        url: 'https://cinsscore.com/list/ci-badguys.txt',
        ipsetName: 'cins-army',
        description: 'C.I. Army — IPs malveillantes confirmées (cinsscore.com)',
        maxelem: 60000,
        direction: 'in',
        sourceUrl: 'https://cinsscore.com',
        ipsetType: 'hash:ip',
    },
    'blocklist-de': {
        name: 'Blocklist.de All',
        url: 'https://lists.blocklist.de/lists/all.txt',
        ipsetName: 'blocklist-de',
        description: 'Attaquants détectés par blocklist.de (SSH, mail, FTP, SIP…)',
        maxelem: 500000,
        direction: 'in',
        sourceUrl: 'https://www.blocklist.de',
        ipsetType: 'hash:ip',
    },
    greensnow: {
        name: 'GreenSnow',
        url: 'https://blocklist.greensnow.co/greensnow.txt',
        ipsetName: 'greensnow',
        description: 'IPs blacklistées par GreenSnow — attaques multi-protocoles',
        maxelem: 200000,
        direction: 'in',
        sourceUrl: 'https://greensnow.co',
        ipsetType: 'hash:ip',
    },
    'firehol-l1': {
        name: 'Firehol Level 1',
        url: 'https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/firehol_level1.netset',
        ipsetName: 'firehol-l1',
        description: 'Firehol niveau 1 — agrégat des meilleures listes (CIDRs + IPs)',
        maxelem: 30000,
        direction: 'in',
        sourceUrl: 'https://github.com/firehol/blocklist-ipsets',
        ipsetType: 'hash:net',
    },
    stopforumspam: {
        name: 'Stopforumspam 7j',
        url: 'https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/stopforumspam_7d.ipset',
        ipsetName: 'stopforumspam',
        description: 'Spammeurs de forums actifs sur 7 jours (via Firehol)',
        maxelem: 200000,
        direction: 'in',
        sourceUrl: 'https://www.stopforumspam.com',
        ipsetType: 'hash:ip',
    },
    'country-ru': {
        name: 'Pays — Russie (CIDRs)',
        url: 'https://raw.githubusercontent.com/ipverse/rir-ip/master/country/ru/ipv4-aggregated.txt',
        ipsetName: 'country-ru',
        description: '⚠ Bloc pays entier — tous les CIDRs IPv4 alloués à la Russie',
        maxelem: 30000,
        direction: 'in',
        sourceUrl: 'https://github.com/ipverse/rir-ip',
        ipsetType: 'hash:net',
    },
    'country-cn': {
        name: 'Pays — Chine (CIDRs)',
        url: 'https://raw.githubusercontent.com/ipverse/rir-ip/master/country/cn/ipv4-aggregated.txt',
        ipsetName: 'country-cn',
        description: '⚠ Bloc pays entier — tous les CIDRs IPv4 alloués à la Chine',
        maxelem: 30000,
        direction: 'in',
        sourceUrl: 'https://github.com/ipverse/rir-ip',
        ipsetType: 'hash:net',
    },
};

/**
 * Returns [chain, matchFlag] pairs for the given direction.
 * 'in'   → INPUT / src
 * 'out'  → OUTPUT / dst
 * 'both' → INPUT / src + OUTPUT / dst
 */
function iptablesChainsFor(direction: ListDirection): Array<[string, string]> {
    if (direction === 'in')  return [['INPUT', 'src']];
    if (direction === 'out') return [['OUTPUT', 'dst']];
    return [['INPUT', 'src'], ['OUTPUT', 'dst']];
}

export interface CustomListDef {
    id: string;         // = ipsetName (user-supplied, unique)
    name: string;
    url: string;
    ipsetName: string;
    description: string;
    maxelem: number;
    direction: ListDirection;
    ipsetType: IpsetType;
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
    builtin: boolean;       // true for LISTS entries, false for user-added
    direction: ListDirection;
    ipsetType: IpsetType;
    sourceUrl?: string;     // Link to the blocklist project/repo
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

    private _allLists(): Record<string, { name: string; url: string; ipsetName: string; description: string; maxelem: number; direction: ListDirection; ipsetType: IpsetType; sourceUrl?: string }> {
        const custom: Record<string, { name: string; url: string; ipsetName: string; description: string; maxelem: number; direction: ListDirection; ipsetType: IpsetType; sourceUrl?: string }> = {};
        for (const [id, def] of this._customDefs.entries()) {
            custom[id] = { name: def.name, url: def.url, ipsetName: def.ipsetName, description: def.description, maxelem: def.maxelem, direction: def.direction, ipsetType: def.ipsetType };
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
                direction: list.direction,
                ipsetType: list.ipsetType,
                sourceUrl: list.sourceUrl,
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

    addCustomList(def: { name: string; url: string; ipsetName: string; description?: string; maxelem?: number; direction?: ListDirection; ipsetType?: IpsetType }): { ok: boolean; error?: string } {
        const name = def.name.trim();
        const url = def.url.trim();
        const ipsetName = def.ipsetName.trim();
        const description = def.description?.trim() ?? '';
        const maxelem = def.maxelem ?? 150000;
        const direction: ListDirection = def.direction ?? 'in';
        const ipsetType: IpsetType = def.ipsetType ?? 'hash:ip';

        if (!name) return { ok: false, error: 'Le nom est requis' };
        if (!url || !url.startsWith('http')) return { ok: false, error: 'URL invalide (doit commencer par http)' };
        if (!ipsetName) return { ok: false, error: 'Le nom d\'ipset est requis' };
        if (!/^[a-z0-9][a-z0-9-]*$/.test(ipsetName)) {
            return { ok: false, error: 'Nom d\'ipset invalide: lettres minuscules, chiffres et tirets uniquement' };
        }

        const existing = this._allLists();
        const ipsetNameConflict = Object.values(existing).some(l => l.ipsetName === ipsetName);
        if (ipsetName in existing || ipsetNameConflict) {
            return { ok: false, error: `Le nom d'ipset "${ipsetName}" est déjà utilisé` };
        }

        const id = ipsetName;
        const newDef: CustomListDef = { id, name, url, ipsetName, description, maxelem, direction, ipsetType };
        this._customDefs.set(id, newDef);
        this._saveCustomDefs();

        this._status.set(id, {
            id, name, description,
            enabled: false, lastUpdate: null, count: 0, error: null, updating: false,
            builtin: false, direction, ipsetType,
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

        if (this._refreshInProgress.has(id)) {
            return { ok: false, error: 'Rafraîchissement en cours, réessayez dans un instant' };
        }

        // Disable first (removes iptables rule — errors are silently swallowed in disable())
        await this.disable(id);

        // Destroy ipset kernel object (ignore if already absent)
        try {
            const [c, a] = priv('ipset', ['destroy', def.ipsetName]);
            await execFileAsync(c, a, { timeout: 10_000 });
        } catch { /* ignore */ }
        // Also destroy the temporary set used during refresh (may be orphaned if refresh was interrupted)
        try {
            const [c, a] = priv('ipset', ['destroy', def.ipsetName + '-new']);
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

            // 2. Parse IPs / CIDRs — flexible parser that handles:
            //    - plain IPs: 1.2.3.4
            //    - CIDRs: 1.2.3.4/24
            //    - comments: # or ; at start or after the entry
            //    - ipset restore format: "add setname 1.2.3.4" (extract IP from 3rd token)
            const ipOrCidrRe = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?:\/\d{1,2})?)/;
            const entries = [...new Set(
                body.split('\n')
                    .map(l => {
                        // Strip inline comments (# or ;)
                        const clean = l.replace(/[#;].*$/, '').trim();
                        if (!clean) return '';
                        // Find first IP or CIDR pattern anywhere on the line
                        const m = clean.match(ipOrCidrRe);
                        return m ? m[1] : '';
                    })
                    .filter(Boolean)
            )];

            if (entries.length === 0) {
                throw new Error(`Aucune IP/CIDR valide dans la liste ${list.name} (liste vide ou format non reconnu)`);
            }

            // Kernel ipset hash tables are capped at ~524 288 entries (2^19) regardless
            // of maxelem or hashsize. Fail early with a clear message rather than letting
            // ipset restore crash mid-load.
            const IPSET_KERNEL_LIMIT = 520000;
            if (entries.length > IPSET_KERNEL_LIMIT) {
                throw new Error(
                    `Liste trop grande pour ipset sur ce kernel : ${entries.length.toLocaleString()} entrées (limite ~${IPSET_KERNEL_LIMIT.toLocaleString()}). ` +
                    `Désactivez cette liste ou regroupez les IPs en CIDRs.`
                );
            }

            const ipsetType = list.ipsetType ?? 'hash:ip';
            logger.info('BlocklistService', `${list.name}: parsed ${entries.length} unique entries (${ipsetType})`);

            // 3. Build restore script — only "add" lines; we create the -new set
            //    explicitly below so we have guaranteed control over maxelem.
            const script = entries.map(e => `add ${list.ipsetName}-new ${e}`).join('\n') + '\n';

            // 4a. Ensure main set exists with correct type (ignore "already exists").
            //     If it exists with wrong maxelem, destroy it first so a fresh create picks
            //     up the new value. Iptables rules are not affected until the swap.
            try {
                const [c, a] = priv('ipset', ['create', list.ipsetName, ipsetType, 'family', 'inet', 'maxelem', String(list.maxelem)]);
                await execFileAsync(c, a, { timeout: 10_000 });
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                if (msg.includes('already exists') || msg.includes('set with the same name')) {
                    // Set exists — check maxelem; destroy & recreate if too small
                    try {
                        const [lc, la] = priv('ipset', ['list', list.ipsetName, '-t']);
                        const { stdout } = await execFileAsync(lc, la, { timeout: 10_000 });
                        const maxElemMatch = stdout.match(/Maxelem:\s*(\d+)/i);
                        const currentMaxelem = maxElemMatch ? parseInt(maxElemMatch[1], 10) : 0;
                        if (currentMaxelem < list.maxelem) {
                            logger.info('BlocklistService', `${list.name}: maxelem mismatch (${currentMaxelem} < ${list.maxelem}), recreating`);
                            const [dc, da] = priv('ipset', ['destroy', list.ipsetName]);
                            await execFileAsync(dc, da, { timeout: 10_000 });
                            const [cc, ca] = priv('ipset', ['create', list.ipsetName, ipsetType, 'family', 'inet', 'maxelem', String(list.maxelem)]);
                            await execFileAsync(cc, ca, { timeout: 10_000 });
                        }
                    } catch (innerErr: unknown) {
                        const innerMsg = innerErr instanceof Error ? innerErr.message : String(innerErr);
                        logger.warn('BlocklistService', `${list.name}: could not verify/fix maxelem — ${innerMsg}`);
                    }
                } else {
                    throw new Error(`ipset create ${list.ipsetName}: ${msg}`);
                }
            }

            // 4b. Destroy -new temp set (always), then recreate it explicitly with
            //     the correct maxelem. Doing this here — rather than via a "create"
            //     line inside the restore file — guarantees maxelem is correct even
            //     if a stale -new set existed in the kernel from a previous run.
            try {
                const [c, a] = priv('ipset', ['destroy', `${list.ipsetName}-new`]);
                await execFileAsync(c, a, { timeout: 10_000 });
            } catch { /* ignore — set may not exist */ }

            {
                // hashsize must be a power-of-2 ≥ maxelem/8 so the kernel hash table
                // doesn't overflow before maxelem is reached (each bucket holds ~8 entries).
                const targetBuckets = Math.ceil(list.maxelem / 4);
                const hashsize = Math.pow(2, Math.ceil(Math.log2(Math.max(1024, targetBuckets))));
                const [c, a] = priv('ipset', ['create', `${list.ipsetName}-new`, ipsetType, 'family', 'inet', 'hashsize', String(hashsize), 'maxelem', String(list.maxelem)]);
                await execFileAsync(c, a, { timeout: 10_000 });
                logger.info('BlocklistService', `${list.name}: created ${list.ipsetName}-new (${ipsetType}, hashsize=${hashsize}, maxelem=${list.maxelem})`);
            }

            // 4c. Write restore script (add-only lines) to tmp file
            tmpFile = path.join(os.tmpdir(), `${list.ipsetName}-restore-${Date.now()}.txt`);
            fs.writeFileSync(tmpFile, script, 'utf8');

            // 4d. ipset restore — fills -new set
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
            status.count = entries.length;
            status.error = null;
            this._saveStatus();

            logger.info('BlocklistService', `${list.name}: refresh OK (${entries.length} entries)`);
            return { ok: true, count: entries.length };

        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('BlocklistService', `${list.name}: refresh failed — ${msg}`);

            // Cleanup tmp file on error
            if (tmpFile) {
                try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
            }

            // Cleanup orphaned -new temp set so it doesn't clutter ipset list
            try {
                const [c, a] = priv('ipset', ['destroy', `${list.ipsetName}-new`]);
                await execFileAsync(c, a, { timeout: 10_000 });
            } catch { /* ignore — set may not exist or still in use */ }

            status.updating = false;
            status.error = msg;
            this._saveStatus();

            return { ok: false, error: msg };
        } finally {
            this._refreshInProgress.delete(id);
        }
    }

    /**
     * Force-reset: removes iptables rules, destroys existing ipset (main + -new),
     * then runs a fresh refresh. Use this when a normal refresh fails due to a
     * stale kernel set (wrong maxelem, corrupted state, etc.).
     */
    async forceReset(id: string): Promise<{ ok: boolean; count?: number; error?: string }> {
        const list = this._allLists()[id];
        if (!list) return { ok: false, error: `Liste inconnue: ${id}` };

        const status = this._status.get(id)!;
        const wasEnabled = status.enabled;

        // 1. Remove iptables rules (ignore errors — rules may not exist)
        for (const [chain, dirFlag] of iptablesChainsFor(list.direction)) {
            try {
                const [c, a] = priv('iptables', ['-D', chain, '-m', 'set', '--match-set', list.ipsetName, dirFlag, '-j', 'DROP']);
                await execFileAsync(c, a, { timeout: 10_000 });
            } catch { /* ignore */ }
        }

        // 2. Destroy main set and temp set (ignore errors)
        for (const setName of [list.ipsetName, `${list.ipsetName}-new`]) {
            try {
                const [c, a] = priv('ipset', ['destroy', setName]);
                await execFileAsync(c, a, { timeout: 10_000 });
                logger.info('BlocklistService', `forceReset: destroyed ${setName}`);
            } catch { /* ignore — may not exist */ }
        }

        // 3. Fresh refresh (re-downloads, recreates set from scratch)
        const r = await this.refresh(id);
        if (!r.ok) return r;

        // 4. Re-add iptables rules if it was enabled before
        if (wasEnabled) {
            for (const [chain, dirFlag] of iptablesChainsFor(list.direction)) {
                try {
                    const [c, a] = priv('iptables', ['-I', chain, '-m', 'set', '--match-set', list.ipsetName, dirFlag, '-j', 'DROP']);
                    await execFileAsync(c, a, { timeout: 10_000 });
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    logger.error('BlocklistService', `forceReset: iptables -I ${chain} failed — ${msg}`);
                }
            }
            status.enabled = true;
            this._saveStatus();
        }

        return r;
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

        // Apply iptables rules for each chain dictated by direction
        for (const [chain, dirFlag] of iptablesChainsFor(list.direction)) {
            try {
                const [c, a] = priv('iptables', ['-C', chain, '-m', 'set', '--match-set', list.ipsetName, dirFlag, '-j', 'DROP']);
                await execFileAsync(c, a, { timeout: 10_000 });
                // exit 0 → rule exists, skip insertion
            } catch {
                // Rule absent — insert at top
                try {
                    const [c, a] = priv('iptables', ['-I', chain, '-m', 'set', '--match-set', list.ipsetName, dirFlag, '-j', 'DROP']);
                    await execFileAsync(c, a, { timeout: 10_000 });
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    logger.error('BlocklistService', `enable ${id}: iptables -I ${chain} failed — ${msg}`);
                    return { ok: false, error: msg };
                }
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

        // Remove iptables rules for each chain dictated by direction
        for (const [chain, dirFlag] of iptablesChainsFor(list.direction)) {
            try {
                const [c, a] = priv('iptables', ['-D', chain, '-m', 'set', '--match-set', list.ipsetName, dirFlag, '-j', 'DROP']);
                await execFileAsync(c, a, { timeout: 10_000 });
            } catch {
                // Ignore — rule may not exist
            }
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

            // Re-add iptables DROP rules for each chain dictated by direction
            for (const [chain, dirFlag] of iptablesChainsFor(list.direction)) {
                try {
                    const [cc, ca] = priv('iptables', ['-C', chain, '-m', 'set', '--match-set', list.ipsetName, dirFlag, '-j', 'DROP']);
                    await execFileAsync(cc, ca, { timeout: 10_000 });
                    logger.info('BlocklistService', `Startup restore: ${id} iptables ${chain} rule already present`);
                } catch {
                    try {
                        const [ic, ia] = priv('iptables', ['-I', chain, '-m', 'set', '--match-set', list.ipsetName, dirFlag, '-j', 'DROP']);
                        await execFileAsync(ic, ia, { timeout: 10_000 });
                        logger.info('BlocklistService', `Startup restore: ${id} iptables ${chain} rule re-added`);
                    } catch (err: unknown) {
                        const msg = err instanceof Error ? err.message : String(err);
                        logger.error('BlocklistService', `Startup restore: ${id} iptables -I ${chain} failed — ${msg}`);
                        status.error = `Restauration au démarrage échouée: ${msg}`;
                        this._saveStatus();
                    }
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
                        for (const [chain, dirFlag] of iptablesChainsFor(list.direction)) {
                            try {
                                const [cc, ca] = priv('iptables', ['-C', chain, '-m', 'set', '--match-set', list.ipsetName, dirFlag, '-j', 'DROP']);
                                await execFileAsync(cc, ca, { timeout: 10_000 });
                            } catch {
                                try {
                                    const [ic, ia] = priv('iptables', ['-I', chain, '-m', 'set', '--match-set', list.ipsetName, dirFlag, '-j', 'DROP']);
                                    await execFileAsync(ic, ia, { timeout: 10_000 });
                                    logger.info('BlocklistService', `Auto-refresh: ${id} iptables ${chain} rule re-added`);
                                } catch (err: unknown) {
                                    logger.error('BlocklistService', `Auto-refresh: ${id} iptables ${chain} restore failed — ${err instanceof Error ? err.message : String(err)}`);
                                }
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
