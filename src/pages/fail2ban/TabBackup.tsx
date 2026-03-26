import React, { useState, useRef } from 'react';
import { Archive, UploadCloud, AlertTriangle, CheckCircle, XCircle, FolderOpen, RefreshCw } from 'lucide-react';
import { card, cardH, cardB } from './helpers';

// ── Palette ───────────────────────────────────────────────────────────────────

const C = {
    bg0: '#0d1117', bg1: '#161b22', bg2: '#21262d', border: '#30363d',
    text: '#e6edf3', muted: '#8b949e',
    blue: '#58a6ff', purple: '#bc8cff', green: '#3fb950',
    red: '#e86a65', orange: '#e3b341',
};

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Component ─────────────────────────────────────────────────────────────────

export const TabBackup: React.FC = () => {
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', alignItems: 'start' }}>

                {/* ── Card : Export ── */}
                <div style={card}>
                    <div style={cardH}>
                        <Archive style={{ width: 14, height: 14, color: C.blue }} />
                        <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Backup complet</span>
                        <span style={{ marginLeft: 'auto', fontSize: '.68rem', padding: '.1rem .45rem', borderRadius: 4, background: 'rgba(88,166,255,.12)', color: C.blue, border: '1px solid rgba(88,166,255,.25)' }}>Export</span>
                    </div>
                    <div style={{ ...cardB, display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
                        <ul style={{ margin: 0, padding: '0 0 0 1.1rem', fontSize: '.8rem', color: C.muted, lineHeight: 1.9 }}>
                            <li><code style={{ color: C.text }}>fail2ban.conf</code> / <code style={{ color: C.text }}>fail2ban.local</code></li>
                            <li><code style={{ color: C.text }}>jail.conf</code> / <code style={{ color: C.text }}>jail.local</code></li>
                            <li><code style={{ color: C.text }}>jail.d/</code>, <code style={{ color: C.text }}>filter.d/</code>, <code style={{ color: C.text }}>action.d/</code></li>
                            <li>État runtime (IPs bannies par jail)</li>
                        </ul>

                        {exportErr && <Alert type="error">{exportErr}</Alert>}
                        {exportOk  && <Alert type="ok">Backup téléchargé avec succès</Alert>}

                        <button onClick={() => { void handleExport(); }} disabled={exporting} style={{
                            display: 'inline-flex', alignItems: 'center', gap: '.4rem',
                            padding: '.45rem 1rem', borderRadius: 6, fontSize: '.82rem', fontWeight: 600,
                            background: exporting ? 'rgba(88,166,255,.08)' : 'rgba(88,166,255,.15)',
                            border: '1px solid rgba(88,166,255,.4)', color: C.blue,
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
                <div style={card}>
                    <div style={cardH}>
                        <UploadCloud style={{ width: 14, height: 14, color: C.purple }} />
                        <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Restaurer un backup</span>
                        <span style={{ marginLeft: 'auto', fontSize: '.68rem', padding: '.1rem .45rem', borderRadius: 4, background: 'rgba(188,140,255,.12)', color: C.purple, border: '1px solid rgba(188,140,255,.25)' }}>Restore</span>
                    </div>
                    <div style={{ ...cardB, display: 'flex', flexDirection: 'column', gap: '.75rem' }}>

                        <Alert type="warn">
                            Seuls les fichiers <code style={{ fontFamily: 'monospace' }}>.local</code> sont restaurés — les <code style={{ fontFamily: 'monospace' }}>.conf</code> système ne sont jamais écrasés.
                        </Alert>

                        {/* Hidden native input */}
                        <input ref={fileRef} type="file" accept=".json" onChange={handleFileChange} style={{ display: 'none' }} />

                        {/* Styled file picker */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                            <button onClick={() => fileRef.current?.click()} style={{
                                display: 'inline-flex', alignItems: 'center', gap: '.4rem',
                                padding: '.38rem .8rem', borderRadius: 6, fontSize: '.8rem', fontWeight: 600,
                                background: 'rgba(139,148,158,.1)', border: `1px solid ${C.border}`,
                                color: C.text, cursor: 'pointer', flexShrink: 0,
                                transition: 'border-color .15s, background .15s',
                            }}
                                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = C.muted; (e.currentTarget as HTMLElement).style.background = 'rgba(139,148,158,.18)'; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = C.border; (e.currentTarget as HTMLElement).style.background = 'rgba(139,148,158,.1)'; }}
                            >
                                <FolderOpen style={{ width: 13, height: 13, color: C.muted }} />
                                Choisir un fichier
                            </button>
                            <span style={{ fontSize: '.78rem', color: fileName ? C.text : C.muted, fontFamily: fileName ? 'monospace' : 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {fileName ?? 'Aucun fichier sélectionné'}
                            </span>
                        </div>

                        {fileErr && <Alert type="error">{fileErr}</Alert>}

                        {/* Preview panel */}
                        {backup && (
                            <div style={{ padding: '.6rem .85rem', background: 'rgba(63,185,80,.06)', border: '1px solid rgba(63,185,80,.22)', borderRadius: 6, fontSize: '.8rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: '.35rem', color: C.green, fontWeight: 600 }}>
                                    <CheckCircle style={{ width: 12, height: 12 }} /> Backup valide
                                </div>
                                <div style={{ color: C.muted, lineHeight: 1.75 }}>
                                    <div>Le <span style={{ color: C.text }}>{new Date(backup.exported_at).toLocaleString('fr-FR')}</span> — <code style={{ color: C.text, fontFamily: 'monospace' }}>{backup.host}</code></div>
                                    <div><span style={{ color: C.text }}>{totalFiles} fichier(s)</span> · <span style={{ color: C.blue }}>{localCount} .local</span> seront restaurés</div>
                                    {jailNames.length > 0 && <div>Jails : <span style={{ color: C.text }}>{jailNames.join(', ')}</span></div>}
                                </div>
                            </div>
                        )}

                        {/* Reload checkbox */}
                        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.8rem', color: C.muted, cursor: 'pointer', userSelect: 'none' }}>
                            <input type="checkbox" checked={reload} onChange={e => setReload(e.target.checked)}
                                style={{ accentColor: C.purple, width: 14, height: 14 }} />
                            <RefreshCw style={{ width: 11, height: 11 }} />
                            Recharger fail2ban après restauration
                        </label>

                        {restoreErr && <Alert type="error">{restoreErr}</Alert>}

                        {/* Launch button */}
                        <button onClick={() => { void handleRestore(); }} disabled={!backup || restoring} style={{
                            display: 'inline-flex', alignItems: 'center', gap: '.4rem',
                            padding: '.45rem 1rem', borderRadius: 6, fontSize: '.82rem', fontWeight: 600,
                            background: (!backup || restoring) ? 'rgba(188,140,255,.05)' : 'rgba(188,140,255,.15)',
                            border: '1px solid rgba(188,140,255,.4)', color: C.purple,
                            cursor: (!backup || restoring) ? 'not-allowed' : 'pointer',
                            opacity: (!backup || restoring) ? .45 : 1,
                            width: '100%', justifyContent: 'center',
                        }}>
                            {restoring
                                ? <><Spinner color={C.purple} /> Restauration…</>
                                : <><UploadCloud style={{ width: 13, height: 13 }} /> Lancer la restauration</>
                            }
                        </button>

                        {/* Result panel */}
                        {restoreResult && (
                            <div style={{ padding: '.6rem .85rem', background: restoreResult.ok ? 'rgba(63,185,80,.06)' : 'rgba(232,106,101,.06)', border: `1px solid ${restoreResult.ok ? 'rgba(63,185,80,.25)' : 'rgba(232,106,101,.25)'}`, borderRadius: 6, fontSize: '.8rem' }}>
                                <div style={{ fontWeight: 600, marginBottom: '.35rem', color: restoreResult.ok ? C.green : C.red }}>
                                    {restoreResult.ok ? '✓ Restauration réussie' : '⚠ Restauration avec erreurs'}
                                </div>
                                {restoreResult.written.length > 0 && (
                                    <div style={{ color: C.muted, marginBottom: '.2rem' }}>
                                        Écrits : {restoreResult.written.map(f => <code key={f} style={{ color: C.green, marginRight: '.4rem', fontFamily: 'monospace' }}>{f}</code>)}
                                    </div>
                                )}
                                {restoreResult.skipped.length > 0 && (
                                    <div style={{ color: C.muted, marginBottom: '.2rem' }}>
                                        Ignorés : {restoreResult.skipped.map(f => <code key={f} style={{ color: C.muted, marginRight: '.4rem', fontFamily: 'monospace' }}>{f}</code>)}
                                    </div>
                                )}
                                {restoreResult.errors.length > 0 && (
                                    <div style={{ color: C.red }}>
                                        Erreurs : {restoreResult.errors.map((e, i) => <div key={i}><code style={{ fontFamily: 'monospace' }}>{e}</code></div>)}
                                    </div>
                                )}
                                {restoreResult.reloadOk !== undefined && (
                                    <div style={{ marginTop: '.3rem', color: restoreResult.reloadOk ? C.green : C.orange }}>
                                        Reload : {restoreResult.reloadOk ? '✓ OK' : `⚠ ${restoreResult.reloadOut ?? 'échec'}`}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

            </div>

            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
};
