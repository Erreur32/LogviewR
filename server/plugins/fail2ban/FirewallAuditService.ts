/**
 * FirewallAuditService — cross-checks fail2ban jails against the live iptables/ipset/nftables
 * state to detect coherence issues: missing chains, missing jump rules, ipsets that exist but
 * are never enforced by a firewall rule, banned IPs that aren't actually blocked, and stale
 * kernel-level entries fail2ban no longer knows about.
 *
 * Read-only: every finding carries a suggested command as text — nothing is executed here.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { JailMeta } from './jailConfigParser.js';
import type { Fail2banClientExec } from './Fail2banClientExec.js';

export type IssueSeverity = 'critical' | 'warning' | 'info';
export type IssueCategory = 'chain' | 'jump' | 'ipset' | 'orphan-ipset' | 'dangling-rule' | 'ip-mismatch' | 'unsupported';

export interface FirewallIssue {
    id: string;
    severity: IssueSeverity;
    category: IssueCategory;
    jail?: string;
    /** i18n key under fail2ban.coherence.issues.* — frontend renders it via t(messageKey, messageParams). */
    messageKey: string;
    messageParams?: Record<string, string | number>;
    /** i18n key under fail2ban.coherence.fixes.* — same interpolation, frontend renders it via t(fixKey, fixParams). */
    fixKey?: string;
    fixParams?: Record<string, string | number>;
}

export interface FirewallAuditResult {
    ok: boolean;
    generatedAt: number;
    jailsChecked: number;
    jailsSkipped: string[];
    issues: FirewallIssue[];
    summary: { critical: number; warning: number; info: number };
    error?: string;
}

export interface AuditDeps {
    confBase: string;
    client: Fail2banClientExec;
    activeJails: string[];
    jailMeta: Record<string, JailMeta>;
}

// ── action.d template parsing ──────────────────────────────────────────────────

interface ActionMechanism {
    kind: 'chain' | 'ipset' | 'nftables' | 'other';
    targetName?: string;   // chain name or ipset name, resolved for this jail
    parentChain?: string;  // chain the jail's rule is jumped/matched from (best-effort default)
}

/**
 * Parses a fail2ban action.d/*.conf file. Unlike jail.conf, each continuation line
 * is a distinct shell command and must keep its own line break — so this does NOT
 * reuse jailConfigParser's continuation logic, which joins with a single space.
 */
function readActionTemplate(actionFilePath: string): { init: Record<string, string>; actionban?: string; actionstart?: string } | null {
    let text: string;
    try { text = fs.readFileSync(actionFilePath, 'utf8'); } catch { return null; }

    const sections: Record<string, Record<string, string>> = {};
    let section = '';
    let lastKey = '';
    for (const rawLine of text.split(/\r?\n/)) {
        const isContinuation = /^\s+\S/.test(rawLine);
        const line = rawLine.replace(/#.*$/, '').trim();
        if (!line) { lastKey = ''; continue; }
        const secMatch = line.match(/^\[([^\]]+)\]$/);
        if (secMatch) { section = secMatch[1].toLowerCase(); lastKey = ''; continue; }
        if (isContinuation && lastKey && section) {
            sections[section] ??= {};
            sections[section][lastKey] = `${sections[section][lastKey] ?? ''}\n${line}`;
            continue;
        }
        const kvMatch = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*(.*)$/);
        if (!kvMatch || !section) { lastKey = ''; continue; }
        const key = kvMatch[1].toLowerCase();
        lastKey = key;
        sections[section] ??= {};
        sections[section][key] = kvMatch[2].trim();
    }

    const definition = sections['definition'] ?? {};
    return { init: sections['init'] ?? {}, actionban: definition['actionban'], actionstart: definition['actionstart'] };
}

/** Resolve fail2ban's <tag> interpolation (distinct from jail.conf's %(key)s style). */
export function resolveTags(text: string, jail: string, init: Record<string, string>, depth = 0): string {
    if (!text || depth > 4) return text ?? '';
    let changed = false;
    const out = text.replaceAll(/<([a-zA-Z_][a-zA-Z0-9_]*)>/g, (full, key: string) => {
        if (key === 'name') { changed = true; return jail; }
        if (key === 'ip') return full; // no concrete IP at this stage — keep as placeholder
        if (init[key] !== undefined) { changed = true; return init[key]; }
        return full;
    });
    return changed && /<[a-zA-Z_]+>/.test(out) ? resolveTags(out, jail, init, depth + 1) : out;
}

/** Find the chain a jail-specific chain/ipset is actually wired into, by scanning actionstart. */
function findParentChain(startText: string, targetName: string, matchSet: boolean): string | undefined {
    for (const line of startText.split('\n')) {
        const insertMatch = line.match(/-[IA]\s+(\S+)\b/i);
        if (!insertMatch || insertMatch[1] === targetName) continue;
        if (matchSet) {
            const ms = line.match(/--match-set\s+(\S+)/i);
            if (ms?.[1] === targetName) return insertMatch[1];
        } else {
            const jump = line.match(/-j\s+(\S+)/i);
            if (jump?.[1] === targetName) return insertMatch[1];
        }
    }
    return undefined;
}

