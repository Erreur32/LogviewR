/**
 * Fail2ban Client Executor
 *
 * Wraps fail2ban-client CLI commands. Requires:
 *   - fail2ban-client installed in the container (apk add fail2ban)
 *   - /var/run/fail2ban/fail2ban.sock mounted and chmod 660
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';

const execFileAsync = promisify(execFile);

const SOCKET_PATH = '/var/run/fail2ban/fail2ban.sock';
const EXEC_TIMEOUT = 10000; // 10s

function findF2bClient(): string {
    for (const p of ['/usr/bin/fail2ban-client', '/bin/fail2ban-client']) {
        try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* try next */ }
    }
    return '/usr/bin/fail2ban-client'; // fallback, will fail with a clear error
}
const F2B_CLIENT = findF2bClient();

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
            currentlyFailed: parseInt(parse(/Currently failed:\s*(\d+)/), 10),
            totalFailed:     parseInt(parse(/Total failed:\s*(\d+)/),     10),
            currentlyBanned: parseInt(parse(/Currently banned:\s*(\d+)/), 10),
            totalBanned:     parseInt(parse(/Total banned:\s*(\d+)/),     10),
            bannedIps,
            fileList: parse(/File list:\s*(.*)/),
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
        const n = parseInt(res.output.trim(), 10);
        return isNaN(n) ? undefined : n;
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

    private async runBin(bin: string, args: string[]): Promise<F2bClientResult> {
        try {
            const { stdout } = await execFileAsync(bin, args, { timeout: EXEC_TIMEOUT });
            return { ok: true, output: stdout.trim() };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            const missing = msg.includes('ENOENT') || msg.includes('not found');
            return {
                ok: false, output: '',
                error: missing
                    ? `${bin} non disponible dans le container.\nAjoutez dans docker-compose.yml :\n  cap_add:\n    - NET_ADMIN\nEt dans Dockerfile :\n  RUN apk add --no-cache iptables ipset nftables`
                    : msg,
            };
        }
    }

    async iptablesSave(): Promise<F2bClientResult> {
        return this.runBin('iptables-save', []);
    }

    async ipsetList(): Promise<F2bClientResult> {
        return this.runBin('ipset', ['list']);
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
                sets.push({ name: current, entries: parseInt(entriesMatch[1], 10) });
                current = null;
            }
        }
        return sets;
    }

    async ipsetAdd(setName: string, entry: string): Promise<F2bClientResult> {
        return this.runBin('ipset', ['add', setName, entry]);
    }

    async ipsetDel(setName: string, entry: string): Promise<F2bClientResult> {
        return this.runBin('ipset', ['del', setName, entry]);
    }

    async nftList(): Promise<F2bClientResult> {
        return this.runBin('nft', ['list', 'ruleset']);
    }
}
