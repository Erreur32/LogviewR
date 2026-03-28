/**
 * Fail2banPathConfig — shared path configuration fields
 * Used in both Administration > Plugins (PluginOptionsPanel) and Fail2ban > Config tab (TabConfig)
 *
 * Fields:
 *   - SQLite DB path (custom Docker override)
 *   - NPM data path (for Top Domains feature)
 */

import React, { useState, useEffect } from 'react';
import { Save, RefreshCw, CheckCircle, XCircle, Stethoscope, Database, Network } from 'lucide-react';

interface Fail2banPathConfigProps {
    sqliteDbPath: string;
    onSqliteDbPathChange: (v: string) => void;
    npmDataPath: string;
    onNpmDataPathChange: (v: string) => void;
}

interface NpmCheckResult {
    ok: boolean;
    step: string;
    error: string | null;
    resolvedPath: string;
    domains: number;
    jailMatches: number;
}

interface F2bCheckResult {
    ok: boolean;
    checks: { socket: { ok: boolean }; client: { ok: boolean }; daemon: { ok: boolean }; sqlite: { ok: boolean; path?: string }; dropin: { ok: boolean } };
}

function authHeader() {
    return { Authorization: `Bearer ${localStorage.getItem('dashboard_user_token') ?? ''}` };
}

