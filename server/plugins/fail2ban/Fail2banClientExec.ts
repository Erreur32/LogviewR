/**
 * Fail2ban Client Executor
 *
 * Wraps fail2ban-client CLI commands. Requires:
 *   - fail2ban-client installed in the container (apk add fail2ban)
 *   - /var/run/fail2ban/fail2ban.sock mounted and chmod 660
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';

const execFileAsync = promisify(execFile);

const SOCKET_PATH = '/var/run/fail2ban/fail2ban.sock';
const EXEC_TIMEOUT  = 10000; // 10s
const MAX_BUF_SMALL = 1 * 1024 * 1024;  // 1 MB  — default commands
const MAX_BUF_LARGE = 16 * 1024 * 1024; // 16 MB — ipset list (can be huge)

function findF2bClient(): string {
    for (const p of ['/usr/bin/fail2ban-client', '/bin/fail2ban-client']) {
        try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* try next */ }
    }
    return '/usr/bin/fail2ban-client'; // fallback, will fail with a clear error
}
const F2B_CLIENT = findF2bClient();

/** Prepend sudo when not running as root (same pattern as IptablesService). */
function priv(cmd: string, args: string[]): [string, string[]] {
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    return isRoot ? [cmd, args] : ['sudo', ['-n', cmd, ...args]];
}

export interface F2bJailStatus {
    jail: string;
    currentlyFailed: number;
    totalFailed: number;
    currentlyBanned: number;
    totalBanned: number;
    bannedIps: string[];
    fileList: string;
    // Optional fields filled from config parsing or later enrichment
    filter?: string;
    port?: string;
    actions?: string[];
    banaction?: string;
    bantime?: number;
    findtime?: number;
    maxretry?: number;
}

export interface IpsetSetInfo {
    name: string; type: string; size: number; maxelem: number; entries: number;
}

export interface F2bClientResult {
    ok: boolean;
    output: string;
    error?: string;
}

export class Fail2banClientExec {

    isAvailable(): boolean {
        try {
            fs.accessSync(F2B_CLIENT, fs.constants.X_OK);
            fs.accessSync(SOCKET_PATH, fs.constants.R_OK | fs.constants.W_OK);
            return true;
        } catch {
            return false;
        }
    }

    private async run(args: string[]): Promise<F2bClientResult> {
        try {
            const { stdout } = await execFileAsync(F2B_CLIENT, args, { timeout: EXEC_TIMEOUT });
            return { ok: true, output: stdout.trim() };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { ok: false, output: '', error: msg };
        }
    }

    async ping(): Promise<boolean> {
        const res = await this.run(['ping']);
        return res.ok && res.output.includes('pong');
    }

    /** Returns { client, server } version strings, or null if unavailable. */
    async versions(): Promise<{ client: string; server: string; mismatch: boolean } | null> {
        try {
            const clientRes = await this.run(['--version']);
            const clientMatch = clientRes.output.match(/Fail2Ban\s+v?([\d.]+)/i);
            const clientVer = clientMatch?.[1] ?? '';
            const serverRes = await this.run(['version']);
            const serverMatch = serverRes.output.match(/[\d.]+/);
            const serverVer = serverMatch?.[0] ?? '';
            if (!clientVer || !serverVer) return null;
            const mismatch = clientVer !== serverVer;
            return { client: clientVer, server: serverVer, mismatch };
        } catch {
            return null;
        }
    }

    async listJails(): Promise<string[]> {
        const res = await this.run(['status']);
        if (!res.ok) return [];
        // Output: "Jail list: sshd, nginx-http-auth, ..."
        const match = res.output.match(/Jail list:\s*(.+)/);
        if (!match) return [];
        return match[1].split(',').map(j => j.trim()).filter(Boolean);
    }

    async getJailStatus(jail: string): Promise<F2bJailStatus | null> {
        const res = await this.run(['status', jail]);
        if (!res.ok) return null;

        const parse = (pattern: RegExp): string => {
            const m = res.output.match(pattern);
            return m ? m[1].trim() : '0';
        };

        const bannedRaw = parse(/Banned IP list:\s*(.*)/);
        const bannedIps = bannedRaw ? bannedRaw.split(/\s+/).filter(Boolean) : [];

        return {
            jail,
            currentlyFailed: Number.parseInt(parse(/Currently failed:\s*(\d+)/), 10),
            totalFailed:     Number.parseInt(parse(/Total failed:\s*(\d+)/),     10),
            currentlyBanned: Number.parseInt(parse(/Currently banned:\s*(\d+)/), 10),
            totalBanned:     Number.parseInt(parse(/Total banned:\s*(\d+)/),     10),
            bannedIps,
            fileList: res.output.match(/File list:\s*(.*)/)?.[1]?.trim() ?? '',
        };
    }

    async banIp(jail: string, ip: string): Promise<F2bClientResult> {
        return this.run(['set', jail, 'banip', ip]);
    }

    async unbanIp(jail: string, ip: string): Promise<F2bClientResult> {
        return this.run(['set', jail, 'unbanip', ip]);
    }

    async startJail(jail: string): Promise<F2bClientResult> {
        return this.run(['start', jail]);
    }

    async stopJail(jail: string): Promise<F2bClientResult> {
        return this.run(['stop', jail]);
    }

    async reloadJail(jail: string): Promise<F2bClientResult> {
        return this.run(['reload', jail]);
    }

    async reload(): Promise<F2bClientResult> {
        return this.run(['reload']);
    }

    async restart(): Promise<F2bClientResult> {
        return this.run(['restart']);
    }

