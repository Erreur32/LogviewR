import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Archive, UploadCloud, AlertTriangle, CheckCircle, XCircle, FolderOpen, RefreshCw, Save, RotateCcw, Trash2, Layers, Shield, FileJson, Database, Download, Camera } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { card, cardH, cardB, F2bTooltip } from './helpers';

// ── Palette ───────────────────────────────────────────────────────────────────

const C = {
    bg0: '#0d1117', bg1: '#161b22', bg2: '#21262d', border: '#30363d',
    text: '#e6edf3', muted: '#8b949e',
    blue: '#58a6ff', purple: '#bc8cff', green: '#3fb950',
    red: '#e86a65', orange: '#e3b341', cyan: '#39c5cf',
};

// ── Section divider ───────────────────────────────────────────────────────────

const SectionHeader: React.FC<{ icon: React.ReactNode; label: string; color: string; sub?: string }> = ({ icon, label, color, sub }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: '-.25rem' }}>
        <span style={{ color, display: 'flex', alignItems: 'center' }}>{icon}</span>
        <span style={{ fontWeight: 700, fontSize: '.82rem', color, letterSpacing: '.04em', textTransform: 'uppercase' }}>{label}</span>
        {sub && <span style={{ fontSize: '.73rem', color: C.muted }}>{sub}</span>}
        <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${color}44 0%, transparent 100%)` }} />
    </div>
);

// ── Types ─────────────────────────────────────────────────────────────────────

interface SnapshotEntry { filename: string; size: number; ts: number }
interface IptBackupEntry { filename: string; size: number; ts: number }

interface BackupFile {
    version: number;
    type: string;
    exported_at: string;
    exported_by: string;
    host: string;
    files: Record<string, string>;
    runtime?: {
        total_banned?: number;
        jails?: Record<string, { currently_banned?: number; banned_ips?: string[] }>;
    };
}

interface DbExportFile {
    version: number;
    type: string;
    exported_at: string;
    counts: Record<string, number>;
    tables: Record<string, unknown[]>;
}

interface DbImportResult {
    ok: boolean;
    mode: string;
    inserted: Record<string, number>;
    skipped: string[];
}

interface ConfigRestoreResult {
    ok: boolean;
    written: string[];
    skipped: string[];
    errors: string[];
    reloadOk?: boolean;
    reloadOut?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function padZ(n: number) { return String(n).padStart(2, '0'); }
function nowStamp() {
    const d = new Date();
    return `${d.getFullYear()}-${padZ(d.getMonth()+1)}-${padZ(d.getDate())}_${padZ(d.getHours())}${padZ(d.getMinutes())}${padZ(d.getSeconds())}`;
}

function authBearer() {
    return { Authorization: `Bearer ${localStorage.getItem('dashboard_user_token') ?? ''}` };
}

async function downloadFile(url: string, filename: string) {
    const resp = await fetch(url, { credentials: 'include', headers: authBearer() });
    if (!resp.ok) return;
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = blobUrl; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
}

// ── Sub-components ────────────────────────────────────────────────────────────

const Spinner: React.FC<{ color: string }> = ({ color }) => (
    <span style={{ display: 'inline-block', width: 12, height: 12, border: `2px solid ${color}33`, borderTopColor: color, borderRadius: '50%', animation: 'spin .7s linear infinite', flexShrink: 0 }} />
);

const Alert: React.FC<{ type: 'error' | 'warn' | 'ok'; children: React.ReactNode }> = ({ type, children }) => {
    const map = {
        error: { bg: 'rgba(232,106,101,.1)', border: 'rgba(232,106,101,.3)', color: C.red,    Icon: XCircle },
        warn:  { bg: 'rgba(227,179,65,.08)',  border: 'rgba(227,179,65,.25)', color: C.orange, Icon: AlertTriangle },
        ok:    { bg: 'rgba(63,185,80,.06)',   border: 'rgba(63,185,80,.25)',  color: C.green,  Icon: CheckCircle },
    };
    const { bg, border, color, Icon } = map[type];
    return (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.5rem', padding: '.5rem .75rem', background: bg, border: `1px solid ${border}`, borderRadius: 6, fontSize: '.8rem', color }}>
            <Icon style={{ width: 13, height: 13, flexShrink: 0, marginTop: 1 }} />
            <span>{children}</span>
        </div>
    );
};

// ── Snapshot table (shared between Config and DB snapshot panels) ──────────────

interface SnapshotTableProps {
    snapshots: SnapshotEntry[];
    downloading: string | null;
    restoring: string | null;
    deleting: string | null;
    onDownload: (filename: string) => void;
    onRestore: (filename: string) => void;
    onDelete: (filename: string) => void;
    emptyLabel: string;
}

const SnapshotTable: React.FC<SnapshotTableProps> = ({
    snapshots, downloading, restoring, deleting,
    onDownload, onRestore, onDelete, emptyLabel,
}) => {
    const { t } = useTranslation();
    const fmtSize = (b: number) => b > 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`;
    const fmtDate = (ts: number) => new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

    if (snapshots.length === 0) return <div style={{ color: '#555d69', fontSize: '.8rem' }}>{emptyLabel}</div>;

    return (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.78rem' }}>
            <thead>
                <tr style={{ borderBottom: '1px solid #30363d', color: '#8b949e', fontSize: '.68rem', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                    <th style={{ textAlign: 'left', padding: '.3rem .5rem .3rem 0' }}>Fichier</th>
                    <th style={{ textAlign: 'right', padding: '.3rem .5rem' }}>Taille</th>
                    <th style={{ textAlign: 'right', padding: '.3rem .5rem' }}>Date</th>
                    <th style={{ textAlign: 'right', padding: '.3rem 0 .3rem .5rem' }}>Actions</th>
                </tr>
            </thead>
            <tbody>
                {snapshots.map(s => (
                    <tr key={s.filename}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.02)'}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                        style={{ borderBottom: '1px solid #21262d' }}>
                        <td style={{ padding: '.45rem .5rem .45rem 0', fontFamily: 'monospace', color: '#c9d1d9', fontSize: '.74rem', wordBreak: 'break-all' }}>{s.filename}</td>
                        <td style={{ padding: '.45rem .5rem', textAlign: 'right', color: '#8b949e', whiteSpace: 'nowrap' }}>{fmtSize(s.size)}</td>
                        <td style={{ padding: '.45rem .5rem', textAlign: 'right', color: '#8b949e', whiteSpace: 'nowrap' }}>{fmtDate(s.ts)}</td>
                        <td style={{ padding: '.45rem 0 .45rem .5rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <F2bTooltip title={t('fail2ban.backup.download')} body={t('fail2ban.backup.downloadSnapshot')} color="green">
                                <button onClick={() => onDownload(s.filename)} disabled={downloading === s.filename}
                                    style={{ background: 'rgba(63,185,80,.1)', border: '1px solid rgba(63,185,80,.25)', color: C.green, borderRadius: 4, cursor: 'pointer', padding: '.2rem .45rem', marginRight: '.35rem', display: 'inline-flex', alignItems: 'center', opacity: downloading === s.filename ? .5 : 1 }}>
                                    {downloading === s.filename ? <Spinner color={C.green} /> : <Download style={{ width: 11, height: 11 }} />}
                                </button>
                            </F2bTooltip>
                            <F2bTooltip title={t('fail2ban.backup.restore')} body={t('fail2ban.backup.restoreSnapshot')} color="orange">
                                <button onClick={() => onRestore(s.filename)} disabled={restoring === s.filename}
                                    style={{ background: 'rgba(227,179,65,.1)', border: '1px solid rgba(227,179,65,.25)', color: C.orange, borderRadius: 4, cursor: 'pointer', padding: '.2rem .45rem', marginRight: '.35rem', display: 'inline-flex', alignItems: 'center', opacity: restoring === s.filename ? .5 : 1 }}>
                                    {restoring === s.filename ? <Spinner color={C.orange} /> : <RotateCcw style={{ width: 11, height: 11 }} />}
                                </button>
                            </F2bTooltip>
                            <F2bTooltip title={t('fail2ban.backup.delete')} body={t('fail2ban.backup.deleteSnapshot')} color="red">
                                <button onClick={() => onDelete(s.filename)} disabled={deleting === s.filename}
                                    style={{ background: 'rgba(232,106,101,.08)', border: '1px solid rgba(232,106,101,.2)', color: C.red, borderRadius: 4, cursor: 'pointer', padding: '.2rem .45rem', display: 'inline-flex', alignItems: 'center', opacity: deleting === s.filename ? .5 : 1 }}>
                                    {deleting === s.filename ? <Spinner color={C.red} /> : <Trash2 style={{ width: 11, height: 11 }} />}
                                </button>
                            </F2bTooltip>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
};

// ── Config Snapshot Panel ─────────────────────────────────────────────────────

const ConfigSnapshotPanel: React.FC = () => {
    const { t } = useTranslation();
    const [snapshots, setSnapshots]     = useState<SnapshotEntry[]>([]);
    const [loading, setLoading]         = useState(false);
    const [creating, setCreating]       = useState(false);
    const [reload, setReload]           = useState(true);
    const [msg, setMsg]                 = useState<{ ok: boolean; text: string } | null>(null);
    const [restoreResult, setRestoreResult] = useState<ConfigRestoreResult | null>(null);
    const [downloading, setDownloading] = useState<string | null>(null);
    const [restoring, setRestoring]     = useState<string | null>(null);
    const [deleting, setDeleting]       = useState<string | null>(null);

    const fetchSnapshots = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get<{ ok: boolean; snapshots: SnapshotEntry[] }>('/api/plugins/fail2ban/backup/snapshots');
            if (res.success && res.result?.ok) setSnapshots(res.result.snapshots);
        } finally { setLoading(false); }
    }, []);

    useEffect(() => { void fetchSnapshots(); }, [fetchSnapshots]);

    const createSnapshot = async () => {
        setCreating(true); setMsg(null); setRestoreResult(null);
        try {
            const res = await api.post<{ ok: boolean; filename?: string; error?: string }>(
                '/api/plugins/fail2ban/backup/snapshot', {}
            );
            if (res.success && res.result?.ok) {
                setMsg({ ok: true, text: t('fail2ban.backup.snapshotCreated', { filename: res.result.filename ?? '' }) });
                void fetchSnapshots();
            } else {
                setMsg({ ok: false, text: res.result?.error ?? t('fail2ban.backup.serverError') });
            }
        } finally { setCreating(false); }
    };

    const handleDownload = async (filename: string) => {
        setDownloading(filename);
        try { await downloadFile(`/api/plugins/fail2ban/backup/snapshot/${encodeURIComponent(filename)}/download`, filename); }
        finally { setDownloading(null); }
    };

    const handleRestore = async (filename: string) => {
        if (!confirm(t('fail2ban.backup.restoreConfirm', { filename }))) return;
        setRestoring(filename); setMsg(null); setRestoreResult(null);
        try {
            const res = await api.post<ConfigRestoreResult>(
                `/api/plugins/fail2ban/backup/snapshot/${encodeURIComponent(filename)}/restore?reload=${reload ? 1 : 0}`, {}
            );
            if (res.success && res.result) {
                setRestoreResult(res.result);
                setMsg({ ok: res.result.ok, text: res.result.ok ? t('fail2ban.backup.restoreSuccess') : t('fail2ban.backup.restoreWithErrors') });
            } else {
                setMsg({ ok: false, text: t('fail2ban.backup.serverError') });
            }
        } finally { setRestoring(null); }
    };

    const handleDelete = async (filename: string) => {
        if (!confirm(t('fail2ban.backup.deleteSnapshotConfirm', { filename }))) return;
        setDeleting(filename);
        try { await api.delete(`/api/plugins/fail2ban/backup/snapshot/${encodeURIComponent(filename)}`); void fetchSnapshots(); }
        finally { setDeleting(null); }
    };

    return (
        <div style={{ ...card, height: '100%', display: 'flex', flexDirection: 'column', borderTop: `2px solid ${C.green}` }}>
            <div style={cardH}>
                <Camera style={{ width: 14, height: 14, color: C.blue }} />
                <span style={{ fontWeight: 600, fontSize: '.9rem' }}>{t('fail2ban.backup.snapshotsConfig')}</span>
                <span style={{ marginLeft: 'auto', fontSize: '.68rem', padding: '.1rem .45rem', borderRadius: 4, background: 'rgba(88,166,255,.12)', color: C.blue, border: '1px solid rgba(88,166,255,.25)' }}>{t('fail2ban.backup.maxEntries', { count: 10 })}</span>
            </div>
            <div style={{ ...cardB, display: 'flex', flexDirection: 'column', gap: '.75rem', flex: 1 }}>
                <div style={{ fontSize: '.75rem', color: C.muted }}>
                    {t('fail2ban.backup.configSnapshotsDescription')}
                </div>
                <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.75rem', color: C.muted, cursor: 'pointer', userSelect: 'none', flexShrink: 0 }}>
                        <input type="checkbox" checked={reload} onChange={e => setReload(e.target.checked)}
                            style={{ accentColor: C.purple, width: 12, height: 12 }} />
                        <RefreshCw style={{ width: 10, height: 10 }} />
                        {t('fail2ban.backup.reloadAuto')}
                    </label>
                    <button onClick={() => { void createSnapshot(); }} disabled={creating} style={{
                        marginLeft: 'auto',
                        background: 'rgba(63,185,80,.12)', border: `1px solid rgba(63,185,80,.3)`, color: C.green,
                        borderRadius: 4, cursor: creating ? 'default' : 'pointer',
                        padding: '.35rem .85rem', fontSize: '.8rem', fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: '.35rem', opacity: creating ? .6 : 1, flexShrink: 0,
                    }}>
                        {creating ? <><Spinner color={C.green} /> {t('fail2ban.backup.creating')}</> : <><Camera style={{ width: 12, height: 12 }} /> {t('fail2ban.backup.createSnapshot')}</>}
                    </button>
                </div>
                {msg && (
                    <div style={{ fontSize: '.78rem', color: msg.ok ? C.green : C.red, display: 'flex', gap: '.4rem', alignItems: 'center' }}>
                        {msg.ok ? <CheckCircle style={{ width: 12, height: 12 }} /> : <AlertTriangle style={{ width: 12, height: 12 }} />}
                        {msg.text}
                    </div>
                )}
                {loading && <div style={{ color: C.muted, fontSize: '.82rem' }}>{t('fail2ban.backup.loading')}</div>}
                {!loading && (
                    <SnapshotTable
                        snapshots={snapshots}
                        downloading={downloading} restoring={restoring} deleting={deleting}
                        onDownload={filename => { void handleDownload(filename); }}
                        onRestore={filename => { void handleRestore(filename); }}
                        onDelete={filename => { void handleDelete(filename); }}
                        emptyLabel={t('fail2ban.backup.noConfigSnapshot')}
                    />
                )}
                {restoreResult && (
                    <div style={{ padding: '.5rem .75rem', background: restoreResult.ok ? 'rgba(63,185,80,.06)' : 'rgba(232,106,101,.06)', border: `1px solid ${restoreResult.ok ? 'rgba(63,185,80,.25)' : 'rgba(232,106,101,.25)'}`, borderRadius: 6, fontSize: '.78rem' }}>
                        {restoreResult.written.length > 0 && (
                            <div style={{ color: C.muted, marginBottom: '.2rem' }}>
                                {t('fail2ban.backup.written')} {restoreResult.written.map(f => <code key={f} style={{ color: C.green, marginRight: '.35rem', fontFamily: 'monospace' }}>{f}</code>)}
                            </div>
                        )}
                        {restoreResult.errors.length > 0 && (
                            <div style={{ color: C.red }}>
                                {t('fail2ban.backup.errors')} {restoreResult.errors.map((e, i) => <div key={i}><code style={{ fontFamily: 'monospace' }}>{e}</code></div>)}
                            </div>
                        )}
                        {restoreResult.reloadOk !== undefined && (
                            <div style={{ color: restoreResult.reloadOk ? C.green : C.orange }}>
                                {t('fail2ban.backup.reloadLabel')} {restoreResult.reloadOk ? '✓ ' + t('fail2ban.backup.ok') : `⚠ ${restoreResult.reloadOut ?? t('fail2ban.backup.failed')}`}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

// ── Config Restore Panel (from external file) ─────────────────────────────────

const ConfigRestorePanel: React.FC = () => {
    const { t } = useTranslation();
    const [backup, setBackup]               = useState<BackupFile | null>(null);
    const [fileName, setFileName]           = useState<string | null>(null);
    const [fileErr, setFileErr]             = useState<string | null>(null);
    const [reload, setReload]               = useState(true);
    const [restoring, setRestoring]         = useState(false);
    const [restoreErr, setRestoreErr]       = useState<string | null>(null);
    const [restoreResult, setRestoreResult] = useState<ConfigRestoreResult | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setBackup(null); setFileErr(null); setRestoreResult(null); setRestoreErr(null); setFileName(null);
        const file = e.target.files?.[0];
        if (!file) return;
        setFileName(file.name);
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const d = JSON.parse(ev.target?.result as string) as BackupFile;
                if (d.type !== 'f2b_full_backup' || d.version !== 1) {
                    setFileErr(t('fail2ban.backup.invalidFile')); return;
                }
                setBackup(d);
            } catch { setFileErr(t('fail2ban.backup.cannotReadJson')); }
        };
        reader.onerror = () => setFileErr(t('fail2ban.errors.readError'));
        reader.readAsText(file);
    };

    const handleRestore = async () => {
        if (!backup) return;
        const localFiles = Object.keys(backup.files).filter(k => k.endsWith('.local'));
        if (!window.confirm(
            t('fail2ban.backup.restoreLocalFilesConfirm', { count: localFiles.length, date: new Date(backup.exported_at).toLocaleString('fr-FR') })
        )) return;
        setRestoring(true); setRestoreErr(null); setRestoreResult(null);
        try {
            const resp = await fetch(`/api/plugins/fail2ban/backup/restore?reload=${reload ? 1 : 0}`, {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(backup),
            });
            const json = await resp.json() as { success: boolean; error?: string; result?: ConfigRestoreResult };
            if (!json.success) throw new Error(json.error ?? t('fail2ban.errors.unknown'));
            setRestoreResult(json.result ?? null);
        } catch (err: unknown) {
            setRestoreErr(err instanceof Error ? err.message : String(err));
        } finally {
            setRestoring(false); setBackup(null); setFileName(null);
            if (fileRef.current) fileRef.current.value = '';
        }
    };

    const totalFiles = backup ? Object.keys(backup.files).length : 0;
    const localCount = backup ? Object.keys(backup.files).filter(k => k.endsWith('.local')).length : 0;
    const jailNames  = backup?.runtime?.jails ? Object.keys(backup.runtime.jails) : [];

    return (
        <div style={{ ...card, borderTop: `2px solid ${C.orange}`, display: 'flex', flexDirection: 'column' }}>
            <div style={{ ...cardH, gap: '.6rem' }}>
                <UploadCloud style={{ width: 15, height: 15, color: C.orange }} />
                <div>
                    <div style={{ fontWeight: 700, fontSize: '.88rem', color: C.text, lineHeight: 1.2 }}>{t('fail2ban.backup.restoreFromFile')}</div>
                    <div style={{ fontSize: '.7rem', color: C.muted, marginTop: 1 }}>{t('fail2ban.backup.importExternalBackup')}</div>
                </div>
                <span style={{ marginLeft: 'auto', fontSize: '.67rem', padding: '.1rem .45rem', borderRadius: 4, background: 'rgba(227,179,65,.12)', color: C.orange, border: '1px solid rgba(227,179,65,.22)' }}>restore</span>
            </div>
            <div style={{ ...cardB, display: 'flex', flexDirection: 'column', gap: '.7rem', flex: 1 }}>

                <Alert type="warn">
                    {t('fail2ban.backup.localFilesOnly')}
                </Alert>

                <input ref={fileRef} type="file" accept=".json" onChange={handleFileChange} style={{ display: 'none' }} />

                <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                    <button onClick={() => fileRef.current?.click()} style={{
                        display: 'inline-flex', alignItems: 'center', gap: '.4rem',
                        padding: '.35rem .75rem', borderRadius: 6, fontSize: '.8rem', fontWeight: 600,
                        background: 'rgba(139,148,158,.1)', border: `1px solid ${C.border}`,
                        color: C.text, cursor: 'pointer', flexShrink: 0,
                    }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = C.muted; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = C.border; }}
                    >
                        <FolderOpen style={{ width: 13, height: 13, color: C.muted }} />
                        {t('fail2ban.backup.choose')}
                    </button>
                    <span style={{ fontSize: '.78rem', color: fileName ? C.text : C.muted, fontFamily: fileName ? 'monospace' : 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                        {fileName ?? t('fail2ban.backup.noFileSelected')}
                    </span>
                </div>

                {fileErr && <Alert type="error">{fileErr}</Alert>}

                {backup && (
                    <div style={{ padding: '.5rem .75rem', background: 'rgba(63,185,80,.06)', border: '1px solid rgba(63,185,80,.22)', borderRadius: 6, fontSize: '.78rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: '.25rem', color: C.green, fontWeight: 600 }}>
                            <CheckCircle style={{ width: 11, height: 11 }} /> {t('fail2ban.backup.validBackup')}
                        </div>
                        <div style={{ color: C.muted, lineHeight: 1.7 }}>
                            <div><span style={{ color: C.text }}>{new Date(backup.exported_at).toLocaleString('fr-FR')}</span> · <code style={{ color: C.text, fontFamily: 'monospace' }}>{backup.host}</code></div>
                            <div><span style={{ color: C.text }}>{t('fail2ban.backup.totalFiles', { count: totalFiles })}</span> · <span style={{ color: C.blue }}>{t('fail2ban.backup.localFiles', { count: localCount })}</span></div>
                            {jailNames.length > 0 && <div>{t('fail2ban.backup.jails')} <span style={{ color: C.text }}>{jailNames.join(', ')}</span></div>}
                        </div>
                    </div>
                )}

                <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.78rem', color: C.muted, cursor: 'pointer', userSelect: 'none' }}>
                    <input type="checkbox" checked={reload} onChange={e => setReload(e.target.checked)}
                        style={{ accentColor: C.purple, width: 13, height: 13 }} />
                    <RefreshCw style={{ width: 10, height: 10 }} />
                    {t('fail2ban.backup.reloadAfterRestore')}
                </label>

                {restoreErr && <Alert type="error">{restoreErr}</Alert>}

                <button onClick={() => { void handleRestore(); }} disabled={!backup || restoring} style={{
                    display: 'inline-flex', alignItems: 'center', gap: '.4rem',
                    padding: '.42rem 1rem', borderRadius: 6, fontSize: '.82rem', fontWeight: 600,
                    background: (!backup || restoring) ? 'rgba(227,179,65,.05)' : 'rgba(227,179,65,.14)',
                    border: '1px solid rgba(227,179,65,.38)', color: C.orange,
                    cursor: (!backup || restoring) ? 'not-allowed' : 'pointer',
                    opacity: (!backup || restoring) ? .4 : 1,
                    width: '100%', justifyContent: 'center', marginTop: 'auto',
                }}>
                    {restoring
                        ? <><Spinner color={C.orange} /> {t('fail2ban.backup.restoring')}</>
                        : <><UploadCloud style={{ width: 13, height: 13 }} /> {t('fail2ban.backup.launchRestore')}</>
                    }
                </button>

                {restoreResult && (
                    <div style={{ padding: '.5rem .75rem', background: restoreResult.ok ? 'rgba(63,185,80,.06)' : 'rgba(232,106,101,.06)', border: `1px solid ${restoreResult.ok ? 'rgba(63,185,80,.25)' : 'rgba(232,106,101,.25)'}`, borderRadius: 6, fontSize: '.78rem' }}>
                        <div style={{ fontWeight: 600, marginBottom: '.3rem', color: restoreResult.ok ? C.green : C.red }}>
                            {restoreResult.ok ? t('fail2ban.backup.restoreSuccessShort') : t('fail2ban.backup.restoreWithErrorsShort')}
                        </div>
                        {restoreResult.written.length > 0 && (
                            <div style={{ color: C.muted, marginBottom: '.2rem' }}>
                                {t('fail2ban.backup.written')} {restoreResult.written.map(f => <code key={f} style={{ color: C.green, marginRight: '.35rem', fontFamily: 'monospace' }}>{f}</code>)}
                            </div>
                        )}
                        {restoreResult.skipped.length > 0 && (
                            <div style={{ color: C.muted, marginBottom: '.2rem' }}>
                                {t('fail2ban.backup.ignored')} {restoreResult.skipped.map(f => <code key={f} style={{ color: C.muted, marginRight: '.35rem', fontFamily: 'monospace' }}>{f}</code>)}
                            </div>
                        )}
                        {restoreResult.errors.length > 0 && (
                            <div style={{ color: C.red }}>
                                {t('fail2ban.backup.errors')} {restoreResult.errors.map((e, i) => <div key={i}><code style={{ fontFamily: 'monospace' }}>{e}</code></div>)}
                            </div>
                        )}
                        {restoreResult.reloadOk !== undefined && (
                            <div style={{ marginTop: '.25rem', color: restoreResult.reloadOk ? C.green : C.orange }}>
                                {t('fail2ban.backup.reloadLabel')} {restoreResult.reloadOk ? '✓ ' + t('fail2ban.backup.ok') : `⚠ ${restoreResult.reloadOut ?? t('fail2ban.backup.failed')}`}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

// ── DB Snapshot Panel ─────────────────────────────────────────────────────────

const DbSnapshotPanel: React.FC = () => {
    const { t } = useTranslation();
    const [snapshots, setSnapshots]     = useState<SnapshotEntry[]>([]);
    const [loading, setLoading]         = useState(false);
    const [creating, setCreating]       = useState(false);
    const [restoreMode, setRestoreMode] = useState<'merge' | 'replace'>('merge');
    const [msg, setMsg]                 = useState<{ ok: boolean; text: string } | null>(null);
    const [restoreResult, setRestoreResult] = useState<DbImportResult | null>(null);
    const [downloading, setDownloading] = useState<string | null>(null);
    const [restoring, setRestoring]     = useState<string | null>(null);
    const [deleting, setDeleting]       = useState<string | null>(null);

    const fetchSnapshots = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get<{ ok: boolean; snapshots: SnapshotEntry[] }>('/api/plugins/fail2ban/db-snapshots');
            if (res.success && res.result?.ok) setSnapshots(res.result.snapshots);
        } finally { setLoading(false); }
    }, []);

    useEffect(() => { void fetchSnapshots(); }, [fetchSnapshots]);

    const createSnapshot = async () => {
        setCreating(true); setMsg(null); setRestoreResult(null);
        try {
            const res = await api.post<{ ok: boolean; filename?: string; error?: string }>(
                '/api/plugins/fail2ban/db-snapshot', {}
            );
            if (res.success && res.result?.ok) {
                setMsg({ ok: true, text: t('fail2ban.backup.snapshotCreated', { filename: res.result.filename ?? '' }) });
                void fetchSnapshots();
            } else {
                setMsg({ ok: false, text: res.result?.error ?? t('fail2ban.backup.serverError') });
            }
        } finally { setCreating(false); }
    };

    const handleDownload = async (filename: string) => {
        setDownloading(filename);
        try { await downloadFile(`/api/plugins/fail2ban/db-snapshot/${encodeURIComponent(filename)}/download`, filename); }
        finally { setDownloading(null); }
    };

    const handleRestore = async (filename: string) => {
        const modeLabel = restoreMode === 'replace' ? t('fail2ban.backup.replace') : t('fail2ban.backup.merge');
        if (!confirm(`${restoreMode === 'replace' ? '⚠ ' : ''}${t('fail2ban.backup.dbRestoreConfirm', { filename, mode: modeLabel })}`)) return;
        setRestoring(filename); setMsg(null); setRestoreResult(null);
        try {
            const res = await api.post<DbImportResult>(
                `/api/plugins/fail2ban/db-snapshot/${encodeURIComponent(filename)}/restore?mode=${restoreMode}`, {}
            );
            if (res.success && res.result) {
                setRestoreResult(res.result);
                setMsg({ ok: res.result.ok, text: res.result.ok ? t('fail2ban.backup.restoreSuccess') : t('fail2ban.backup.restoreWithErrors') });
            } else {
                setMsg({ ok: false, text: t('fail2ban.backup.serverError') });
            }
        } finally { setRestoring(null); }
    };

    const handleDelete = async (filename: string) => {
        if (!confirm(t('fail2ban.backup.deleteSnapshotConfirm', { filename }))) return;
        setDeleting(filename);
        try { await api.delete(`/api/plugins/fail2ban/db-snapshot/${encodeURIComponent(filename)}`); void fetchSnapshots(); }
        finally { setDeleting(null); }
    };

    return (
        <div style={{ ...card, height: '100%', display: 'flex', flexDirection: 'column', borderTop: `2px solid ${C.green}` }}>
            <div style={cardH}>
                <Camera style={{ width: 14, height: 14, color: C.orange }} />
                <span style={{ fontWeight: 600, fontSize: '.9rem' }}>{t('fail2ban.backup.databasesSnapshots')}</span>
                <span style={{ marginLeft: 'auto', fontSize: '.68rem', padding: '.1rem .45rem', borderRadius: 4, background: 'rgba(227,179,65,.12)', color: C.orange, border: '1px solid rgba(227,179,65,.25)' }}>{t('fail2ban.backup.maxEntries', { count: 5 })}</span>
            </div>
            <div style={{ ...cardB, display: 'flex', flexDirection: 'column', gap: '.75rem', flex: 1 }}>
                <div style={{ fontSize: '.75rem', color: C.muted }}>
                    {t('fail2ban.backup.dbSnapshotsDescription')}
                </div>

                {/* Mode restore selector */}
                <div style={{ display: 'flex', gap: '.4rem' }}>
                    {(['merge', 'replace'] as const).map(m => (
                        <label key={m} onClick={() => setRestoreMode(m)} style={{
                            flex: 1, display: 'flex', alignItems: 'center', gap: '.4rem',
                            padding: '.3rem .55rem', borderRadius: 5, cursor: 'pointer',
                            background: restoreMode === m ? (m === 'replace' ? 'rgba(232,106,101,.1)' : 'rgba(63,185,80,.08)') : 'rgba(255,255,255,.03)',
                            border: `1px solid ${restoreMode === m ? (m === 'replace' ? 'rgba(232,106,101,.35)' : 'rgba(63,185,80,.3)') : C.border}`,
                            fontSize: '.74rem', userSelect: 'none',
                        }}>
                            <input type="radio" name="dbSnapMode" value={m} checked={restoreMode === m} onChange={() => setRestoreMode(m)}
                                style={{ accentColor: m === 'replace' ? C.red : C.green, width: 11, height: 11 }} />
                            <div>
                                <div style={{ fontWeight: 600, color: restoreMode === m ? (m === 'replace' ? C.red : C.green) : C.text, fontSize: '.74rem' }}>
                                    {m === 'merge' ? t('fail2ban.backup.merge') : t('fail2ban.backup.replace')}
                                </div>
                                <div style={{ fontSize: '.65rem', color: C.muted }}>
                                    {m === 'merge' ? t('fail2ban.backup.mergeDescription') : t('fail2ban.backup.replaceDescription')}
                                </div>
                            </div>
                        </label>
                    ))}
                    <button onClick={() => { void createSnapshot(); }} disabled={creating} style={{
                        background: 'rgba(63,185,80,.12)', border: `1px solid rgba(63,185,80,.3)`, color: C.green,
                        borderRadius: 4, cursor: creating ? 'default' : 'pointer',
                        padding: '.35rem .85rem', fontSize: '.8rem', fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: '.35rem', opacity: creating ? .6 : 1, flexShrink: 0,
                    }}>
                        {creating ? <><Spinner color={C.green} /> {t('fail2ban.backup.creating')}</> : <><Camera style={{ width: 12, height: 12 }} /> {t('fail2ban.backup.snapshot')}</>}
                    </button>
                </div>

                {restoreMode === 'replace' && (
                    <Alert type="warn">{t('fail2ban.backup.modeReplaceWarning')}</Alert>
                )}

                {msg && (
                    <div style={{ fontSize: '.78rem', color: msg.ok ? C.green : C.red, display: 'flex', gap: '.4rem', alignItems: 'center' }}>
                        {msg.ok ? <CheckCircle style={{ width: 12, height: 12 }} /> : <AlertTriangle style={{ width: 12, height: 12 }} />}
                        {msg.text}
                    </div>
                )}
                {loading && <div style={{ color: C.muted, fontSize: '.82rem' }}>{t('fail2ban.backup.loading')}</div>}
                {!loading && (
                    <SnapshotTable
                        snapshots={snapshots}
                        downloading={downloading} restoring={restoring} deleting={deleting}
                        onDownload={filename => { void handleDownload(filename); }}
                        onRestore={filename => { void handleRestore(filename); }}
                        onDelete={filename => { void handleDelete(filename); }}
                        emptyLabel={t('fail2ban.backup.noDatabaseSnapshot')}
                    />
                )}
                {restoreResult && (
                    <div style={{ padding: '.5rem .75rem', background: restoreResult.ok ? 'rgba(63,185,80,.06)' : 'rgba(232,106,101,.06)', border: `1px solid ${restoreResult.ok ? 'rgba(63,185,80,.25)' : 'rgba(232,106,101,.25)'}`, borderRadius: 6, fontSize: '.78rem' }}>
                        <div style={{ fontWeight: 600, marginBottom: '.3rem', color: restoreResult.ok ? C.green : C.red }}>
                            {restoreResult.ok ? t('fail2ban.backup.restoreSuccessShort') : t('fail2ban.backup.restoreWithErrorsShort')}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem .75rem', color: C.muted }}>
                            {Object.entries(restoreResult.inserted).map(([tbl, n]) => (
                                <span key={tbl} style={{ fontSize: '.72rem' }}>
                                    <span style={{ fontFamily: 'monospace' }}>{tbl.replace('f2b_', '')}</span>
                                    {' '}<span style={{ fontWeight: 600, color: C.green }}>{n.toLocaleString()} {t('fail2ban.backup.rows')}</span>
                                </span>
                            ))}
                        </div>
                        {restoreResult.skipped.length > 0 && (
                            <div style={{ marginTop: '.2rem', fontSize: '.7rem', color: C.muted }}>
                                {t('fail2ban.backup.skippedEmpty')} {restoreResult.skipped.map(tbl => tbl.replace('f2b_', '')).join(', ')}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

// ── DB Import Panel (from external file) ─────────────────────────────────────

const DbImportPanel: React.FC = () => {
    const { t } = useTranslation();
    const [dbFile, setDbFile]               = useState<DbExportFile | null>(null);
    const [dbFileName, setDbFileName]       = useState<string | null>(null);
    const [dbFileErr, setDbFileErr]         = useState<string | null>(null);
    const [dbImportMode, setDbImportMode]   = useState<'merge' | 'replace'>('merge');
    const [dbImporting, setDbImporting]     = useState(false);
    const [dbImportResult, setDbImportResult] = useState<DbImportResult | null>(null);
    const [dbImportErr, setDbImportErr]     = useState<string | null>(null);
    const dbFileRef = useRef<HTMLInputElement>(null);

    const handleDbFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setDbFile(null); setDbFileErr(null); setDbImportResult(null); setDbImportErr(null); setDbFileName(null);
        const file = e.target.files?.[0];
        if (!file) return;
        setDbFileName(file.name);
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const d = JSON.parse(ev.target?.result as string) as DbExportFile;
                if (d.type !== 'f2b_db_export' || d.version !== 1) {
                    setDbFileErr(t('fail2ban.backup.invalidFileType')); return;
                }
                setDbFile(d);
            } catch { setDbFileErr(t('fail2ban.backup.cannotReadJsonFile')); }
        };
        reader.onerror = () => setDbFileErr(t('fail2ban.backup.readError'));
        reader.readAsText(file);
    };

    const handleDbImport = async () => {
        if (!dbFile) return;
        const totalRows = Object.values(dbFile.counts).reduce((a, b) => a + b, 0);
        const modeLabel = dbImportMode === 'replace' ? t('fail2ban.backup.replace') : t('fail2ban.backup.merge');
        if (!window.confirm(`${dbImportMode === 'replace' ? '⚠ ' : ''}${t('fail2ban.backup.importRowsConfirm', { count: totalRows, filename: dbFileName ?? '', mode: modeLabel } as any)}`)) return;
        setDbImporting(true); setDbImportErr(null); setDbImportResult(null);
        try {
            const res = await api.post<DbImportResult>('/api/plugins/fail2ban/db-import', { data: dbFile, mode: dbImportMode });
            if (res.success && res.result) {
                setDbImportResult(res.result);
                setDbFile(null); setDbFileName(null);
                if (dbFileRef.current) dbFileRef.current.value = '';
            } else {
                setDbImportErr(t('fail2ban.backup.importServerError'));
            }
        } catch (err: unknown) {
            setDbImportErr(err instanceof Error ? err.message : String(err));
        } finally { setDbImporting(false); }
    };

    return (
        <div style={{ ...card, borderTop: `2px solid ${C.orange}`, display: 'flex', flexDirection: 'column' }}>
            <div style={{ ...cardH, gap: '.6rem' }}>
                <UploadCloud style={{ width: 15, height: 15, color: C.orange }} />
                <div>
                    <div style={{ fontWeight: 700, fontSize: '.88rem', color: C.text, lineHeight: 1.2 }}>{t('fail2ban.backup.importFromFile')}</div>
                    <div style={{ fontSize: '.7rem', color: C.muted, marginTop: 1 }}>{t('fail2ban.backup.importExternalJson')}</div>
                </div>
                <span style={{ marginLeft: 'auto', fontSize: '.67rem', padding: '.1rem .45rem', borderRadius: 4, background: 'rgba(227,179,65,.12)', color: C.orange, border: '1px solid rgba(227,179,65,.22)' }}>import</span>
            </div>
            <div style={{ ...cardB, display: 'flex', flexDirection: 'column', gap: '.7rem', flex: 1 }}>

                <div style={{ display: 'flex', gap: '.5rem' }}>
                    {(['merge', 'replace'] as const).map(m => (
                        <label key={m} onClick={() => setDbImportMode(m)} style={{
                            flex: 1, display: 'flex', alignItems: 'center', gap: '.45rem',
                            padding: '.4rem .65rem', borderRadius: 5, cursor: 'pointer',
                            background: dbImportMode === m ? (m === 'replace' ? 'rgba(232,106,101,.1)' : 'rgba(63,185,80,.08)') : 'rgba(255,255,255,.03)',
                            border: `1px solid ${dbImportMode === m ? (m === 'replace' ? 'rgba(232,106,101,.35)' : 'rgba(63,185,80,.3)') : C.border}`,
                            fontSize: '.78rem', userSelect: 'none',
                        }}>
                            <input type="radio" name="dbMode" value={m} checked={dbImportMode === m} onChange={() => setDbImportMode(m)}
                                style={{ accentColor: m === 'replace' ? C.red : C.green, width: 12, height: 12 }} />
                            <div>
                                <div style={{ fontWeight: 600, color: dbImportMode === m ? (m === 'replace' ? C.red : C.green) : C.text }}>
                                    {m === 'merge' ? t('fail2ban.backup.merge') : t('fail2ban.backup.replace')}
                                </div>
                                <div style={{ fontSize: '.67rem', color: C.muted }}>
                                    {m === 'merge' ? t('fail2ban.backup.mergeDescription') : t('fail2ban.backup.replaceDescription')}
                                </div>
                            </div>
                        </label>
                    ))}
                </div>

                {dbImportMode === 'replace' && (
                    <Alert type="warn">{t('fail2ban.backup.importModeReplaceWarning')}</Alert>
                )}

                <input ref={dbFileRef} type="file" accept=".json" onChange={handleDbFileChange} style={{ display: 'none' }} />

                <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                    <button onClick={() => dbFileRef.current?.click()} style={{
                        display: 'inline-flex', alignItems: 'center', gap: '.4rem',
                        padding: '.35rem .75rem', borderRadius: 6, fontSize: '.8rem', fontWeight: 600,
                        background: 'rgba(139,148,158,.1)', border: `1px solid ${C.border}`,
                        color: C.text, cursor: 'pointer', flexShrink: 0,
                    }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = C.muted; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = C.border; }}
                    >
                        <FolderOpen style={{ width: 13, height: 13, color: C.muted }} />
                        {t('fail2ban.backup.choose')}
                    </button>
                    <span style={{ fontSize: '.78rem', color: dbFileName ? C.text : C.muted, fontFamily: dbFileName ? 'monospace' : 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                        {dbFileName ?? t('fail2ban.backup.noFileSelected')}
                    </span>
                </div>

                {dbFileErr && <Alert type="error">{dbFileErr}</Alert>}

                {dbFile && (
                    <div style={{ padding: '.5rem .75rem', background: 'rgba(63,185,80,.06)', border: '1px solid rgba(63,185,80,.22)', borderRadius: 6, fontSize: '.78rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: '.3rem', color: C.green, fontWeight: 600 }}>
                            <CheckCircle style={{ width: 11, height: 11 }} /> {t('fail2ban.backup.validBackup')} · {new Date(dbFile.exported_at).toLocaleString('fr-FR')}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem .75rem' }}>
                            {Object.entries(dbFile.counts).map(([tbl, n]) => (
                                <span key={tbl} style={{ fontSize: '.72rem', color: n > 0 ? C.text : C.muted }}>
                                    <span style={{ fontFamily: 'monospace', color: C.muted }}>{tbl.replace('f2b_', '')}</span>
                                    {' '}<span style={{ fontWeight: 600, color: n > 0 ? C.blue : C.muted }}>{n.toLocaleString()}</span>
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {dbImportErr && <Alert type="error">{dbImportErr}</Alert>}

                <button onClick={() => { void handleDbImport(); }} disabled={!dbFile || dbImporting} style={{
                    display: 'inline-flex', alignItems: 'center', gap: '.4rem',
                    padding: '.42rem 1rem', borderRadius: 6, fontSize: '.82rem', fontWeight: 600,
                    background: (!dbFile || dbImporting) ? 'rgba(227,179,65,.05)' : 'rgba(227,179,65,.14)',
                    border: '1px solid rgba(227,179,65,.38)', color: C.orange,
                    cursor: (!dbFile || dbImporting) ? 'not-allowed' : 'pointer',
                    opacity: (!dbFile || dbImporting) ? .4 : 1,
                    width: '100%', justifyContent: 'center', marginTop: 'auto',
                }}>
                    {dbImporting
                        ? <><Spinner color={C.orange} /> {t('fail2ban.backup.importInProgress')}</>
                        : <><UploadCloud style={{ width: 13, height: 13 }} /> {t('fail2ban.backup.launchImport')}</>
                    }
                </button>

                {dbImportResult && (
                    <div style={{ padding: '.5rem .75rem', background: dbImportResult.ok ? 'rgba(63,185,80,.06)' : 'rgba(232,106,101,.06)', border: `1px solid ${dbImportResult.ok ? 'rgba(63,185,80,.25)' : 'rgba(232,106,101,.25)'}`, borderRadius: 6, fontSize: '.78rem' }}>
                        <div style={{ fontWeight: 600, marginBottom: '.3rem', color: dbImportResult.ok ? C.green : C.red }}>
                            {dbImportResult.ok ? t('fail2ban.backup.importSuccess') : t('fail2ban.backup.importWithErrors')}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem .75rem', color: C.muted }}>
                            {Object.entries(dbImportResult.inserted).map(([tbl, n]) => (
                                <span key={tbl} style={{ fontSize: '.72rem' }}>
                                    <span style={{ fontFamily: 'monospace' }}>{tbl.replace('f2b_', '')}</span>
                                    {' '}<span style={{ fontWeight: 600, color: C.green }}>{n.toLocaleString()} {t('fail2ban.backup.rows')}</span>
                                </span>
                            ))}
                        </div>
                        {dbImportResult.skipped.length > 0 && (
                            <div style={{ marginTop: '.2rem', fontSize: '.7rem', color: C.muted }}>
                                {t('fail2ban.backup.skippedEmpty')} {dbImportResult.skipped.map(tbl => tbl.replace('f2b_', '')).join(', ')}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

// ── IPTables Backup Panel ─────────────────────────────────────────────────────

const IptBackupPanel: React.FC = () => {
    const { t } = useTranslation();
    const [backups, setBackups]     = useState<IptBackupEntry[]>([]);
    const [loading, setLoading]     = useState(false);
    const [creating, setCreating]   = useState(false);
    const [label, setLabel]         = useState('');
    const [msg, setMsg]             = useState<{ ok: boolean; text: string } | null>(null);
    const [restoring, setRestoring]   = useState<string | null>(null);
    const [deleting, setDeleting]     = useState<string | null>(null);
    const [downloading, setDownloading] = useState<string | null>(null);

    const fetchBackups = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get<{ ok: boolean; backups: IptBackupEntry[] }>('/api/plugins/fail2ban/iptables/backups');
            if (res.success && res.result?.ok) setBackups(res.result.backups);
        } finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchBackups(); }, [fetchBackups]);

    const createBackup = async () => {
        setCreating(true); setMsg(null);
        try {
            const res = await api.post<{ ok: boolean; filename?: string; error?: string }>(
                '/api/plugins/fail2ban/iptables/backup', { label: label.trim() || undefined }
            );
            if (res.success && res.result?.ok) {
                setMsg({ ok: true, text: `${t('fail2ban.messages.saved')} ${res.result.filename}` });
                setLabel(''); fetchBackups();
            } else {
                setMsg({ ok: false, text: res.result?.error ?? t('fail2ban.errors.unknown') });
            }
        } finally { setCreating(false); }
    };

    const restore = async (filename: string) => {
        if (!confirm(t('fail2ban.backup.restoreRulesConfirm', { filename }))) return;
        setRestoring(filename); setMsg(null);
        try {
            const res = await api.post<{ ok: boolean; output?: string; error?: string }>(
                `/api/plugins/fail2ban/iptables/restore/${encodeURIComponent(filename)}`, {}
            );
            if (res.success && res.result?.ok) setMsg({ ok: true, text: `${t('fail2ban.backup.restored')} ${filename}` });
            else setMsg({ ok: false, text: res.result?.error ?? t('fail2ban.errors.unknown') });
        } finally { setRestoring(null); }
    };

    const del = async (filename: string) => {
        if (!confirm(t('fail2ban.backup.deleteSnapshotConfirm', { filename }))) return;
        setDeleting(filename);
        try { await api.delete(`/api/plugins/fail2ban/iptables/backup/${encodeURIComponent(filename)}`); fetchBackups(); }
        finally { setDeleting(null); }
    };

    const download = async (filename: string) => {
        setDownloading(filename);
        try { await downloadFile(`/api/plugins/fail2ban/iptables/backup/${encodeURIComponent(filename)}/download`, filename); }
        finally { setDownloading(null); }
    };

    const fmtSize = (b: number) => b > 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`;
    const fmtDate = (ts: number) => new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const inputStyle: React.CSSProperties = { background: '#161b22', border: '1px solid #30363d', borderBottom: '1px solid #555', borderRadius: 4, color: '#e6edf3', fontSize: '.8rem', padding: '.35rem .6rem', outline: 'none', boxShadow: 'inset 0 2px 4px rgba(0,0,0,.55), inset 0 1px 0 rgba(0,0,0,.4), inset 0 -1px 0 rgba(255,255,255,.04)' };

    return (
        <div style={{ ...card, height: '100%', display: 'flex', flexDirection: 'column', borderTop: `2px solid ${C.green}` }}>
            <div style={cardH}>
                <Save style={{ width: 14, height: 14, color: C.cyan }} />
                <span style={{ fontWeight: 600, fontSize: '.9rem' }}>{t('fail2ban.backup.iptablesBackups')}</span>
                <span style={{ marginLeft: 'auto', fontSize: '.68rem', padding: '.1rem .45rem', borderRadius: 4, background: 'rgba(57,197,207,.12)', color: C.cyan, border: '1px solid rgba(57,197,207,.25)' }}>iptables-save</span>
            </div>
            <div style={{ ...cardB, display: 'flex', flexDirection: 'column', gap: '.75rem', flex: 1 }}>
                <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                    <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label (optionnel)"
                        style={{ ...inputStyle, flex: 1 }}
                        onKeyDown={e => { if (e.key === 'Enter') createBackup(); }} />
                    <button onClick={createBackup} disabled={creating} style={{
                        background: 'rgba(63,185,80,.12)', border: `1px solid rgba(63,185,80,.3)`, color: C.green,
                        borderRadius: 4, cursor: creating ? 'default' : 'pointer',
                        padding: '.35rem .85rem', fontSize: '.8rem', fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: '.35rem', opacity: creating ? .6 : 1,
                    }}>
                        <Save style={{ width: 12, height: 12 }} /> {t('fail2ban.backup.saveNow')}
                    </button>
                </div>
                {msg && (
                    <div style={{ fontSize: '.78rem', color: msg.ok ? C.green : C.red, display: 'flex', gap: '.4rem', alignItems: 'center' }}>
                        {msg.ok ? <CheckCircle style={{ width: 12, height: 12 }} /> : <AlertTriangle style={{ width: 12, height: 12 }} />}
                        {msg.text}
                    </div>
                )}
                {loading && <div style={{ color: '#8b949e', fontSize: '.82rem' }}>{t('fail2ban.messages.loadingData')}</div>}
                {!loading && backups.length === 0 && <div style={{ color: '#555d69', fontSize: '.8rem' }}>{t('fail2ban.backup.noIptablesBackup')}</div>}
                {backups.length > 0 && (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.78rem' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid #30363d', color: '#8b949e', fontSize: '.68rem', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                                <th style={{ textAlign: 'left', padding: '.3rem .5rem .3rem 0' }}>Fichier</th>
                                <th style={{ textAlign: 'right', padding: '.3rem .5rem' }}>Taille</th>
                                <th style={{ textAlign: 'right', padding: '.3rem .5rem' }}>Date</th>
                                <th style={{ textAlign: 'right', padding: '.3rem 0 .3rem .5rem' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {backups.map(b => (
                                <tr key={b.filename}
                                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.02)'}
                                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                                    style={{ borderBottom: '1px solid #21262d' }}>
                                    <td style={{ padding: '.45rem .5rem .45rem 0', fontFamily: 'monospace', color: '#c9d1d9', fontSize: '.74rem', wordBreak: 'break-all' }}>{b.filename}</td>
                                    <td style={{ padding: '.45rem .5rem', textAlign: 'right', color: '#8b949e', whiteSpace: 'nowrap' }}>{fmtSize(b.size)}</td>
                                    <td style={{ padding: '.45rem .5rem', textAlign: 'right', color: '#8b949e', whiteSpace: 'nowrap' }}>{fmtDate(b.ts)}</td>
                                    <td style={{ padding: '.45rem 0 .45rem .5rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                        <F2bTooltip title={t('fail2ban.backup.download')} body={t('fail2ban.backup.downloadFile')} color="green">
                                            <button onClick={() => { void download(b.filename); }} disabled={downloading === b.filename}
                                                style={{ background: 'rgba(63,185,80,.1)', border: '1px solid rgba(63,185,80,.25)', color: C.green, borderRadius: 4, cursor: 'pointer', padding: '.2rem .45rem', marginRight: '.35rem', display: 'inline-flex', alignItems: 'center' }}>
                                                <Download style={{ width: 11, height: 11 }} />
                                            </button>
                                        </F2bTooltip>
                                        <F2bTooltip title={t('fail2ban.backup.restore')} body={t('fail2ban.backup.restoreRules')} color="orange">
                                            <button onClick={() => { void restore(b.filename); }} disabled={restoring === b.filename}
                                                style={{ background: 'rgba(227,179,65,.1)', border: '1px solid rgba(227,179,65,.25)', color: C.orange, borderRadius: 4, cursor: 'pointer', padding: '.2rem .45rem', marginRight: '.35rem', display: 'inline-flex', alignItems: 'center' }}>
                                                <RotateCcw style={{ width: 11, height: 11 }} />
                                            </button>
                                        </F2bTooltip>
                                        <F2bTooltip title={t('fail2ban.backup.delete')} body={t('fail2ban.backup.deleteSnapshot')} color="red">
                                            <button onClick={() => { void del(b.filename); }} disabled={deleting === b.filename}
                                                style={{ background: 'rgba(232,106,101,.08)', border: '1px solid rgba(232,106,101,.2)', color: C.red, borderRadius: 4, cursor: 'pointer', padding: '.2rem .45rem', display: 'inline-flex', alignItems: 'center' }}>
                                                <Trash2 style={{ width: 11, height: 11 }} />
                                            </button>
                                        </F2bTooltip>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};

// ── IPSet Backup Panel ────────────────────────────────────────────────────────

const IpsetBackupPanel: React.FC = () => {
    const { t } = useTranslation();
    const [backups, setBackups]     = useState<IptBackupEntry[]>([]);
    const [loading, setLoading]     = useState(false);
    const [creating, setCreating]   = useState(false);
    const [label, setLabel]         = useState('');
    const [msg, setMsg]             = useState<{ ok: boolean; text: string } | null>(null);
    const [restoring, setRestoring]     = useState<string | null>(null);
    const [deleting, setDeleting]       = useState<string | null>(null);
    const [downloading, setDownloading] = useState<string | null>(null);

    const fetchBackups = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get<{ ok: boolean; backups: IptBackupEntry[] }>('/api/plugins/fail2ban/ipset/backups');
            if (res.success && res.result?.ok) setBackups(res.result.backups);
        } finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchBackups(); }, [fetchBackups]);

    const createBackup = async () => {
        setCreating(true); setMsg(null);
        try {
            const res = await api.post<{ ok: boolean; filename?: string; error?: string }>(
                '/api/plugins/fail2ban/ipset/backup', { label: label.trim() || undefined }
            );
            if (res.success && res.result?.ok) {
                setMsg({ ok: true, text: `${t('fail2ban.messages.saved')} ${res.result.filename}` });
                setLabel(''); fetchBackups();
            } else {
                setMsg({ ok: false, text: res.result?.error ?? t('fail2ban.errors.unknown') });
            }
        } finally { setCreating(false); }
    };

    const restore = async (filename: string) => {
        if (!confirm(t('fail2ban.backup.restoreSetsConfirm', { filename }))) return;
        setRestoring(filename); setMsg(null);
        try {
            const res = await api.post<{ ok: boolean; output?: string; error?: string }>(
                `/api/plugins/fail2ban/ipset/restore/${encodeURIComponent(filename)}`, {}
            );
            if (res.success && res.result?.ok) setMsg({ ok: true, text: `${t('fail2ban.backup.restored')} ${filename}` });
            else setMsg({ ok: false, text: res.result?.error ?? t('fail2ban.errors.unknown') });
        } finally { setRestoring(null); }
    };

    const del = async (filename: string) => {
        if (!confirm(t('fail2ban.backup.deleteSnapshotConfirm', { filename }))) return;
        setDeleting(filename);
        try { await api.delete(`/api/plugins/fail2ban/ipset/backup/${encodeURIComponent(filename)}`); fetchBackups(); }
        finally { setDeleting(null); }
    };

    const download = async (filename: string) => {
        setDownloading(filename);
        try { await downloadFile(`/api/plugins/fail2ban/ipset/backup/${encodeURIComponent(filename)}/download`, filename); }
        finally { setDownloading(null); }
    };

    const fmtSize = (b: number) => b > 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`;
    const fmtDate = (ts: number) => new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const inputStyle: React.CSSProperties = { background: '#161b22', border: '1px solid #30363d', borderBottom: '1px solid #555', borderRadius: 4, color: '#e6edf3', fontSize: '.8rem', padding: '.35rem .6rem', outline: 'none', boxShadow: 'inset 0 2px 4px rgba(0,0,0,.55), inset 0 1px 0 rgba(0,0,0,.4), inset 0 -1px 0 rgba(255,255,255,.04)' };

    return (
        <div style={{ ...card, height: '100%', display: 'flex', flexDirection: 'column', borderTop: `2px solid ${C.green}` }}>
            <div style={cardH}>
                <Layers style={{ width: 14, height: 14, color: C.purple }} />
                <span style={{ fontWeight: 600, fontSize: '.9rem' }}>{t('fail2ban.backup.ipsetBackups')}</span>
                <span style={{ marginLeft: 'auto', fontSize: '.68rem', padding: '.1rem .45rem', borderRadius: 4, background: 'rgba(188,140,255,.12)', color: C.purple, border: '1px solid rgba(188,140,255,.25)' }}>ipset save</span>
            </div>
            <div style={{ ...cardB, display: 'flex', flexDirection: 'column', gap: '.75rem', flex: 1 }}>
                <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                    <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label (optionnel)"
                        style={{ ...inputStyle, flex: 1 }}
                        onKeyDown={e => { if (e.key === 'Enter') createBackup(); }} />
                    <button onClick={createBackup} disabled={creating} style={{
                        background: 'rgba(63,185,80,.12)', border: `1px solid rgba(63,185,80,.3)`, color: C.green,
                        borderRadius: 4, cursor: creating ? 'default' : 'pointer',
                        padding: '.35rem .85rem', fontSize: '.8rem', fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: '.35rem', opacity: creating ? .6 : 1,
                    }}>
                        <Save style={{ width: 12, height: 12 }} /> {t('fail2ban.backup.saveNow')}
                    </button>
                </div>
                {msg && (
                    <div style={{ fontSize: '.78rem', color: msg.ok ? C.green : C.red, display: 'flex', gap: '.4rem', alignItems: 'center' }}>
                        {msg.ok ? <CheckCircle style={{ width: 12, height: 12 }} /> : <AlertTriangle style={{ width: 12, height: 12 }} />}
                        {msg.text}
                    </div>
                )}
                {loading && <div style={{ color: '#8b949e', fontSize: '.82rem' }}>{t('fail2ban.messages.loadingData')}</div>}
                {!loading && backups.length === 0 && <div style={{ color: '#555d69', fontSize: '.8rem' }}>{t('fail2ban.backup.noIpsetBackup')}</div>}
                {backups.length > 0 && (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.78rem' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid #30363d', color: '#8b949e', fontSize: '.68rem', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                                <th style={{ textAlign: 'left', padding: '.3rem .5rem .3rem 0' }}>Fichier</th>
                                <th style={{ textAlign: 'right', padding: '.3rem .5rem' }}>Taille</th>
                                <th style={{ textAlign: 'right', padding: '.3rem .5rem' }}>Date</th>
                                <th style={{ textAlign: 'right', padding: '.3rem 0 .3rem .5rem' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {backups.map(b => (
                                <tr key={b.filename}
                                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.02)'}
                                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                                    style={{ borderBottom: '1px solid #21262d' }}>
                                    <td style={{ padding: '.45rem .5rem .45rem 0', fontFamily: 'monospace', color: '#c9d1d9', fontSize: '.74rem', wordBreak: 'break-all' }}>{b.filename}</td>
                                    <td style={{ padding: '.45rem .5rem', textAlign: 'right', color: '#8b949e', whiteSpace: 'nowrap' }}>{fmtSize(b.size)}</td>
                                    <td style={{ padding: '.45rem .5rem', textAlign: 'right', color: '#8b949e', whiteSpace: 'nowrap' }}>{fmtDate(b.ts)}</td>
                                    <td style={{ padding: '.45rem 0 .45rem .5rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                        <F2bTooltip title={t('fail2ban.backup.download')} body={t('fail2ban.backup.downloadFile')} color="green">
                                            <button onClick={() => { void download(b.filename); }} disabled={downloading === b.filename}
                                                style={{ background: 'rgba(63,185,80,.1)', border: '1px solid rgba(63,185,80,.25)', color: C.green, borderRadius: 4, cursor: 'pointer', padding: '.2rem .45rem', marginRight: '.35rem', display: 'inline-flex', alignItems: 'center' }}>
                                                <Download style={{ width: 11, height: 11 }} />
                                            </button>
                                        </F2bTooltip>
                                        <F2bTooltip title={t('fail2ban.backup.restore')} body={t('fail2ban.backup.restoreSets')} color="orange">
                                            <button onClick={() => { void restore(b.filename); }} disabled={restoring === b.filename}
                                                style={{ background: 'rgba(227,179,65,.1)', border: '1px solid rgba(227,179,65,.25)', color: C.orange, borderRadius: 4, cursor: 'pointer', padding: '.2rem .45rem', marginRight: '.35rem', display: 'inline-flex', alignItems: 'center' }}>
                                                <RotateCcw style={{ width: 11, height: 11 }} />
                                            </button>
                                        </F2bTooltip>
                                        <F2bTooltip title={t('fail2ban.backup.delete')} body={t('fail2ban.backup.deleteSnapshot')} color="red">
                                            <button onClick={() => { void del(b.filename); }} disabled={deleting === b.filename}
                                                style={{ background: 'rgba(232,106,101,.08)', border: '1px solid rgba(232,106,101,.2)', color: C.red, borderRadius: 4, cursor: 'pointer', padding: '.2rem .45rem', display: 'inline-flex', alignItems: 'center' }}>
                                                <Trash2 style={{ width: 11, height: 11 }} />
                                            </button>
                                        </F2bTooltip>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};

// ── Unavailable panel ─────────────────────────────────────────────────────────

const UnavailablePanel: React.FC<{ tool: string; color: string; icon: React.ReactNode }> = ({ tool, color, icon }) => {
    const { t } = useTranslation();
    return (
        <div style={{ ...card, opacity: .85, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ ...cardH }}>
                <span style={{ color }}>{icon}</span>
                <span style={{ fontWeight: 600, fontSize: '.9rem' }}>{t('fail2ban.backup.sectionTool', { tool })}</span>
                <span style={{ marginLeft: 'auto', fontSize: '.68rem', padding: '.1rem .45rem', borderRadius: 4, background: 'rgba(232,106,101,.1)', color: C.red, border: '1px solid rgba(232,106,101,.25)' }}>{t('fail2ban.backup.notAvailable')}</span>
            </div>
            <div style={{ ...cardB, display: 'flex', flexDirection: 'column', gap: '.6rem', flex: 1 }}>
                <Alert type="warn">{t('fail2ban.backup.toolNotAccessible', { tool })}</Alert>
                <div style={{ fontSize: '.78rem', color: C.muted }}>{t('fail2ban.backup.prerequisite')} <code style={{ color: C.text, fontFamily: 'monospace' }}>docker-compose.yml</code> :</div>
                <pre style={{ margin: 0, fontSize: '.73rem', fontFamily: 'monospace', color: C.text, background: C.bg0, borderRadius: 4, padding: '.5rem .75rem', border: `1px solid ${C.border}`, lineHeight: 1.6 }}>{`network_mode: host    # partage le namespace réseau du host
cap_add:
  - NET_ADMIN         # autorise les opérations netfilter kernel`}</pre>
            </div>
        </div>
    );
};

// ── Component ─────────────────────────────────────────────────────────────────

export const TabBackup: React.FC = () => {
    const { t } = useTranslation();
    const [iptAvail, setIptAvail]     = useState<boolean | null>(null);
    const [ipsetAvail, setIpsetAvail] = useState<boolean | null>(null);

    useEffect(() => {
        api.get<{ ok: boolean }>('/api/plugins/fail2ban/iptables')
            .then(r => setIptAvail(r.success && r.result?.ok === true))
            .catch(() => setIptAvail(false));
        api.get<{ ok: boolean }>('/api/plugins/fail2ban/ipset/info')
            .then(r => setIpsetAvail(r.success && r.result?.ok === true))
            .catch(() => setIpsetAvail(false));
    }, []);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

            {/* ══ Section : Configuration Fail2ban ══════════════════════════════ */}
            <SectionHeader icon={<Shield style={{ width: 13, height: 13 }} />} label={t('fail2ban.backup.sectionFail2banConfig')} color={C.blue} sub="fichiers .local + état runtime" />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', alignItems: 'stretch' }}>
                <ConfigSnapshotPanel />
                <ConfigRestorePanel />
            </div>

            {/* ══ Section : Base de données fail2ban ════════════════════════════ */}
            <SectionHeader icon={<Database style={{ width: 13, height: 13 }} />} label={t('fail2ban.backup.sectionFail2banDb')} color={C.orange} sub="tables f2b_* uniquement · données historiques" />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', alignItems: 'stretch' }}>
                <DbSnapshotPanel />
                <DbImportPanel />
            </div>

            {/* ══ Section : Pare-feu — Netfilter ════════════════════════════════ */}
            <SectionHeader icon={<Layers style={{ width: 13, height: 13 }} />} label={t('fail2ban.backup.sectionFirewall')} color={C.cyan} sub="IPTables · IPSet" />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', alignItems: 'stretch' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {iptAvail === null && <div style={{ color: C.muted, fontSize: '.8rem', padding: '.5rem' }}>{t('fail2ban.messages.loadingData')}</div>}
                    {iptAvail === true  && <IptBackupPanel />}
                    {iptAvail === false && (
                        <UnavailablePanel tool="IPTables" color={C.cyan}
                            icon={<Shield style={{ width: 14, height: 14 }} />} />
                    )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {ipsetAvail === null && <div style={{ color: C.muted, fontSize: '.8rem', padding: '.5rem' }}>{t('fail2ban.messages.loadingData')}</div>}
                    {ipsetAvail === true  && <IpsetBackupPanel />}
                    {ipsetAvail === false && (
                        <UnavailablePanel tool="IPSet" color={C.purple}
                            icon={<Layers style={{ width: 14, height: 14 }} />} />
                    )}
                </div>
            </div>

            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
};