export const Fail2banPathConfig: React.FC<Fail2banPathConfigProps> = ({
    sqliteDbPath,
    onSqliteDbPathChange,
    npmDataPath,
    onNpmDataPathChange,
}) => {
    // ── SQLite path ──────────────────────────────────────────────────────────
    const [sqliteInput, setSqliteInput]   = useState(sqliteDbPath);
    const [sqliteSaving, setSqliteSaving] = useState(false);
    const [sqliteStatus, setSqliteStatus] = useState<'idle' | 'ok' | 'error'>('idle');
    const [sqliteError, setSqliteError]   = useState<string>('');

    useEffect(() => { setSqliteInput(sqliteDbPath); }, [sqliteDbPath]);

    const saveSqlitePath = async () => {
        setSqliteSaving(true);
        setSqliteStatus('idle');
        setSqliteError('');
        try {
            const res = await fetch('/api/plugins/fail2ban/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeader() },
                body: JSON.stringify({ settings: { sqliteDbPath: sqliteInput.trim() } }),
            });
            if (!res.ok) { setSqliteStatus('error'); setSqliteError('Erreur serveur'); return; }
            onSqliteDbPathChange(sqliteInput.trim());
            // Re-run diagnostic to validate
            const chk = await fetch('/api/plugins/fail2ban/check', { headers: authHeader() });
            if (chk.ok) {
                const data = await chk.json();
                const result: F2bCheckResult = data.result ?? data;
                if (result.checks.sqlite.ok) {
                    setSqliteStatus('ok');
                } else {
                    setSqliteStatus('error');
                    setSqliteError('Fichier non accessible — vérifiez les permissions');
                }
            }
        } catch (e) {
            setSqliteStatus('error');
            setSqliteError(e instanceof Error ? e.message : 'Erreur réseau');
        } finally {
            setSqliteSaving(false);
        }
    };

    // ── NPM path ─────────────────────────────────────────────────────────────
    const [npmInput, setNpmInput]       = useState(npmDataPath);
    const [npmSaving, setNpmSaving]     = useState(false);
    const [npmSaved, setNpmSaved]       = useState(false);
    const [npmCheck, setNpmCheck]       = useState<NpmCheckResult | null>(null);
    const [npmChecking, setNpmChecking] = useState(false);

    useEffect(() => { setNpmInput(npmDataPath); }, [npmDataPath]);

    const saveNpmPath = async () => {
        setNpmSaving(true);
        setNpmCheck(null);
        setNpmSaved(false);
        try {
            const res = await fetch('/api/plugins/fail2ban/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeader() },
                body: JSON.stringify({ settings: { npmDataPath: npmInput.trim() } }),
            });
            if (res.ok) {
                onNpmDataPathChange(npmInput.trim());
                setNpmSaved(true);
                setTimeout(() => setNpmSaved(false), 4000);
            }
        } catch { /* ignore */ }
        finally { setNpmSaving(false); }
    };

    const checkNpm = async () => {
        setNpmChecking(true);
        setNpmCheck(null);
        try {
            const res = await fetch('/api/plugins/fail2ban/check-npm', { headers: authHeader() });
            if (res.ok) {
                const data = await res.json();
                setNpmCheck(data.result ?? data);
            } else {
                setNpmCheck({ ok: false, step: 'request', error: 'Erreur réseau', resolvedPath: '', domains: 0, jailMatches: 0 });
            }
        } catch (e) {
            setNpmCheck({ ok: false, step: 'request', error: e instanceof Error ? e.message : 'Erreur', resolvedPath: '', domains: 0, jailMatches: 0 });
        } finally {
            setNpmChecking(false);
        }
    };

    const inputStyle = (status: 'idle' | 'ok' | 'error'): React.CSSProperties => ({
        flex: 1, padding: '.38rem .65rem', fontSize: '.82rem', fontFamily: 'monospace',
        background: '#161b22', color: '#e6edf3', outline: 'none', borderRadius: 4,
        border: `1px solid ${status === 'ok' ? '#3fb950' : status === 'error' ? '#e86a65' : '#30363d'}`,
        borderBottom: `1px solid ${status === 'ok' ? '#3fb950' : status === 'error' ? '#e86a65' : '#555'}`,
        boxSizing: 'border-box' as const,
        boxShadow: 'inset 0 2px 4px rgba(0,0,0,.55), inset 0 1px 0 rgba(0,0,0,.4), inset 0 -1px 0 rgba(255,255,255,.04)',
        transition: 'border-color .15s',
    });

    const btnStyle = (color: string, bg: string): React.CSSProperties => ({
        display: 'flex', alignItems: 'center', gap: '.3rem',
        padding: '.38rem .7rem', borderRadius: 4, cursor: 'pointer',
        background: bg, border: `1px solid ${color}66`, color,
        fontSize: '.75rem', whiteSpace: 'nowrap' as const, flexShrink: 0,
    });

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* SQLite path */}
            <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: '.4rem' }}>
                    <Database size={13} style={{ color: '#bc8cff', flexShrink: 0 }} />
                    <span style={{ fontSize: '.82rem', fontWeight: 600, color: '#e6edf3' }}>Chemin base SQLite</span>
                    <span style={{ fontSize: '.72rem', color: '#e3b341' }}>(optionnel)</span>
                    {sqliteStatus === 'ok'    && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontSize: '.72rem', color: '#3fb950', marginLeft: 'auto' }}><CheckCircle size={11} /> Accessible</span>}
                    {sqliteStatus === 'error' && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontSize: '.72rem', color: '#e86a65', marginLeft: 'auto' }}><XCircle size={11} /> {sqliteError || 'Non accessible'}</span>}
                </div>
                <div style={{ display: 'flex', gap: '.4rem' }}>
                    <input
                        type="text"
                        value={sqliteInput}
                        onChange={e => { setSqliteInput(e.target.value); setSqliteStatus('idle'); }}
                        placeholder="/var/lib/fail2ban/fail2ban.sqlite3"
                        style={inputStyle(sqliteStatus)}
                    />
                    <button type="button" onClick={saveSqlitePath} disabled={sqliteSaving}
                        style={{ ...btnStyle('#e86a65', 'rgba(232,106,101,.12)'), opacity: sqliteSaving ? .5 : 1 }}>
                        {sqliteSaving ? <RefreshCw size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={11} />}
                        {sqliteSaving ? 'Vérification…' : 'Sauvegarder'}
                    </button>
                </div>
                <p style={{ fontSize: '.72rem', color: '#8b949e', marginTop: '.3rem' }}>
                    Vide = chemin par défaut <code style={{ color: '#e86a65' }}>/var/lib/fail2ban/fail2ban.sqlite3</code>
                </p>
            </div>

            {/* NPM path */}
            <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: '.4rem' }}>
                    <Network size={13} style={{ color: '#39c5cf', flexShrink: 0 }} />
                    <span style={{ fontSize: '.82rem', fontWeight: 600, color: '#e6edf3' }}>Chemin données NPM</span>
                    <span style={{ fontSize: '.72rem', color: '#e3b341' }}>(optionnel)</span>
                    {npmCheck?.ok === true  && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontSize: '.72rem', color: '#3fb950', marginLeft: 'auto' }}><CheckCircle size={11} /> {npmCheck.domains} domaine{npmCheck.domains !== 1 ? 's' : ''}</span>}
                    {npmCheck?.ok === false && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontSize: '.72rem', color: '#e86a65', marginLeft: 'auto' }}><XCircle size={11} /> {npmCheck.error ?? 'Chemin invalide'}</span>}
                    {npmSaved && !npmCheck  && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontSize: '.72rem', color: '#3fb950', marginLeft: 'auto' }}><CheckCircle size={11} /> Enregistré</span>}
                </div>
                <div style={{ display: 'flex', gap: '.4rem' }}>
                    <input
                        type="text"
                        value={npmInput}
                        onChange={e => { setNpmInput(e.target.value); setNpmCheck(null); }}
                        placeholder="/data  ou  /opt/npm/data"
                        style={inputStyle(npmCheck?.ok === true ? 'ok' : npmCheck?.ok === false ? 'error' : 'idle')}
                    />
                    <button type="button" onClick={saveNpmPath} disabled={npmSaving}
                        style={{ ...btnStyle('#e86a65', 'rgba(232,106,101,.12)'), opacity: npmSaving ? .5 : 1 }}>
                        {npmSaving ? <RefreshCw size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={11} />}
                        {npmSaving ? 'Sauvegarde…' : 'Sauvegarder'}
                    </button>
                    <button type="button" onClick={checkNpm} disabled={npmChecking || !npmInput.trim()}
                        style={{ ...btnStyle('#3fb950', 'rgba(63,185,80,.12)'), opacity: npmChecking || !npmInput.trim() ? .5 : 1 }}>
                        {npmChecking ? <RefreshCw size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Stethoscope size={11} />}
                        {npmChecking ? 'Test…' : 'Tester'}
                    </button>
                </div>
                <p style={{ fontSize: '.72rem', color: '#8b949e', marginTop: '.3rem' }}>
                    Requis pour "Top Domaines" (Nginx Proxy Manager). Ex : <code style={{ color: '#e3b341' }}>/data</code> ou <code style={{ color: '#e3b341' }}>/opt/npm/data</code>
                </p>
            </div>
        </div>
    );
};
