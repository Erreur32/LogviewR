/**
 * IptablesService — read/write iptables rules + backup/restore.
 * Requires NET_ADMIN capability (Docker: cap_add: [NET_ADMIN]).
 * When running as non-root (e.g. Docker node user), uses sudo for privileged commands.
 */

import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execFileAsync = promisify(execFile);
const EXEC_TIMEOUT = 10_000;

/** Returns [cmd, args] — prepends sudo when not running as root. */
function priv(cmd: string, args: string[]): [string, string[]] {
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    return isRoot ? [cmd, args] : ['sudo', [cmd, ...args]];
}

export interface IptResult { ok: boolean; output: string; error?: string }
export interface BackupEntry { filename: string; size: number; ts: number }

export interface IptRule {
    num: number; pkts: string; bytes: string; target: string; prot: string;
    iface_in: string; iface_out: string; source: string; dest: string; options: string;
}
export interface IptChain { name: string; policy: string; rules: IptRule[] }

function parseIptOutput(text: string): IptChain[] {
    const chains: IptChain[] = [];
    let current: IptChain | null = null;
    for (const line of text.split('\n')) {
        const cm = line.match(/^Chain\s+(\S+)\s+\(policy\s+(\S+)/);
        if (cm) { current = { name: cm[1], policy: cm[2], rules: [] }; chains.push(current); continue; }
        if (!current) continue;
        if (/^\s*(num\s+pkts|pkts\s+bytes)/i.test(line)) continue;
        if (!line.trim()) continue;
        const p = line.trim().split(/\s+/);
        if (p.length < 10) continue;
        const num = Number.parseInt(p[0], 10);
        if (Number.isNaN(num)) continue;
        // Fields: num pkts bytes target prot opt in out source dest [options...]
        current.rules.push({ num, pkts: p[1], bytes: p[2], target: p[3], prot: p[4], iface_in: p[6], iface_out: p[7], source: p[8], dest: p[9], options: p.slice(10).join(' ') });
    }
    return chains;
}

function getBackupDir(): string {
    return path.join(process.cwd(), 'data', 'iptables-backups');
}

function ensureBackupDir(): void {
    try { fs.mkdirSync(getBackupDir(), { recursive: true }); } catch { /* ignore */ }
}

function notAvailable(bin: string): IptResult {
    return { ok: false, output: '', error: `${bin} non disponible.\nVérifiez que NET_ADMIN est activé dans docker-compose.yml :\n  cap_add:\n    - NET_ADMIN\nEt que les outils sont installés (iptables).` };
}

export class IptablesService {

    // ── Read ──────────────────────────────────────────────────────────────────

    static async save(): Promise<IptResult> {
        try {
            const [c, a] = priv('iptables-save', []);
            const { stdout } = await execFileAsync(c, a, { timeout: EXEC_TIMEOUT });
            return { ok: true, output: stdout };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('ENOENT')) return notAvailable('iptables-save');
            return { ok: false, output: '', error: msg };
        }
    }

    /** Run iptables -L -v -n --line-numbers and return parsed chains. */
    static async listParsed(table?: string): Promise<{ ok: boolean; chains?: IptChain[]; error?: string }> {
        const args = ['-L', '-v', '-n', '--line-numbers'];
        if (table) args.push('-t', table);
        try {
            const [c, a] = priv('iptables', args);
            const { stdout } = await execFileAsync(c, a, { timeout: EXEC_TIMEOUT });
            return { ok: true, chains: parseIptOutput(stdout) };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('ENOENT')) return { ok: false, error: notAvailable('iptables').error };
            return { ok: false, error: msg };
        }
    }

    /** Extract table names from iptables-save output (lines starting with *). */
    static parseTables(saveOutput: string): string[] {
        return saveOutput
            .split('\n')
            .filter(l => l.startsWith('*'))
            .map(l => l.slice(1).trim())
            .filter(Boolean);
    }

    // ── Write ─────────────────────────────────────────────────────────────────

    static async addRule(table: string, chain: string, ruleArgs: string[]): Promise<IptResult> {
        // Validate table name (only lowercase alpha, max 10 chars)
        if (!/^[a-z]{1,10}$/.test(table)) return { ok: false, output: '', error: 'Table invalide' };
        if (!/^[A-Z_]{1,32}$/.test(chain)) return { ok: false, output: '', error: 'Chain invalide' };
        try {
            const [c, a] = priv('iptables', ['-t', table, '-A', chain, ...ruleArgs]);
            const { stdout } = await execFileAsync(c, a, { timeout: EXEC_TIMEOUT });
            return { ok: true, output: stdout.trim() || 'Règle ajoutée' };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('ENOENT')) return notAvailable('iptables');
            return { ok: false, output: '', error: msg };
        }
    }

    /** Insert a rule at position pos (1 = top). Used for IP banning. */
    static async insertRule(table: string, chain: string, pos: number, specArgs: string[]): Promise<IptResult> {
        if (!/^[a-z]{1,10}$/.test(table)) return { ok: false, output: '', error: 'Table invalide' };
        if (!/^[A-Z_]{1,32}$/.test(chain)) return { ok: false, output: '', error: 'Chain invalide' };
        if (!Number.isInteger(pos) || pos < 1) return { ok: false, output: '', error: 'Position invalide' };
        try {
            const [c, a] = priv('iptables', ['-t', table, '-I', chain, String(pos), ...specArgs]);
            const { stdout } = await execFileAsync(c, a, { timeout: EXEC_TIMEOUT });
            return { ok: true, output: stdout.trim() || 'Règle insérée' };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('ENOENT')) return notAvailable('iptables');
            return { ok: false, output: '', error: msg };
        }
    }

    /** Delete first rule matching spec args. Used for IP unbanning. */
    static async deleteRuleSpec(table: string, chain: string, specArgs: string[]): Promise<IptResult> {
        if (!/^[a-z]{1,10}$/.test(table)) return { ok: false, output: '', error: 'Table invalide' };
        if (!/^[A-Z_]{1,32}$/.test(chain)) return { ok: false, output: '', error: 'Chain invalide' };
        try {
            const [c, a] = priv('iptables', ['-t', table, '-D', chain, ...specArgs]);
            const { stdout } = await execFileAsync(c, a, { timeout: EXEC_TIMEOUT });
            return { ok: true, output: stdout.trim() || 'Règle supprimée' };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('ENOENT')) return notAvailable('iptables');
            return { ok: false, output: '', error: msg };
        }
    }

    static async deleteRule(table: string, chain: string, rulenum: number): Promise<IptResult> {
        if (!/^[a-z]{1,10}$/.test(table)) return { ok: false, output: '', error: 'Table invalide' };
        if (!/^[A-Z_]{1,32}$/.test(chain)) return { ok: false, output: '', error: 'Chain invalide' };
        if (!Number.isInteger(rulenum) || rulenum < 1) return { ok: false, output: '', error: 'Numéro de règle invalide' };
        try {
            const [c, a] = priv('iptables', ['-t', table, '-D', chain, String(rulenum)]);
            const { stdout } = await execFileAsync(c, a, { timeout: EXEC_TIMEOUT });
            return { ok: true, output: stdout.trim() || 'Règle supprimée' };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('ENOENT')) return notAvailable('iptables');
            return { ok: false, output: '', error: msg };
        }
    }

    static async restore(content: string): Promise<IptResult> {
        return new Promise<IptResult>(resolve => {
            let settled = false;
            const settle = (r: IptResult) => { if (!settled) { settled = true; resolve(r); } };

            const [c, a] = priv('iptables-restore', []);
            const proc = spawn(c, a, { timeout: EXEC_TIMEOUT });
            let stderr = '';
            proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
            proc.on('close', (code: number | null) => {
                if (code === 0) settle({ ok: true, output: 'Règles restaurées avec succès' });
                else settle({ ok: false, output: '', error: stderr.trim() || `Exit code ${code}` });
            });
            proc.on('error', (err: Error) => {
                if (err.message.includes('ENOENT')) settle(notAvailable('iptables-restore'));
                else settle({ ok: false, output: '', error: err.message });
            });
            proc.stdin.write(content, 'utf8');
            proc.stdin.end();
        });
    }

    // ── Backups ───────────────────────────────────────────────────────────────

    static async saveBackup(label?: string): Promise<{ ok: boolean; filename?: string; error?: string }> {
        ensureBackupDir();
        const r = await this.save();
        if (!r.ok) return { ok: false, error: r.error };
        const ts = new Date().toISOString().replaceAll(/[:.]/g, '-').replace('T', '_').slice(0, 19);
        const safe = (label ?? '').replaceAll(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
        const filename = safe ? `${ts}-${safe}.rules` : `${ts}.rules`;
        try {
            fs.writeFileSync(path.join(getBackupDir(), filename), r.output, 'utf8');
            return { ok: true, filename };
        } catch (err: unknown) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    }

    static listBackups(): BackupEntry[] {
        ensureBackupDir();
        try {
            return fs.readdirSync(getBackupDir())
                .filter(f => f.endsWith('.rules'))
                .map(f => {
                    const st = fs.statSync(path.join(getBackupDir(), f));
                    return { filename: f, size: st.size, ts: Math.floor(st.mtimeMs) };
                })
                .sort((a, b) => b.ts - a.ts)
                .slice(0, 50); // keep last 50
        } catch { return []; }
    }

    static async restoreFromFile(filename: string): Promise<IptResult> {
        const safe = path.basename(filename);
        const fullPath = path.join(getBackupDir(), safe);
        // Security: must stay in backup dir
        if (!fullPath.startsWith(getBackupDir() + path.sep)) return { ok: false, output: '', error: 'Chemin invalide' };
        let content: string;
        try { content = fs.readFileSync(fullPath, 'utf8'); }
        catch { return { ok: false, output: '', error: `Fichier introuvable: ${safe}` }; }
        return this.restore(content);
    }

    static deleteBackup(filename: string): { ok: boolean; error?: string } {
        const safe = path.basename(filename);
        const fullPath = path.join(getBackupDir(), safe);
        if (!fullPath.startsWith(getBackupDir() + path.sep)) return { ok: false, error: 'Chemin invalide' };
        try { fs.unlinkSync(fullPath); return { ok: true }; }
        catch (err: unknown) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
    }

    // ── IPSet Backups ─────────────────────────────────────────────────────────

    static async saveIpsetBackup(label?: string): Promise<{ ok: boolean; filename?: string; error?: string }> {
        ensureBackupDir();
        try {
            const [c, a] = priv('ipset', ['save']);
            const { stdout } = await execFileAsync(c, a, { timeout: EXEC_TIMEOUT, maxBuffer: 16 * 1024 * 1024 });
            const ts = new Date().toISOString().replaceAll(/[:.]/g, '-').replace('T', '_').slice(0, 19);
            const safe = (label ?? '').replaceAll(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
            const filename = safe ? `${ts}-${safe}.ipset` : `${ts}.ipset`;
            fs.writeFileSync(path.join(getBackupDir(), filename), stdout, 'utf8');
            return { ok: true, filename };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('ENOENT')) return { ok: false, error: 'ipset non disponible. Vérifiez NET_ADMIN dans docker-compose.yml.' };
            return { ok: false, error: msg };
        }
    }

    static listIpsetBackups(): BackupEntry[] {
        ensureBackupDir();
        try {
            return fs.readdirSync(getBackupDir())
                .filter(f => f.endsWith('.ipset'))
                .map(f => {
                    const st = fs.statSync(path.join(getBackupDir(), f));
                    return { filename: f, size: st.size, ts: Math.floor(st.mtimeMs) };
                })
                .sort((a, b) => b.ts - a.ts)
                .slice(0, 50);
        } catch { return []; }
    }

    static async restoreIpsetFromFile(filename: string): Promise<IptResult> {
        const safe = path.basename(filename);
        const fullPath = path.join(getBackupDir(), safe);
        if (!fullPath.startsWith(getBackupDir() + path.sep)) return { ok: false, output: '', error: 'Chemin invalide' };
        let content: string;
        try { content = fs.readFileSync(fullPath, 'utf8'); }
        catch { return { ok: false, output: '', error: `Fichier introuvable: ${safe}` }; }
        return new Promise<IptResult>(resolve => {
            let settled = false;
            const settle = (r: IptResult) => { if (!settled) { settled = true; resolve(r); } };
            const [c, a] = priv('ipset', ['restore']);
            const proc = spawn(c, a, { timeout: EXEC_TIMEOUT });
            let stderr = '';
            proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
            proc.on('close', (code: number | null) => {
                if (code === 0) settle({ ok: true, output: 'Sets restaurés avec succès' });
                else settle({ ok: false, output: '', error: stderr.trim() || `Exit code ${code}` });
            });
            proc.on('error', (err: Error) => {
                if (err.message.includes('ENOENT')) settle({ ok: false, output: '', error: 'ipset non disponible' });
                else settle({ ok: false, output: '', error: err.message });
            });
            proc.stdin.write(content, 'utf8');
            proc.stdin.end();
        });
    }

    static deleteIpsetBackup(filename: string): { ok: boolean; error?: string } {
        const safe = path.basename(filename);
        const fullPath = path.join(getBackupDir(), safe);
        if (!fullPath.startsWith(getBackupDir() + path.sep)) return { ok: false, error: 'Chemin invalide' };
        try { fs.unlinkSync(fullPath); return { ok: true }; }
        catch (err: unknown) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
    }
}
