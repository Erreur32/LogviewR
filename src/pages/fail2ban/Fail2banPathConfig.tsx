/**
 * Fail2banPathConfig — path configuration fields
 *
 * Each section is rendered only when the corresponding callback is provided:
 *   - SQLite section: pass sqliteDbPath + onSqliteDbPathChange
 *   - NPM section:    pass npmDataPath  + onNpmDataPathChange
 *
 * Usage:
 *   - Administration > Plugins: SQLite only
 *   - Fail2ban > Config tab:    NPM only
 */

import React, { useState, useEffect } from 'react';
import { Save, RefreshCw, CheckCircle, XCircle, Stethoscope, Database, Network, Eye, EyeOff } from 'lucide-react';

interface Fail2banPathConfigProps {
    sqliteDbPath?: string;
    onSqliteDbPathChange?: (v: string) => void;
    onSqliteStatusChange?: (status: 'idle' | 'ok' | 'error') => void;
    npmDataPath?: string;
    onNpmDataPathChange?: (v: string) => void;
}

interface NpmCheckResult {
    ok: boolean;
    step: string;
    error: string | null;
    resolvedPath: string;
    domains: number;
    jailMatches: number;
    source?: 'sqlite' | 'mysql';
}

interface NpmMysqlConfig {
    host: string;
    port: string;
    user: string;
    pass: string;
    db: string;
}

interface F2bCheckResult {
    ok: boolean;
    checks: { socket: { ok: boolean }; client: { ok: boolean }; daemon: { ok: boolean }; sqlite: { ok: boolean; path?: string }; dropin: { ok: boolean } };
}

function authHeader() {
    return { Authorization: `Bearer ${localStorage.getItem('dashboard_user_token') ?? ''}` };
}

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

