import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, Trash2, RotateCcw, Plus, AlertTriangle, CheckCircle, Network, Code, Table2, ChevronDown, ChevronRight, Archive } from 'lucide-react';
import { api } from '../../api/client';
import { card, cardH, cardB, F2bTooltip } from './helpers';

// ── Types ──────────────────────────────────────────────────────────────────────

interface IptRule { num: number; pkts: string; bytes: string; target: string; prot: string; iface_in: string; iface_out: string; source: string; dest: string; options: string }
interface IptChain { name: string; policy: string; rules: IptRule[] }
interface RollbackStatus { pending: boolean; deadline: number | null }

// ── Colorizer (raw view) ───────────────────────────────────────────────────────

type Token = { text: string; color?: string; bold?: boolean };

function colorizeIptLine(line: string): Token[] {
    if (!line) return [{ text: '' }];
    if (line.startsWith('#')) return [{ text: line, color: '#555d69' }];
    if (line.startsWith('*')) return [{ text: '*', color: '#8b949e' }, { text: line.slice(1), color: '#39c5cf', bold: true }];
    if (line.startsWith(':')) {
        const m = line.match(/^:(\S+)\s+(\S+)(.*)$/);
        if (m) {
            const polColor = m[2] === 'DROP' || m[2] === 'REJECT' ? '#e86a65' : m[2] === 'ACCEPT' ? '#3fb950' : '#e3b341';
            return [{ text: ':', color: '#8b949e' }, { text: m[1], color: '#58a6ff', bold: true }, { text: ' ' }, { text: m[2], color: polColor, bold: true }, { text: m[3] ?? '', color: '#555d69' }];
        }
        return [{ text: line, color: '#58a6ff' }];
    }
    if (line.trim() === 'COMMIT') return [{ text: 'COMMIT', color: '#e3b341', bold: true }];

    const tokens: Token[] = [];
    const parts = line.split(/(\s+)/);
    let i = 0;
    while (i < parts.length) {
        const p = parts[i];
        if (p.trim() === '') { tokens.push({ text: p }); i++; continue; }
        if (i >= 2 && parts[i - 2]?.trim() === '-j') {
            const color = p === 'ACCEPT' ? '#3fb950' : (p === 'DROP' || p === 'REJECT') ? '#e86a65' : p === 'LOG' ? '#e3b341' : '#bc8cff';
            tokens.push({ text: p, color, bold: true }); i++; continue;
        }
        if (i >= 2 && (parts[i - 2]?.trim() === '-A' || parts[i - 2]?.trim() === '-I' || parts[i - 2]?.trim() === '-D')) {
            tokens.push({ text: p, color: '#58a6ff', bold: true }); i++; continue;
        }
        if (/^-{1,2}[a-zA-Z]/.test(p)) { tokens.push({ text: p, color: '#8b949e' }); i++; continue; }
        if (/^[\d.]{7,}(\/\d+)?$/.test(p) || /^[0-9a-f:]{3,}(\/\d+)?$/i.test(p)) { tokens.push({ text: p, color: '#39c5cf' }); i++; continue; }
        if (/^\d{1,5}$/.test(p) || /^\d+:\d+$/.test(p)) { tokens.push({ text: p, color: '#e3b341' }); i++; continue; }
        tokens.push({ text: p, color: '#e6edf3' });
        i++;
    }
    return tokens;
}

function ColorLine({ line }: { line: string }) {
    const tokens = colorizeIptLine(line);
    return <span>{tokens.map((t, i) => <span key={i} style={{ color: t.color, fontWeight: t.bold ? 700 : undefined }}>{t.text}</span>)}</span>;
}

// ── Rollback Banner ────────────────────────────────────────────────────────────

