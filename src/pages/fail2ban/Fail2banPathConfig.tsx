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

    const borderSqlite = sqliteStatus === 'ok' ? 'border-green-600' : sqliteStatus === 'error' ? 'border-red-600' : 'border-gray-700';
    const borderNpm    = npmCheck?.ok === true ? 'border-green-600' : npmCheck?.ok === false ? 'border-red-600' : 'border-gray-700';

    return (
        <div className="space-y-4">
            {/* SQLite path */}
            <div>
                <div className="flex items-center gap-2 mb-2">
                    <Database size={13} className="text-purple-400" />
                    <span className="text-sm font-medium text-gray-300">Chemin base SQLite</span>
                    <span className="text-amber-400 text-xs">(optionnel)</span>
                    {sqliteStatus === 'ok'    && <span className="inline-flex items-center gap-1 text-xs text-green-400 ml-auto"><CheckCircle size={11} /> Accessible</span>}
                    {sqliteStatus === 'error' && <span className="inline-flex items-center gap-1 text-xs text-red-400 ml-auto"><XCircle size={11} /> {sqliteError || 'Non accessible'}</span>}
                </div>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={sqliteInput}
                        onChange={e => { setSqliteInput(e.target.value); setSqliteStatus('idle'); }}
                        placeholder="/var/lib/fail2ban/fail2ban.sqlite3"
                        className={`flex-1 px-3 py-2 bg-[#1a1a1a] border ${borderSqlite} rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/50 text-sm font-mono transition-colors`}
                    />
                    <button
                        type="button"
                        onClick={saveSqlitePath}
                        disabled={sqliteSaving}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/15 border border-red-500/40 text-red-300 hover:bg-red-500/25 transition-colors text-xs whitespace-nowrap disabled:opacity-50"
                    >
                        {sqliteSaving ? <RefreshCw size={11} className="animate-spin" /> : <Save size={11} />}
                        {sqliteSaving ? 'Vérification…' : 'Sauvegarder'}
                    </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                    Vide = chemin par défaut <code className="text-red-400">/var/lib/fail2ban/fail2ban.sqlite3</code>
                </p>
            </div>

            {/* NPM path */}
            <div>
                <div className="flex items-center gap-2 mb-2">
                    <Network size={13} className="text-cyan-400" />
                    <span className="text-sm font-medium text-gray-300">Chemin données NPM</span>
                    <span className="text-amber-400 text-xs">(optionnel)</span>
                    {npmCheck?.ok === true  && <span className="inline-flex items-center gap-1 text-xs text-green-400 ml-auto"><CheckCircle size={11} /> {npmCheck.domains} domaine{npmCheck.domains !== 1 ? 's' : ''}</span>}
                    {npmCheck?.ok === false && <span className="inline-flex items-center gap-1 text-xs text-red-400 ml-auto"><XCircle size={11} /> {npmCheck.error ?? 'Chemin invalide'}</span>}
                    {npmSaved && !npmCheck  && <span className="inline-flex items-center gap-1 text-xs text-green-400 ml-auto"><CheckCircle size={11} /> Enregistré</span>}
                </div>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={npmInput}
                        onChange={e => { setNpmInput(e.target.value); setNpmCheck(null); }}
                        placeholder="/data  ou  /opt/npm/data"
                        className={`flex-1 px-3 py-2 bg-[#1a1a1a] border ${borderNpm} rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/50 text-sm font-mono transition-colors`}
                    />
                    <button
                        type="button"
                        onClick={saveNpmPath}
                        disabled={npmSaving}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/15 border border-red-500/40 text-red-300 hover:bg-red-500/25 transition-colors text-xs whitespace-nowrap disabled:opacity-50"
                    >
                        {npmSaving ? <RefreshCw size={11} className="animate-spin" /> : <Save size={11} />}
                        {npmSaving ? 'Sauvegarde…' : 'Sauvegarder'}
                    </button>
                    <button
                        type="button"
                        onClick={checkNpm}
                        disabled={npmChecking || !npmInput.trim()}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-500/15 border border-green-500/40 text-green-300 hover:bg-green-500/25 transition-colors text-xs whitespace-nowrap disabled:opacity-50"
                    >
                        {npmChecking ? <RefreshCw size={11} className="animate-spin" /> : <Stethoscope size={11} />}
                        {npmChecking ? 'Test…' : 'Tester'}
                    </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                    Requis pour "Top Domaines" (Nginx Proxy Manager). Ex : <code className="text-orange-400">/data</code> ou <code className="text-orange-400">/opt/npm/data</code>
                </p>
            </div>
        </div>
    );
};
