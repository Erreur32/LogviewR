import React, { useState, useEffect, useCallback } from 'react';
import {
    Settings, Database, RefreshCw, Save, Play,
    Info, Shield, FileText, AlertTriangle, CheckCircle, XCircle,
    ChevronRight, HardDrive, Stethoscope, Trash2, Copy,
} from 'lucide-react';
import { api } from '../../api/client';
import { card, cardH, cardB } from './helpers';

// ── Types ─────────────────────────────────────────────────────────────────────

interface GlobalConfig {
    loglevel: string;
    logtarget: string;
    socket: string;
    pidfile: string;
    dbfile: string;
    dbpurgeage: string;
    dbmaxmatches: string;
    local_values: Record<string, string>;
    local_exists?: boolean;
}

interface DbInfo {
    size: number;
    sizeFmt: string;
    readable: boolean;
    integrity: string;
    pageCount: number;
    freePages: number;
    fragPct: number;
    bans?: number;
    jails?: number;
    logs?: number;
}

interface InternalDbStats {
    totalEvents: number;
    last24h: number;
    last7d: number;
    lastSync: string | null;
    lastRowid: number;
}

interface ParsedConfigResult {
    cfg: GlobalConfig;
    version: string;
    dbInfo: DbInfo | null;
    dbHostPath: string;
    appDbInfo: { size: number; sizeFmt: string; exists: boolean };
    internalDbStats: InternalDbStats | null;
}

interface RawFiles {
    'fail2ban.conf': string | null;
    'fail2ban.local': string | null;
    'jail.conf': string | null;
    'jail.local': string | null;
}

interface CheckItem {
    ok: boolean;
    fix?: string | null;
    path?: string;
    exists?: boolean;
    readable?: boolean;
    writable?: boolean;
    perms?: string;
}

interface CheckResult {
    ok: boolean;
    checks: {
        socket: CheckItem;
        client: CheckItem;
        daemon: CheckItem;
        sqlite: CheckItem;
        dropin: CheckItem;
    };
}

// ── Color palette ─────────────────────────────────────────────────────────────
const C = {
    bg0: '#0d1117', bg1: '#161b22', bg2: '#21262d', bg3: '#2d333b',
    border: '#30363d', text: '#e6edf3', muted: '#8b949e',
    green: '#3fb950', blue: '#58a6ff', red: '#e86a65',
    orange: '#e3b341', purple: '#bc8cff', cyan: '#39c5cf',
};

// ── Sub-components ────────────────────────────────────────────────────────────

const SectionHeader: React.FC<{
    color: string;
    bg: string;
    icon: React.ReactNode;
    title: string;
    sub: string;
}> = ({ color, bg, icon, title, sub }) => (
    <div style={{
        background: bg, border: `1px solid ${C.border}`,
        borderBottom: 'none', borderRadius: '8px 8px 0 0',
        padding: '.75rem 1rem', display: 'flex', alignItems: 'center', gap: '.75rem',
    }}>
        <span style={{ color, fontSize: '1.1rem' }}>{icon}</span>
        <div>
            <div style={{ fontWeight: 700, fontSize: '.95rem', color: C.text }}>{title}</div>
            <div style={{ fontSize: '.75rem', color: C.muted, marginTop: 1 }}>{sub}</div>
        </div>
    </div>
);

const Row: React.FC<{ label: string; value: React.ReactNode; isLocal?: boolean }> = ({ label, value, isLocal }) => (
    <div style={{ display: 'flex', alignItems: 'center', padding: '.4rem 0', borderBottom: `1px solid ${C.border}` }}>
        <span style={{ width: 160, flexShrink: 0, fontSize: '.78rem', color: C.muted, fontFamily: 'monospace' }}>{label}</span>
        <span style={{ flex: 1, fontSize: '.82rem', color: C.text, fontFamily: 'monospace', wordBreak: 'break-all' }}>{value}</span>
        {isLocal && <span style={{ fontSize: '.65rem', color: C.orange, marginLeft: '.5rem', background: 'rgba(227,179,65,.12)', padding: '1px 5px', borderRadius: 3 }}>local</span>}
    </div>
);

const StatusBadge: React.FC<{ ok: boolean; label: string }> = ({ ok, label }) => (
    <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.75rem',
        padding: '2px 7px', borderRadius: 4,
        background: ok ? 'rgba(63,185,80,.12)' : 'rgba(232,106,101,.12)',
        color: ok ? C.green : C.red, border: `1px solid ${ok ? 'rgba(63,185,80,.3)' : 'rgba(232,106,101,.3)'}`,
    }}>
        {ok ? <CheckCircle style={{ width: 10, height: 10 }} /> : <XCircle style={{ width: 10, height: 10 }} />}
        {label}
    </span>
);

const Btn: React.FC<{
    onClick: () => void;
    disabled?: boolean;
    color?: string;
    bg?: string;
    border?: string;
    children: React.ReactNode;
    loading?: boolean;
    small?: boolean;
}> = ({ onClick, disabled, color = C.text, bg = C.bg3, border = C.border, children, loading, small }) => (
    <button onClick={onClick} disabled={disabled || loading}
        style={{
            padding: small ? '.25rem .65rem' : '.35rem .85rem',
            fontSize: small ? '.73rem' : '.8rem', borderRadius: 5,
            background: bg, color, border: `1px solid ${border}`,
            cursor: disabled || loading ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            display: 'inline-flex', alignItems: 'center', gap: '.35rem',
        }}>
        {loading ? <RefreshCw style={{ width: 12, height: 12, animation: 'spin 1s linear infinite' }} /> : null}
        {children}
    </button>
);