/** Determine how a jail actually bans IPs (iptables chain, ipset, nftables, or unsupported/other). */
export function detectMechanism(jail: string, banaction: string | undefined, confBase: string): ActionMechanism | null {
    if (!banaction) return null;
    const actionName = banaction.replace(/\[.*$/, '').trim();
    if (!actionName) return null;
    const localFile = path.join(confBase, 'action.d', `${actionName}.local`);
    const confFile  = path.join(confBase, 'action.d', `${actionName}.conf`);
    const tpl = readActionTemplate(fs.existsSync(localFile) ? localFile : confFile);
    if (!tpl) return null;
    if (!tpl.actionban) return { kind: 'other' };

    const ban = resolveTags(tpl.actionban, jail, tpl.init);
    const start = resolveTags(tpl.actionstart ?? '', jail, tpl.init);

    if (/\bipset\b/i.test(ban)) {
        const setName = ban.match(/ipset\s+(?:-\S+\s+)*add\s+(\S+)/i)?.[1];
        if (!setName) return { kind: 'other' };
        return { kind: 'ipset', targetName: setName, parentChain: findParentChain(start, setName, true) };
    }
    if (/\bnft\b/i.test(ban)) {
        return { kind: 'nftables', targetName: jail };
    }
    if (/\biptables\b|\bip6tables\b/i.test(ban)) {
        const chainName = ban.match(/-[IA]\s+(\S+)\b/i)?.[1];
        if (!chainName) return { kind: 'other' };
        return { kind: 'chain', targetName: chainName, parentChain: findParentChain(start, chainName, false) };
    }
    return { kind: 'other' };
}

// ── iptables-save parsing ──────────────────────────────────────────────────────

interface IptSaveRule { chain: string; raw: string; sourceIp?: string; matchSet?: string; jumpTarget?: string }
interface IptSaveDump { chains: Set<string>; rules: IptSaveRule[] }

export function parseIptablesSave(text: string): IptSaveDump {
    const chains = new Set<string>();
    const rules: IptSaveRule[] = [];
    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#') || line.startsWith('*') || line === 'COMMIT') continue;
        const chainDecl = line.match(/^:(\S+)\s/);
        if (chainDecl) { chains.add(chainDecl[1]); continue; }
        if (!line.startsWith('-A ')) continue;
        const chain = line.match(/^-A\s+(\S+)/)?.[1];
        if (!chain) continue;
        rules.push({
            chain,
            raw: line,
            sourceIp: line.match(/-s\s+([0-9a-fA-F.:]+)(?:\/\d+)?\b/)?.[1],
            matchSet: line.match(/--match-set\s+(\S+)/)?.[1],
            jumpTarget: line.match(/-j\s+(\S+)/)?.[1],
        });
    }
    return { chains, rules };
}

// ── Main audit ──────────────────────────────────────────────────────────────────

