import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
    Settings, Database, RefreshCw, Save, Play,
    Info, Shield, FileText, AlertTriangle, CheckCircle, XCircle,
    ChevronRight, ChevronDown, HardDrive, Stethoscope, Trash2, Copy, Terminal,
    Pencil, X, Layers, Network,
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
    appDbInfo: { size: number; sizeFmt: string; exists: boolean; fragPct: number };
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

type TestResult = { ok: boolean; errors: string[]; warnings: string[] };
type SaveResult = { ok: boolean; reloadOk: boolean; reloadOutput: string; error?: string };

const RawFileViewer: React.FC<{
    rawFiles: RawFiles | null;
    rawTab: string;
    onTabChange: (t: string) => void;
    height?: number | string;
    onSaved?: (filename: string, content: string) => void;
}> = ({ rawFiles, rawTab, onTabChange, height = 480, onSaved }) => {
    const [copied, setCopied]       = useState(false);
    const [editMode, setEditMode]   = useState(false);
    const [editContent, setEditContent] = useState('');
    const [testing, setTesting]     = useState(false);
    const [testResult, setTestResult] = useState<TestResult | null>(null);
    const [saving, setSaving]       = useState(false);
    const [saveResult, setSaveResult] = useState<SaveResult | null>(null);

    const FILES = ['fail2ban.conf', 'fail2ban.local', 'jail.conf', 'jail.local'] as const;
    const EDITABLE = new Set(['fail2ban.local', 'jail.local']);

    const content = rawFiles ? (rawFiles[rawTab as keyof RawFiles] ?? null) : null;
    const isEditable = EDITABLE.has(rawTab);
    const isDirty = editMode && editContent !== (content ?? '');

    const copyContent = () => {
        const src = editMode ? editContent : content;
        if (!src) return;
        navigator.clipboard.writeText(src).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
    };

    const enterEdit = () => {
        setEditContent(content ?? '');
        setTestResult(null);
        setSaveResult(null);
        setEditMode(true);
    };

    const exitEdit = () => {
        setEditMode(false);
        setTestResult(null);
        setSaveResult(null);
    };

    const switchTab = (f: string) => {
        if (editMode && isDirty) {
            if (!window.confirm('Des modifications non sauvegardées seront perdues. Continuer ?')) return;
        }
        exitEdit();
        onTabChange(f);
    };

    const testConfig = async () => {
        setTesting(true);
        setTestResult(null);
        setSaveResult(null);
        const res = await api.post<TestResult>('/api/plugins/fail2ban/config/test-raw', { filename: rawTab, content: editContent });
        setTesting(false);
        if (res.success && res.result) setTestResult(res.result);
        else setTestResult({ ok: false, errors: [res.error?.message ?? 'Erreur réseau'], warnings: [] });
    };

    const saveConfig = async () => {
        setSaving(true);
        setSaveResult(null);
        const res = await api.post<SaveResult>('/api/plugins/fail2ban/config/write-raw', { filename: rawTab, content: editContent });
        setSaving(false);
        if (res.success && res.result) {
            setSaveResult(res.result);
            if (res.result.ok) {
                onSaved?.(rawTab, editContent);
                setEditMode(false);
                setTestResult(null);
            }
        } else {
            setSaveResult({ ok: false, reloadOk: false, reloadOutput: '', error: res.error?.message ?? 'Erreur réseau' });
        }
    };

    const lineCount = (editMode ? editContent : (content ?? '')).split('\n').length;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height, overflow: 'hidden' }}>
            {/* Test/Save result banner */}
            {(testResult || saveResult) && (
                <div style={{
                    padding: '.45rem .85rem', flexShrink: 0, fontSize: '.75rem',
                    background: (testResult?.ok || saveResult?.ok) ? 'rgba(63,185,80,.08)' : 'rgba(232,106,101,.08)',
                    borderBottom: `1px solid ${(testResult?.ok || saveResult?.ok) ? 'rgba(63,185,80,.3)' : 'rgba(232,106,101,.3)'}`,
                }}>
                    {testResult && !testResult.ok && testResult.errors.map((e, i) => (
                        <div key={i} style={{ color: '#e86a65', display: 'flex', alignItems: 'flex-start', gap: '.4rem' }}>
                            <XCircle style={{ width: 12, height: 12, flexShrink: 0, marginTop: 1 }} />{e}
                        </div>
                    ))}
                    {testResult && testResult.warnings.map((w, i) => (
                        <div key={i} style={{ color: '#e3b341', display: 'flex', alignItems: 'flex-start', gap: '.4rem' }}>
                            <AlertTriangle style={{ width: 12, height: 12, flexShrink: 0, marginTop: 1 }} />{w}
                        </div>
                    ))}
                    {testResult?.ok && (
                        <div style={{ color: '#3fb950', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                            <CheckCircle style={{ width: 12, height: 12 }} /> Syntaxe valide — prêt à sauvegarder
                        </div>
                    )}
                    {saveResult && !saveResult.ok && (
                        <div style={{ color: '#e86a65', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                            <XCircle style={{ width: 12, height: 12 }} /> {saveResult.error ?? 'Échec de l\'écriture'}
                        </div>
                    )}
                </div>
            )}

            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                {/* Sidebar */}
                <div style={{ width: 148, flexShrink: 0, borderRight: `1px solid #30363d`, display: 'flex', flexDirection: 'column', background: '#161b22' }}>
                    <div style={{ padding: '.45rem .75rem', fontSize: '.65rem', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: '1px solid #30363d' }}>
                        /etc/fail2ban/
                    </div>
                    {FILES.map(f => {
                        const absent = rawFiles && rawFiles[f] === null;
                        const active = rawTab === f;
                        const canEdit = EDITABLE.has(f);
                        return (
                            <button key={f} onClick={() => switchTab(f)} style={{
                                textAlign: 'left', padding: '.4rem .75rem', fontSize: '.78rem',
                                fontFamily: 'monospace', background: active ? 'rgba(88,166,255,.12)' : 'transparent',
                                color: active ? '#58a6ff' : absent ? '#555d69' : '#e6edf3',
                                border: 'none', borderLeft: active ? '2px solid #58a6ff' : '2px solid transparent',
                                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '.4rem',
                            }}>
                                <FileText style={{ width: 11, height: 11, flexShrink: 0 }} />
                                <span style={{ flex: 1 }}>{f}</span>
                                {absent && <span style={{ fontSize: '.55rem', color: '#555d69' }}>∅</span>}
                                {canEdit && !absent && <Pencil style={{ width: 9, height: 9, color: '#8b949e', opacity: .5 }} />}
                            </button>
                        );
                    })}
                    <div style={{ flex: 1 }} />
                    <div style={{ padding: '.5rem .6rem', fontSize: '.62rem', color: '#555d69', borderTop: '1px solid #30363d', lineHeight: 1.4 }}>
                        <span style={{ color: '#3fb950' }}>●</span> éditable<br />
                        <span style={{ color: '#555d69' }}>●</span> lecture seule
                    </div>
                </div>

                {/* Editor area */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0d1117' }}>
                    {/* Toolbar */}
                    <div style={{ display: 'flex', alignItems: 'center', padding: '.3rem .75rem', background: '#161b22', borderBottom: '1px solid #30363d', gap: '.5rem', flexShrink: 0 }}>
                        <span style={{ fontFamily: 'monospace', fontSize: '.72rem', color: '#58a6ff', flex: 1 }}>
                            /etc/fail2ban/{rawTab}
                            {isDirty && <span style={{ color: '#e3b341', marginLeft: '.4rem' }}>●</span>}
                        </span>
                        {content && !editMode && <span style={{ fontSize: '.68rem', color: '#555d69' }}>{lineCount} lignes</span>}
                        {editMode && <span style={{ fontSize: '.68rem', color: '#e3b341' }}>{lineCount} lignes · édition</span>}
                        {content === null && <span style={{ fontSize: '.68rem', color: '#555d69', fontStyle: 'italic' }}>fichier absent</span>}

                        {/* Edit mode actions */}
                        {editMode && isDirty && (
                            <button onClick={testConfig} disabled={testing} style={{
                                background: testing ? 'rgba(227,179,65,.08)' : 'rgba(227,179,65,.15)', color: '#e3b341',
                                border: '1px solid rgba(227,179,65,.4)', borderRadius: 4, cursor: testing ? 'not-allowed' : 'pointer',
                                padding: '2px 7px', display: 'flex', alignItems: 'center', gap: '.3rem', fontSize: '.7rem',
                            }}>
                                {testing
                                    ? <><RefreshCw style={{ width: 10, height: 10, animation: 'spin 1s linear infinite' }} /> Test…</>
                                    : <><CheckCircle style={{ width: 10, height: 10 }} /> Tester</>
                                }
                            </button>
                        )}
                        {editMode && testResult?.ok && isDirty && (
                            <button onClick={saveConfig} disabled={saving} style={{
                                background: saving ? 'rgba(63,185,80,.08)' : 'rgba(63,185,80,.15)', color: '#3fb950',
                                border: '1px solid rgba(63,185,80,.4)', borderRadius: 4, cursor: saving ? 'not-allowed' : 'pointer',
                                padding: '2px 7px', display: 'flex', alignItems: 'center', gap: '.3rem', fontSize: '.7rem',
                            }}>
                                {saving
                                    ? <><RefreshCw style={{ width: 10, height: 10, animation: 'spin 1s linear infinite' }} /> Sauvegarde…</>
                                    : <><Save style={{ width: 10, height: 10 }} /> Sauvegarder & Recharger</>
                                }
                            </button>
                        )}

                        {/* Copy */}
                        <button onClick={copyContent} disabled={!content && !editMode} title="Copier" style={{
                            background: 'none', border: `1px solid #30363d`, borderRadius: 4,
                            cursor: (content || editMode) ? 'pointer' : 'not-allowed',
                            color: copied ? '#3fb950' : '#8b949e', padding: '2px 6px', display: 'flex', alignItems: 'center', gap: '.3rem', fontSize: '.7rem',
                        }}>
                            {copied ? <CheckCircle style={{ width: 11, height: 11 }} /> : <Copy style={{ width: 11, height: 11 }} />}
                            {copied ? 'Copié' : 'Copier'}
                        </button>

                        {/* Edit toggle */}
                        {isEditable && !editMode && (
                            <button onClick={enterEdit} title="Activer l'édition" style={{
                                background: 'rgba(88,166,255,.12)', color: '#58a6ff',
                                border: '1px solid rgba(88,166,255,.35)', borderRadius: 4,
                                cursor: 'pointer', padding: '2px 7px', display: 'flex', alignItems: 'center', gap: '.3rem', fontSize: '.7rem',
                            }}>
                                <Pencil style={{ width: 10, height: 10 }} /> Éditer
                            </button>
                        )}
                        {editMode && (
                            <button onClick={exitEdit} title="Quitter l'édition" style={{
                                background: 'rgba(232,106,101,.12)', color: '#e86a65',
                                border: '1px solid rgba(232,106,101,.35)', borderRadius: 4,
                                cursor: 'pointer', padding: '2px 7px', display: 'flex', alignItems: 'center', gap: '.3rem', fontSize: '.7rem',
                            }}>
                                <X style={{ width: 10, height: 10 }} /> Quitter
                            </button>
                        )}
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        {editMode ? (
                            <textarea
                                value={editContent}
                                onChange={e => { setEditContent(e.target.value); setTestResult(null); setSaveResult(null); }}
                                spellCheck={false}
                                style={{
                                    flex: 1, width: '100%', height: '100%', resize: 'none',
                                    borderTop: 'none', borderRight: 'none', borderBottom: 'none', outline: 'none',
                                    background: '#0d1117', color: '#e6edf3', fontFamily: 'monospace', fontSize: '.75rem',
                                    lineHeight: 1.65, padding: '.75rem 1rem', boxSizing: 'border-box',
                                    borderLeft: '3px solid rgba(227,179,65,.4)',
                                }}
                            />
                        ) : content ? (
                            <div style={{ flex: 1, overflowY: 'auto', display: 'flex' }}>
                                {/* Line numbers */}
                                <div style={{ padding: '.75rem .5rem', textAlign: 'right', userSelect: 'none', borderRight: '1px solid #21262d', flexShrink: 0, minWidth: 40 }}>
                                    {content.split('\n').map((_, i) => (
                                        <div key={i} style={{ fontSize: '.72rem', lineHeight: 1.65, color: '#30363d', fontFamily: 'monospace' }}>{i + 1}</div>
                                    ))}
                                </div>
                                <pre style={{ flex: 1, padding: '.75rem 1rem', margin: 0, overflow: 'visible', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                    <ConfHighlighter content={content} />
                                </pre>
                            </div>
                        ) : (
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '.6rem', color: '#555d69', fontSize: '.8rem' }}>
                                {rawFiles ? (
                                    isEditable ? (
                                        <>
                                            <span style={{ fontStyle: 'italic' }}>Ce fichier n'existe pas — cliquez <strong style={{ color: '#58a6ff' }}>Éditer</strong> pour le créer</span>
                                        </>
                                    ) : (
                                        <span style={{ fontStyle: 'italic' }}>Ce fichier n'existe pas sur ce système</span>
                                    )
                                ) : 'Chargement…'}
                            </div>
                        )}
                    </div>
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

// ── VacuumAlert for dashboard.db ──────────────────────────────────────────────

const DashboardVacuumAlert: React.FC<{ fragPct: number; onDone: () => void }> = ({ fragPct, onDone }) => {
    const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
    const [errMsg, setErrMsg] = useState('');
    const run = async () => {
        setState('running');
        try {
            const res = await api.post<{ ok: boolean; error?: string }>('/api/plugins/fail2ban/config/dashboard-vacuum');
            if (res.success && res.result?.ok) { setState('done'); onDone(); }
            else {
                setErrMsg(res.result?.error ?? res.error?.message ?? 'Erreur inconnue');
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
                    <span style={{ color: C.muted }}>— compresse dashboard.db et libère l'espace inutilisé</span>
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
            </div>
        </div>
    );
};

// ── Warning badge inline ───────────────────────────────────────────────────────

const WarnBadge: React.FC<{ count: number; tip?: string }> = ({ count, tip }) => (
    <span title={tip} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, background: 'rgba(227,179,65,.18)', border: '1px solid rgba(227,179,65,.45)', color: C.orange, fontSize: '.65rem', fontWeight: 700, cursor: tip ? 'help' : undefined }}>
        {count}
    </span>
);

// ── Raw File Modal ─────────────────────────────────────────────────────────────

const RawFileModal: React.FC<{
    rawFiles: RawFiles | null;
    rawTab: string;
    onTabChange: (t: string) => void;
    onClose: () => void;
    onSaved: (filename: string, content: string) => void;
}> = ({ rawFiles, rawTab, onTabChange, onClose, onSaved }) => createPortal(
    <div
        style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
        <div style={{ background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 10, width: '100%', maxWidth: 1300, boxShadow: '0 20px 60px rgba(0,0,0,.6)', display: 'flex', flexDirection: 'column', maxHeight: '95vh' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.8rem 1rem', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
                <FileText style={{ width: 15, height: 15, color: C.blue }} />
                <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '.95rem', color: C.text }}>Fichiers de configuration</div>
                    <div style={{ fontSize: '.72rem', color: C.muted, marginTop: 1 }}>/etc/fail2ban/ — <span style={{ color: C.orange }}>fail2ban.local</span> et <span style={{ color: C.orange }}>jail.local</span> sont éditables</div>
                </div>
                <button onClick={onClose} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 5, cursor: 'pointer', color: C.muted, padding: '.2rem .4rem', display: 'flex', alignItems: 'center' }}>
                    <X style={{ width: 14, height: 14 }} />
                </button>
            </div>
            {/* Body */}
            <div style={{ flex: 1, overflow: 'hidden', borderRadius: '0 0 10px 10px' }}>
                <RawFileViewer rawFiles={rawFiles} rawTab={rawTab} onTabChange={onTabChange} height="100%" onSaved={onSaved} />
            </div>
        </div>
    </div>,
    document.body
);

// ── Main Component ────────────────────────────────────────────────────────────

export const TabConfig: React.FC<{
    onWarningsChange?: (count: number) => void;
    npmDataPath?: string;
    onNpmDataPathChange?: (v: string) => void;
}> = ({ onWarningsChange, npmDataPath = '', onNpmDataPathChange }) => {
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

    // Intégrations — NPM logpath (synced with parent via props)
    const [npmInput, setNpmInput] = useState(npmDataPath);
    const [npmSaving, setNpmSaving] = useState(false);
    const [npmSaved, setNpmSaved]   = useState(false);
    type NpmCheckResult = { ok: boolean; step: string; error: string | null; resolvedPath: string; domains: number; jailMatches: number; jailLogpaths?: Record<string, string>; proxyHostJails?: { jail: string; logpath: string }[] };
    const [npmCheck, setNpmCheck] = useState<NpmCheckResult | null>(null);
    const [npmChecking, setNpmChecking] = useState(false);
    // Keep local input in sync when parent prop updates (e.g. initial load)
    useEffect(() => { setNpmInput(npmDataPath); }, [npmDataPath]);

    const saveNpmSettings = async () => {
        setNpmSaving(true);
        setNpmCheck(null);
        setNpmSaved(false);
        const res = await api.post<{ ok: boolean }>('/api/plugins/fail2ban/config', { settings: { npmDataPath: npmInput.trim() } });
        setNpmSaving(false);
        if (res.success) {
            onNpmDataPathChange?.(npmInput.trim());
            setNpmSaved(true);
            setTimeout(() => setNpmSaved(false), 4000);
        } else {
            toast('Erreur lors de l\'enregistrement', false);
        }
    };

    const checkNpm = async () => {
        setNpmChecking(true);
        setNpmCheck(null);
        const res = await api.get<NpmCheckResult>('/api/plugins/fail2ban/check-npm');
        setNpmChecking(false);
        if (res.success && res.result) setNpmCheck(res.result);
        else setNpmCheck({ ok: false, step: 'request', error: res.error?.message ?? 'Erreur réseau', resolvedPath: '', domains: 0, jailMatches: 0 });
    };

    // Maintenance
    const [resetting, setResetting] = useState(false);

    // Form state (runtime & persist)
    const [fmLoglevel, setFmLoglevel]   = useState('');
    const [fmLogtarget, setFmLogtarget] = useState('');
    const [fmPurgeage, setFmPurgeage]   = useState('');
    const [fmMaxmatches, setFmMaxmatches] = useState('');

    // Collapsible cards
    const [openRuntime, setOpenRuntime] = useState(false);
    const [openDb,      setOpenDb]      = useState(false);
    const [openMaint,   setOpenMaint]   = useState(false);

    // Raw files modal
    const [openRawModal, setOpenRawModal] = useState(false);

    // Firewall checks (iptables / ipset / nftables)
    type FwStatus = 'idle' | 'loading' | 'ok' | 'error';
    const FW_CHECKS_CFG = [
        { key: 'iptables', label: 'IPTables', icon: <Shield style={{ width: 13, height: 13 }} />, color: C.blue,   route: '/api/plugins/fail2ban/iptables',  detail: 'Règles netfilter via iptables-save', fix: 'Requiert NET_ADMIN + network_mode: host' },
        { key: 'ipset',    label: 'IPSet',    icon: <Layers  style={{ width: 13, height: 13 }} />, color: C.purple, route: '/api/plugins/fail2ban/ipset/info', detail: 'Sets netfilter (f2b-*, blacklist…)',  fix: 'Requiert NET_ADMIN + network_mode: host' },
        { key: 'nftables', label: 'NFTables', icon: <Network style={{ width: 13, height: 13 }} />, color: C.cyan,   route: '/api/plugins/fail2ban/nftables',  detail: 'Ruleset nftables du host',           fix: 'Requiert NET_ADMIN + network_mode: host' },
    ];
    const [fwStatuses, setFwStatuses] = useState<Record<string, FwStatus>>({});
    const [fwErrors,   setFwErrors]   = useState<Record<string, string>>({});
    const [fwLoading,  setFwLoading]  = useState(false);

    const checkFirewall = useCallback(async () => {
        setFwLoading(true);
        setFwStatuses({ iptables: 'loading', ipset: 'loading', nftables: 'loading' });
        setFwErrors({});
        const results = await Promise.all(
            FW_CHECKS_CFG.map(async c => {
                try {
                    const res = await api.get<{ ok: boolean; error?: string }>(c.route);
                    const ok = res.success && res.result?.ok === true;
                    return { key: c.key, status: ok ? 'ok' : 'error', error: res.result?.error ?? '' };
                } catch (e) {
                    return { key: c.key, status: 'error', error: e instanceof Error ? e.message : String(e) };
                }
            })
        );
        const st: Record<string, FwStatus> = {};
        const er: Record<string, string>   = {};
        for (const r of results) { st[r.key] = r.status as FwStatus; if (r.error) er[r.key] = r.error; }
        setFwStatuses(st);
        setFwErrors(er);
        setFwLoading(false);
    }, []);

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
        checkFirewall();
    }, [loadParsed, runChecks, checkFirewall]);

    // Notify parent whenever parsed data or firewall statuses change → drives nav badge
    useEffect(() => {
        if (!onWarningsChange) return;
        let warns = 0;
        if (parsed?.dbInfo?.fragPct   && parsed.dbInfo.fragPct   > 20) warns++;
        if (parsed?.dbInfo?.integrity && parsed.dbInfo.integrity !== 'ok') warns++;
        if (parsed?.appDbInfo?.fragPct && parsed.appDbInfo.fragPct > 20) warns++;
        warns += FW_CHECKS_CFG.filter(c => fwStatuses[c.key] === 'error').length;
        onWarningsChange(warns);
    }, [parsed, fwStatuses, onWarningsChange]);

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

            {/* ── Raw File Modal ────────────────────────────────────────────── */}
            {openRawModal && (
                <RawFileModal
                    rawFiles={rawFiles}
                    rawTab={rawTab ?? 'fail2ban.conf'}
                    onTabChange={setRawTab}
                    onClose={() => setOpenRawModal(false)}
                    onSaved={(filename, content) => setRawFiles(prev => prev ? { ...prev, [filename]: content } : prev)}
                />
            )}

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
                            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                                <button onClick={runChecks} disabled={checkLoading}
                                    style={{ padding: '.2rem .5rem', borderRadius: 4, background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, cursor: 'pointer', fontSize: '.72rem', display: 'inline-flex', alignItems: 'center', gap: '.25rem', opacity: checkLoading ? .5 : 1 }}>
                                    <RefreshCw style={{ width: 10, height: 10 }} /> Relancer
                                </button>
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
                                {/* Setup script hint when socket or dropin has errors */}
                                {(['socket', 'dropin', 'sqlite'] as const).some(k => checkResult.checks[k as keyof typeof checkResult.checks] && !checkResult.checks[k as keyof typeof checkResult.checks].ok) && (
                                    <div style={{ borderRadius: 6, border: '1px solid rgba(88,166,255,.25)', background: 'rgba(88,166,255,.05)', overflow: 'hidden' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.5rem .75rem', background: 'rgba(88,166,255,.08)', borderBottom: '1px solid rgba(88,166,255,.2)' }}>
                                            <Terminal style={{ width: 12, height: 12, color: C.blue, flexShrink: 0 }} />
                                            <span style={{ fontWeight: 600, fontSize: '.82rem', color: C.blue }}>Setup automatique (recommandé)</span>
                                            <span style={{ marginLeft: 'auto', fontSize: '.7rem', color: C.muted }}>à lancer sur le host</span>
                                        </div>
                                        <div style={{ padding: '.6rem .75rem' }}>
                                            <pre style={{ margin: 0, fontSize: '.75rem', fontFamily: 'monospace', color: C.cyan, lineHeight: 1.55, whiteSpace: 'pre-wrap', background: C.bg3, borderRadius: 5, padding: '.5rem .7rem', border: `1px solid ${C.border}` }}>
                                                {'sudo bash <(curl -fsSL https://raw.githubusercontent.com/Erreur32/LogviewR/main/scripts/setup-fail2ban-access.sh)'}
                                            </pre>
                                            <p style={{ margin: '.5rem 0 0', fontSize: '.72rem', color: C.muted, lineHeight: 1.5 }}>
                                                Crée le groupe fail2ban, installe le drop-in systemd (socket 660, SQLite 644) et détecte automatiquement le GID au démarrage du container.
                                            </p>
                                        </div>
                                    </div>
                                )}
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
                            <div style={{ ...card, borderColor: (dbInfo && (dbInfo.integrity !== 'ok' || dbInfo.fragPct > 20)) ? 'rgba(227,179,65,.4)' : C.border }}>
                                <div style={{ ...cardH }}>
                                    <Database style={{ width: 14, height: 14, color: C.purple }} />
                                    <span style={{ fontWeight: 600, fontSize: '.9rem' }}>SQLite fail2ban (officielle)</span>
                                    {dbInfo && (dbInfo.integrity !== 'ok' || dbInfo.fragPct > 20) && (
                                        <WarnBadge count={[dbInfo.integrity !== 'ok', dbInfo.fragPct > 20].filter(Boolean).length}
                                            tip={[dbInfo.integrity !== 'ok' ? `Intégrité : ${dbInfo.integrity}` : '', dbInfo.fragPct > 20 ? `Fragmentation élevée : ${dbInfo.fragPct}%` : ''].filter(Boolean).join(' · ')} />
                                    )}
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
                                    <div onClick={() => setOpenRuntime(o => !o)} style={{ ...cardH, cursor: 'pointer', userSelect: 'none' }}>
                                        <Play style={{ width: 14, height: 14, color: C.blue }} />
                                        <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Runtime</span>
                                        <span style={{ marginLeft: 'auto', fontSize: '.67rem', color: C.muted }}>sans redémarrage</span>
                                        {openRuntime ? <ChevronDown style={{ width: 13, height: 13, color: C.muted, marginLeft: '.35rem' }} /> : <ChevronRight style={{ width: 13, height: 13, color: C.muted, marginLeft: '.35rem' }} />}
                                    </div>
                                    {openRuntime && <div style={{ ...cardB, display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
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
                                    </div>}
                                </div>

                                {/* Base de données & Rétention */}
                                <div style={card}>
                                    <div onClick={() => setOpenDb(o => !o)} style={{ ...cardH, cursor: 'pointer', userSelect: 'none' }}>
                                        <Database style={{ width: 14, height: 14, color: C.purple }} />
                                        <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Base de données</span>
                                        <span style={{ marginLeft: 'auto', fontSize: '.67rem', color: C.muted }}>fail2ban.local</span>
                                        {openDb ? <ChevronDown style={{ width: 13, height: 13, color: C.muted, marginLeft: '.35rem' }} /> : <ChevronRight style={{ width: 13, height: 13, color: C.muted, marginLeft: '.35rem' }} />}
                                    </div>
                                    {openDb && <div style={{ ...cardB, display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
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
                                    </div>}
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
                        <div style={{ ...cardH }}>
                            <FileText style={{ width: 14, height: 14, color: C.blue }} />
                            <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Fichiers de configuration</span>
                            <span style={{ marginLeft: 'auto' }}>
                                <button onClick={() => { setRawTab(t => t ?? 'fail2ban.conf'); setOpenRawModal(true); }} style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '.3rem',
                                    padding: '.2rem .55rem', borderRadius: 5, cursor: 'pointer',
                                    background: 'rgba(88,166,255,.12)', color: C.blue,
                                    border: '1px solid rgba(88,166,255,.35)', fontSize: '.73rem',
                                }}>
                                    <Pencil style={{ width: 11, height: 11 }} /> Éditer
                                </button>
                            </span>
                        </div>
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
                    <div style={{ ...card, borderColor: (parsed?.appDbInfo?.fragPct ?? 0) > 20 ? 'rgba(227,179,65,.4)' : C.border }}>
                        <div style={{ ...cardH }}>
                            <HardDrive style={{ width: 14, height: 14, color: C.cyan }} />
                            <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Base de données interne (dashboard.db)</span>
                            {(parsed?.appDbInfo?.fragPct ?? 0) > 20 && (
                                <WarnBadge count={1} tip={`Fragmentation élevée : ${parsed!.appDbInfo.fragPct}% — VACUUM recommandé`} />
                            )}
                        </div>
                        <div style={{ ...cardB }}>
                            {parsed?.appDbInfo ? (
                                <div>
                                    <Row label="Chemin" value="data/dashboard.db" />
                                    <Row label="Taille" value={parsed.appDbInfo.sizeFmt} />
                                    <Row label="Fragmentation" value={
                                        <span style={{ color: parsed.appDbInfo.fragPct > 20 ? C.orange : C.green, fontWeight: 600 }}>
                                            {parsed.appDbInfo.fragPct}%
                                        </span>
                                    } />
                                    <Row label="État" value={<StatusBadge ok={parsed.appDbInfo.exists} label={parsed.appDbInfo.exists ? 'Accessible' : 'Non trouvé'} />} />
                                    {parsed.appDbInfo.fragPct > 20 && (
                                        <DashboardVacuumAlert fragPct={parsed.appDbInfo.fragPct} onDone={() => { void loadParsed(); }} />
                                    )}
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

                    {/* Card: Pare-feu — Netfilter */}
                    {(() => {
                        const fwErrCount = FW_CHECKS_CFG.filter(c => fwStatuses[c.key] === 'error').length;
                        const fwOkAll    = FW_CHECKS_CFG.every(c => fwStatuses[c.key] === 'ok');
                        return (
                    <div style={{ ...card, borderColor: fwErrCount > 0 ? 'rgba(227,179,65,.4)' : C.border }}>
                        <div style={{ ...cardH, background: fwErrCount > 0 ? 'rgba(227,179,65,.04)' : undefined }}>
                            <Layers style={{ width: 14, height: 14, color: fwErrCount > 0 ? C.orange : C.cyan }} />
                            <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Pare-feu — Netfilter <span style={{ fontWeight: 400, color: C.orange, fontSize: '.72rem' }}>(optionnel)</span></span>
                            {fwErrCount > 0 && (
                                <WarnBadge count={fwErrCount}
                                    tip={FW_CHECKS_CFG.filter(c => fwStatuses[c.key] === 'error').map(c => `${c.label} inaccessible`).join(' · ') + ' — NET_ADMIN + network_mode: host requis'} />
                            )}
                            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                                <button onClick={checkFirewall} disabled={fwLoading} style={{ padding: '.2rem .5rem', borderRadius: 4, background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, cursor: 'pointer', fontSize: '.72rem', display: 'inline-flex', alignItems: 'center', gap: '.25rem', opacity: fwLoading ? .5 : 1 }}>
                                    <RefreshCw style={{ width: 10, height: 10, ...(fwLoading ? { animation: 'spin 1s linear infinite' } : {}) }} /> Relancer
                                </button>
                                {fwOkAll ? (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(63,185,80,.12)', color: C.green, border: '1px solid rgba(63,185,80,.3)' }}>
                                        <CheckCircle style={{ width: 10, height: 10 }} /> Tout accessible
                                    </span>
                                ) : fwErrCount > 0 ? (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(227,179,65,.12)', color: C.orange, border: '1px solid rgba(227,179,65,.3)' }}>
                                        <AlertTriangle style={{ width: 10, height: 10 }} /> {fwErrCount} inaccessible{fwErrCount > 1 ? 's' : ''}
                                    </span>
                                ) : null}
                            </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                            {FW_CHECKS_CFG.map((c, i) => {
                                const st  = fwStatuses[c.key] ?? 'idle';
                                const err = fwErrors[c.key] ?? '';
                                return (
                                    <div key={c.key} style={{ borderBottom: i < FW_CHECKS_CFG.length - 1 ? `1px solid ${C.border}` : undefined }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.5rem 1rem' }}>
                                            <span style={{ color: c.color }}>{c.icon}</span>
                                            <span style={{ fontWeight: 600, fontSize: '.82rem', color: C.text, minWidth: 72 }}>{c.label}</span>
                                            <span style={{ fontSize: '.73rem', color: C.muted }}>{c.detail}</span>
                                            <span style={{ marginLeft: 'auto' }}>
                                                {st === 'loading' ? (
                                                    <RefreshCw style={{ width: 11, height: 11, color: C.muted, animation: 'spin 1s linear infinite' }} />
                                                ) : st === 'ok' ? (
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', color: C.green }}>
                                                        <CheckCircle style={{ width: 11, height: 11 }} /> Accessible
                                                    </span>
                                                ) : st === 'error' ? (
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', color: C.red }}>
                                                        <XCircle style={{ width: 11, height: 11 }} /> Non disponible
                                                    </span>
                                                ) : null}
                                            </span>
                                        </div>
                                        {st === 'error' && (
                                            <div style={{ padding: '0 1rem .6rem 2.6rem', display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
                                                {err && <div style={{ fontSize: '.72rem', color: C.orange, background: 'rgba(227,179,65,.06)', border: '1px solid rgba(227,179,65,.2)', borderRadius: 4, padding: '.3rem .6rem', fontFamily: 'monospace' }}>{err}</div>}
                                                <div style={{ fontSize: '.71rem', color: C.muted }}>{c.fix}</div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                        );
                    })()}

                    {/* Card: Intégrations — NPM */}
                    <div style={{ ...card, borderColor: npmDataPath ? 'transparent' : 'rgba(227,179,65,.4)' }}>
                        <div style={{ ...cardH, background: npmDataPath ? undefined : 'rgba(227,179,65,.06)' }}>
                            <Network style={{ width: 14, height: 14, color: npmDataPath ? C.cyan : C.orange }} />
                            <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Intégrations <span style={{ fontWeight: 400, color: C.orange, fontSize: '.72rem' }}>(optionnel)</span></span>
                            {!npmDataPath && <WarnBadge count={1} tip="Chemin données NPM non configuré — Top Domaines inactif" />}
                            <span style={{ marginLeft: 'auto', fontSize: '.65rem', background: 'rgba(57,197,207,.08)', color: C.cyan, border: `1px solid ${C.cyan}40`, borderRadius: 4, padding: '.08rem .4rem' }}>Nginx Proxy Manager</span>
                        </div>
                        <div style={{ ...cardB }}>
                            {/* Warning banner when not configured */}
                            {!npmDataPath && (
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.5rem', padding: '.5rem .7rem', borderRadius: 6, background: 'rgba(227,179,65,.08)', border: '1px solid rgba(227,179,65,.3)', marginBottom: '.75rem' }}>
                                    <AlertTriangle style={{ width: 14, height: 14, color: C.orange, flexShrink: 0, marginTop: 1 }} />
                                    <span style={{ fontSize: '.78rem', color: C.orange, lineHeight: 1.5 }}>
                                        Chemin NPM non configuré — les <strong>Top Domaines</strong> (onglet Stats) ne fonctionneront pas.
                                    </span>
                                </div>
                            )}
                            <p style={{ fontSize: '.8rem', color: C.muted, lineHeight: 1.6, marginBottom: '.75rem' }}>
                                Les <strong style={{ color: C.text }}>Top Domaines</strong> fonctionnent uniquement avec <strong style={{ color: C.cyan }}>Nginx Proxy Manager</strong>.
                                LogviewR lit le fichier <code style={{ fontFamily: 'monospace', fontSize: '.78rem', color: C.orange }}>database.sqlite</code> de NPM
                                pour résoudre les <code style={{ fontFamily: 'monospace', fontSize: '.78rem' }}>proxy-host-N</code> en noms de domaine.
                            </p>
                            <div style={{ fontSize: '.78rem', color: C.muted, marginBottom: '.35rem', fontWeight: 600 }}>
                                Chemin du répertoire données NPM{' '}
                                <span style={{ fontWeight: 400, color: C.orange, fontSize: '.72rem' }}>(optionnel)</span>
                                {' '}<span style={{ fontWeight: 400, color: C.muted }}>(dossier contenant <code style={{ fontFamily: 'monospace' }}>database.sqlite</code>)</span>
                            </div>
                            <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                                <input
                                    value={npmInput}
                                    onChange={e => { setNpmInput(e.target.value); setNpmCheck(null); }}
                                    placeholder="/data  ou  /opt/npm/data"
                                    style={{ flex: 1, background: C.bg3, border: `1px solid ${npmDataPath ? C.border : 'rgba(227,179,65,.4)'}`, borderRadius: 5, color: C.text, fontFamily: 'monospace', fontSize: '.8rem', padding: '.35rem .6rem', outline: 'none' }}
                                />
                                <button onClick={saveNpmSettings} disabled={npmSaving}
                                    style={{ padding: '.3rem .7rem', borderRadius: 5, background: 'rgba(57,197,207,.12)', border: `1px solid ${C.cyan}50`, color: C.cyan, cursor: 'pointer', fontSize: '.78rem', display: 'flex', alignItems: 'center', gap: '.3rem', opacity: npmSaving ? .5 : 1, whiteSpace: 'nowrap' }}>
                                    <Save style={{ width: 11, height: 11 }} /> {npmSaving ? 'Sauvegarde…' : 'Enregistrer'}
                                </button>
                                <button onClick={checkNpm} disabled={npmChecking || !npmDataPath}
                                    style={{ padding: '.3rem .7rem', borderRadius: 5, background: 'rgba(63,185,80,.1)', border: `1px solid rgba(63,185,80,.35)`, color: C.green, cursor: npmDataPath ? 'pointer' : 'not-allowed', fontSize: '.78rem', display: 'flex', alignItems: 'center', gap: '.3rem', opacity: (npmChecking || !npmDataPath) ? .5 : 1, whiteSpace: 'nowrap' }}>
                                    <Stethoscope style={{ width: 11, height: 11 }} /> {npmChecking ? 'Test…' : 'Tester'}
                                </button>
                            </div>
                            {npmSaved && (
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', marginTop: '.4rem', fontSize: '.78rem', color: C.green, background: 'rgba(63,185,80,.1)', border: '1px solid rgba(63,185,80,.3)', borderRadius: 5, padding: '.25rem .6rem' }}>
                                    <CheckCircle style={{ width: 12, height: 12 }} /> Chemin NPM enregistré
                                </div>
                            )}
                            <div style={{ fontSize: '.72rem', color: C.muted, marginTop: '.4rem', lineHeight: 1.5 }}>
                                Exemple Docker : <code style={{ fontFamily: 'monospace', color: C.orange }}>/host/data</code> si NPM monte ses données dans <code style={{ fontFamily: 'monospace' }}>/data</code>.
                                Laissez vide pour détection automatique via les logpaths fail2ban.
                            </div>
                            {npmCheck && (
                                <div style={{ marginTop: '.6rem', padding: '.5rem .75rem', borderRadius: 6, background: npmCheck.ok ? 'rgba(63,185,80,.07)' : 'rgba(232,106,101,.07)', border: `1px solid ${npmCheck.ok ? 'rgba(63,185,80,.3)' : 'rgba(232,106,101,.3)'}`, fontSize: '.78rem', display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontWeight: 600, color: npmCheck.ok ? C.green : C.red }}>
                                        {npmCheck.ok
                                            ? <><CheckCircle style={{ width: 13, height: 13 }} /> DB NPM accessible — {npmCheck.domains} domaine{npmCheck.domains > 1 ? 's' : ''} trouvé{npmCheck.domains > 1 ? 's' : ''}</>
                                            : <><XCircle style={{ width: 13, height: 13 }} /> Échec ({npmCheck.step})</>}
                                    </div>
                                    {npmCheck.error && <div style={{ color: C.orange, fontFamily: 'monospace', fontSize: '.73rem' }}>{npmCheck.error}</div>}
                                    {npmCheck.resolvedPath && <div style={{ color: C.muted, fontFamily: 'monospace', fontSize: '.7rem' }}>→ {npmCheck.resolvedPath}</div>}
                                    {npmCheck.ok && <div style={{ color: C.muted, fontSize: '.73rem' }}>{npmCheck.jailMatches} jail{npmCheck.jailMatches > 1 ? 's' : ''} résolu{npmCheck.jailMatches > 1 ? 's' : ''} en cache (f2b_jail_domain)</div>}
                                    {npmCheck.ok && npmCheck.jailMatches === 0 && (
                                        <>
                                            <div style={{ color: C.orange, fontSize: '.73rem', marginTop: '.15rem' }}>⚠ Aucun jail résolu — logpaths fail2ban sans pattern <code style={{ fontFamily: 'monospace' }}>proxy-host-N</code></div>
                                            {npmCheck.jailLogpaths && Object.keys(npmCheck.jailLogpaths).length > 0 ? (
                                                <div style={{ marginTop: '.4rem' }}>
                                                    <div style={{ fontSize: '.7rem', color: C.muted, marginBottom: '.2rem', fontWeight: 600 }}>Logpaths détectés ({Object.keys(npmCheck.jailLogpaths).length} jails) :</div>
                                                    <div style={{ maxHeight: 120, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '.15rem' }}>
                                                        {Object.entries(npmCheck.jailLogpaths).map(([jail, lp]) => (
                                                            <div key={jail} style={{ fontSize: '.68rem', fontFamily: 'monospace', color: C.muted, display: 'flex', gap: '.5rem' }}>
                                                                <span style={{ color: C.blue, flexShrink: 0 }}>{jail}</span>
                                                                <span style={{ color: /proxy-host/i.test(lp) ? C.green : C.muted }}>{lp}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ) : (
                                                <div style={{ fontSize: '.7rem', color: C.red, marginTop: '.2rem' }}>Aucun logpath trouvé dans /etc/fail2ban — configs non accessibles ?</div>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Card: Maintenance */}
                    <div style={{ ...card, borderColor: 'rgba(255,85,85,.35)' }}>
                        <div onClick={() => setOpenMaint(o => !o)} style={{ ...cardH, background: 'rgba(255,85,85,.06)', cursor: 'pointer', userSelect: 'none' }}>
                            <Trash2 style={{ width: 14, height: 14, color: C.red }} />
                            <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Maintenance &amp; base de données</span>
                            {openMaint
                                ? <ChevronDown  style={{ width: 13, height: 13, color: C.muted, marginLeft: 'auto' }} />
                                : <ChevronRight style={{ width: 13, height: 13, color: C.muted, marginLeft: 'auto' }} />}
                        </div>
                        {openMaint && (
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
                        )}
                    </div>


                </div>
            </div>

            </div>{/* /grid */}
        </div>
    );
};