// ── Conf syntax highlighter ────────────────────────────────────────────────────

type ConfToken = { t: 'section' | 'comment' | 'key' | 'eq' | 'value' | 'plain'; v: string };

function tokenizeConfLine(line: string): ConfToken[] {
    const trimmed = line.trimStart();
    const indent = line.slice(0, line.length - trimmed.length);
    const pre: ConfToken[] = indent ? [{ t: 'plain', v: indent }] : [];

    // comment
    if (/^[#;]/.test(trimmed)) return [...pre, { t: 'comment', v: trimmed }];
    // section
    const secM = trimmed.match(/^(\[)([^\]]+)(\].*)$/);
    if (secM) return [...pre, { t: 'plain', v: secM[1] }, { t: 'section', v: secM[2] }, { t: 'plain', v: secM[3] }];
    // key = value
    const kvM = trimmed.match(/^([A-Za-z_][A-Za-z0-9_./-]*)(\s*=\s*)(.*)/);
    if (kvM) return [...pre, { t: 'key', v: kvM[1] }, { t: 'eq', v: kvM[2] }, { t: 'value', v: kvM[3] }];
    return [...pre, { t: 'plain', v: trimmed }];
}

const CONF_COLORS: Record<ConfToken['t'], string> = {
    section: '#58a6ff',
    comment: '#555d69',
    key:     '#e3b341',
    eq:      '#8b949e',
    value:   '#3fb950',
    plain:   '#8b949e',
};

const ConfHighlighter: React.FC<{ content: string }> = ({ content }) => (
    <code style={{ fontFamily: 'monospace', fontSize: '.75rem', lineHeight: 1.65, display: 'block' }}>
        {content.split('\n').map((line, i) => (
            <div key={i} style={{ minHeight: '1.1em' }}>
                {tokenizeConfLine(line).map((tok, j) => (
                    <span key={j} style={{ color: CONF_COLORS[tok.t] }}>{tok.v}</span>
                ))}
            </div>
        ))}
    </code>
);

const RawFileViewer: React.FC<{ rawFiles: RawFiles | null; rawTab: string; onTabChange: (t: string) => void }> = ({ rawFiles, rawTab, onTabChange }) => {
    const [copied, setCopied] = useState(false);
    const FILES = ['fail2ban.conf', 'fail2ban.local', 'jail.conf', 'jail.local'] as const;
    const content = rawFiles ? (rawFiles[rawTab as keyof RawFiles] ?? null) : null;
    const copyContent = () => {
        if (!content) return;
        navigator.clipboard.writeText(content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
    };
    const lineCount = content ? content.split('\n').length : 0;
    return (
        <div style={{ display: 'flex', gap: 0, height: 480, overflow: 'hidden' }}>
            {/* Sidebar */}
            <div style={{ width: 148, flexShrink: 0, borderRight: `1px solid #30363d`, display: 'flex', flexDirection: 'column', background: '#161b22' }}>
                <div style={{ padding: '.45rem .75rem', fontSize: '.65rem', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: '1px solid #30363d' }}>
                    /etc/fail2ban/
                </div>
                {FILES.map(f => {
                    const absent = rawFiles && rawFiles[f] === null;
                    const active = rawTab === f;
                    return (
                        <button key={f} onClick={() => onTabChange(f)} style={{
                            textAlign: 'left', padding: '.4rem .75rem', fontSize: '.78rem',
                            fontFamily: 'monospace', background: active ? 'rgba(88,166,255,.12)' : 'transparent',
                            color: active ? '#58a6ff' : absent ? '#555d69' : '#e6edf3',
                            border: 'none', borderLeft: active ? '2px solid #58a6ff' : '2px solid transparent',
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '.4rem',
                        }}>
                            <FileText style={{ width: 11, height: 11, flexShrink: 0 }} />
                            <span style={{ flex: 1 }}>{f}</span>
                            {absent && <span style={{ fontSize: '.55rem', color: '#555d69' }}>∅</span>}
                        </button>
                    );
                })}
            </div>
            {/* Editor area */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0d1117' }}>
                {/* Toolbar */}
                <div style={{ display: 'flex', alignItems: 'center', padding: '.3rem .75rem', background: '#161b22', borderBottom: '1px solid #30363d', gap: '.5rem' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '.72rem', color: '#58a6ff', flex: 1 }}>/etc/fail2ban/{rawTab}</span>
                    {content && <span style={{ fontSize: '.68rem', color: '#555d69' }}>{lineCount} lignes</span>}
                    {content === null && <span style={{ fontSize: '.68rem', color: '#555d69', fontStyle: 'italic' }}>fichier absent</span>}
                    <button onClick={copyContent} disabled={!content} title="Copier" style={{
                        background: 'none', border: `1px solid #30363d`, borderRadius: 4, cursor: content ? 'pointer' : 'not-allowed',
                        color: copied ? '#3fb950' : '#8b949e', padding: '2px 6px', display: 'flex', alignItems: 'center', gap: '.3rem', fontSize: '.7rem',
                    }}>
                        {copied ? <CheckCircle style={{ width: 11, height: 11 }} /> : <Copy style={{ width: 11, height: 11 }} />}
                        {copied ? 'Copié' : 'Copier'}
                    </button>
                </div>
                {/* Content with line numbers */}
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex' }}>
                    {content ? (
                        <>
                            {/* Line numbers */}
                            <div style={{ padding: '.75rem .5rem', textAlign: 'right', userSelect: 'none', borderRight: '1px solid #21262d', flexShrink: 0, minWidth: 40 }}>
                                {content.split('\n').map((_, i) => (
                                    <div key={i} style={{ fontSize: '.72rem', lineHeight: 1.65, color: '#30363d', fontFamily: 'monospace' }}>{i + 1}</div>
                                ))}
                            </div>
                            {/* Code */}
                            <pre style={{ flex: 1, padding: '.75rem 1rem', margin: 0, overflow: 'visible', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                <ConfHighlighter content={content} />
                            </pre>
                        </>
                    ) : (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555d69', fontSize: '.8rem', fontStyle: 'italic' }}>
                            {rawFiles ? 'Ce fichier n\'existe pas sur ce système' : 'Chargement…'}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const ShellCommand: React.FC<{ cmd: string }> = ({ cmd }) => {
    const [copied, setCopied] = useState(false);
    const copy = () => {
        navigator.clipboard.writeText(cmd).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
    };
    return (
        <div style={{ display: 'flex', alignItems: 'center', background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 5, padding: '.3rem .6rem', gap: '.5rem', marginTop: '.4rem' }}>
            <span style={{ color: C.muted, fontSize: '.72rem', userSelect: 'none' }}>$</span>
            <code style={{ flex: 1, fontFamily: 'monospace', fontSize: '.72rem', color: C.cyan, userSelect: 'all' }}>{cmd}</code>
            <button onClick={copy} title="Copier" style={{ background: 'none', border: 'none', cursor: 'pointer', color: copied ? C.green : C.muted, padding: 0, display: 'flex', alignItems: 'center' }}>
                {copied
                    ? <CheckCircle style={{ width: 12, height: 12 }} />
                    : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                }
            </button>
        </div>
    );
};

const VacuumAlert: React.FC<{ fragPct: number; dbPath: string; onDone: () => void }> = ({ fragPct, dbPath, onDone }) => {
    const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
    const [errMsg, setErrMsg] = useState('');
    const cmd = `sqlite3 ${dbPath} 'VACUUM'`;
    const run = async () => {
        setState('running');
        try {
            const res = await api.post<{ ok: boolean; error?: string }>('/api/plugins/fail2ban/config/sqlite-vacuum');
            if (res.success && res.result?.ok) { setState('done'); onDone(); }
            else {
                const httpMsg = res.error?.message ?? '';
                const is404 = httpMsg.includes('404') || res.error?.code === 'INVALID_RESPONSE';
                const isAuth = httpMsg.includes('401') || httpMsg.includes('403');
                setErrMsg(
                    is404  ? 'Route introuvable (404) — redémarrez le serveur pour activer cette fonctionnalité' :
                    isAuth ? 'Accès refusé — authentification requise' :
                    res.result?.error ?? (httpMsg || 'Erreur inconnue')
                );
                setState('error');
            }
        } catch (e: unknown) {
            setState('error');
            setErrMsg(e instanceof Error ? e.message : 'Erreur réseau');
        }
    };
    return (
        <div style={{ fontSize: '.75rem', color: C.orange, marginTop: '.25rem', display: 'flex', alignItems: 'flex-start', gap: '.5rem', background: 'rgba(227,179,65,.06)', border: '1px solid rgba(227,179,65,.25)', borderRadius: 6, padding: '.6rem .75rem' }}>
            <AlertTriangle style={{ width: 13, height: 13, marginTop: 1, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600 }}>Fragmentation élevée ({fragPct}%)</span>
                    <span style={{ color: C.muted }}>— compresse la DB et libère l'espace disque inutilisé</span>
                    {state === 'done' && (
                        <span style={{ color: C.green, display: 'inline-flex', alignItems: 'center', gap: '.3rem' }}>
                            <CheckCircle style={{ width: 11, height: 11 }} /> VACUUM terminé
                        </span>
                    )}
                    {state === 'error' && <span style={{ color: C.red }}>{errMsg}</span>}
                    {state !== 'done' && (
                        <Btn onClick={run} loading={state === 'running'} small
                            bg="rgba(227,179,65,.15)" color={C.orange} border="rgba(227,179,65,.4)">
                            <HardDrive style={{ width: 11, height: 11 }} />
                            {state === 'running' ? 'VACUUM en cours…' : 'Lancer VACUUM'}
                        </Btn>
                    )}
                </div>
                <ShellCommand cmd={cmd} />
            </div>
        </div>
    );
};

// ── Main Component ────────────────────────────────────────────────────────────

export const TabConfig: React.FC = () => {
    const [parsed, setParsed]       = useState<ParsedConfigResult | null>(null);
    const [rawFiles, setRawFiles]   = useState<RawFiles | null>(null);
    const [loading, setLoading]     = useState(true);
    const [rawTab, setRawTab]       = useState<string | null>(null);
    const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
    const [checkLoading, setCheckLoading] = useState(true);

    // Sync check
    const [syncStatus, setSyncStatus] = useState<{
        internalEvents: number; lastSyncedRowid: number;
        f2bMaxRowid: number | null; f2bTotalBans: number | null;
        lastSyncAt: string | null; synced: boolean | null;
    } | null>(null);
    const [syncChecking, setSyncChecking] = useState(false);

    const checkSync = async () => {
        setSyncChecking(true);
        const res = await api.get<typeof syncStatus>('/api/plugins/fail2ban/sync-status');
        if (res.success && res.result) setSyncStatus(res.result);
        setSyncChecking(false);
    };

    // Maintenance
    const [resetting, setResetting] = useState(false);

    // Form state (runtime & persist)
    const [fmLoglevel, setFmLoglevel]   = useState('');
    const [fmLogtarget, setFmLogtarget] = useState('');
    const [fmPurgeage, setFmPurgeage]   = useState('');
    const [fmMaxmatches, setFmMaxmatches] = useState('');

    // Feedback toasts
    const [toasts, setToasts] = useState<{ id: number; msg: string; ok: boolean }[]>([]);
    const [saving, setSaving] = useState<string | null>(null);

    const toast = useCallback((msg: string, ok: boolean) => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, msg, ok }]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
    }, []);

    const loadParsed = useCallback(async () => {
        const res = await api.get<ParsedConfigResult>('/api/plugins/fail2ban/config/parsed');
        if (res.success && res.result) {
            setParsed(res.result);
            setFmLoglevel(res.result.cfg.loglevel ?? 'INFO');
            setFmLogtarget(res.result.cfg.logtarget ?? '');
            setFmPurgeage(res.result.cfg.dbpurgeage ?? '86400');
            setFmMaxmatches(res.result.cfg.dbmaxmatches ?? '10');
        }
        setLoading(false);
    }, []);

    const runChecks = useCallback(async () => {
        setCheckLoading(true);
        const res = await api.get<CheckResult>('/api/plugins/fail2ban/check');
        if (res.success && res.result) setCheckResult(res.result);
        setCheckLoading(false);
    }, []);

    useEffect(() => {
        loadParsed();
        runChecks();
    }, [loadParsed, runChecks]);

    const loadRaw = useCallback(async () => {
        const res = await api.get<{ files: RawFiles }>('/api/plugins/fail2ban/config');
        if (res.success && res.result?.files) {
            setRawFiles(res.result.files);
        }
    }, []);

    // Show raw viewer if tab clicked
    useEffect(() => {
        if (rawTab !== null) loadRaw();
    }, [rawTab, loadRaw]);

    const applyRuntime = async () => {
        setSaving('runtime');
        const res = await api.post<{ ok: boolean; results: Record<string, { ok: boolean; output: string; error?: string }> }>(
            '/api/plugins/fail2ban/config/runtime',
            { loglevel: fmLoglevel, logtarget: fmLogtarget }
        );
        setSaving(null);
        if (res.success && res.result?.ok) {
            toast('Paramètres runtime appliqués ✓', true);
            await loadParsed();
        } else {
            const errs = res.result?.results ? Object.values(res.result.results).filter(r => !r.ok).map(r => r.error).join(', ') : 'Erreur inconnue';
            toast(`Erreur: ${errs}`, false);
        }
    };

    const persistRuntime = async () => {
        setSaving('persist-runtime');
        const res = await api.post<{ ok: boolean; written: string[]; errors: string[] }>(
            '/api/plugins/fail2ban/config/write',
            { loglevel: fmLoglevel, logtarget: fmLogtarget }
        );
        setSaving(null);
        if (res.success && res.result?.ok) {
            toast(`Persisté dans fail2ban.local: ${res.result.written.join(', ')} ✓`, true);
            await loadParsed();
        } else {
            toast(`Erreur: ${res.result?.errors?.join(', ') ?? 'Erreur'}`, false);
        }
    };

    const persistDb = async () => {
        setSaving('persist-db');
        const res = await api.post<{ ok: boolean; written: string[]; errors: string[] }>(
            '/api/plugins/fail2ban/config/write',
            { dbpurgeage: fmPurgeage, dbmaxmatches: fmMaxmatches }
        );
        setSaving(null);
        if (res.success && res.result?.ok) {
            toast(`Persisté dans fail2ban.local: ${res.result.written.join(', ')} ✓`, true);
            await loadParsed();
        } else {
            toast(`Erreur: ${res.result?.errors?.join(', ') ?? 'Erreur'}`, false);
        }
    };

    const doReset = async () => {
        if (!window.confirm('Réinitialiser toutes les données fail2ban ?\n\nCela supprime : événements f2b_events, cache géo f2b_ip_geo, état de synchronisation.\nCette action est irréversible.')) return;
        setResetting(true);
        const res = await api.post<{ ok: boolean }>('/api/plugins/fail2ban/config/maintenance/reset', {});
        setResetting(false);
        if (res.success && res.result?.ok) {
            toast('Données fail2ban réinitialisées ✓', true);
            await loadParsed();
        } else {
            toast('Erreur lors de la réinitialisation', false);
        }
    };


    const cfg = parsed?.cfg;
    const dbInfo = parsed?.dbInfo;

    const LOGLEVELS = ['CRITICAL', 'ERROR', 'WARNING', 'NOTICE', 'INFO', 'DEBUG'];

    const inp: React.CSSProperties = {
        background: C.bg3, border: `1px solid ${C.border}`, borderRadius: 5,
        color: C.text, padding: '.3rem .6rem', fontSize: '.82rem', width: '100%',
        fontFamily: 'monospace',
    };

    const sel: React.CSSProperties = { ...inp };

    // ── Shared column body style
    const colBody: React.CSSProperties = {
        border: `1px solid ${C.border}`, borderTop: 'none', borderRadius: '0 0 8px 8px',
        padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem', background: C.bg0,
    };

    return (
        <div style={{ paddingBottom: '2rem' }}>

            {/* ── Toast notifications ─────────────────────────────────────── */}
            <div style={{ position: 'fixed', bottom: 24, right: 24, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 9999 }}>
                {toasts.map(t => (
                    <div key={t.id} style={{
                        background: t.ok ? 'rgba(63,185,80,.18)' : 'rgba(232,106,101,.18)',
                        border: `1px solid ${t.ok ? 'rgba(63,185,80,.4)' : 'rgba(232,106,101,.4)'}`,
                        color: t.ok ? C.green : C.red,
                        borderRadius: 7, padding: '.5rem .9rem', fontSize: '.82rem',
                        display: 'flex', alignItems: 'center', gap: '.5rem',
                        boxShadow: '0 4px 12px rgba(0,0,0,.4)',
                    }}>
                        {t.ok ? <CheckCircle style={{ width: 13, height: 13 }} /> : <AlertTriangle style={{ width: 13, height: 13 }} />}
                        {t.msg}
                    </div>
                ))}
            </div>

            {/* ── 2-column grid ─────────────────────────────────────────────── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 520px), 1fr))', gap: '1.25rem', alignItems: 'start' }}>

            {/* ══════════════════════════════════════════════════════════════
                COLONNE GAUCHE — Fail2ban (démon)
            ══════════════════════════════════════════════════════════════ */}
            <div>
                <SectionHeader
                    color={C.blue} bg="rgba(88,166,255,.07)"
                    icon={<Shield style={{ width: 16, height: 16 }} />}
                    title="Fail2ban"
                    sub="Configuration du démon, service, et base de données officielle"
                />
                <div style={colBody}>

                    {/* ── Card: Diagnostic système (auto-run) ── */}
                    <div style={card}>
                        <div style={{ ...cardH }}>
                            <Stethoscope style={{ width: 14, height: 14, color: C.cyan }} />
                            <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Diagnostic système</span>
                            <span style={{ marginLeft: 'auto' }}>
                                {checkLoading ? (
                                    <span style={{ fontSize: '.72rem', color: C.muted, display: 'flex', alignItems: 'center', gap: '.3rem' }}>
                                        <RefreshCw style={{ width: 11, height: 11, animation: 'spin 1s linear infinite' }} /> Analyse…
                                    </span>
                                ) : checkResult?.ok ? (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.75rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(63,185,80,.12)', color: C.green, border: '1px solid rgba(63,185,80,.3)' }}>
                                        <CheckCircle style={{ width: 10, height: 10 }} /> Tout OK
                                    </span>
                                ) : (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.75rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(232,106,101,.12)', color: C.red, border: '1px solid rgba(232,106,101,.3)' }}>
                                        <AlertTriangle style={{ width: 10, height: 10 }} /> Erreurs détectées
                                    </span>
                                )}
                            </span>
                            <button onClick={runChecks} disabled={checkLoading}
                                style={{ marginLeft: '.5rem', padding: '.2rem .5rem', borderRadius: 4, background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, cursor: 'pointer', fontSize: '.72rem', display: 'inline-flex', alignItems: 'center', gap: '.25rem', opacity: checkLoading ? .5 : 1 }}>
                                <RefreshCw style={{ width: 10, height: 10 }} /> Relancer
                            </button>
                        </div>
                        {!checkLoading && checkResult && !checkResult.ok && (
                            <div style={{ ...cardB, display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
                                {(Object.entries(checkResult.checks) as [string, CheckItem][])
                                    .filter(([, c]) => !c.ok)
                                    .map(([key, c]) => {
                                        const labels: Record<string, string> = {
                                            socket: 'Socket fail2ban',
                                            client: 'fail2ban-client',
                                            daemon: 'Démon fail2ban',
                                            sqlite: 'Base SQLite',
                                            dropin: 'Drop-in systemd',
                                        };
                                        return (
                                            <div key={key} style={{ borderRadius: 6, border: '1px solid rgba(232,106,101,.3)', background: 'rgba(232,106,101,.06)', overflow: 'hidden' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.5rem .75rem', borderBottom: c.fix ? '1px solid rgba(232,106,101,.2)' : undefined, background: 'rgba(232,106,101,.08)' }}>
                                                    <XCircle style={{ width: 13, height: 13, color: C.red, flexShrink: 0 }} />
                                                    <span style={{ fontWeight: 600, fontSize: '.82rem', color: C.red }}>{labels[key] ?? key}</span>
                                                    {c.path && <code style={{ marginLeft: 'auto', fontSize: '.7rem', color: C.muted, fontFamily: 'monospace' }}>{c.path}</code>}
                                                </div>
                                                {c.fix && (
                                                    <div style={{ padding: '.6rem .75rem' }}>
                                                        <pre style={{ margin: 0, fontSize: '.75rem', fontFamily: 'monospace', color: C.text, lineHeight: 1.55, whiteSpace: 'pre-wrap', background: C.bg3, borderRadius: 5, padding: '.5rem .7rem', border: `1px solid ${C.border}` }}>
                                                            {c.fix}
                                                        </pre>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                            </div>
                        )}
                    </div>

                    {loading ? (
                        <div style={{ color: C.muted, fontSize: '.85rem', textAlign: 'center', padding: '2rem' }}>Chargement…</div>
                    ) : cfg ? (
                        <>
                            {/* Card: Infos système */}
                            <div style={card}>
                                <div style={{ ...cardH }}>
                                    <Info style={{ width: 14, height: 14, color: C.muted }} />
                                    <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Infos système</span>
                                    {parsed?.version && <span style={{ marginLeft: 'auto', fontSize: '.73rem', color: C.muted, fontFamily: 'monospace' }}>v{parsed.version}</span>}
                                    <span style={{ marginLeft: parsed?.version ? '.5rem' : 'auto' }}>
                                        <StatusBadge ok={!!parsed?.dbInfo?.readable} label="SQLite" />
                                    </span>
                                </div>
                                <div style={{ ...cardB }}>
                                    <Row label="loglevel"     value={cfg.loglevel}     isLocal={!!cfg.local_values.loglevel} />
                                    <Row label="logtarget"    value={cfg.logtarget}    isLocal={!!cfg.local_values.logtarget} />
                                    <Row label="socket"       value={cfg.socket} />
                                    <Row label="dbfile"       value={cfg.dbfile} />
                                    <Row label="dbpurgeage"   value={`${cfg.dbpurgeage}s (${Math.round(parseInt(cfg.dbpurgeage,10)/86400)} j)`} isLocal={!!cfg.local_values.dbpurgeage} />
                                    <Row label="dbmaxmatches" value={cfg.dbmaxmatches} isLocal={!!cfg.local_values.dbmaxmatches} />
                                    <Row label="fail2ban.local" value={
                                        cfg.local_exists
                                            ? <span style={{ color: C.green, display: 'inline-flex', alignItems: 'center', gap: '.3rem' }}>
                                                <CheckCircle style={{ width: 11, height: 11 }} /> Présent
                                                <span style={{ color: C.muted, fontSize: '.73rem' }}>({Object.keys(cfg.local_values).length} directive{Object.keys(cfg.local_values).length !== 1 ? 's' : ''})</span>
                                              </span>
                                            : <span style={{ color: C.muted, display: 'inline-flex', alignItems: 'center', gap: '.3rem' }}>
                                                <XCircle style={{ width: 11, height: 11 }} /> Absent
                                              </span>
                                    } />
                                </div>
                            </div>

                            {/* Card: SQLite fail2ban */}
                            <div style={{ ...card, borderColor: dbInfo?.integrity === 'ok' ? C.border : 'rgba(232,106,101,.4)' }}>
                                <div style={{ ...cardH }}>
                                    <Database style={{ width: 14, height: 14, color: C.purple }} />
                                    <span style={{ fontWeight: 600, fontSize: '.9rem' }}>SQLite fail2ban (officielle)</span>
                                </div>
                                <div style={{ ...cardB }}>
                                    {dbInfo ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                                            <Row label="Chemin" value={parsed?.dbHostPath ?? cfg.dbfile} />
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '.5rem', marginTop: '.25rem' }}>
                                                {[
                                                    { l: 'Taille',       v: dbInfo.sizeFmt,                  c: C.blue },
                                                    { l: 'Intégrité',    v: dbInfo.integrity,                c: dbInfo.integrity === 'ok' ? C.green : C.red },
                                                    { l: 'Pages',        v: String(dbInfo.pageCount),        c: C.muted },
                                                    { l: 'Fragment.',    v: `${dbInfo.fragPct}%`,            c: dbInfo.fragPct > 20 ? C.orange : C.green },
                                                    { l: 'Bans en DB',   v: String(dbInfo.bans  ?? '—'),    c: C.red },
                                                    { l: 'Jails',        v: String(dbInfo.jails ?? '—'),    c: C.purple },
                                                    { l: 'Logs',         v: String(dbInfo.logs  ?? '—'),    c: C.muted },
                                                ].map(s => (
                                                    <div key={s.l} style={{ background: C.bg2, borderRadius: 6, padding: '.5rem .4rem', textAlign: 'center', minWidth: 0 }}>
                                                        <div style={{ fontSize: '.9rem', fontWeight: 700, color: s.c, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.v}</div>
                                                        <div style={{ fontSize: '.6rem', color: C.muted, textTransform: 'uppercase', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.l}</div>
                                                    </div>
                                                ))}
                                            </div>
                                            {dbInfo.fragPct > 20 && (
                                                <VacuumAlert fragPct={dbInfo.fragPct} dbPath={cfg.dbfile} onDone={() => { void loadParsed(); }} />
                                            )}
                                        </div>
                                    ) : (
                                        <div style={{ fontSize: '.8rem', color: C.muted, display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                                            <AlertTriangle style={{ width: 13, height: 13, color: C.orange }} />
                                            SQLite non lisible. Vérifiez les permissions : <code style={{ fontFamily: 'monospace' }}>chmod o+r {cfg.dbfile}</code>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Cards: Runtime + DB côte à côte */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', alignItems: 'start' }}>

                                {/* Paramètres runtime */}
                                <div style={card}>
                                    <div style={{ ...cardH }}>
                                        <Play style={{ width: 14, height: 14, color: C.blue }} />
                                        <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Runtime</span>
                                        <span style={{ marginLeft: 'auto', fontSize: '.67rem', color: C.muted }}>sans redémarrage</span>
                                    </div>
                                    <div style={{ ...cardB, display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
                                        <div>
                                            <label style={{ fontSize: '.75rem', color: C.muted, display: 'block', marginBottom: '.3rem' }}>Loglevel</label>
                                            <select value={fmLoglevel} onChange={e => setFmLoglevel(e.target.value)} style={sel}>
                                                {LOGLEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                                            </select>
                                            {cfg.local_values.loglevel && <div style={{ fontSize: '.65rem', color: C.orange, marginTop: 2 }}>Local: {cfg.local_values.loglevel}</div>}
                                        </div>
                                        <div>
                                            <label style={{ fontSize: '.75rem', color: C.muted, display: 'block', marginBottom: '.3rem' }}>Logtarget</label>
                                            <input type="text" value={fmLogtarget} onChange={e => setFmLogtarget(e.target.value)} style={inp} placeholder="/var/log/fail2ban.log" />
                                            {cfg.local_values.logtarget && <div style={{ fontSize: '.65rem', color: C.orange, marginTop: 2 }}>Local: {cfg.local_values.logtarget}</div>}
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
                                            <Btn onClick={applyRuntime} loading={saving === 'runtime'}
                                                bg="rgba(88,166,255,.15)" color={C.blue} border="rgba(88,166,255,.4)">
                                                <Play style={{ width: 11, height: 11 }} /> Appliquer en runtime
                                            </Btn>
                                            <Btn onClick={persistRuntime} loading={saving === 'persist-runtime'}
                                                bg="rgba(188,140,255,.15)" color={C.purple} border="rgba(188,140,255,.4)">
                                                <Save style={{ width: 11, height: 11 }} /> Appliquer + persister
                                            </Btn>
                                        </div>
                                    </div>
                                </div>

                                {/* Base de données & Rétention */}
                                <div style={card}>
                                    <div style={{ ...cardH }}>
                                        <Database style={{ width: 14, height: 14, color: C.purple }} />
                                        <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Base de données</span>
                                        <span style={{ marginLeft: 'auto', fontSize: '.67rem', color: C.muted }}>fail2ban.local</span>
                                    </div>
                                    <div style={{ ...cardB, display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
                                        <div>
                                            <label style={{ fontSize: '.75rem', color: C.muted, display: 'block', marginBottom: '.3rem' }}>DB Purge Age (secondes)</label>
                                            <input type="text" value={fmPurgeage} onChange={e => setFmPurgeage(e.target.value)} style={inp} placeholder="86400" />
                                            <div style={{ fontSize: '.65rem', color: C.muted, marginTop: 2 }}>
                                                {parseInt(fmPurgeage, 10) > 0 ? `≈ ${Math.round(parseInt(fmPurgeage, 10) / 86400)} jour(s)` : 'Désactivé (0)'}
                                            </div>
                                        </div>
                                        <div>
                                            <label style={{ fontSize: '.75rem', color: C.muted, display: 'block', marginBottom: '.3rem' }}>DB Max Matches</label>
                                            <input type="number" min="1" max="10000" value={fmMaxmatches} onChange={e => setFmMaxmatches(e.target.value)} style={inp} />
                                            <div style={{ fontSize: '.65rem', color: C.muted, marginTop: 2 }}>Lignes de log max conservées par IP</div>
                                        </div>
                                        <Btn onClick={persistDb} loading={saving === 'persist-db'}
                                            bg="rgba(188,140,255,.15)" color={C.purple} border="rgba(188,140,255,.4)">
                                            <Save style={{ width: 11, height: 11 }} /> Persister dans fail2ban.local
                                        </Btn>
                                    </div>
                                </div>

                            </div>

                        </>
                    ) : (
                        <div style={{ padding: '2rem', textAlign: 'center', color: C.red, fontSize: '.85rem' }}>
                            <AlertTriangle style={{ width: 18, height: 18, marginBottom: '.5rem' }} />
                            <div>Impossible de lire la configuration fail2ban.</div>
                            <div style={{ color: C.muted, marginTop: '.25rem', fontSize: '.75rem' }}>Vérifiez que /etc/fail2ban/ est monté dans le container.</div>
                        </div>
                    )}

                    {/* Card: Raw files viewer — fichiers /etc/fail2ban/ */}
                    <div style={card}>
                        <div style={{ ...cardH, cursor: 'pointer' }} onClick={() => setRawTab(rawTab === null ? 'fail2ban.conf' : null)}>
                            <FileText style={{ width: 14, height: 14, color: C.blue }} />
                            <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Fichiers de configuration</span>
                            <ChevronRight style={{ width: 14, height: 14, color: C.muted, marginLeft: 'auto', transition: 'transform .15s', transform: rawTab !== null ? 'rotate(90deg)' : 'none' }} />
                        </div>
                        {rawTab !== null && (
                            <RawFileViewer rawFiles={rawFiles} rawTab={rawTab} onTabChange={setRawTab} />
                        )}
                    </div>

                </div>
            </div>

            {/* ══════════════════════════════════════════════════════════════
                COLONNE DROITE — Application LogviewR
            ══════════════════════════════════════════════════════════════ */}
            <div>
                <SectionHeader
                    color={C.orange} bg="rgba(227,179,65,.07)"
                    icon={<Settings style={{ width: 16, height: 16 }} />}
                    title="Application"
                    sub="Base de données interne LogviewR, maintenance"
                />
                <div style={colBody}>

                    {/* Card: App DB + internal sync stats */}
                    <div style={card}>
                        <div style={{ ...cardH }}>
                            <HardDrive style={{ width: 14, height: 14, color: C.cyan }} />
                            <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Base de données interne (dashboard.db)</span>
                        </div>
                        <div style={{ ...cardB }}>
                            {parsed?.appDbInfo ? (
                                <div>
                                    <Row label="Chemin" value="data/dashboard.db" />
                                    <Row label="Taille" value={parsed.appDbInfo.sizeFmt} />
                                    <Row label="État" value={<StatusBadge ok={parsed.appDbInfo.exists} label={parsed.appDbInfo.exists ? 'Accessible' : 'Non trouvé'} />} />
                                </div>
                            ) : (
                                <div style={{ fontSize: '.8rem', color: C.muted }}>Non disponible</div>
                            )}

                            {/* Internal fail2ban event store */}
                            <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: `1px solid ${C.border}` }}>
                                <div style={{ fontSize: '.78rem', fontWeight: 600, color: C.muted, marginBottom: '.6rem', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                                    Historique fail2ban synchronisé (f2b_events)
                                </div>
                                {parsed?.internalDbStats ? (
                                    <div>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '.5rem', marginBottom: '.6rem' }}>
                                            {[
                                                { l: 'Total événements', v: parsed.internalDbStats.totalEvents.toLocaleString(), c: C.blue },
                                                { l: 'Dernières 24h',    v: parsed.internalDbStats.last24h.toLocaleString(),    c: C.orange },
                                                { l: 'Derniers 7 jours', v: parsed.internalDbStats.last7d.toLocaleString(),     c: C.purple },
                                            ].map(s => (
                                                <div key={s.l} style={{ background: C.bg2, borderRadius: 6, padding: '.45rem .6rem', textAlign: 'center' }}>
                                                    <div style={{ fontSize: '.9rem', fontWeight: 700, color: s.c }}>{s.v}</div>
                                                    <div style={{ fontSize: '.63rem', color: C.muted, textTransform: 'uppercase', marginTop: 2 }}>{s.l}</div>
                                                </div>
                                            ))}
                                        </div>
                                        <Row label="Dernière synchro" value={parsed.internalDbStats.lastSync
                                            ? new Date(parsed.internalDbStats.lastSync).toLocaleString('fr-FR')
                                            : 'Jamais (en attente…)'} />
                                        <div style={{ marginTop: '.6rem', display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                                            <button onClick={checkSync} disabled={syncChecking}
                                                style={{ display: 'flex', alignItems: 'center', gap: '.3rem', padding: '.2rem .6rem', fontSize: '.72rem', borderRadius: 4, border: `1px solid ${C.border}`, background: C.bg2, color: C.muted, cursor: 'pointer' }}>
                                                <Stethoscope style={{ width: 11, height: 11 }} />
                                                {syncChecking ? 'Vérification…' : 'Vérifier synchro'}
                                            </button>
                                            {syncStatus && (
                                                <span style={{ fontSize: '.72rem', color: syncStatus.synced === true ? C.green : syncStatus.synced === false ? C.orange : C.muted }}>
                                                    {syncStatus.synced === true
                                                        ? `✓ À jour — ${syncStatus.internalEvents.toLocaleString()} événements (rowid ${syncStatus.lastSyncedRowid})`
                                                        : syncStatus.synced === false
                                                        ? `⚠ Décalage — interne: rowid ${syncStatus.lastSyncedRowid}, fail2ban: rowid ${syncStatus.f2bMaxRowid} (${syncStatus.f2bTotalBans} bans)`
                                                        : `fail2ban.sqlite3 non lisible — ${syncStatus.internalEvents.toLocaleString()} événements locaux`
                                                    }
                                                </span>
                                            )}
                                        </div>
                                        <div style={{ fontSize: '.68rem', color: C.muted, marginTop: '.5rem', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                                            <Info style={{ width: 10, height: 10 }} />
                                            Synchronisation automatique toutes les 60s — conserve les bans indéfiniment (fail2ban purge selon dbpurgeage)
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ fontSize: '.78rem', color: C.muted }}>Non disponible (fail2ban SQLite non lisible)</div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Card: Maintenance */}
                    <div style={{ ...card, borderColor: 'rgba(255,85,85,.35)' }}>
                        <div style={{ ...cardH, background: 'rgba(255,85,85,.06)' }}>
                            <Trash2 style={{ width: 14, height: 14, color: C.red }} />
                            <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Maintenance &amp; base de données</span>
                        </div>
                        <div style={{ ...cardB }}>
                            <p style={{ fontSize: '.83rem', color: C.muted, lineHeight: 1.6, marginBottom: '1rem' }}>
                                Opérations de maintenance sur la base de données interne. Ces actions sont irréversibles.
                            </p>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                                <Btn onClick={doReset} loading={resetting}
                                    bg="rgba(232,106,101,.12)" color={C.red} border="rgba(232,106,101,.4)">
                                    <Trash2 style={{ width: 12, height: 12 }} /> Réinitialiser les données fail2ban
                                </Btn>
                                <span style={{ fontSize: '.8rem', color: C.muted }}>Vide les événements, le cache géo et l'état de synchronisation.</span>
                            </div>
                        </div>
                    </div>


                </div>
            </div>

            </div>{/* /grid */}
        </div>
    );
};
