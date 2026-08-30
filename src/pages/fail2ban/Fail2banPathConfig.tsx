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
import { useTranslation } from 'react-i18next';

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
    const { t } = useTranslation();
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
                setSqliteError(t('fail2ban.pathConfig.sqliteFileNotAccessible'));
            }
        } else {
            setSqliteStatus('error');
            setSqliteError(t('fail2ban.pathConfig.serverError'));
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
        catch (e) { setSqliteStatus('error'); setSqliteError(e instanceof Error ? e.message : t('fail2ban.pathConfig.networkError')); }
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
            if (!res.ok) { setSqliteStatus('error'); setSqliteError(t('fail2ban.pathConfig.serverError')); return; }
            onSqliteDbPathChange!(sqliteInput.trim());
            await runSqliteCheck();
        } catch (e) {
            setSqliteStatus('error');
            setSqliteError(e instanceof Error ? e.message : t('fail2ban.pathConfig.networkError'));
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
                if (s.npmDataPath) setNpmInput(s.npmDataPath);
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
            const port = Number.parseInt(mysql.port);
            if (!mysql.host.trim()) { setNpmCheck({ ok: false, step: 'validate', error: t('fail2ban.pathConfig.mysqlHostRequired'), resolvedPath: '', domains: 0, jailMatches: 0 }); return; }
            if (!mysql.user.trim()) { setNpmCheck({ ok: false, step: 'validate', error: t('fail2ban.pathConfig.mysqlUserRequired'), resolvedPath: '', domains: 0, jailMatches: 0 }); return; }
            if (!mysql.db.trim())   { setNpmCheck({ ok: false, step: 'validate', error: t('fail2ban.pathConfig.mysqlDbRequired'), resolvedPath: '', domains: 0, jailMatches: 0 }); return; }
            if (Number.isNaN(port) || port < 1 || port > 65535) { setNpmCheck({ ok: false, step: 'validate', error: t('fail2ban.pathConfig.mysqlPortInvalid'), resolvedPath: '', domains: 0, jailMatches: 0 }); return; }
        }
        setNpmSaving(true);
        setNpmCheck(null);
        setNpmSaved(false);
        try {
            const settings: Record<string, unknown> = { npmDbType };
            settings.npmDataPath = npmInput.trim();
            if (npmDbType === 'mysql') {
                settings.npmMysqlHost = mysql.host.trim();
                settings.npmMysqlPort = Number.parseInt(mysql.port) || 3306;
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
                onNpmDataPathChange!(npmInput.trim());
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
                setNpmCheck({ ok: false, step: 'request', error: t('fail2ban.pathConfig.networkError'), resolvedPath: '', domains: 0, jailMatches: 0 });
            }
        } catch (e) {
            setNpmCheck({ ok: false, step: 'request', error: e instanceof Error ? e.message : t('fail2ban.pathConfig.error'), resolvedPath: '', domains: 0, jailMatches: 0 });
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
                        <span style={{ fontSize: '.82rem', fontWeight: 600, color: '#e6edf3' }}>{t('fail2ban.pathConfig.sqlitePath')}</span>
                        <span style={{ fontSize: '.72rem', color: '#e3b341' }}>({t('fail2ban.pathConfig.optional')})</span>
                        {sqliteStatus === 'ok' && !sqliteInput.trim() && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontSize: '.72rem', color: '#3fb950', marginLeft: 'auto',
                                background: 'rgba(63,185,80,.10)', border: '1px solid rgba(63,185,80,.3)', borderRadius: 4, padding: '.1rem .45rem' }}>
                                <CheckCircle size={11} /> {t('fail2ban.pathConfig.defaultOk')}
                            </span>
                        )}
                        {sqliteStatus === 'ok' && !!sqliteInput.trim() && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontSize: '.72rem', color: '#3fb950', marginLeft: 'auto' }}>
                                <CheckCircle size={11} /> {t('fail2ban.pathConfig.accessible')}
                            </span>
                        )}
                        {sqliteStatus === 'error' && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontSize: '.72rem', color: '#e86a65', marginLeft: 'auto' }}><XCircle size={11} /> {sqliteError || t('fail2ban.pathConfig.notAccessible')}</span>}
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
                            {sqliteTesting ? t('fail2ban.pathConfig.testing') : t('fail2ban.pathConfig.test')}
                        </button>
                        <button type="button" onClick={saveSqlitePath} disabled={sqliteSaving}
                            style={{ ...btnStyle('#58a6ff', 'rgba(88,166,255,.1)'), opacity: sqliteSaving ? .5 : 1 }}>
                            {sqliteSaving ? <RefreshCw size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={11} />}
                            {sqliteSaving ? t('fail2ban.pathConfig.saving') : t('fail2ban.pathConfig.save')}
                        </button>
                    </div>
                    <p style={{ fontSize: '.72rem', color: '#8b949e', marginTop: '.3rem' }}>
                        {t('fail2ban.pathConfig.emptyDefaultPath')} <code style={{ color: '#e86a65' }}>/var/lib/fail2ban/fail2ban.sqlite3</code>
                    </p>
                </div>
            )}

            {/* NPM config — Fail2ban > Config tab only */}
            {showNpm && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
                    {/* Header + status */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                        <Network size={13} style={{ color: '#39c5cf', flexShrink: 0 }} />
                        <span style={{ fontSize: '.82rem', fontWeight: 600, color: '#e6edf3' }}>{t('fail2ban.pathConfig.npmIntegration')}</span>
                        <span style={{ fontSize: '.72rem', color: '#e3b341' }}>({t('fail2ban.pathConfig.optional')})</span>
                        {npmCheck?.ok === true  && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontSize: '.72rem', color: '#3fb950', marginLeft: 'auto' }}><CheckCircle size={11} /> {t('fail2ban.pathConfig.npmDomains', { count: npmCheck.domains, source: npmCheck.source })}</span>}
                        {npmCheck?.ok === false && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontSize: '.72rem', color: '#e86a65', marginLeft: 'auto' }}><XCircle size={11} /> {npmCheck.error ?? t('fail2ban.pathConfig.error')}</span>}
                        {npmSaved && !npmCheck  && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontSize: '.72rem', color: '#3fb950', marginLeft: 'auto' }}><CheckCircle size={11} /> {t('fail2ban.pathConfig.saved')}</span>}
                    </div>

                    {/* DB type toggle */}
                    <div style={{ display: 'flex', gap: '.35rem' }}>
                        {(['sqlite', 'mysql'] as const).map(dbType => (
                            <button key={dbType} type="button"
                                onClick={() => { setNpmDbType(dbType); setNpmCheck(null); }}
                                style={{
                                    padding: '.25rem .65rem', borderRadius: 4, fontSize: '.75rem', cursor: 'pointer',
                                    fontWeight: npmDbType === dbType ? 700 : 400,
                                    background: npmDbType === dbType ? (dbType === 'mysql' ? 'rgba(88,166,255,.15)' : 'rgba(57,197,207,.15)') : 'transparent',
                                    border: `1px solid ${npmDbType === dbType ? (dbType === 'mysql' ? '#58a6ff88' : '#39c5cf88') : '#30363d'}`,
                                    color: npmDbType === dbType ? (dbType === 'mysql' ? '#58a6ff' : '#39c5cf') : '#8b949e',
                                }}>
                                {dbType === 'sqlite' ? t('fail2ban.pathConfig.dbSqlite') : t('fail2ban.pathConfig.dbMysql')}
                            </button>
                        ))}
                    </div>

                    {/* SQLite fields */}
                    {npmDbType === 'sqlite' && (
                        <div>
                            <div style={{ display: 'flex', gap: '.4rem' }}>
                                <input type="text" value={npmInput}
                                    onChange={e => { setNpmInput(e.target.value); setNpmCheck(null); }}
                                    placeholder="/home/docker/nginx-proxy-manager/data"
                                    style={inputStyle(npmCheck?.ok === true ? 'ok' : npmCheck?.ok === false ? 'error' : 'idle')} />
                            </div>
                            <p style={{ fontSize: '.72rem', color: '#8b949e', marginTop: '.25rem' }}>
                                {t('fail2ban.pathConfig.sqliteRootHint')} <code style={{ color: '#e3b341' }}>/home/docker/nginx-proxy-manager/data</code> {t('fail2ban.pathConfig.sqliteRootMustContain')} <code style={{ color: '#8b949e' }}>database.sqlite</code> + <code style={{ color: '#8b949e' }}>logs/</code>
                            </p>
                        </div>
                    )}

                    {/* MySQL fields */}
                    {npmDbType === 'mysql' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '.4rem' }}>
                                <input type="text" value={mysql.host} placeholder={t('fail2ban.pathConfig.hostPlaceholder')}
                                    onChange={e => setMysql(m => ({ ...m, host: e.target.value }))}
                                    style={inputStyle('idle')} />
                                <input type="text" value={mysql.port} placeholder={t('fail2ban.pathConfig.portPlaceholder')}
                                    onChange={e => setMysql(m => ({ ...m, port: e.target.value }))}
                                    style={{ ...inputStyle(mysql.port.trim() && (Number.isNaN(Number.parseInt(mysql.port)) || +mysql.port < 1 || +mysql.port > 65535) ? 'error' : 'idle'), width: 70, flex: 'none' }} />
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.4rem' }}>
                                <input type="text" value={mysql.user} placeholder={t('fail2ban.pathConfig.userPlaceholder')}
                                    onChange={e => setMysql(m => ({ ...m, user: e.target.value }))}
                                    style={inputStyle('idle')} />
                                <input type="text" value={mysql.db} placeholder={t('fail2ban.pathConfig.dbPlaceholder')}
                                    onChange={e => setMysql(m => ({ ...m, db: e.target.value }))}
                                    style={inputStyle('idle')} />
                            </div>
                            <div style={{ position: 'relative', display: 'flex' }}>
                                <input type={showPass ? 'text' : 'password'} value={mysql.pass} placeholder={t('fail2ban.pathConfig.passPlaceholder')}
                                    onChange={e => setMysql(m => ({ ...m, pass: e.target.value }))}
                                    style={{ ...inputStyle('idle'), paddingRight: '2rem' }} />
                                <button type="button" onClick={() => setShowPass(p => !p)}
                                    style={{ position: 'absolute', right: '.4rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#8b949e', display: 'flex', alignItems: 'center' }}>
                                    {showPass ? <EyeOff size={13} /> : <Eye size={13} />}
                                </button>
                            </div>
                            <p style={{ fontSize: '.72rem', color: '#8b949e' }}>
                                {t('fail2ban.pathConfig.mysqlHostHelp')} <code style={{ color: '#e3b341' }}>npm</code> {t('fail2ban.pathConfig.mysqlHostHelpSuffix')}
                            </p>
                            <div style={{ marginTop: '.4rem' }}>
                                <div style={{ fontSize: '.72rem', color: '#e3b341', marginBottom: '.2rem', fontWeight: 600 }}>
                                    {t('fail2ban.pathConfig.npmLogsDir')} <span style={{ color: '#8b949e', fontWeight: 400 }}>({t('fail2ban.pathConfig.requiredForTopDomains')})</span>
                                </div>
                                <input type="text" value={npmInput}
                                    onChange={e => { setNpmInput(e.target.value); setNpmCheck(null); }}
                                    placeholder="/home/docker/nginx-proxy-manager/data"
                                    style={inputStyle('idle')} />
                                <p style={{ fontSize: '.72rem', color: '#8b949e', marginTop: '.25rem' }}>
                                    {t('fail2ban.pathConfig.sqliteRootHint')} <code style={{ color: '#e3b341' }}>/home/docker/nginx-proxy-manager/data</code> {t('fail2ban.pathConfig.mysqlLogsMustContain')} <code style={{ color: '#8b949e' }}>logs/</code>
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '.4rem' }}>
                        <button type="button" onClick={checkNpm} disabled={npmChecking}
                            style={{ ...btnStyle('#3fb950', 'rgba(63,185,80,.12)'), opacity: npmChecking ? .5 : 1 }}>
                            {npmChecking ? <RefreshCw size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Stethoscope size={11} />}
                            {npmChecking ? t('fail2ban.pathConfig.testing') : t('fail2ban.pathConfig.testConnection')}
                        </button>
                        <button type="button" onClick={saveNpmConfig} disabled={npmSaving}
                            style={{ ...btnStyle('#58a6ff', 'rgba(88,166,255,.1)'), opacity: npmSaving ? .5 : 1 }}>
                            {npmSaving ? <RefreshCw size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={11} />}
                            {npmSaving ? t('fail2ban.pathConfig.saving') : t('fail2ban.pathConfig.save')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
