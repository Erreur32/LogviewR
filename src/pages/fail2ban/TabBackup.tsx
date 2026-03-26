import React, { useState, useRef } from 'react';
import { Archive, UploadCloud, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { card, cardH, cardB } from './helpers';

// ── Backup file shape (validated client-side) ─────────────────────────────────

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

function padZ(n: number) { return String(n).padStart(2, '0'); }
function nowStamp() {
    const d = new Date();
    return `${d.getFullYear()}-${padZ(d.getMonth()+1)}-${padZ(d.getDate())}_${padZ(d.getHours())}${padZ(d.getMinutes())}${padZ(d.getSeconds())}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const TabBackup: React.FC = () => {
    // Export state
    const [exporting, setExporting] = useState(false);
    const [exportErr, setExportErr] = useState<string | null>(null);

    // Restore state
    const [backup, setBackup] = useState<BackupFile | null>(null);
    const [fileErr, setFileErr] = useState<string | null>(null);
    const [reload, setReload] = useState(true);
    const [restoring, setRestoring] = useState(false);
    const [restoreErr, setRestoreErr] = useState<string | null>(null);
    const [restoreResult, setRestoreResult] = useState<{
        ok: boolean; written: string[]; skipped: string[]; errors: string[];
        reloadOk?: boolean; reloadOut?: string;
    } | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    // ── Export ────────────────────────────────────────────────────────────────

    const handleExport = async () => {
        setExporting(true);
        setExportErr(null);
        try {
            const resp = await fetch('/api/plugins/fail2ban/backup/full', { credentials: 'include' });
            if (!resp.ok) {
                const txt = await resp.text();
                throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 200)}`);
            }
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `fail2ban-backup-${nowStamp()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err: unknown) {
            setExportErr(err instanceof Error ? err.message : String(err));
        } finally {
            setExporting(false);
        }
    };

    // ── Restore — file selection ───────────────────────────────────────────────

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setBackup(null);
        setFileErr(null);
        setRestoreResult(null);
        setRestoreErr(null);
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const d = JSON.parse(ev.target?.result as string) as BackupFile;
                if (d.type !== 'f2b_full_backup' || d.version !== 1) {
                    setFileErr('Fichier invalide — type ou version non reconnu');
                    return;
                }
                setBackup(d);
            } catch {
                setFileErr('Impossible de lire le fichier JSON');
            }
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

        setRestoring(true);
        setRestoreErr(null);
        setRestoreResult(null);
        try {
            const resp = await fetch(`/api/plugins/fail2ban/backup/restore?reload=${reload ? 1 : 0}`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(backup),
            });
            const json = await resp.json() as { success: boolean; error?: string; result?: typeof restoreResult };
            if (!json.success) throw new Error(json.error ?? 'Erreur inconnue');
            setRestoreResult(json.result ?? null);
            setBackup(null);
            if (fileRef.current) fileRef.current.value = '';
        } catch (err: unknown) {
            setRestoreErr(err instanceof Error ? err.message : String(err));
        } finally {
            setRestoring(false);
        }
    };

    // ── Derived preview values ─────────────────────────────────────────────────

    const totalFiles   = backup ? Object.keys(backup.files).length : 0;
    const localCount   = backup ? Object.keys(backup.files).filter(k => k.endsWith('.local')).length : 0;
    const jailNames    = backup?.runtime?.jails ? Object.keys(backup.runtime.jails) : [];

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 700 }}>

            {/* ── Card 1: Export ── */}
            <div style={card}>
                <div style={cardH}>
                    <Archive style={{ width: 14, height: 14, color: '#58a6ff' }} />
                    <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Backup complet</span>
                    <span style={{ marginLeft: 'auto', fontSize: '.7rem', padding: '.1rem .5rem', borderRadius: 4, background: 'rgba(88,166,255,.15)', color: '#58a6ff', border: '1px solid rgba(88,166,255,.3)' }}>Export</span>
                </div>
                <div style={cardB}>
                    <ul style={{ margin: '0 0 1rem', padding: '0 0 0 1.2rem', fontSize: '.82rem', color: '#8b949e', lineHeight: 1.8 }}>
                        <li><code style={{ color: '#e6edf3' }}>fail2ban.conf</code> / <code style={{ color: '#e6edf3' }}>fail2ban.local</code></li>
                        <li><code style={{ color: '#e6edf3' }}>jail.conf</code> / <code style={{ color: '#e6edf3' }}>jail.local</code></li>
                        <li><code style={{ color: '#e6edf3' }}>jail.d/</code> — tous les fichiers</li>
                        <li><code style={{ color: '#e6edf3' }}>filter.d/</code> — tous les fichiers</li>
                        <li><code style={{ color: '#e6edf3' }}>action.d/</code> — tous les fichiers</li>
                        <li>État runtime (IPs bannies par jail)</li>
                    </ul>

                    {exportErr && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.5rem .75rem', background: 'rgba(232,106,101,.1)', border: '1px solid rgba(232,106,101,.3)', borderRadius: 6, marginBottom: '.75rem', fontSize: '.82rem', color: '#e86a65' }}>
                            <XCircle style={{ width: 14, height: 14, flexShrink: 0 }} />
                            {exportErr}
                        </div>
                    )}

                    <button
                        onClick={() => { void handleExport(); }}
                        disabled={exporting}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: '.4rem',
                            padding: '.45rem 1rem', borderRadius: 6, fontSize: '.82rem', fontWeight: 600,
                            background: exporting ? 'rgba(88,166,255,.1)' : 'rgba(88,166,255,.15)',
                            border: '1px solid rgba(88,166,255,.4)', color: '#58a6ff',
                            cursor: exporting ? 'not-allowed' : 'pointer', opacity: exporting ? .7 : 1,
                        }}
                    >
                        {exporting
                            ? <><span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid rgba(88,166,255,.3)', borderTopColor: '#58a6ff', borderRadius: '50%', animation: 'spin .7s linear infinite' }} /> Préparation…</>
                            : <><Archive style={{ width: 13, height: 13 }} /> Télécharger le backup JSON</>
                        }
                    </button>
                </div>
            </div>

            {/* ── Card 2: Restore ── */}
            <div style={card}>
                <div style={cardH}>
                    <UploadCloud style={{ width: 14, height: 14, color: '#bc8cff' }} />
                    <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Restaurer un backup</span>
                    <span style={{ marginLeft: 'auto', fontSize: '.7rem', padding: '.1rem .5rem', borderRadius: 4, background: 'rgba(188,140,255,.15)', color: '#bc8cff', border: '1px solid rgba(188,140,255,.3)' }}>Restaurer</span>
                </div>
                <div style={cardB}>
                    {/* Warning banner */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.5rem', padding: '.5rem .75rem', background: 'rgba(227,179,65,.08)', border: '1px solid rgba(227,179,65,.25)', borderRadius: 6, marginBottom: '1rem', fontSize: '.8rem', color: '#e3b341' }}>
                        <AlertTriangle style={{ width: 13, height: 13, flexShrink: 0, marginTop: 2 }} />
                        <span>Seuls les fichiers <code>.local</code> sont restaurés — les <code>.conf</code> système ne sont jamais écrasés.</span>
                    </div>

                    {/* File picker */}
                    <div style={{ marginBottom: '1rem' }}>
                        <input
                            ref={fileRef}
                            type="file"
                            accept=".json"
                            onChange={handleFileChange}
                            style={{ fontSize: '.82rem', color: '#e6edf3' }}
                        />
                    </div>

                    {/* File error */}
                    {fileErr && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.5rem .75rem', background: 'rgba(232,106,101,.1)', border: '1px solid rgba(232,106,101,.3)', borderRadius: 6, marginBottom: '.75rem', fontSize: '.82rem', color: '#e86a65' }}>
                            <XCircle style={{ width: 14, height: 14, flexShrink: 0 }} />
                            {fileErr}
                        </div>
                    )}

                    {/* Preview panel */}
                    {backup && (
                        <div style={{ padding: '.65rem .85rem', background: 'rgba(63,185,80,.06)', border: '1px solid rgba(63,185,80,.25)', borderRadius: 6, marginBottom: '1rem', fontSize: '.82rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: '.4rem', color: '#3fb950', fontWeight: 600 }}>
                                <CheckCircle style={{ width: 13, height: 13 }} /> Backup valide
                            </div>
                            <div style={{ color: '#8b949e', lineHeight: 1.7 }}>
                                <div>Exporté le <span style={{ color: '#e6edf3' }}>{new Date(backup.exported_at).toLocaleString('fr-FR')}</span> depuis <code style={{ color: '#e6edf3' }}>{backup.host}</code></div>
                                <div><span style={{ color: '#e6edf3' }}>{totalFiles} fichier(s)</span> au total · <span style={{ color: '#58a6ff' }}>{localCount} fichier(s) .local</span> seront restaurés</div>
                                {jailNames.length > 0 && (
                                    <div>Jails : <span style={{ color: '#e6edf3' }}>{jailNames.join(', ')}</span></div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Reload checkbox */}
                    <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.82rem', color: '#8b949e', marginBottom: '1rem', cursor: 'pointer' }}>
                        <input type="checkbox" checked={reload} onChange={e => setReload(e.target.checked)} />
                        Recharger Fail2ban après restauration (<code>fail2ban-client reload</code>)
                    </label>

                    {/* Restore error */}
                    {restoreErr && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.5rem .75rem', background: 'rgba(232,106,101,.1)', border: '1px solid rgba(232,106,101,.3)', borderRadius: 6, marginBottom: '.75rem', fontSize: '.82rem', color: '#e86a65' }}>
                            <XCircle style={{ width: 14, height: 14, flexShrink: 0 }} />
                            {restoreErr}
                        </div>
                    )}

                    {/* Launch button */}
                    <button
                        onClick={() => { void handleRestore(); }}
                        disabled={!backup || restoring}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: '.4rem',
                            padding: '.45rem 1rem', borderRadius: 6, fontSize: '.82rem', fontWeight: 600,
                            background: (!backup || restoring) ? 'rgba(188,140,255,.05)' : 'rgba(188,140,255,.15)',
                            border: '1px solid rgba(188,140,255,.4)', color: '#bc8cff',
                            cursor: (!backup || restoring) ? 'not-allowed' : 'pointer',
                            opacity: (!backup || restoring) ? .5 : 1,
                        }}
                    >
                        {restoring
                            ? <><span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid rgba(188,140,255,.3)', borderTopColor: '#bc8cff', borderRadius: '50%', animation: 'spin .7s linear infinite' }} /> Restauration…</>
                            : <><UploadCloud style={{ width: 13, height: 13 }} /> Lancer la restauration</>
                        }
                    </button>

                    {/* Result panel */}
                    {restoreResult && (
                        <div style={{ marginTop: '1rem', padding: '.65rem .85rem', background: restoreResult.ok ? 'rgba(63,185,80,.06)' : 'rgba(232,106,101,.06)', border: `1px solid ${restoreResult.ok ? 'rgba(63,185,80,.25)' : 'rgba(232,106,101,.25)'}`, borderRadius: 6, fontSize: '.82rem' }}>
                            <div style={{ fontWeight: 600, marginBottom: '.4rem', color: restoreResult.ok ? '#3fb950' : '#e86a65' }}>
                                {restoreResult.ok ? '✓ Restauration réussie' : '⚠ Restauration avec erreurs'}
                            </div>
                            {restoreResult.written.length > 0 && (
                                <div style={{ marginBottom: '.25rem', color: '#8b949e' }}>
                                    Écrits : {restoreResult.written.map(f => <code key={f} style={{ color: '#3fb950', marginRight: '.4rem' }}>{f}</code>)}
                                </div>
                            )}
                            {restoreResult.skipped.length > 0 && (
                                <div style={{ marginBottom: '.25rem', color: '#8b949e' }}>
                                    Ignorés : {restoreResult.skipped.map(f => <code key={f} style={{ color: '#8b949e', marginRight: '.4rem' }}>{f}</code>)}
                                </div>
                            )}
                            {restoreResult.errors.length > 0 && (
                                <div style={{ marginBottom: '.25rem', color: '#e86a65' }}>
                                    Erreurs : {restoreResult.errors.map((e, i) => <div key={i}><code>{e}</code></div>)}
                                </div>
                            )}
                            {restoreResult.reloadOk !== undefined && (
                                <div style={{ marginTop: '.35rem', color: restoreResult.reloadOk ? '#3fb950' : '#e3b341' }}>
                                    Reload : {restoreResult.reloadOk ? '✓ OK' : `⚠ ${restoreResult.reloadOut ?? 'échec'}`}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Spinner keyframes */}
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
};
