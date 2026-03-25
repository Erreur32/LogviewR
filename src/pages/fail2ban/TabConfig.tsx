import React, { useState, useEffect, useCallback } from 'react';
import {
    Settings, Database, RefreshCw, RotateCcw, Save, Play,
    Info, Shield, FileText, AlertTriangle, CheckCircle, XCircle,
    ChevronRight, HardDrive,
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
}

interface DbInfo {
    size: number;
    sizeFmt: string;
    readable: boolean;
    integrity: string;
    pageCount: number;
    freePages: number;
    fragPct: number;
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

// ── Main Component ────────────────────────────────────────────────────────────

export const TabConfig: React.FC = () => {
    const [parsed, setParsed]     = useState<ParsedConfigResult | null>(null);
    const [rawFiles, setRawFiles] = useState<RawFiles | null>(null);
    const [loading, setLoading]   = useState(true);
    const [rawTab, setRawTab]     = useState<string | null>(null);

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

    useEffect(() => {
        loadParsed();
    }, [loadParsed]);

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

    const serviceAction = async (action: 'reload' | 'restart') => {
        if (action === 'restart' && !window.confirm('Redémarrage complet de fail2ban ?\n\nLes IPs bannies seront temporairement inactives.')) return;
        setSaving(`service-${action}`);
        const res = await api.post<{ ok: boolean; output: string; error?: string }>(
            '/api/plugins/fail2ban/config/service', { action }
        );
        setSaving(null);
        if (res.success && res.result?.ok) {
            toast(`fail2ban ${action === 'reload' ? 'rechargé' : 'redémarré'} ✓`, true);
        } else {
            toast(`Erreur ${action}: ${res.result?.error ?? 'échec'}`, false);
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

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', paddingBottom: '2rem' }}>

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

            {/* ── SECTION 1: Fail2ban ──────────────────────────────────────── */}
            <div>
                <SectionHeader
                    color={C.blue} bg="rgba(88,166,255,.07)"
                    icon={<Shield style={{ width: 16, height: 16 }} />}
                    title="Fail2ban"
                    sub="Configuration du démon, service, et base de données officielle"
                />
                <div style={{ border: `1px solid ${C.border}`, borderTop: 'none', borderRadius: '0 0 8px 8px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem', background: C.bg0 }}>

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
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '.5rem', marginTop: '.25rem' }}>
                                                {[
                                                    { l: 'Taille',       v: dbInfo.sizeFmt,              c: C.blue },
                                                    { l: 'Pages',        v: String(dbInfo.pageCount),    c: C.muted },
                                                    { l: 'Fragmentation',v: `${dbInfo.fragPct}%`,        c: dbInfo.fragPct > 20 ? C.orange : C.green },
                                                    { l: 'Intégrité',    v: dbInfo.integrity,            c: dbInfo.integrity === 'ok' ? C.green : C.red },
                                                ].map(s => (
                                                    <div key={s.l} style={{ background: C.bg2, borderRadius: 6, padding: '.5rem .65rem', textAlign: 'center' }}>
                                                        <div style={{ fontSize: '.9rem', fontWeight: 700, color: s.c }}>{s.v}</div>
                                                        <div style={{ fontSize: '.65rem', color: C.muted, textTransform: 'uppercase', marginTop: 2 }}>{s.l}</div>
                                                    </div>
                                                ))}
                                            </div>
                                            {dbInfo.fragPct > 20 && (
                                                <div style={{ fontSize: '.75rem', color: C.orange, marginTop: '.25rem', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                                                    <AlertTriangle style={{ width: 11, height: 11 }} />
                                                    Fragmentation élevée ({dbInfo.fragPct}%) — envisagez un VACUUM sur le host : <code style={{ fontFamily: 'monospace' }}>sqlite3 {cfg.dbfile} 'VACUUM'</code>
                                                </div>
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

                            {/* Card: Paramètres runtime */}
                            <div style={card}>
                                <div style={{ ...cardH }}>
                                    <Play style={{ width: 14, height: 14, color: C.blue }} />
                                    <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Paramètres runtime</span>
                                    <span style={{ marginLeft: 'auto', fontSize: '.7rem', color: C.muted }}>Appliqué sans redémarrage via fail2ban-client</span>
                                </div>
                                <div style={{ ...cardB, display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                        <div>
                                            <label style={{ fontSize: '.75rem', color: C.muted, display: 'block', marginBottom: '.3rem' }}>Loglevel</label>
                                            <select value={fmLoglevel} onChange={e => setFmLoglevel(e.target.value)} style={sel}>
                                                {LOGLEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                                            </select>
                                            {cfg.local_values.loglevel && <div style={{ fontSize: '.65rem', color: C.orange, marginTop: 2 }}>Actuel local: {cfg.local_values.loglevel}</div>}
                                        </div>
                                        <div>
                                            <label style={{ fontSize: '.75rem', color: C.muted, display: 'block', marginBottom: '.3rem' }}>Logtarget</label>
                                            <input type="text" value={fmLogtarget} onChange={e => setFmLogtarget(e.target.value)} style={inp} placeholder="/var/log/fail2ban.log" />
                                            {cfg.local_values.logtarget && <div style={{ fontSize: '.65rem', color: C.orange, marginTop: 2 }}>Actuel local: {cfg.local_values.logtarget}</div>}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
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

                            {/* Card: Base de données & Rétention */}
                            <div style={card}>
                                <div style={{ ...cardH }}>
                                    <Database style={{ width: 14, height: 14, color: C.purple }} />
                                    <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Base de données &amp; Rétention</span>
                                    <span style={{ marginLeft: 'auto', fontSize: '.7rem', color: C.muted }}>Écrit dans fail2ban.local</span>
                                </div>
                                <div style={{ ...cardB, display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
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
                                            <div style={{ fontSize: '.65rem', color: C.muted, marginTop: 2 }}>Nombre max de lignes de log conservées par IP</div>
                                        </div>
                                    </div>
                                    <Btn onClick={persistDb} loading={saving === 'persist-db'}
                                        bg="rgba(188,140,255,.15)" color={C.purple} border="rgba(188,140,255,.4)">
                                        <Save style={{ width: 11, height: 11 }} /> Appliquer + persister dans fail2ban.local
                                    </Btn>
                                </div>
                            </div>

                            {/* Card: Service fail2ban */}
                            <div style={card}>
                                <div style={{ ...cardH }}>
                                    <RefreshCw style={{ width: 14, height: 14, color: C.blue }} />
                                    <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Service fail2ban</span>
                                </div>
                                <div style={{ ...cardB, display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                                        <Btn onClick={() => serviceAction('reload')} loading={saving === 'service-reload'}
                                            bg="rgba(88,166,255,.12)" color={C.blue} border="rgba(88,166,255,.3)">
                                            <RefreshCw style={{ width: 12, height: 12 }} /> Recharger (reload)
                                        </Btn>
                                        <span style={{ fontSize: '.68rem', color: C.muted }}>Relit la configuration sans interrompre les bans</span>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                                        <Btn onClick={() => serviceAction('restart')} loading={saving === 'service-restart'}
                                            bg="rgba(232,106,101,.12)" color={C.red} border="rgba(232,106,101,.3)">
                                            <RotateCcw style={{ width: 12, height: 12 }} /> Redémarrer (restart)
                                        </Btn>
                                        <span style={{ fontSize: '.68rem', color: C.muted }}>Redémarre complètement — bans temporairement inactifs</span>
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
                </div>
            </div>

            {/* ── SECTION 2: Application ──────────────────────────────────── */}
            <div>
                <SectionHeader
                    color={C.orange} bg="rgba(227,179,65,.07)"
                    icon={<Settings style={{ width: 16, height: 16 }} />}
                    title="Application"
                    sub="Base de données interne, maintenance"
                />
                <div style={{ border: `1px solid ${C.border}`, borderTop: 'none', borderRadius: '0 0 8px 8px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem', background: C.bg0 }}>

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

                    {/* Card: Raw files viewer */}
                    <div style={card}>
                        <div style={{ ...cardH, cursor: 'pointer' }} onClick={() => setRawTab(rawTab === null ? 'fail2ban.conf' : null)}>
                            <FileText style={{ width: 14, height: 14, color: C.blue }} />
                            <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Fichiers de configuration bruts</span>
                            <ChevronRight style={{ width: 14, height: 14, color: C.muted, marginLeft: 'auto', transition: 'transform .15s', transform: rawTab !== null ? 'rotate(90deg)' : 'none' }} />
                        </div>
                        {rawTab !== null && (
                            <div style={{ ...cardB, display: 'flex', gap: '.75rem', height: 420 }}>
                                <div style={{ width: 160, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    {(['fail2ban.conf', 'fail2ban.local', 'jail.conf', 'jail.local'] as const).map(f => (
                                        <button key={f} onClick={() => setRawTab(f)}
                                            style={{
                                                textAlign: 'left', padding: '.35rem .65rem', fontSize: '.78rem',
                                                fontFamily: 'monospace', background: rawTab === f ? 'rgba(88,166,255,.1)' : 'transparent',
                                                color: rawTab === f ? C.blue : C.text, border: 'none', borderRadius: 4, cursor: 'pointer',
                                            }}>
                                            {f}
                                            {rawFiles && rawFiles[f as keyof RawFiles] === null && (
                                                <span style={{ fontSize: '.6rem', color: C.muted, marginLeft: 4 }}>(absent)</span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                                <div style={{ flex: 1, background: C.bg3, borderRadius: 6, border: `1px solid ${C.border}`, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                                    <div style={{ padding: '.35rem .65rem', background: C.bg2, borderBottom: `1px solid ${C.border}`, fontSize: '.72rem', color: C.muted, fontFamily: 'monospace' }}>
                                        /etc/fail2ban/{rawTab}
                                    </div>
                                    <pre style={{ flex: 1, overflowY: 'auto', padding: '1rem', fontSize: '.75rem', fontFamily: 'monospace', color: C.text, lineHeight: 1.6, whiteSpace: 'pre-wrap', margin: 0 }}>
                                        {rawFiles ? (rawFiles[rawTab as keyof RawFiles] ?? '(fichier non disponible)') : 'Chargement…'}
                                    </pre>
                                </div>
                            </div>
                        )}
                    </div>

                </div>
            </div>

        </div>
    );
};
