/**
 * Jail config parser — reads jail.conf/jail.local/jail.d/*.{conf,local} and
 * resolves per-jail metadata (filter, banaction, bantime, etc.).
 * Shared between Fail2banPlugin (routes) and FirewallAuditService.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface JailMeta {
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
export function parseJailIniFile(filePath: string, defaults: Record<string, string>, result: Record<string, Record<string, string>>): void {
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
export function parseJailConfigs(confBase: string): Record<string, JailMeta> {
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
            const n = Number.parseFloat(suffixMatch[1]);
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
            return v.replaceAll(/%\(([^)]+)\)s/g, (_, key) => {
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
            maxretry:  get('maxretry') !== undefined ? Number.parseInt(get('maxretry')!, 10) : undefined,
            enabled:   enabledRaw !== undefined ? (enabledRaw.toLowerCase() !== 'false' && enabledRaw !== '0') : true,
            logpath:   resolveVars(get('logpath')),
        };
    }
    return result;
}