function RollbackBanner({ countdown, onConfirm, onRollback, loading }: { countdown: number; onConfirm: () => void; onRollback: () => void; loading: boolean }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', background: 'rgba(232,106,101,.08)', border: '1px solid rgba(232,106,101,.3)', borderRadius: 6, padding: '.6rem .85rem', flexWrap: 'wrap' }}>
            <AlertTriangle style={{ width: 14, height: 14, color: '#e86a65', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
                <span style={{ fontSize: '.82rem', color: '#e86a65', fontWeight: 600 }}>Rollback automatique dans </span>
                <span style={{ fontSize: '.95rem', fontWeight: 800, color: '#e86a65', fontFamily: 'monospace' }}>{countdown}s</span>
                <span style={{ fontSize: '.76rem', color: '#8b949e', marginLeft: '.5rem' }}>— confirmez ou annulez</span>
            </div>
            <F2bTooltip title="Confirmer" body="Garder les règles actuelles — annule le rollback" color="green">
                <button onClick={onConfirm} style={{ background: 'rgba(63,185,80,.12)', border: '1px solid rgba(63,185,80,.3)', color: '#3fb950', borderRadius: 4, cursor: 'pointer', padding: '.25rem .65rem', fontSize: '.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '.3rem' }}>
                    <CheckCircle style={{ width: 12, height: 12 }} /> Confirmer
                </button>
            </F2bTooltip>
            <F2bTooltip title="Rollback" body="Restaurer les règles d'avant la modification" color="red">
                <button onClick={onRollback} disabled={loading} style={{ background: 'rgba(232,106,101,.12)', border: '1px solid rgba(232,106,101,.3)', color: '#e86a65', borderRadius: 4, cursor: loading ? 'default' : 'pointer', padding: '.25rem .65rem', fontSize: '.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '.3rem', opacity: loading ? .6 : 1 }}>
                    <RotateCcw style={{ width: 12, height: 12 }} /> Rollback
                </button>
            </F2bTooltip>
        </div>
    );
}

// ── Target Badge ───────────────────────────────────────────────────────────────

function TargetBadge({ target }: { target: string }) {
    const t = target.toUpperCase();
    const color = t === 'ACCEPT' ? '#3fb950' : (t === 'DROP' || t === 'REJECT') ? '#e86a65' : '#bc8cff';
    const bg    = t === 'ACCEPT' ? 'rgba(63,185,80,.12)' : (t === 'DROP' || t === 'REJECT') ? 'rgba(232,106,101,.12)' : 'rgba(188,140,255,.1)';
    return <span style={{ background: bg, color, border: `1px solid ${color}40`, borderRadius: 3, padding: '.08rem .38rem', fontSize: '.74rem', fontWeight: 700, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{target}</span>;
}

// ── Chain Card ─────────────────────────────────────────────────────────────────

type SortKey = 'num' | 'target' | 'prot' | 'iface_in' | 'iface_out' | 'source' | 'dest' | 'pkts' | 'options';

/** Parse packet count strings like "123K", "4.5M" for numeric sort. */
function parsePkts(s: string): number {
    if (!s) return 0;
    const m = s.match(/^([\d.]+)([KMG]?)$/i);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    const mul = { K: 1e3, M: 1e6, G: 1e9 }[m[2].toUpperCase()] ?? 1;
    return n * mul;
}

function ChainCard({ chain, onDelete, deleting, hiddenDockerRules, onToggleDocker }: { chain: IptChain; onDelete: (chain: string, num: number) => void; deleting: string | null; hiddenDockerRules?: number; onToggleDocker?: () => void }) {
    const { t } = useTranslation();
    const [collapsed, setCollapsed] = useState(false);
    const [sortKey, setSortKey]     = useState<SortKey>('num');
    const [sortAsc, setSortAsc]     = useState(true);

    const pc = chain.policy === 'DROP' || chain.policy === 'REJECT' ? '#e86a65' : chain.policy === 'ACCEPT' ? '#3fb950' : '#e3b341';

    const sortedRules = useMemo(() => {
        const rules = [...chain.rules];
        rules.sort((a, b) => {
            let va: string | number = a[sortKey as keyof IptRule] as string | number;
            let vb: string | number = b[sortKey as keyof IptRule] as string | number;
            if (sortKey === 'num')  { va = a.num;  vb = b.num; }
            if (sortKey === 'pkts') { va = parsePkts(a.pkts); vb = parsePkts(b.pkts); }
            if (typeof va === 'number' && typeof vb === 'number') return sortAsc ? va - vb : vb - va;
            return sortAsc
                ? String(va).localeCompare(String(vb))
                : String(vb).localeCompare(String(va));
        });
        return rules;
    }, [chain.rules, sortKey, sortAsc]);

    const toggleSort = (key: SortKey) => {
        if (sortKey === key) setSortAsc(a => !a);
        else { setSortKey(key); setSortAsc(true); }
    };

    const sortIcon = (key: SortKey) => {
        if (sortKey !== key) return <span style={{ opacity: .3, fontSize: '.7rem' }}>↕</span>;
        return <span style={{ fontSize: '.7rem', color: '#58a6ff' }}>{sortAsc ? '↑' : '↓'}</span>;
    };

    const TH = (key: SortKey, label: string, extra?: React.CSSProperties): React.ReactNode => (
        <th onClick={() => toggleSort(key)}
            style={{ padding: '.3rem .65rem', fontWeight: 700, fontSize: '.66rem', textTransform: 'uppercase', letterSpacing: '.05em', color: sortKey === key ? '#58a6ff' : '#8b949e', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none', ...extra }}>
            {label} {sortIcon(key)}
        </th>
    );
    const TD: React.CSSProperties = { padding: '.38rem .65rem', borderBottom: '1px solid rgba(48,54,61,.5)' };

    return (
        <div style={{ border: '1px solid #30363d', borderRadius: 6, overflow: 'hidden' }}>
            {/* ── Header (clickable to collapse) ── */}
            <div onClick={() => setCollapsed(c => !c)}
                style={{ background: '#21262d', padding: '.5rem .85rem', display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap', cursor: 'pointer', userSelect: 'none' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#262c34'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = '#21262d'}>
                {collapsed
                    ? <ChevronRight style={{ width: 13, height: 13, color: '#555d69', flexShrink: 0 }} />
                    : <ChevronDown  style={{ width: 13, height: 13, color: '#555d69', flexShrink: 0 }} />}
                <Network style={{ width: 13, height: 13, color: '#58a6ff', flexShrink: 0 }} />
                <span style={{ fontWeight: 700, fontSize: '.85rem', color: '#58a6ff' }}>Chain {chain.name}</span>
                <span style={{ color: '#555d69', fontSize: '.74rem' }}>({chain.rules.length} règle{chain.rules.length !== 1 ? 's' : ''})</span>
                <span style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                    {hiddenDockerRules !== undefined && hiddenDockerRules > 0 && onToggleDocker && (
                        <F2bTooltip title="Règles Docker masquées" body={`${hiddenDockerRules} règle${hiddenDockerRules > 1 ? 's' : ''} Docker filtrée${hiddenDockerRules > 1 ? 's' : ''} dans cette chaîne — cliquer pour afficher`} color="blue">
                            <button onClick={e => { e.stopPropagation(); onToggleDocker(); }}
                                style={{ background: 'rgba(88,166,255,.1)', border: '1px solid rgba(88,166,255,.35)', color: '#58a6ff', borderRadius: 4, cursor: 'pointer', padding: '.1rem .45rem', fontSize: '.68rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                +{hiddenDockerRules} Docker
                            </button>
                        </F2bTooltip>
                    )}
                </span>
                <span style={{ background: `${pc}1a`, border: `1px solid ${pc}40`, color: pc, borderRadius: 3, padding: '.1rem .5rem', fontSize: '.72rem', fontWeight: 700, fontFamily: 'monospace' }}>
                    Politique : {chain.policy}
                </span>
            </div>

            {/* ── Body (collapsible) ── */}
            {!collapsed && (
                chain.rules.length === 0
                    ? <div style={{ padding: '.65rem 1rem', color: '#555d69', fontSize: '.8rem' }}>Aucune règle</div>
                    : (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', minWidth: 780, borderCollapse: 'collapse', fontSize: '.77rem', tableLayout: 'fixed' }}>
                                <colgroup>
                                    <col style={{ width: '3%' }} />
                                    <col style={{ width: '10%' }} />
                                    <col style={{ width: '6%' }} />
                                    <col style={{ width: '7%' }} />
                                    <col style={{ width: '7%' }} />
                                    <col style={{ width: '14%' }} />
                                    <col style={{ width: '14%' }} />
                                    <col style={{ width: '7%' }} />
                                    <col />
                                    <col style={{ width: '3%' }} />
                                </colgroup>
                                <thead>
                                    <tr>
                                        {TH('num',      '#',           { textAlign: 'right' })}
                                        {TH('target',   t('fail2ban.labels.target'))}
                                        {TH('prot',     t('fail2ban.labels.protocol'))}
                                        {TH('iface_in', 'In')}
                                        {TH('iface_out','Out')}
                                        {TH('source',   t('fail2ban.labels.source'))}
                                        {TH('dest',     'Destination')}
                                        {TH('pkts',     t('fail2ban.labels.packets'),     { textAlign: 'right' })}
                                        {TH('options',  'Options')}
                                        <th style={{ padding: '.3rem .65rem', borderBottom: '1px solid #30363d' }}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedRules.map((r, i) => {
                                        const dk = `${chain.name}-${r.num}-${i}`;
                                        return (
                                            <tr key={dk}
                                                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.025)'}
                                                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                                                <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: '#555d69' }}>{r.num}</td>
                                                <td style={TD}><TargetBadge target={r.target} /></td>
                                                <td style={{ ...TD, fontFamily: 'monospace', color: '#8b949e' }}>{r.prot}</td>
                                                <td style={{ ...TD, fontFamily: 'monospace', color: '#8b949e', maxWidth: 70, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.iface_in}>{r.iface_in}</td>
                                                <td style={{ ...TD, fontFamily: 'monospace', color: '#8b949e', maxWidth: 70, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.iface_out}>{r.iface_out}</td>
                                                <td style={{ ...TD, fontFamily: 'monospace', color: '#e6edf3', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.source}>{r.source}</td>
                                                <td style={{ ...TD, fontFamily: 'monospace', color: '#e6edf3', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.dest}>{r.dest}</td>
                                                <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: '#8b949e', fontSize: '.72rem' }}>{r.pkts}</td>
                                                <td style={{ ...TD, color: '#8b949e', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.options}>{r.options}</td>
                                                <td style={{ ...TD, textAlign: 'right' }}>
                                                    <F2bTooltip title="Supprimer" body={`Règle #${r.num} de ${chain.name}`} color="red">
                                                        <button onClick={e => { e.stopPropagation(); onDelete(chain.name, r.num); }} disabled={deleting === dk}
                                                            style={{ background: 'rgba(232,106,101,.08)', border: '1px solid rgba(232,106,101,.2)', color: '#e86a65', borderRadius: 3, cursor: deleting === dk ? 'default' : 'pointer', padding: '.18rem .32rem', display: 'inline-flex', alignItems: 'center', opacity: deleting === dk ? .5 : 1 }}>
                                                            <Trash2 style={{ width: 11, height: 11 }} />
                                                        </button>
                                                    </F2bTooltip>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )
            )}
        </div>
    );
}

// ── Ruleset Viewer ─────────────────────────────────────────────────────────────

const TABLES = ['filter', 'nat', 'mangle', 'raw'];

// Patterns for Docker detection (chain names + bridge interfaces)
const DOCKER_CHAIN_RE = /^DOCKER/i;
const DOCKER_IFACE_RE = /^!?(br-[0-9a-f]+|docker\d*|veth[0-9a-f]+)$/i;

function hasDockerContent(chains: IptChain[]): boolean {
    return chains.some(c =>
        DOCKER_CHAIN_RE.test(c.name) ||
        c.rules.some(r => DOCKER_IFACE_RE.test(r.iface_in) || DOCKER_IFACE_RE.test(r.iface_out))
    );
}

function applyDockerFilter(chains: IptChain[]): { visible: IptChain[]; hiddenRules: number; hiddenChains: number; perChainHidden: Record<string, number> } {
    let hiddenRules = 0;
    let hiddenChains = 0;
    const visible: IptChain[] = [];
    const perChainHidden: Record<string, number> = {};
    for (const c of chains) {
        if (DOCKER_CHAIN_RE.test(c.name)) { hiddenChains++; hiddenRules += c.rules.length; continue; }
        const filtered = c.rules.filter(r => !DOCKER_IFACE_RE.test(r.iface_in) && !DOCKER_IFACE_RE.test(r.iface_out));
        const diff = c.rules.length - filtered.length;
        if (diff > 0) perChainHidden[c.name] = diff;
        hiddenRules += diff;
        visible.push({ ...c, rules: filtered });
    }
    return { visible, hiddenRules, hiddenChains, perChainHidden };
}

function RulesetViewer({ refreshToken, onAction }: { refreshToken?: number; onAction: (deadline?: number) => void }) {
    const { t } = useTranslation();
    const [selTable, setSelTable] = useState('filter');
    const [viewMode, setViewMode] = useState<'table' | 'raw'>('table');
    const [chains, setChains]   = useState<IptChain[]>([]);
    const [rawOutput, setRawOutput] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError]     = useState<string | null>(null);
    const [lastLoaded, setLastLoaded] = useState(0);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [hideDocker, setHideDocker] = useState(true);
    const mountedRef = useRef(false);

    const fetchData = useCallback(async (table: string, mode: 'table' | 'raw') => {
        setLoading(true); setError(null);
        try {
            if (mode === 'table') {
                const res = await api.get<{ ok: boolean; chains?: IptChain[]; error?: string }>(`/api/plugins/fail2ban/iptables/parsed?table=${encodeURIComponent(table)}`);
                if (res.success && res.result?.ok) { setChains(res.result.chains ?? []); setLastLoaded(Date.now()); }
                else setError(res.result?.error ?? res.error?.message ?? t('fail2ban.errors.unknown'));
            } else {
                const res = await api.get<{ ok: boolean; output: string; error?: string }>(`/api/plugins/fail2ban/iptables/rules?table=${encodeURIComponent(table)}`);
                if (res.success && res.result?.ok) { setRawOutput(res.result.output ?? ''); setLastLoaded(Date.now()); }
                else setError(res.result?.error ?? res.error?.message ?? t('fail2ban.errors.unknown'));
            }
        } finally { setLoading(false); }
    }, []);

    useEffect(() => { mountedRef.current = true; fetchData('filter', 'table'); }, [fetchData]);
    useEffect(() => {
        if (!mountedRef.current || !refreshToken) return;
        fetchData(selTable, viewMode);
    }, [refreshToken]); // eslint-disable-line react-hooks/exhaustive-deps

    const selectTable = (t: string) => { setSelTable(t); fetchData(t, viewMode); };
    const switchMode  = (m: 'table' | 'raw') => { setViewMode(m); fetchData(selTable, m); };

    const deleteRule = async (chainName: string, rulenum: number) => {
        if (!confirm(`Supprimer la règle #${rulenum} de ${chainName} ?`)) return;
        const dk = `${chainName}-${rulenum}`;
        setDeleting(dk);
        try {
            const res = await api.post<{ ok: boolean; error?: string; rollbackDeadline?: number }>(
                '/api/plugins/fail2ban/iptables/rule/delete', { table: selTable, chain: chainName, rulenum }
            );
            if (res.success && res.result?.ok) {
                onAction(res.result.rollbackDeadline);
                fetchData(selTable, viewMode);
            } else {
                alert(res.result?.error ?? 'Erreur suppression');
            }
        } finally { setDeleting(null); }
    };

    return (
        <div style={card}>
            <div style={{ ...cardH, justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontWeight: 600, fontSize: '.88rem' }}>
                    <Shield style={{ width: 14, height: 14, color: '#39c5cf' }} />
                    Règles IPTables
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
                    {TABLES.map(t => (
                        <button key={t} onClick={() => selectTable(t)} style={{
                            padding: '.12rem .5rem', fontSize: '.7rem', borderRadius: 4, cursor: 'pointer',
                            border: `1px solid ${selTable === t ? 'rgba(57,197,207,.4)' : '#30363d'}`,
                            background: selTable === t ? 'rgba(57,197,207,.12)' : 'transparent',
                            color: selTable === t ? '#39c5cf' : '#8b949e',
                        }}>{t}</button>
                    ))}
                    <button onClick={() => switchMode(viewMode === 'table' ? 'raw' : 'table')}
                        style={{ padding: '.12rem .45rem', fontSize: '.7rem', borderRadius: 4, cursor: 'pointer', border: '1px solid #30363d', background: 'transparent', color: '#8b949e', display: 'flex', alignItems: 'center', gap: '.25rem' }}>
                        {viewMode === 'table' ? <Code style={{ width: 11, height: 11 }} /> : <Table2 style={{ width: 11, height: 11 }} />}
                        {viewMode === 'table' ? 'Voir brut' : 'Vue tableau'}
                    </button>
{lastLoaded > 0 && !loading && <span style={{ fontSize: '.67rem', color: '#555d69' }}>{new Date(lastLoaded).toLocaleTimeString('fr-FR')}</span>}
                </div>
            </div>
            <div style={cardB}>
                {loading && <div style={{ color: '#8b949e', fontSize: '.82rem' }}>{t('common.loading')}</div>}
                {error && (
                    <div style={{ background: 'rgba(227,179,65,.07)', border: '1px solid rgba(227,179,65,.25)', borderRadius: 6, padding: '.75rem 1rem' }}>
                        <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', color: '#e3b341', fontSize: '.82rem', marginBottom: '.4rem' }}>
                            <AlertTriangle style={{ width: 13, height: 13 }} /> Commande non disponible
                        </div>
                        <pre style={{ fontSize: '.75rem', color: '#8b949e', fontFamily: 'monospace', margin: 0, whiteSpace: 'pre-wrap' }}>{error}</pre>
                    </div>
                )}
                {!loading && !error && viewMode === 'table' && (
                    chains.length > 0
                        ? (() => {
                            const { visible, hiddenRules, hiddenChains, perChainHidden } = hideDocker ? applyDockerFilter(chains) : { visible: chains, hiddenRules: 0, hiddenChains: 0, perChainHidden: {} };
                            const toggle = () => setHideDocker(h => !h);
                            return (
                                <>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '.85rem' }}>{visible.map(c => <ChainCard key={c.name} chain={c} onDelete={deleteRule} deleting={deleting} hiddenDockerRules={hideDocker ? (perChainHidden[c.name] ?? 0) : 0} onToggleDocker={toggle} />)}</div>
                                    {(hiddenRules > 0 || hiddenChains > 0) && (
                                        <div style={{ fontSize: '.72rem', color: '#555d69', textAlign: 'center', padding: '.35rem' }}>
                                            {hiddenChains > 0 && <>{hiddenChains} chaîne{hiddenChains > 1 ? 's' : ''} Docker masquée{hiddenChains > 1 ? 's' : ''} — </>}
                                            {hiddenRules} règle{hiddenRules > 1 ? 's' : ''} Docker masquée{hiddenRules > 1 ? 's' : ''}
                                        </div>
                                    )}
                                </>
                            );
                          })()
                        : lastLoaded > 0 && <div style={{ color: '#555d69', fontSize: '.8rem' }}>Aucune règle</div>
                )}
                {!loading && !error && viewMode === 'raw' && rawOutput && (
                    <pre style={{ fontFamily: 'monospace', fontSize: '.78rem', lineHeight: 1.7, margin: 0, overflowX: 'auto', maxHeight: '50vh' }}>
                        {rawOutput.split('\n').map((line, i) => <div key={i} style={{ minHeight: '1em' }}><ColorLine line={line} /></div>)}
                    </pre>
                )}
            </div>
        </div>
    );
}

// ── Rule Builder ───────────────────────────────────────────────────────────────

function RuleBuilder({ onAction }: { onAction: (deadline?: number) => void }) {
    const { t } = useTranslation();
    const [table, setTable] = useState('filter');
    const [chain, setChain] = useState('INPUT');
    const [rule, setRule]   = useState('');
    const [loading, setLoading] = useState(false);
    const [msg, setMsg]     = useState<{ ok: boolean; text: string } | null>(null);

    const addRule = async () => {
        if (!rule.trim()) return;
        setLoading(true); setMsg(null);
        try {
            const res = await api.post<{ ok: boolean; output?: string; error?: string; rollbackDeadline?: number }>(
                '/api/plugins/fail2ban/iptables/rule/add', { table, chain, rule: rule.trim() }
            );
            if (res.success && res.result?.ok) {
                setMsg({ ok: true, text: res.result.output ?? 'Règle ajoutée' });
                setRule('');
                onAction(res.result.rollbackDeadline);
            } else {
                setMsg({ ok: false, text: res.result?.error ?? t('fail2ban.errors.unknown') });
            }
        } finally { setLoading(false); }
    };

    const inputStyle: React.CSSProperties = { background: '#161b22', border: '1px solid #30363d', borderBottom: '1px solid #555', borderRadius: 4, color: '#e6edf3', fontSize: '.8rem', padding: '.35rem .6rem', outline: 'none', fontFamily: 'monospace', boxShadow: 'inset 0 2px 4px rgba(0,0,0,.55), inset 0 1px 0 rgba(0,0,0,.4), inset 0 -1px 0 rgba(255,255,255,.04)' };

    return (
        <div style={card}>
            <div style={cardH}>
                <Plus style={{ width: 14, height: 14, color: '#e3b341' }} />
                <span style={{ fontWeight: 600, fontSize: '.88rem' }}>Ajouter une règle</span>
                <span style={{ marginLeft: 'auto', fontSize: '.72rem', color: '#8b949e' }}>iptables -t TABLE -A CHAIN [règle]</span>
            </div>
            <div style={{ ...cardB, display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
                <div style={{ display: 'flex', gap: '.4rem', background: 'rgba(227,179,65,.06)', border: '1px solid rgba(227,179,65,.2)', borderRadius: 5, padding: '.45rem .75rem', fontSize: '.76rem', color: '#e3b341' }}>
                    <AlertTriangle style={{ width: 12, height: 12, flexShrink: 0, marginTop: 1 }} />
                    <span>Écriture iptables — <strong>rollback automatique en 30s</strong> si non confirmé. Une règle mal formée peut couper l'accès SSH.</span>
                </div>
                <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
                        <label style={{ fontSize: '.67rem', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '.05em' }}>Table</label>
                        <select value={table} onChange={e => setTable(e.target.value)} style={{ ...inputStyle, cursor: 'pointer', minWidth: 90 }}>
                            {['filter', 'nat', 'mangle', 'raw'].map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
                        <label style={{ fontSize: '.67rem', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '.05em' }}>Chain</label>
                        <input value={chain} onChange={e => setChain(e.target.value.toUpperCase())} placeholder="INPUT" style={{ ...inputStyle, width: 110 }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem', flex: 1, minWidth: 200 }}>
                        <label style={{ fontSize: '.67rem', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '.05em' }}>Règle</label>
                        <input value={rule} onChange={e => setRule(e.target.value)} placeholder="-s 1.2.3.4 -j DROP"
                            style={{ ...inputStyle, width: '100%' }}
                            onKeyDown={e => { if (e.key === 'Enter') addRule(); }} />
                    </div>
                    <button onClick={addRule} disabled={loading || !rule.trim()} style={{
                        background: 'rgba(227,179,65,.12)', border: '1px solid rgba(227,179,65,.3)', color: '#e3b341',
                        borderRadius: 4, cursor: loading || !rule.trim() ? 'default' : 'pointer',
                        padding: '.35rem .85rem', fontSize: '.8rem', fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: '.35rem', opacity: loading || !rule.trim() ? .5 : 1,
                    }}>
                        <Plus style={{ width: 12, height: 12 }} /> Ajouter
                    </button>
                </div>
                {msg && (
                    <div style={{ fontSize: '.8rem', color: msg.ok ? '#3fb950' : '#e86a65', display: 'flex', gap: '.4rem', alignItems: 'center' }}>
                        {msg.ok ? <CheckCircle style={{ width: 13, height: 13 }} /> : <AlertTriangle style={{ width: 13, height: 13 }} />}
                        {msg.text}
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Main tab ───────────────────────────────────────────────────────────────────

export const TabIPTables: React.FC = () => {
    const [refreshToken, setRefreshToken] = useState(0);
    const [rollback, setRollback] = useState<RollbackStatus>({ pending: false, deadline: null });
    const [countdown, setCountdown] = useState(0);
    const [actionLoading, setActionLoading] = useState(false);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchRollback = useCallback(async () => {
        const res = await api.get<RollbackStatus>('/api/plugins/fail2ban/iptables/rollback/status');
        if (res.success && res.result) setRollback(res.result);
    }, []);

    useEffect(() => { fetchRollback(); }, [fetchRollback]);

    useEffect(() => {
        if (!rollback.pending || !rollback.deadline) { setCountdown(0); return; }
        const tick = () => setCountdown(Math.max(0, Math.round((rollback.deadline! - Date.now()) / 1000)));
        tick();
        const id = setInterval(tick, 500);
        return () => clearInterval(id);
    }, [rollback]);

    useEffect(() => {
        if (rollback.pending) {
            if (pollRef.current) return;
            pollRef.current = setInterval(fetchRollback, 2000);
        } else {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        }
        return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
    }, [rollback.pending, fetchRollback]);

    const handleAction = useCallback((deadline?: number) => {
        setRefreshToken(k => k + 1);
        if (deadline) setRollback({ pending: true, deadline });
    }, []);

    const confirmRollback = async () => {
        await api.post('/api/plugins/fail2ban/iptables/rollback/confirm', {});
        setRollback({ pending: false, deadline: null });
    };

    const doRollback = async () => {
        setActionLoading(true);
        try {
            const res = await api.post<{ ok: boolean; output?: string; error?: string }>('/api/plugins/fail2ban/iptables/rollback/now', {});
            setRollback({ pending: false, deadline: null });
            if (res.success && res.result?.ok) setRefreshToken(k => k + 1);
        } finally { setActionLoading(false); }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {rollback.pending && <RollbackBanner countdown={countdown} onConfirm={confirmRollback} onRollback={doRollback} loading={actionLoading} />}
            <RulesetViewer refreshToken={refreshToken} onAction={handleAction} />
            <RuleBuilder onAction={handleAction} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.6rem .85rem', background: 'rgba(57,197,207,.05)', border: '1px solid rgba(57,197,207,.2)', borderRadius: 6, fontSize: '.8rem', color: '#8b949e' }}>
                <Archive style={{ width: 13, height: 13, color: '#39c5cf', flexShrink: 0 }} />
                Les sauvegardes IPTables se trouvent dans l&apos;onglet <span style={{ color: '#39c5cf', fontWeight: 600, marginLeft: '.25rem' }}>Backup</span>.
            </div>
        </div>
    );
};