export const Fail2banPathConfig: React.FC<Fail2banPathConfigProps> = ({
    sqliteDbPath,
    onSqliteDbPathChange,
    onSqliteStatusChange,
    npmDataPath,
    onNpmDataPathChange,
}) => {
    const showSqlite = onSqliteDbPathChange !== undefined;
    const showNpm    = onNpmDataPathChange  !== undefined;

    // ── SQLite path ──────────────────────────────────────────────────────────
    const [sqliteInput, setSqliteInput]     = useState(sqliteDbPath ?? '');
    const [sqliteSaving, setSqliteSaving]   = useState(false);
    const [sqliteTesting, setSqliteTesting] = useState(false);
    const [sqliteStatus, setSqliteStatus]   = useState<'idle' | 'ok' | 'error'>('idle');

    // Bubble status up to parent whenever it changes
    useEffect(() => { onSqliteStatusChange?.(sqliteStatus); }, [sqliteStatus]); // eslint-disable-line react-hooks/exhaustive-deps
    const [sqliteError, setSqliteError]     = useState<string>('');

    useEffect(() => { if (sqliteDbPath !== undefined) setSqliteInput(sqliteDbPath); }, [sqliteDbPath]);

    const runSqliteCheck = async (): Promise<void> => {
        const chk = await fetch('/api/plugins/fail2ban/check', { headers: authHeader() });
        if (chk.ok) {
            const data = await chk.json();
            const result: F2bCheckResult = data.result ?? data;
            if (result.checks.sqlite.ok) {
                setSqliteStatus('ok');
            } else {
                setSqliteStatus('error');
                setSqliteError('Fichier non accessible — vérifiez les permissions et le montage Docker');
            }
        } else {
            setSqliteStatus('error');
            setSqliteError('Erreur serveur');
        }
    };

    // Auto-check SQLite on mount (silent — shows default-path OK tip)
    useEffect(() => {
        if (!showSqlite) return;
        runSqliteCheck().catch(() => {});
    }, [showSqlite]); // eslint-disable-line react-hooks/exhaustive-deps

    const testSqlitePath = async () => {
        setSqliteTesting(true);
        setSqliteStatus('idle');
        setSqliteError('');
        try { await runSqliteCheck(); }
        catch (e) { setSqliteStatus('error'); setSqliteError(e instanceof Error ? e.message : 'Erreur réseau'); }
        finally { setSqliteTesting(false); }
    };

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
            onSqliteDbPathChange!(sqliteInput.trim());
            await runSqliteCheck();
        } catch (e) {
            setSqliteStatus('error');
            setSqliteError(e instanceof Error ? e.message : 'Erreur réseau');
        } finally {
            setSqliteSaving(false);
        }
    };

    // ── NPM config ────────────────────────────────────────────────────────────
    const [npmDbType, setNpmDbType]     = useState<'sqlite' | 'mysql'>('sqlite');
    const [npmInput, setNpmInput]       = useState(npmDataPath ?? '');
    const [npmSaving, setNpmSaving]     = useState(false);
    const [npmSaved, setNpmSaved]       = useState(false);
    const [npmCheck, setNpmCheck]       = useState<NpmCheckResult | null>(null);
    const [npmChecking, setNpmChecking] = useState(false);
    const [showPass, setShowPass]       = useState(false);
    const [mysql, setMysql]             = useState<NpmMysqlConfig>({ host: '', port: '3306', user: 'npm', pass: '', db: 'npm' });

    useEffect(() => { if (npmDataPath !== undefined) setNpmInput(npmDataPath); }, [npmDataPath]);

    // Load saved MySQL config from plugin settings on mount, then auto-check if config is present
    useEffect(() => {
        if (!showNpm) return;
        fetch('/api/plugins/fail2ban', { headers: authHeader() })
            .then(r => r.json())
            .then(data => {
                const s = (data.result ?? data)?.settings ?? {};
                const dbType: 'sqlite' | 'mysql' = s.npmDbType ?? 'sqlite';
                if (s.npmDbType) setNpmDbType(dbType);
                if (s.npmMysqlHost) setMysql(m => ({ ...m, host: s.npmMysqlHost }));
                if (s.npmMysqlPort) setMysql(m => ({ ...m, port: String(s.npmMysqlPort) }));
                if (s.npmMysqlUser) setMysql(m => ({ ...m, user: s.npmMysqlUser }));
                if (s.npmMysqlPass) setMysql(m => ({ ...m, pass: s.npmMysqlPass }));
                if (s.npmMysqlDb)   setMysql(m => ({ ...m, db: s.npmMysqlDb }));
                // Auto-check if config looks usable
                const hasSqlite = dbType === 'sqlite' && !!s.npmDataPath;
                const hasMysql  = dbType === 'mysql'  && !!s.npmMysqlHost && !!s.npmMysqlUser && !!s.npmMysqlDb;
                if (hasSqlite || hasMysql) {
                    setNpmChecking(true);
                    fetch('/api/plugins/fail2ban/check-npm', { headers: authHeader() })
                        .then(r => r.json())
                        .then(d => setNpmCheck(d.result ?? d))
                        .catch(() => {})
                        .finally(() => setNpmChecking(false));
                }
            })
            .catch(() => {});
    }, [showNpm]);

    const saveNpmConfig = async () => {
        // Validate MySQL fields before save
        if (npmDbType === 'mysql') {
            const port = parseInt(mysql.port);
            if (!mysql.host.trim()) { setNpmCheck({ ok: false, step: 'validate', error: 'Hôte MySQL obligatoire', resolvedPath: '', domains: 0, jailMatches: 0 }); return; }
            if (!mysql.user.trim()) { setNpmCheck({ ok: false, step: 'validate', error: 'Utilisateur MySQL obligatoire', resolvedPath: '', domains: 0, jailMatches: 0 }); return; }
            if (!mysql.db.trim())   { setNpmCheck({ ok: false, step: 'validate', error: 'Nom de la base obligatoire', resolvedPath: '', domains: 0, jailMatches: 0 }); return; }
            if (isNaN(port) || port < 1 || port > 65535) { setNpmCheck({ ok: false, step: 'validate', error: 'Port invalide — doit être entre 1 et 65535', resolvedPath: '', domains: 0, jailMatches: 0 }); return; }
        }
        setNpmSaving(true);
        setNpmCheck(null);
        setNpmSaved(false);
        try {
            const settings: Record<string, unknown> = { npmDbType };
            if (npmDbType === 'sqlite') {
                settings.npmDataPath = npmInput.trim();
            } else {
                settings.npmMysqlHost = mysql.host.trim();
                settings.npmMysqlPort = parseInt(mysql.port) || 3306;
                settings.npmMysqlUser = mysql.user.trim();
                settings.npmMysqlPass = mysql.pass;
                settings.npmMysqlDb   = mysql.db.trim();
            }
            const res = await fetch('/api/plugins/fail2ban/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeader() },
                body: JSON.stringify({ settings }),
            });
            if (res.ok) {
                if (npmDbType === 'sqlite') onNpmDataPathChange!(npmInput.trim());
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

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* SQLite path — Administration > Plugins only */}
            {showSqlite && (
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: '.4rem' }}>
                        <Database size={13} style={{ color: '#bc8cff', flexShrink: 0 }} />
                        <span style={{ fontSize: '.82rem', fontWeight: 600, color: '#e6edf3' }}>Chemin base SQLite</span>
                        <span style={{ fontSize: '.72rem', color: '#e3b341' }}>(optionnel)</span>
                        {sqliteStatus === 'ok' && !sqliteInput.trim() && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontSize: '.72rem', color: '#3fb950', marginLeft: 'auto',
                                background: 'rgba(63,185,80,.10)', border: '1px solid rgba(63,185,80,.3)', borderRadius: 4, padding: '.1rem .45rem' }}>
                                <CheckCircle size={11} /> Par défaut · OK
                            </span>
                        )}
                        {sqliteStatus === 'ok' && !!sqliteInput.trim() && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontSize: '.72rem', color: '#3fb950', marginLeft: 'auto' }}>
                                <CheckCircle size={11} /> Accessible
                            </span>
                        )}
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
                        <button type="button" onClick={testSqlitePath} disabled={sqliteTesting}
                            style={{ ...btnStyle('#3fb950', 'rgba(63,185,80,.12)'), opacity: sqliteTesting ? .5 : 1 }}>
                            {sqliteTesting ? <RefreshCw size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Stethoscope size={11} />}
                            {sqliteTesting ? 'Test…' : 'Tester'}
                        </button>
                        <button type="button" onClick={saveSqlitePath} disabled={sqliteSaving}
                            style={{ ...btnStyle('#58a6ff', 'rgba(88,166,255,.1)'), opacity: sqliteSaving ? .5 : 1 }}>
                            {sqliteSaving ? <RefreshCw size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={11} />}
                            {sqliteSaving ? 'Sauvegarde…' : 'Sauvegarder'}
                        </button>
                    </div>
                    <p style={{ fontSize: '.72rem', color: '#8b949e', marginTop: '.3rem' }}>
                        Vide = chemin par défaut <code style={{ color: '#e86a65' }}>/var/lib/fail2ban/fail2ban.sqlite3</code>
                    </p>
                </div>
            )}

            {/* NPM config — Fail2ban > Config tab only */}
            {showNpm && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
                    {/* Header + status */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                        <Network size={13} style={{ color: '#39c5cf', flexShrink: 0 }} />
                        <span style={{ fontSize: '.82rem', fontWeight: 600, color: '#e6edf3' }}>Intégration NPM</span>
                        <span style={{ fontSize: '.72rem', color: '#e3b341' }}>(optionnel)</span>
                        {npmCheck?.ok === true  && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontSize: '.72rem', color: '#3fb950', marginLeft: 'auto' }}><CheckCircle size={11} /> {npmCheck.domains} domaine{npmCheck.domains !== 1 ? 's' : ''} · {npmCheck.source}</span>}
                        {npmCheck?.ok === false && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontSize: '.72rem', color: '#e86a65', marginLeft: 'auto' }}><XCircle size={11} /> {npmCheck.error ?? 'Erreur'}</span>}
                        {npmSaved && !npmCheck  && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontSize: '.72rem', color: '#3fb950', marginLeft: 'auto' }}><CheckCircle size={11} /> Enregistré</span>}
                    </div>

                    {/* DB type toggle */}
                    <div style={{ display: 'flex', gap: '.35rem' }}>
                        {(['sqlite', 'mysql'] as const).map(t => (
                            <button key={t} type="button"
                                onClick={() => { setNpmDbType(t); setNpmCheck(null); }}
                                style={{
                                    padding: '.25rem .65rem', borderRadius: 4, fontSize: '.75rem', cursor: 'pointer',
                                    fontWeight: npmDbType === t ? 700 : 400,
                                    background: npmDbType === t ? (t === 'mysql' ? 'rgba(88,166,255,.15)' : 'rgba(57,197,207,.15)') : 'transparent',
                                    border: `1px solid ${npmDbType === t ? (t === 'mysql' ? '#58a6ff88' : '#39c5cf88') : '#30363d'}`,
                                    color: npmDbType === t ? (t === 'mysql' ? '#58a6ff' : '#39c5cf') : '#8b949e',
                                }}>
                                {t === 'sqlite' ? '📄 SQLite (fichier)' : '🐬 MySQL / MariaDB'}
                            </button>
                        ))}
                    </div>

                    {/* SQLite fields */}
                    {npmDbType === 'sqlite' && (
                        <div>
                            <div style={{ display: 'flex', gap: '.4rem' }}>
                                <input type="text" value={npmInput}
                                    onChange={e => { setNpmInput(e.target.value); setNpmCheck(null); }}
                                    placeholder="/data  ou  /opt/npm/data"
                                    style={inputStyle(npmCheck?.ok === true ? 'ok' : npmCheck?.ok === false ? 'error' : 'idle')} />
                            </div>
                            <p style={{ fontSize: '.72rem', color: '#8b949e', marginTop: '.25rem' }}>
                                Dossier racine NPM. Ex : <code style={{ color: '#e3b341' }}>/data</code> — doit contenir <code style={{ color: '#8b949e' }}>database.sqlite</code> + <code style={{ color: '#8b949e' }}>logs/</code>
                            </p>
                        </div>
                    )}

                    {/* MySQL fields */}
                    {npmDbType === 'mysql' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '.4rem' }}>
                                <input type="text" value={mysql.host} placeholder="Hôte (ex: 127.0.0.1 ou mariadb)"
                                    onChange={e => setMysql(m => ({ ...m, host: e.target.value }))}
                                    style={inputStyle('idle')} />
                                <input type="text" value={mysql.port} placeholder="Port"
                                    onChange={e => setMysql(m => ({ ...m, port: e.target.value }))}
                                    style={{ ...inputStyle(mysql.port.trim() && (isNaN(parseInt(mysql.port)) || +mysql.port < 1 || +mysql.port > 65535) ? 'error' : 'idle'), width: 70, flex: 'none' }} />
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.4rem' }}>
                                <input type="text" value={mysql.user} placeholder="Utilisateur"
                                    onChange={e => setMysql(m => ({ ...m, user: e.target.value }))}
                                    style={inputStyle('idle')} />
                                <input type="text" value={mysql.db} placeholder="Base de données"
                                    onChange={e => setMysql(m => ({ ...m, db: e.target.value }))}
                                    style={inputStyle('idle')} />
                            </div>
                            <div style={{ position: 'relative', display: 'flex' }}>
                                <input type={showPass ? 'text' : 'password'} value={mysql.pass} placeholder="Mot de passe"
                                    onChange={e => setMysql(m => ({ ...m, pass: e.target.value }))}
                                    style={{ ...inputStyle('idle'), paddingRight: '2rem' }} />
                                <button type="button" onClick={() => setShowPass(p => !p)}
                                    style={{ position: 'absolute', right: '.4rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#8b949e', display: 'flex', alignItems: 'center' }}>
                                    {showPass ? <EyeOff size={13} /> : <Eye size={13} />}
                                </button>
                            </div>
                            <p style={{ fontSize: '.72rem', color: '#8b949e' }}>
                                Hôte = nom du service Docker ou IP. Base = <code style={{ color: '#e3b341' }}>npm</code> par défaut dans NPM.
                            </p>
                        </div>
                    )}

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '.4rem' }}>
                        <button type="button" onClick={checkNpm} disabled={npmChecking}
                            style={{ ...btnStyle('#3fb950', 'rgba(63,185,80,.12)'), opacity: npmChecking ? .5 : 1 }}>
                            {npmChecking ? <RefreshCw size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Stethoscope size={11} />}
                            {npmChecking ? 'Test…' : 'Tester connexion'}
                        </button>
                        <button type="button" onClick={saveNpmConfig} disabled={npmSaving}
                            style={{ ...btnStyle('#58a6ff', 'rgba(88,166,255,.1)'), opacity: npmSaving ? .5 : 1 }}>
                            {npmSaving ? <RefreshCw size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={11} />}
                            {npmSaving ? 'Sauvegarde…' : 'Sauvegarder'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