    async getJailParam(jail: string, param: string): Promise<number | undefined> {
        const res = await this.run(['get', jail, param]);
        if (!res.ok) return undefined;
        const n = Number.parseInt(res.output.trim(), 10);
        return Number.isNaN(n) ? undefined : n;
    }

    async getVersion(): Promise<string> {
        const res = await this.run(['--version']);
        if (!res.ok) return '';
        // Output: "Fail2Ban v1.1.0" or "Fail2Ban vX.Y.Z"
        const m = res.output.match(/v(\d+\.\d+\.\d+)/);
        return m ? m[1] : res.output.split('\n')[0].trim();
    }

    async setLoglevel(level: string): Promise<F2bClientResult> {
        return this.run(['set', 'loglevel', level]);
    }

    async setLogtarget(target: string): Promise<F2bClientResult> {
        return this.run(['set', 'logtarget', target]);
    }

    async setDbpurgeage(value: string): Promise<F2bClientResult> {
        return this.run(['set', 'dbpurgeage', value]);
    }

    async setDbmaxmatches(value: string): Promise<F2bClientResult> {
        return this.run(['set', 'dbmaxmatches', value]);
    }

    // ── Network commands (require NET_ADMIN capability) ──────────────────────

    private async runBin(bin: string, args: string[], largeOutput = false): Promise<F2bClientResult> {
        const [c, a] = priv(bin, args);
        try {
            const { stdout } = await execFileAsync(c, a, { timeout: EXEC_TIMEOUT, maxBuffer: largeOutput ? MAX_BUF_LARGE : MAX_BUF_SMALL });
            return { ok: true, output: stdout.trim() };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            const missing = msg.includes('ENOENT') || msg.includes('not found');
            return {
                ok: false, output: '',
                error: missing
                    ? `${bin} non disponible.\nVérifiez que network_mode: host et cap_add: NET_ADMIN sont actifs dans docker-compose.yml.`
                    : msg,
            };
        }
    }

    async iptablesSave(): Promise<F2bClientResult> {
        return this.runBin('iptables-save', []);
    }

    async ipsetList(): Promise<F2bClientResult> {
        return this.runBin('ipset', ['list'], true);
    }

    async ipsetSets(): Promise<{ name: string; entries: number }[]> {
        // -t = terse (headers only, no members — much faster)
        const r = await this.runBin('ipset', ['list', '-t']);
        if (!r.ok) return [];
        const sets: { name: string; entries: number }[] = [];
        let current: string | null = null;
        for (const line of r.output.split('\n')) {
            const nameMatch = line.match(/^Name:\s*(.+)/);
            if (nameMatch) { current = nameMatch[1].trim(); continue; }
            const entriesMatch = line.match(/^Number of entries:\s*(\d+)/);
            if (entriesMatch && current !== null) {
                sets.push({ name: current, entries: Number.parseInt(entriesMatch[1], 10) });
                current = null;
            }
        }
        return sets;
    }

    /** Full set info: type, maxelem, memory size, entry count. Parses ipset list -t. */
    async ipsetInfo(): Promise<{ ok: boolean; sets: IpsetSetInfo[]; error?: string }> {
        const r = await this.runBin('ipset', ['list', '-t']);
        if (!r.ok) return { ok: false, sets: [], error: r.error };
        const sets: IpsetSetInfo[] = [];
        let cur: Partial<IpsetSetInfo> & { name?: string } = {};
        for (const line of r.output.split('\n')) {
            const mName    = line.match(/^Name:\s*(.+)/);
            const mType    = line.match(/^Type:\s*(.+)/);
            const mMaxelem = line.match(/^Header:.*\bmaxelem\s+(\d+)/);
            const mSize    = line.match(/^Size in memory:\s*(\d+)/);
            const mEntries = line.match(/^Number of entries:\s*(\d+)/);
            if (mName)    { cur = { name: mName[1].trim() }; }
            if (mType)    { cur.type    = mType[1].trim(); }
            if (mMaxelem) { cur.maxelem = Number.parseInt(mMaxelem[1], 10); }
            if (mSize)    { cur.size    = Number.parseInt(mSize[1], 10); }
            if (mEntries && cur.name) {
                sets.push({ name: cur.name, type: cur.type ?? 'unknown', size: cur.size ?? 0, maxelem: cur.maxelem ?? 65536, entries: Number.parseInt(mEntries[1], 10) });
                cur = {};
            }
        }
        return { ok: true, sets };
    }

    /** List members of a specific ipset. Uses large buffer — sets can have thousands of entries. */
    async ipsetEntries(setName: string): Promise<{ ok: boolean; entries: string[]; error?: string }> {
        const r = await this.runBin('ipset', ['list', setName], true);
        if (!r.ok) return { ok: false, entries: [], error: r.error };
        const lines = r.output.split('\n');
        const mi = lines.findIndex(l => l.trim() === 'Members:');
        if (mi === -1) return { ok: true, entries: [] };
        const entries = lines.slice(mi + 1).map(l => l.trim()).filter(Boolean);
        return { ok: true, entries };
    }

    async ipsetAdd(setName: string, entry: string): Promise<F2bClientResult> {
        return this.runBin('ipset', ['add', setName, entry]);
    }

    async ipsetDel(setName: string, entry: string): Promise<F2bClientResult> {
        return this.runBin('ipset', ['del', setName, entry]);
    }

    /** Dump all ipset sets via `ipset save` — output suitable for `ipset restore`. */
    async ipsetSave(): Promise<F2bClientResult> {
        return this.runBin('ipset', ['save'], true);
    }

    async nftList(): Promise<F2bClientResult> {
        return this.runBin('nft', ['list', 'ruleset']);
    }
}
