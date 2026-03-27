import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Archive, UploadCloud, AlertTriangle, CheckCircle, XCircle, FolderOpen, RefreshCw, Save, RotateCcw, Trash2, Layers, Shield, FileJson } from 'lucide-react';
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function padZ(n: number) { return String(n).padStart(2, '0'); }
function nowStamp() {
    const d = new Date();
    return `${d.getFullYear()}-${padZ(d.getMonth()+1)}-${padZ(d.getDate())}_${padZ(d.getHours())}${padZ(d.getMinutes())}${padZ(d.getSeconds())}`;
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

// ── IPTables Backup Panel ─────────────────────────────────────────────────────

const IptBackupPanel: React.FC = () => {
    const [backups, setBackups]     = useState<IptBackupEntry[]>([]);
    const [loading, setLoading]     = useState(false);
    const [creating, setCreating]   = useState(false);
    const [label, setLabel]         = useState('');
    const [msg, setMsg]             = useState<{ ok: boolean; text: string } | null>(null);
    const [restoring, setRestoring] = useState<string | null>(null);
    const [deleting, setDeleting]   = useState<string | null>(null);

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
                setMsg({ ok: true, text: `Sauvegardé : ${res.result.filename}` });
                setLabel(''); fetchBackups();
            } else {
                setMsg({ ok: false, text: res.result?.error ?? 'Erreur' });
            }
        } finally { setCreating(false); }
    };

    const restore = async (filename: string) => {
        if (!confirm(`Restaurer "${filename}" ? Les règles actuelles seront remplacées.`)) return;
        setRestoring(filename); setMsg(null);
        try {
            const res = await api.post<{ ok: boolean; output?: string; error?: string }>(
                `/api/plugins/fail2ban/iptables/restore/${encodeURIComponent(filename)}`, {}
            );
            if (res.success && res.result?.ok) setMsg({ ok: true, text: `Restauré : ${filename}` });
            else setMsg({ ok: false, text: res.result?.error ?? 'Erreur' });
        } finally { setRestoring(null); }
    };

    const del = async (filename: string) => {
        if (!confirm(`Supprimer "${filename}" ?`)) return;
        setDeleting(filename);
        try { await api.delete(`/api/plugins/fail2ban/iptables/backup/${encodeURIComponent(filename)}`); fetchBackups(); }
        finally { setDeleting(null); }
    };

    const fmtSize = (b: number) => b > 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`;
    const fmtDate = (ts: number) => new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const inputStyle: React.CSSProperties = { background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, color: '#e6edf3', fontSize: '.8rem', padding: '.35rem .6rem', outline: 'none' };

    return (
        <div style={card}>
            <div style={cardH}>
                <Save style={{ width: 14, height: 14, color: '#39c5cf' }} />
                <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Sauvegardes IPTables</span>
                <span style={{ marginLeft: 'auto', fontSize: '.68rem', padding: '.1rem .45rem', borderRadius: 4, background: 'rgba(57,197,207,.12)', color: '#39c5cf', border: '1px solid rgba(57,197,207,.25)' }}>iptables-save</span>
            </div>
            <div style={{ ...cardB, display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
                <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                    <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label (optionnel)"
                        style={{ ...inputStyle, flex: 1 }}
                        onKeyDown={e => { if (e.key === 'Enter') createBackup(); }} />
                    <button onClick={createBackup} disabled={creating} style={{
                        background: 'rgba(57,197,207,.12)', border: '1px solid rgba(57,197,207,.3)', color: '#39c5cf',
                        borderRadius: 4, cursor: creating ? 'default' : 'pointer',
                        padding: '.35rem .85rem', fontSize: '.8rem', fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: '.35rem', opacity: creating ? .6 : 1,
                    }}>
                        <Save style={{ width: 12, height: 12 }} /> Sauvegarder maintenant
                    </button>
                </div>
                {msg && (
                    <div style={{ fontSize: '.78rem', color: msg.ok ? '#3fb950' : '#e86a65', display: 'flex', gap: '.4rem', alignItems: 'center' }}>
                        {msg.ok ? <CheckCircle style={{ width: 12, height: 12 }} /> : <AlertTriangle style={{ width: 12, height: 12 }} />}
                        {msg.text}
                    </div>
                )}
                {loading && <div style={{ color: '#8b949e', fontSize: '.82rem' }}>Chargement…</div>}
                {!loading && backups.length === 0 && <div style={{ color: '#555d69', fontSize: '.8rem' }}>Aucune sauvegarde IPTables</div>}
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
                                        <F2bTooltip title="Restaurer" body="Remplace les règles actuelles par ce backup" color="orange">
                                            <button onClick={() => restore(b.filename)} disabled={restoring === b.filename}
                                                style={{ background: 'rgba(227,179,65,.1)', border: '1px solid rgba(227,179,65,.25)', color: '#e3b341', borderRadius: 4, cursor: 'pointer', padding: '.2rem .45rem', marginRight: '.35rem', display: 'inline-flex', alignItems: 'center' }}>
                                                <RotateCcw style={{ width: 11, height: 11 }} />
                                            </button>
                                        </F2bTooltip>
                                        <F2bTooltip title="Supprimer" body="Supprime ce fichier de sauvegarde" color="red">
                                            <button onClick={() => del(b.filename)} disabled={deleting === b.filename}
                                                style={{ background: 'rgba(232,106,101,.08)', border: '1px solid rgba(232,106,101,.2)', color: '#e86a65', borderRadius: 4, cursor: 'pointer', padding: '.2rem .45rem', display: 'inline-flex', alignItems: 'center' }}>
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
    const [backups, setBackups]     = useState<IptBackupEntry[]>([]);
    const [loading, setLoading]     = useState(false);
    const [creating, setCreating]   = useState(false);
    const [label, setLabel]         = useState('');
    const [msg, setMsg]             = useState<{ ok: boolean; text: string } | null>(null);
    const [restoring, setRestoring] = useState<string | null>(null);
    const [deleting, setDeleting]   = useState<string | null>(null);

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
                setMsg({ ok: true, text: `Sauvegardé : ${res.result.filename}` });
                setLabel(''); fetchBackups();
            } else {
                setMsg({ ok: false, text: res.result?.error ?? 'Erreur' });
            }
        } finally { setCreating(false); }
    };

    const restore = async (filename: string) => {
        if (!confirm(`Restaurer "${filename}" ? Les sets actuels seront remplacés.`)) return;
        setRestoring(filename); setMsg(null);
        try {
            const res = await api.post<{ ok: boolean; output?: string; error?: string }>(
                `/api/plugins/fail2ban/ipset/restore/${encodeURIComponent(filename)}`, {}
            );
            if (res.success && res.result?.ok) setMsg({ ok: true, text: `Restauré : ${filename}` });
            else setMsg({ ok: false, text: res.result?.error ?? 'Erreur' });
        } finally { setRestoring(null); }
    };

    const del = async (filename: string) => {
        if (!confirm(`Supprimer "${filename}" ?`)) return;
        setDeleting(filename);
        try { await api.delete(`/api/plugins/fail2ban/ipset/backup/${encodeURIComponent(filename)}`); fetchBackups(); }
        finally { setDeleting(null); }
    };

    const fmtSize = (b: number) => b > 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`;
    const fmtDate = (ts: number) => new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const inputStyle: React.CSSProperties = { background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, color: '#e6edf3', fontSize: '.8rem', padding: '.35rem .6rem', outline: 'none' };

    return (
        <div style={card}>
            <div style={cardH}>
                <Layers style={{ width: 14, height: 14, color: C.purple }} />
                <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Sauvegardes IPSet</span>
                <span style={{ marginLeft: 'auto', fontSize: '.68rem', padding: '.1rem .45rem', borderRadius: 4, background: 'rgba(188,140,255,.12)', color: C.purple, border: '1px solid rgba(188,140,255,.25)' }}>ipset save</span>
            </div>
            <div style={{ ...cardB, display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
                <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                    <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label (optionnel)"
                        style={{ ...inputStyle, flex: 1 }}
                        onKeyDown={e => { if (e.key === 'Enter') createBackup(); }} />
                    <button onClick={createBackup} disabled={creating} style={{
                        background: 'rgba(188,140,255,.12)', border: '1px solid rgba(188,140,255,.3)', color: C.purple,
                        borderRadius: 4, cursor: creating ? 'default' : 'pointer',
                        padding: '.35rem .85rem', fontSize: '.8rem', fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: '.35rem', opacity: creating ? .6 : 1,
                    }}>
                        <Save style={{ width: 12, height: 12 }} /> Sauvegarder maintenant
                    </button>
                </div>
                {msg && (
                    <div style={{ fontSize: '.78rem', color: msg.ok ? '#3fb950' : '#e86a65', display: 'flex', gap: '.4rem', alignItems: 'center' }}>
                        {msg.ok ? <CheckCircle style={{ width: 12, height: 12 }} /> : <AlertTriangle style={{ width: 12, height: 12 }} />}
                        {msg.text}
                    </div>
                )}
                {loading && <div style={{ color: '#8b949e', fontSize: '.82rem' }}>Chargement…</div>}
                {!loading && backups.length === 0 && <div style={{ color: '#555d69', fontSize: '.8rem' }}>Aucune sauvegarde IPSet</div>}
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
                                        <F2bTooltip title="Restaurer" body="Remplace les sets actuels par ce backup" color="orange">
                                            <button onClick={() => restore(b.filename)} disabled={restoring === b.filename}
                                                style={{ background: 'rgba(227,179,65,.1)', border: '1px solid rgba(227,179,65,.25)', color: '#e3b341', borderRadius: 4, cursor: 'pointer', padding: '.2rem .45rem', marginRight: '.35rem', display: 'inline-flex', alignItems: 'center' }}>
                                                <RotateCcw style={{ width: 11, height: 11 }} />
                                            </button>
                                        </F2bTooltip>
                                        <F2bTooltip title="Supprimer" body="Supprime ce fichier de sauvegarde" color="red">
                                            <button onClick={() => del(b.filename)} disabled={deleting === b.filename}
                                                style={{ background: 'rgba(232,106,101,.08)', border: '1px solid rgba(232,106,101,.2)', color: '#e86a65', borderRadius: 4, cursor: 'pointer', padding: '.2rem .45rem', display: 'inline-flex', alignItems: 'center' }}>
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

const UnavailablePanel: React.FC<{ tool: string; color: string; icon: React.ReactNode }> = ({ tool, color, icon }) => (
    <div style={{ ...card, opacity: .85 }}>
        <div style={{ ...cardH }}>
            <span style={{ color }}>{icon}</span>
            <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Sauvegardes {tool}</span>
            <span style={{ marginLeft: 'auto', fontSize: '.68rem', padding: '.1rem .45rem', borderRadius: 4, background: 'rgba(232,106,101,.1)', color: C.red, border: '1px solid rgba(232,106,101,.25)' }}>Non disponible</span>
        </div>
        <div style={{ ...cardB, display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
            <Alert type="warn">{tool} n'est pas accessible depuis le container.</Alert>
            <div style={{ fontSize: '.78rem', color: C.muted }}>Prérequis dans <code style={{ color: C.text, fontFamily: 'monospace' }}>docker-compose.yml</code> :</div>
            <pre style={{ margin: 0, fontSize: '.73rem', fontFamily: 'monospace', color: C.text, background: C.bg0, borderRadius: 4, padding: '.5rem .75rem', border: `1px solid ${C.border}`, lineHeight: 1.6 }}>{`network_mode: host    # partage le namespace réseau du host
cap_add:
  - NET_ADMIN         # autorise les opérations netfilter kernel`}</pre>
        </div>
    </div>
);

// ── Component ─────────────────────────────────────────────────────────────────

export const TabBackup: React.FC = () => {
    // Firewall availability
    const [iptAvail, setIptAvail] = useState<boolean | null>(null);
    const [ipsetAvail, setIpsetAvail] = useState<boolean | null>(null);

    useEffect(() => {
        api.get<{ ok: boolean }>('/api/plugins/fail2ban/iptables')
            .then(r => setIptAvail(r.success && r.result?.ok === true))
            .catch(() => setIptAvail(false));
        api.get<{ ok: boolean }>('/api/plugins/fail2ban/ipset/info')
            .then(r => setIpsetAvail(r.success && r.result?.ok === true))
            .catch(() => setIpsetAvail(false));
    }, []);

    // Export state
    const [exporting, setExporting] = useState(false);
    const [exportErr, setExportErr] = useState<string | null>(null);
    const [exportOk, setExportOk] = useState(false);

    // Restore state
    const [backup, setBackup]             = useState<BackupFile | null>(null);
    const [fileName, setFileName]         = useState<string | null>(null);
    const [fileErr, setFileErr]           = useState<string | null>(null);
    const [reload, setReload]             = useState(true);
    const [restoring, setRestoring]       = useState(false);
    const [restoreErr, setRestoreErr]     = useState<string | null>(null);
    const [restoreResult, setRestoreResult] = useState<{
        ok: boolean; written: string[]; skipped: string[]; errors: string[];
        reloadOk?: boolean; reloadOut?: string;
    } | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    // ── Export ────────────────────────────────────────────────────────────────

    const handleExport = async () => {
        setExporting(true); setExportErr(null); setExportOk(false);
        try {
            const resp = await fetch('/api/plugins/fail2ban/backup/full', { credentials: 'include' });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `fail2ban-backup-${nowStamp()}.json`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
            setExportOk(true);
        } catch (err: unknown) {
            setExportErr(err instanceof Error ? err.message : String(err));
        } finally { setExporting(false); }
    };

    // ── Restore — file selection ───────────────────────────────────────────────

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
                    setFileErr('Fichier invalide — type ou version non reconnu'); return;
                }
                setBackup(d);
            } catch { setFileErr('Impossible de lire le fichier JSON'); }
        };
        reader.onerror = () => setFileErr('Erreur de lecture du fichier');
        reader.readAsText(file);
    };

    // ── Restore — launch ──────────────────────────────────────────────────────

    const handleRestore = async () => {
        if (!backup) return;
        const localFiles = Object.keys(backup.files).filter(k => k.endsWith('.local'));
        if (!window.confirm(
            `Restaurer ${localFiles.length} fichier(s) .local depuis le backup du ${new Date(backup.exported_at).toLocaleString('fr-FR')} ?\n\nCette action écrase les fichiers existants.`
        )) return;

        setRestoring(true); setRestoreErr(null); setRestoreResult(null);
        try {
            const resp = await fetch(`/api/plugins/fail2ban/backup/restore?reload=${reload ? 1 : 0}`, {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(backup),
            });
            const json = await resp.json() as { success: boolean; error?: string; result?: typeof restoreResult };
            if (!json.success) throw new Error(json.error ?? 'Erreur inconnue');
            setRestoreResult(json.result ?? null);
        } catch (err: unknown) {
            setRestoreErr(err instanceof Error ? err.message : String(err));
        } finally {
            setRestoring(false); setBackup(null); setFileName(null);
            if (fileRef.current) fileRef.current.value = '';
        }
    };

    // ── Derived ───────────────────────────────────────────────────────────────

    const totalFiles = backup ? Object.keys(backup.files).length : 0;
    const localCount = backup ? Object.keys(backup.files).filter(k => k.endsWith('.local')).length : 0;
    const jailNames  = backup?.runtime?.jails ? Object.keys(backup.runtime.jails) : [];

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

            {/* ══ Section : Configuration Fail2ban ══════════════════════════════ */}
            <SectionHeader icon={<Shield style={{ width: 13, height: 13 }} />} label="Configuration Fail2ban" color={C.blue} sub="fichiers .local + état runtime" />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', alignItems: 'start' }}>

                {/* ── Card : Export ── */}
                <div style={{ ...card, borderTop: `2px solid ${C.blue}` }}>
                    <div style={{ ...cardH, gap: '.6rem' }}>
                        <FileJson style={{ width: 15, height: 15, color: C.blue }} />
                        <div>
                            <div style={{ fontWeight: 700, fontSize: '.88rem', color: C.text, lineHeight: 1.2 }}>Export JSON</div>
                            <div style={{ fontSize: '.7rem', color: C.muted, marginTop: 1 }}>Snapshot complet de la config</div>
                        </div>
                        <span style={{ marginLeft: 'auto', fontSize: '.67rem', padding: '.1rem .45rem', borderRadius: 4, background: 'rgba(88,166,255,.12)', color: C.blue, border: '1px solid rgba(88,166,255,.22)' }}>fail2ban</span>
                    </div>
                    <div style={{ ...cardB, display: 'flex', flexDirection: 'column', gap: '.7rem' }}>
                        {/* Included items */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem' }}>
                            {['fail2ban.local', 'jail.local', 'jail.d/', 'filter.d/', 'action.d/', 'IPs bannies'].map(f => (
                                <span key={f} style={{ fontFamily: 'monospace', fontSize: '.68rem', color: C.muted, background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 3, padding: '.1rem .4rem' }}>{f}</span>
                            ))}
                        </div>

                        {exportErr && <Alert type="error">{exportErr}</Alert>}
                        {exportOk  && <Alert type="ok">Backup téléchargé avec succès</Alert>}

                        <button onClick={() => { void handleExport(); }} disabled={exporting} style={{
                            display: 'inline-flex', alignItems: 'center', gap: '.4rem',
                            padding: '.42rem 1rem', borderRadius: 6, fontSize: '.82rem', fontWeight: 600,
                            background: exporting ? 'rgba(88,166,255,.07)' : 'rgba(88,166,255,.14)',
                            border: '1px solid rgba(88,166,255,.38)', color: C.blue,
                            cursor: exporting ? 'not-allowed' : 'pointer', opacity: exporting ? .7 : 1,
                            width: '100%', justifyContent: 'center',
                        }}>
                            {exporting
                                ? <><Spinner color={C.blue} /> Préparation…</>
                                : <><Archive style={{ width: 13, height: 13 }} /> Télécharger le backup JSON</>
                            }
                        </button>
                    </div>
                </div>

                {/* ── Card : Restore ── */}
                <div style={{ ...card, borderTop: `2px solid ${C.purple}` }}>
                    <div style={{ ...cardH, gap: '.6rem' }}>
                        <UploadCloud style={{ width: 15, height: 15, color: C.purple }} />
                        <div>
                            <div style={{ fontWeight: 700, fontSize: '.88rem', color: C.text, lineHeight: 1.2 }}>Restaurer un backup</div>
                            <div style={{ fontSize: '.7rem', color: C.muted, marginTop: 1 }}>Importer un fichier JSON</div>
                        </div>
                        <span style={{ marginLeft: 'auto', fontSize: '.67rem', padding: '.1rem .45rem', borderRadius: 4, background: 'rgba(188,140,255,.12)', color: C.purple, border: '1px solid rgba(188,140,255,.22)' }}>restore</span>
                    </div>
                    <div style={{ ...cardB, display: 'flex', flexDirection: 'column', gap: '.7rem' }}>

                        <Alert type="warn">
                            Seuls les <code style={{ fontFamily: 'monospace' }}>.local</code> sont restaurés — les <code style={{ fontFamily: 'monospace' }}>.conf</code> système ne sont jamais écrasés.
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
                                Choisir
                            </button>
                            <span style={{ fontSize: '.78rem', color: fileName ? C.text : C.muted, fontFamily: fileName ? 'monospace' : 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                                {fileName ?? 'Aucun fichier sélectionné'}
                            </span>
                        </div>

                        {fileErr && <Alert type="error">{fileErr}</Alert>}

                        {backup && (
                            <div style={{ padding: '.5rem .75rem', background: 'rgba(63,185,80,.06)', border: '1px solid rgba(63,185,80,.22)', borderRadius: 6, fontSize: '.78rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: '.25rem', color: C.green, fontWeight: 600 }}>
                                    <CheckCircle style={{ width: 11, height: 11 }} /> Backup valide
                                </div>
                                <div style={{ color: C.muted, lineHeight: 1.7 }}>
                                    <div>Le <span style={{ color: C.text }}>{new Date(backup.exported_at).toLocaleString('fr-FR')}</span> · <code style={{ color: C.text, fontFamily: 'monospace' }}>{backup.host}</code></div>
                                    <div><span style={{ color: C.text }}>{totalFiles} fichier(s)</span> · <span style={{ color: C.blue }}>{localCount} .local</span> restaurés</div>
                                    {jailNames.length > 0 && <div style={{ color: C.muted }}>Jails : <span style={{ color: C.text }}>{jailNames.join(', ')}</span></div>}
                                </div>
                            </div>
                        )}

                        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.78rem', color: C.muted, cursor: 'pointer', userSelect: 'none' }}>
                            <input type="checkbox" checked={reload} onChange={e => setReload(e.target.checked)}
                                style={{ accentColor: C.purple, width: 13, height: 13 }} />
                            <RefreshCw style={{ width: 10, height: 10 }} />
                            Recharger fail2ban après restauration
                        </label>

                        {restoreErr && <Alert type="error">{restoreErr}</Alert>}

                        <button onClick={() => { void handleRestore(); }} disabled={!backup || restoring} style={{
                            display: 'inline-flex', alignItems: 'center', gap: '.4rem',
                            padding: '.42rem 1rem', borderRadius: 6, fontSize: '.82rem', fontWeight: 600,
                            background: (!backup || restoring) ? 'rgba(188,140,255,.05)' : 'rgba(188,140,255,.14)',
                            border: '1px solid rgba(188,140,255,.38)', color: C.purple,
                            cursor: (!backup || restoring) ? 'not-allowed' : 'pointer',
                            opacity: (!backup || restoring) ? .4 : 1,
                            width: '100%', justifyContent: 'center',
                        }}>
                            {restoring
                                ? <><Spinner color={C.purple} /> Restauration…</>
                                : <><UploadCloud style={{ width: 13, height: 13 }} /> Lancer la restauration</>
                            }
                        </button>

                        {restoreResult && (
                            <div style={{ padding: '.5rem .75rem', background: restoreResult.ok ? 'rgba(63,185,80,.06)' : 'rgba(232,106,101,.06)', border: `1px solid ${restoreResult.ok ? 'rgba(63,185,80,.25)' : 'rgba(232,106,101,.25)'}`, borderRadius: 6, fontSize: '.78rem' }}>
                                <div style={{ fontWeight: 600, marginBottom: '.3rem', color: restoreResult.ok ? C.green : C.red }}>
                                    {restoreResult.ok ? '✓ Restauration réussie' : '⚠ Restauration avec erreurs'}
                                </div>
                                {restoreResult.written.length > 0 && (
                                    <div style={{ color: C.muted, marginBottom: '.2rem' }}>
                                        Écrits : {restoreResult.written.map(f => <code key={f} style={{ color: C.green, marginRight: '.35rem', fontFamily: 'monospace' }}>{f}</code>)}
                                    </div>
                                )}
                                {restoreResult.skipped.length > 0 && (
                                    <div style={{ color: C.muted, marginBottom: '.2rem' }}>
                                        Ignorés : {restoreResult.skipped.map(f => <code key={f} style={{ color: C.muted, marginRight: '.35rem', fontFamily: 'monospace' }}>{f}</code>)}
                                    </div>
                                )}
                                {restoreResult.errors.length > 0 && (
                                    <div style={{ color: C.red }}>
                                        Erreurs : {restoreResult.errors.map((e, i) => <div key={i}><code style={{ fontFamily: 'monospace' }}>{e}</code></div>)}
                                    </div>
                                )}
                                {restoreResult.reloadOk !== undefined && (
                                    <div style={{ marginTop: '.25rem', color: restoreResult.reloadOk ? C.green : C.orange }}>
                                        Reload : {restoreResult.reloadOk ? '✓ OK' : `⚠ ${restoreResult.reloadOut ?? 'échec'}`}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

            </div>

            {/* ══ Section : Pare-feu — Netfilter ════════════════════════════════ */}
            <SectionHeader icon={<Layers style={{ width: 13, height: 13 }} />} label="Pare-feu — Netfilter" color={C.cyan} sub="IPTables · IPSet" />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', alignItems: 'start' }}>
                <div>
                    {iptAvail === null && <div style={{ color: C.muted, fontSize: '.8rem', padding: '.5rem' }}>Vérification…</div>}
                    {iptAvail === true  && <IptBackupPanel />}
                    {iptAvail === false && (
                        <UnavailablePanel tool="IPTables" color={C.cyan}
                            icon={<Shield style={{ width: 14, height: 14 }} />} />
                    )}
                </div>
                <div>
                    {ipsetAvail === null && <div style={{ color: C.muted, fontSize: '.8rem', padding: '.5rem' }}>Vérification…</div>}
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