export async function auditFirewallCoherence(deps: AuditDeps): Promise<FirewallAuditResult> {
    const { confBase, client, activeJails, jailMeta } = deps;
    const issues: FirewallIssue[] = [];
    const jailsSkipped: string[] = [];
    const reportedOrphanSets = new Set<string>();
    const addIssue = (i: Omit<FirewallIssue, 'id'>): void => { issues.push({ id: String(issues.length), ...i }); };

    const [iptRes, ipsetRes, nftRes] = await Promise.all([
        client.iptablesSave(),
        client.ipsetInfo(),
        client.nftList(),
    ]);

    if (!iptRes.ok && !ipsetRes.ok) {
        return {
            ok: false, generatedAt: Date.now(), jailsChecked: 0, jailsSkipped: [], issues: [],
            summary: { critical: 0, warning: 0, info: 0 },
            error: iptRes.error || ipsetRes.error || 'iptables et ipset indisponibles (NET_ADMIN requis).',
        };
    }

    const dump = iptRes.ok ? parseIptablesSave(iptRes.output) : { chains: new Set<string>(), rules: [] };
    const nftText = nftRes.ok ? nftRes.output : '';
    const ipsetSets = new Map((ipsetRes.sets ?? []).map(s => [s.name, s]));

    let jailsChecked = 0;

    for (const jail of activeJails) {
        const meta = jailMeta[jail];
        const mech = detectMechanism(jail, meta?.banaction, confBase);
        if (!mech || mech.kind === 'other' || !mech.targetName) { jailsSkipped.push(jail); continue; }
        jailsChecked++;

        const status = await client.getJailStatus(jail);
        const bannedIps = new Set(status?.bannedIps ?? []);

        if (mech.kind === 'chain') {
            const chainName = mech.targetName;
            if (!dump.chains.has(chainName)) {
                addIssue({
                    severity: 'critical', jail, category: 'chain',
                    messageKey: 'chainMissing', messageParams: { chain: chainName, jail, banaction: meta?.banaction ?? '' },
                    fixKey: 'reloadJail', fixParams: { jail },
                });
                continue;
            }
            const hasJump = dump.rules.some(r => r.chain !== chainName && r.jumpTarget === chainName);
            if (!hasJump) {
                addIssue({
                    severity: 'critical', jail, category: 'jump',
                    messageKey: 'noJumpRule', messageParams: { chain: chainName, jail },
                    fixKey: 'noJumpRule', fixParams: { jail, parentChain: mech.parentChain ?? 'INPUT', chain: chainName },
                });
            }
            const kernelIps = new Set(dump.rules.filter(r => r.chain === chainName && r.sourceIp).map(r => r.sourceIp!));
            for (const ip of bannedIps) {
                if (!kernelIps.has(ip)) {
                    addIssue({
                        severity: 'critical', jail, category: 'ip-mismatch',
                        messageKey: 'ipMissingInChain', messageParams: { ip, jail, chain: chainName },
                        fixKey: 'banIp', fixParams: { jail, ip },
                    });
                }
            }
            for (const ip of kernelIps) {
                if (!bannedIps.has(ip)) {
                    addIssue({
                        severity: 'warning', jail, category: 'ip-mismatch',
                        messageKey: 'ipOrphanInChain', messageParams: { ip, chain: chainName, jail },
                        fixKey: 'ipOrphanInChain', fixParams: { chain: chainName, ip },
                    });
                }
            }
        } else if (mech.kind === 'ipset') {
            const setName = mech.targetName;
            const set = ipsetSets.get(setName);
            if (!set) {
                addIssue({
                    severity: 'critical', jail, category: 'ipset',
                    messageKey: 'ipsetMissing', messageParams: { set: setName, jail, banaction: meta?.banaction ?? '' },
                    fixKey: 'reloadJail', fixParams: { jail },
                });
                continue;
            }
            const referenced = dump.rules.some(r => r.matchSet === setName) || nftText.includes(setName);
            reportedOrphanSets.add(setName);
            if (!referenced) {
                addIssue({
                    severity: 'critical', jail, category: 'orphan-ipset',
                    messageKey: 'ipsetNotReferenced', messageParams: { set: setName, count: set.entries, jail },
                    fixKey: 'ipsetNotReferenced', fixParams: { jail, banaction: meta?.banaction ?? '', parentChain: mech.parentChain ?? 'INPUT', set: setName },
                });
            }
            if (set.entries > 0) {
                const entriesRes = await client.ipsetEntries(setName);
                if (entriesRes.ok) {
                    const kernelIps = new Set(entriesRes.entries.map(e => e.split(' ')[0]));
                    for (const ip of bannedIps) {
                        if (!kernelIps.has(ip)) {
                            addIssue({
                                severity: 'critical', jail, category: 'ip-mismatch',
                                messageKey: 'ipMissingInIpset', messageParams: { ip, jail, set: setName },
                                fixKey: 'banIp', fixParams: { jail, ip },
                            });
                        }
                    }
                    for (const ip of kernelIps) {
                        if (!bannedIps.has(ip)) {
                            addIssue({
                                severity: 'warning', jail, category: 'ip-mismatch',
                                messageKey: 'ipOrphanInIpset', messageParams: { ip, set: setName, jail },
                                fixKey: 'delFromIpset', fixParams: { set: setName, ip },
                            });
                        }
                    }
                }
            }
        } else if (mech.kind === 'nftables') {
            if (!nftRes.ok || !nftText.includes(jail)) {
                addIssue({
                    severity: 'info', jail, category: 'unsupported',
                    messageKey: 'nftablesUnverified', messageParams: { jail },
                    fixKey: 'nftablesUnverified', fixParams: { jail },
                });
            }
        }
    }

    // Global sweep — ipsets with entries never enforced by any rule (covers blocklists too)
    for (const [name, set] of ipsetSets) {
        if (name.startsWith('docker-') || set.entries === 0 || reportedOrphanSets.has(name)) continue;
        const referenced = dump.rules.some(r => r.matchSet === name) || nftText.includes(name);
        if (!referenced) {
            addIssue({
                severity: 'warning', category: 'orphan-ipset',
                messageKey: 'orphanIpsetGlobal', messageParams: { set: name, count: set.entries },
                fixKey: 'orphanIpsetGlobal', fixParams: { set: name },
            });
        }
    }

    // Global sweep — rules referencing a --match-set whose ipset doesn't exist
    const danglingSeen = new Set<string>();
    for (const r of dump.rules) {
        if (!r.matchSet || ipsetSets.has(r.matchSet) || danglingSeen.has(r.matchSet)) continue;
        danglingSeen.add(r.matchSet);
        addIssue({
            severity: 'critical', category: 'dangling-rule',
            messageKey: 'danglingRule', messageParams: { rule: r.raw, set: r.matchSet },
            fixKey: 'danglingRule', fixParams: { set: r.matchSet, chain: r.chain },
        });
    }

    const summary = {
        critical: issues.filter(i => i.severity === 'critical').length,
        warning: issues.filter(i => i.severity === 'warning').length,
        info: issues.filter(i => i.severity === 'info').length,
    };

    return { ok: true, generatedAt: Date.now(), jailsChecked, jailsSkipped, issues, summary };
}
