import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
    Settings, Database, RefreshCw, Save, Play,
    Info, Shield, FileText, AlertTriangle, CheckCircle, XCircle,
    ChevronRight, ChevronDown, HardDrive, Stethoscope, Trash2, Copy, Terminal,
    Pencil, X, Layers, Network,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { card, cardH, cardB, F2bTooltip, TT } from './helpers';
import { Fail2banPathConfig } from './Fail2banPathConfig';
import { useNotificationStore } from '../../stores/notificationStore';

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

interface RawMtimes {
    'fail2ban.conf': number | null;
    'fail2ban.local': number | null;
    'jail.conf': number | null;
    'jail.local': number | null;
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
    badge?: React.ReactNode;
    collapsible?: boolean;
    open?: boolean;
    onToggle?: () => void;
}> = ({ color, bg, icon, title, sub, badge, collapsible, open, onToggle }) => (
    <div onClick={collapsible ? onToggle : undefined} style={{
        background: bg, border: `1px solid ${C.border}`,
        borderBottom: collapsible && !open ? `1px solid ${C.border}` : 'none',
        borderRadius: collapsible && !open ? 8 : '8px 8px 0 0',
        padding: '.75rem 1rem', display: 'flex', alignItems: 'center', gap: '.75rem',
        cursor: collapsible ? 'pointer' : undefined,
    }}>
        <span style={{ color, fontSize: '1.1rem' }}>{icon}</span>
        <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '.95rem', color: C.text, display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                {title}
                {badge}
            </div>
            <div style={{ fontSize: '.75rem', color: C.muted, marginTop: 1 }}>{sub}</div>
        </div>
        {collapsible && (
            open
                ? <ChevronDown style={{ width: 14, height: 14, color: C.muted, flexShrink: 0 }} />
                : <ChevronRight style={{ width: 14, height: 14, color: C.muted, flexShrink: 0 }} />
        )}
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
    // continuation line (indented value — no = sign, not a section, not a comment)
    if (indent && trimmed && !trimmed.startsWith('[')) return [...pre, { t: 'value', v: trimmed }];
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
    rawMtimes?: RawMtimes | null;
    rawTab: string;
    onTabChange: (t: string) => void;
    height?: number | string;
    onSaved?: (filename: string, content: string) => void;
}> = ({ rawFiles, rawMtimes, rawTab, onTabChange, height = 480, onSaved }) => {
    const { t } = useTranslation();
    const [copied, setCopied]       = useState(false);
    const [editMode, setEditMode]   = useState(false);
    const [editContent, setEditContent] = useState('');
    const [testing, setTesting]     = useState(false);
    const [testResult, setTestResult] = useState<TestResult | null>(null);
    const [saving, setSaving]       = useState(false);
    const [saveResult, setSaveResult] = useState<SaveResult | null>(null);

    const FILES = ['fail2ban.local', 'jail.local', 'fail2ban.conf', 'jail.conf'] as const;
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
        else setTestResult({ ok: false, errors: [res.error?.message ?? t('fail2ban.errors.connectionError')], warnings: [] });
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
            setSaveResult({ ok: false, reloadOk: false, reloadOutput: '', error: res.error?.message ?? t('fail2ban.errors.connectionError') });
        }
    };

    const lineCount = (editMode ? editContent : (content ?? '')).split('\n').length;

    const rootStyle: React.CSSProperties = height === '100%'
        ? { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }
        : { display: 'flex', flexDirection: 'column', height, overflow: 'hidden' };

    return (
        <div style={rootStyle}>
            {/* Test/Save result banner */}
            {(testResult || saveResult) && (
                <div style={{
                    padding: '.5rem .85rem', flexShrink: 0, fontSize: '.75rem', display: 'flex', flexDirection: 'column', gap: '.25rem',
                    background: (testResult?.ok || saveResult?.ok) ? 'rgba(63,185,80,.07)' : 'rgba(232,106,101,.07)',
                    borderBottom: `1px solid ${(testResult?.ok || saveResult?.ok) ? 'rgba(63,185,80,.25)' : 'rgba(232,106,101,.25)'}`,
                    maxHeight: 180, overflowY: 'auto',
                }}>
                    {/* Errors */}
                    {testResult && testResult.errors.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '.18rem' }}>
                            <div style={{ fontSize: '.67rem', fontWeight: 700, color: '#e86a65', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.1rem' }}>
                                {testResult.errors.length} erreur{testResult.errors.length > 1 ? 's' : ''}
                            </div>
                            {testResult.errors.map((e, i) => (
                                <div key={i} style={{ color: '#e86a65', display: 'flex', alignItems: 'flex-start', gap: '.4rem', fontFamily: 'monospace', fontSize: '.73rem' }}>
                                    <XCircle style={{ width: 12, height: 12, flexShrink: 0, marginTop: 1 }} />{e}
                                </div>
                            ))}
                        </div>
                    )}
                    {/* Warnings */}
                    {testResult && testResult.warnings.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '.18rem' }}>
                            <div style={{ fontSize: '.67rem', fontWeight: 700, color: '#e3b341', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.1rem' }}>
                                {testResult.warnings.length} avertissement{testResult.warnings.length > 1 ? 's' : ''}
                            </div>
                            {testResult.warnings.map((w, i) => (
                                <div key={i} style={{ color: '#e3b341', display: 'flex', alignItems: 'flex-start', gap: '.4rem', fontFamily: 'monospace', fontSize: '.73rem' }}>
                                    <AlertTriangle style={{ width: 12, height: 12, flexShrink: 0, marginTop: 1 }} />{w}
                                </div>
                            ))}
                        </div>
                    )}
                    {/* Test OK */}
                    {testResult?.ok && testResult.errors.length === 0 && (
                        <div style={{ color: '#3fb950', display: 'flex', alignItems: 'center', gap: '.4rem', fontWeight: 600 }}>
                            <CheckCircle style={{ width: 12, height: 12 }} />
                            Syntaxe valide{testResult.warnings.length > 0 ? ` (${testResult.warnings.length} avertissement${testResult.warnings.length > 1 ? 's' : ''})` : ' — aucun problème détecté'} — prêt à sauvegarder
                        </div>
                    )}
                    {/* Save result */}
                    {saveResult?.ok && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontWeight: 600 }}>
                                <CheckCircle style={{ width: 12, height: 12, color: '#3fb950' }} />
                                <span style={{ color: '#3fb950' }}>Fichier sauvegardé</span>
                                {saveResult.reloadOk
                                    ? <span style={{ color: '#3fb950', fontWeight: 400 }}>· fail2ban rechargé avec succès</span>
                                    : saveResult.reloadOutput?.startsWith('Socket non disponible')
                                        ? <span style={{ color: '#e3b341', fontWeight: 400 }}>· rechargement non disponible (socket absent)</span>
                                        : <span style={{ color: '#e86a65', fontWeight: 400 }}>· rechargement échoué</span>}
                            </div>
                            {saveResult.reloadOutput && !saveResult.reloadOutput.startsWith('Socket non disponible') && (
                                <div style={{ fontFamily: 'monospace', fontSize: '.7rem', color: '#e86a65', paddingLeft: '1.2rem', whiteSpace: 'pre-wrap', background: 'rgba(232,106,101,.06)', border: '1px solid rgba(232,106,101,.2)', borderRadius: 4, padding: '.4rem .6rem' }}>{saveResult.reloadOutput}</div>
                            )}
                        </div>
                    )}
                    {saveResult && !saveResult.ok && (
                        <div style={{ color: '#e86a65', display: 'flex', alignItems: 'center', gap: '.4rem', fontWeight: 600 }}>
                            <XCircle style={{ width: 12, height: 12 }} /> Échec de la sauvegarde : {saveResult.error ?? 'erreur inconnue'}
                        </div>
                    )}
                </div>
            )}

            <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                {/* Sidebar */}
                <div style={{ width: 210, flexShrink: 0, borderRight: `1px solid #30363d`, display: 'flex', flexDirection: 'column', background: '#161b22' }}>
                    <div style={{ padding: '.45rem .75rem', fontSize: '.65rem', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: '1px solid #30363d' }}>
                        /etc/fail2ban/
                    </div>
                    {FILES.map(f => {
                        const absent = rawFiles && rawFiles[f] === null;
                        const active = rawTab === f;
                        const canEdit = EDITABLE.has(f);
                        const mtime = rawMtimes?.[f as keyof RawMtimes];
                        const lineCount = rawFiles?.[f as keyof RawFiles]?.split('\n').length ?? null;
                        const dateStr = mtime
                            ? new Date(mtime * 1000).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
                            : null;
                        return (
                            <button key={f} onClick={() => switchTab(f)} style={{
                                textAlign: 'left', padding: '.4rem .75rem', fontSize: '.78rem',
                                fontFamily: 'monospace', background: active ? 'rgba(88,166,255,.12)' : 'transparent',
                                color: active ? '#58a6ff' : absent ? '#555d69' : '#e6edf3',
                                border: 'none', borderLeft: active ? '2px solid #58a6ff' : '2px solid transparent',
                                cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '.15rem', alignItems: 'flex-start',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', width: '100%' }}>
                                    <FileText style={{ width: 11, height: 11, flexShrink: 0 }} />
                                    <span style={{ flex: 1 }}>{f}</span>
                                    {absent && <span style={{ fontSize: '.55rem', color: '#555d69' }}>∅</span>}
                                    {canEdit && !absent && <Pencil style={{ width: 13, height: 13, color: active ? '#e3b341' : '#555d69' }} />}
                                </div>
                                {!absent && (dateStr || lineCount !== null) && (
                                    <div style={{ paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '.05rem' }}>
                                        {dateStr && <span style={{ fontSize: '.6rem', color: active ? '#e3b341' : 'rgba(227,179,65,.5)', fontFamily: 'sans-serif' }}>{dateStr}</span>}
                                        {lineCount !== null && <span style={{ fontSize: '.6rem', color: active ? 'rgba(88,166,255,.5)' : '#444c56', fontFamily: 'sans-serif' }}>{lineCount} lignes</span>}
                                    </div>
                                )}
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
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, background: '#0d1117' }}>
                    {/* Toolbar */}
                    <div style={{ display: 'flex', alignItems: 'center', padding: '.3rem .75rem', background: '#161b22', borderBottom: '1px solid #30363d', gap: '.5rem', flexShrink: 0 }}>
                        <span style={{ fontFamily: 'monospace', fontSize: '.72rem', color: '#58a6ff', flex: 1 }}>
                            /etc/fail2ban/{rawTab}
                            {isDirty && <span style={{ color: '#e3b341', marginLeft: '.4rem' }}>●</span>}
                        </span>
                        {content && !editMode && <span style={{ fontSize: '.68rem', color: '#58a6ff', fontWeight: 600 }}>{lineCount} <span style={{ color: '#555d69', fontWeight: 400 }}>lignes</span></span>}
                        {editMode && <span style={{ fontSize: '.68rem', color: '#e3b341', fontWeight: 600 }}>{lineCount} <span style={{ fontWeight: 400 }}>lignes · édition</span></span>}
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
                    <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                        {editMode ? (
                            <div style={{ display: 'flex', minHeight: '100%' }}>
                                {/* Line numbers */}
                                <div style={{ padding: '.75rem .5rem', textAlign: 'right', userSelect: 'none', borderRight: '1px solid #21262d', flexShrink: 0, minWidth: 40, background: '#161b22', pointerEvents: 'none' }}>
                                    {editContent.split('\n').map((_, i) => (
                                        <div key={i} style={{ fontSize: '.72rem', lineHeight: 1.65, color: '#30363d', fontFamily: 'monospace' }}>{i + 1}</div>
                                    ))}
                                </div>
                                <textarea
                                    value={editContent}
                                    onChange={e => { setEditContent(e.target.value); setTestResult(null); setSaveResult(null); }}
                                    spellCheck={false}
                                    style={{
                                        flex: 1, resize: 'none', border: 'none', outline: 'none',
                                        background: '#161b22', color: '#e6edf3', fontFamily: 'monospace', fontSize: '.75rem',
                                        lineHeight: 1.65, padding: '.75rem 1rem', boxSizing: 'border-box',
                                        borderLeft: '3px solid rgba(227,179,65,.4)',
                                        boxShadow: 'inset 0 2px 4px rgba(0,0,0,.55), inset 0 1px 0 rgba(0,0,0,.4)',
                                        overflow: 'hidden',
                                    }}
                                />
                            </div>
                        ) : content ? (
                            <div style={{ display: 'flex' }}>
                                {/* Line numbers */}
                                <div style={{ padding: '.75rem .5rem', textAlign: 'right', userSelect: 'none', borderRight: '1px solid #21262d', flexShrink: 0, minWidth: 40 }}>
                                    {content.split('\n').map((_, i) => (
                                        <div key={i} style={{ fontSize: '.72rem', lineHeight: 1.65, color: '#30363d', fontFamily: 'monospace' }}>{i + 1}</div>
                                    ))}
                                </div>
                                <pre style={{ flex: 1, padding: '.75rem 1rem', margin: 0, overflow: 'hidden', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                    <ConfHighlighter content={content} />
                                </pre>
                            </div>
                        ) : (
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '.6rem', color: '#555d69', fontSize: '.8rem' }}>
                                {rawFiles ? (
                                    isEditable ? (
                                        <span style={{ fontStyle: 'italic' }}>Ce fichier n'existe pas — cliquez <strong style={{ color: '#58a6ff' }}>Éditer</strong> pour le créer</span>
                                    ) : (
                                        <span style={{ fontStyle: 'italic' }}>Ce fichier n'existe pas sur ce système</span>
                                    )
                                ) : t('fail2ban.messages.loadingData')}
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
    const { t } = useTranslation();
    const [state, setState] = useState<'idle' | 'running' | 'done' | 'error' | 'docker'>('idle');
    const [errMsg, setErrMsg] = useState('');
    const cmd = `sqlite3 ${dbPath} 'VACUUM'`;
    const run = async () => {
        setState('running');
        try {
            const res = await api.post<{ ok: boolean; error?: string; dockerReadOnly?: boolean }>('/api/plugins/fail2ban/config/sqlite-vacuum');
            if (res.success && res.result?.ok) { setState('done'); onDone(); }
            else if (res.success && res.result?.dockerReadOnly) {
                setState('docker');
            } else {
                const httpMsg = res.error?.message ?? '';
                const is404 = httpMsg.includes('404') || res.error?.code === 'INVALID_RESPONSE';
                const isAuth = httpMsg.includes('401') || httpMsg.includes('403');
                setErrMsg(
                    is404  ? 'Route introuvable (404) — redémarrez le serveur pour activer cette fonctionnalité' :
                    isAuth ? t('fail2ban.errors.permissionDenied') :
                    res.result?.error ?? (httpMsg || t('fail2ban.errors.unknown'))
                );
                setState('error');
            }
        } catch (e: unknown) {
            setState('error');
            setErrMsg(e instanceof Error ? e.message : t('fail2ban.errors.connectionError'));
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
                    {state !== 'done' && state !== 'docker' && (
                        <Btn onClick={run} loading={state === 'running'} small
                            bg="rgba(227,179,65,.15)" color={C.orange} border="rgba(227,179,65,.4)">
                            <HardDrive style={{ width: 11, height: 11 }} />
                            {state === 'running' ? 'VACUUM en cours…' : 'Lancer VACUUM'}
                        </Btn>
                    )}
                </div>
                {state === 'docker' && (
                    <div style={{ marginTop: '.5rem', padding: '.5rem .65rem', background: 'rgba(88,166,255,.07)', border: '1px solid rgba(88,166,255,.2)', borderRadius: 5, color: '#58a6ff', fontSize: '.72rem', lineHeight: 1.6 }}>
                        <strong>Docker : montage en lecture seule</strong> — le fichier <code style={{ color: '#e3b341' }}>fail2ban.sqlite3</code> est sur <code>/host</code> monté en <code>:ro</code>.<br />
                        Ajoutez ce volume dans votre <code>docker-compose.yml</code> pour activer le VACUUM :<br />
                        <code style={{ color: '#3fb950', display: 'block', marginTop: '.3rem' }}>- /var/lib/fail2ban:/host/var/lib/fail2ban</code>
                        En attendant, lancez manuellement sur l'hôte :
                    </div>
                )}
                <ShellCommand cmd={cmd} />
            </div>
        </div>
    );
};

// ── VacuumAlert for dashboard.db ──────────────────────────────────────────────

const DashboardVacuumAlert: React.FC<{ fragPct: number; onDone: () => void }> = ({ fragPct, onDone }) => {
    const { t } = useTranslation();
    const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
    const [errMsg, setErrMsg] = useState('');
    const run = async () => {
        setState('running');
        try {
            const res = await api.post<{ ok: boolean; error?: string }>('/api/plugins/fail2ban/config/dashboard-vacuum');
            if (res.success && res.result?.ok) { setState('done'); onDone(); }
            else {
                setErrMsg(res.result?.error ?? res.error?.message ?? t('fail2ban.errors.unknown'));
                setState('error');
            }
        } catch (e: unknown) {
            setState('error');
            setErrMsg(e instanceof Error ? e.message : t('fail2ban.errors.connectionError'));
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

// ── Unified header badge (pill) ────────────────────────────────────────────────
// Used in all card headers for consistent appearance.
// color, bg, border are CSS color strings; icon is optional.
const HBadge: React.FC<{ color: string; bg: string; border: string; icon?: React.ReactNode; children: React.ReactNode; title?: string }> = ({ color, bg, border, icon, children, title }) => (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '.72rem', padding: '2px 8px', borderRadius: 4, background: bg, border: `1px solid ${border}`, color, whiteSpace: 'nowrap' }}>
        {icon}{children}
    </span>
);

// ── Raw File Modal ─────────────────────────────────────────────────────────────

const RawFileModal: React.FC<{
    rawFiles: RawFiles | null;
    rawMtimes?: RawMtimes | null;
    rawTab: string;
    onTabChange: (t: string) => void;
    onClose: () => void;
    onSaved: (filename: string, content: string) => void;
}> = ({ rawFiles, rawMtimes, rawTab, onTabChange, onClose, onSaved }) => createPortal(
    <div
        style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
        <div style={{ background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 10, width: '100%', maxWidth: 1300, minHeight: '60vh', boxShadow: '0 20px 60px rgba(0,0,0,.6)', display: 'flex', flexDirection: 'column', maxHeight: '95vh' }}>
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
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', borderRadius: '0 0 10px 10px' }}>
                <RawFileViewer rawFiles={rawFiles} rawMtimes={rawMtimes} rawTab={rawTab} onTabChange={onTabChange} height="100%" onSaved={onSaved} />
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
    const { t } = useTranslation();
    const [parsed, setParsed]       = useState<ParsedConfigResult | null>(null);
    const [rawFiles, setRawFiles]   = useState<RawFiles | null>(null);
    const [rawMtimes, setRawMtimes] = useState<RawMtimes | null>(null);
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
    const [syncLoading, setSyncLoading] = useState(false);
    const [openSync,    setOpenSync]    = useState(false);

    const loadSyncStatus = useCallback(async () => {
        setSyncLoading(true);
        const res = await api.get<typeof syncStatus>('/api/plugins/fail2ban/sync-state');
        if (res.success && res.result) {
            setSyncStatus(res.result);
            if (res.result.synced === false) setOpenSync(true);
        }
        setSyncLoading(false);
    }, []);

    // Maintenance
    const [resetting, setResetting] = useState(false);

    // NPM MySQL config detection (badge)
    const [npmMysqlOk, setNpmMysqlOk] = useState(false);

    useEffect(() => {
        api.get<{ settings?: Record<string, unknown> }>('/api/plugins/fail2ban')
            .then(res => {
                const s = res.result?.settings ?? {};
                if (s.npmDbType === 'mysql' && s.npmMysqlHost && s.npmMysqlUser && s.npmMysqlDb) {
                    setNpmMysqlOk(true);
                }
            })
            .catch(() => {});
    }, []);

    // Form state (runtime & persist)
    const [fmLoglevel, setFmLoglevel]   = useState('');
    const [fmLogtarget, setFmLogtarget] = useState('');
    const [fmPurgeage, setFmPurgeage]   = useState('');
    const [fmMaxmatches, setFmMaxmatches] = useState('');

    // Collapsible cards
    const [openDiag,    setOpenDiag]    = useState(false); // merged: diagnostic + infos système
    const [openRuntime, setOpenRuntime] = useState(false);
    const [openDb,      setOpenDb]      = useState(false);
    const [openSqlite,  setOpenSqlite]  = useState(false);
    const [openDbTip,   setOpenDbTip]   = useState(false);
    const [openAppDb,      setOpenAppDb]      = useState(false);
    const [openInteg,      setOpenInteg]      = useState(false);
    const [openMaint,      setOpenMaint]      = useState(false);
    const [openAppSection, setOpenAppSection] = useState(true); // expanded by default

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
    const [openFw,     setOpenFw]     = useState(false);
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
        // Auto-ouvre si des erreurs détectées
        if (Object.values(st).some(s => s === 'error')) setOpenFw(true);
    }, []);

    const { addAction } = useNotificationStore();
    const [saving, setSaving] = useState<string | null>(null);

    const toast = useCallback((msg: string, ok: boolean) => {
        addAction(msg, ok);
    }, [addAction]);

    const loadParsed = useCallback(async () => {
        const res = await api.get<ParsedConfigResult>('/api/plugins/fail2ban/config/parsed');
        if (res.success && res.result) {
            setParsed(res.result);
            setFmLoglevel(res.result.cfg.loglevel ?? 'INFO');
            setFmLogtarget(res.result.cfg.logtarget ?? '');
            setFmPurgeage(res.result.cfg.dbpurgeage ?? '86400');
            setFmMaxmatches(res.result.cfg.dbmaxmatches ?? '10');
            // Auto-ouvrir SQLite si problème de fragmentation ou intégrité
            const db = res.result.dbInfo;
            if (db && (db.fragPct > 20 || db.integrity !== 'ok')) setOpenSqlite(true);
            // Auto-ouvrir dashboard.db si problème
            const appDb = res.result.appDbInfo;
            if (appDb && (!appDb.exists || appDb.fragPct > 20)) setOpenAppDb(true);
        }
        setLoading(false);
    }, []);

    const runChecks = useCallback(async () => {
        setCheckLoading(true);
        const res = await api.get<CheckResult>('/api/plugins/fail2ban/check');
        if (res.success && res.result) {
            setCheckResult(res.result);
            if (!res.result.ok) setOpenDiag(true);
        }
        setCheckLoading(false);
    }, []);

    useEffect(() => {
        loadParsed();
        runChecks();
        checkFirewall();
        void loadSyncStatus();
    }, [loadParsed, runChecks, checkFirewall, loadSyncStatus]);

    // Auto-ouvrir Intégrations si NPM non configuré (ni SQLite ni MySQL)
    useEffect(() => {
        if (!npmDataPath && !npmMysqlOk) setOpenInteg(true);
    }, [npmDataPath, npmMysqlOk]);

    // Auto-ouvrir Application section si problème détecté (DB manquante ou fragmentation élevée)
    useEffect(() => {
        if (!parsed) return;
        const hasIssue = !parsed.appDbInfo?.exists || (parsed.appDbInfo?.fragPct ?? 0) > 20;
        if (hasIssue) setOpenAppSection(true);
    }, [parsed]);

    // Notify parent whenever parsed data or firewall statuses change → drives nav badge
    useEffect(() => {
        if (!onWarningsChange) return;
        let warns = 0;
        if (parsed?.dbInfo?.fragPct   && parsed.dbInfo.fragPct   > 20) warns++;
        if (parsed?.dbInfo?.integrity && parsed.dbInfo.integrity !== 'ok') warns++;
        if (parsed?.appDbInfo?.fragPct && parsed.appDbInfo.fragPct > 20) warns++;
        if (parsed?.appDbInfo && !parsed.appDbInfo.exists) warns++;
        if (!npmDataPath && !npmMysqlOk) warns++;
        warns += FW_CHECKS_CFG.filter(c => fwStatuses[c.key] === 'error').length;
        onWarningsChange(warns);
    }, [parsed, fwStatuses, npmDataPath, onWarningsChange]);

    const loadRaw = useCallback(async () => {
        const res = await api.get<{ files: RawFiles; mtimes: RawMtimes }>('/api/plugins/fail2ban/config');
        if (res.success && res.result?.files) {
            setRawFiles(res.result.files);
            if (res.result.mtimes) setRawMtimes(res.result.mtimes);
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
            const errs = res.result?.results ? Object.values(res.result.results).filter(r => !r.ok).map(r => r.error).join(', ') : t('fail2ban.errors.unknown');
            toast(`${t('fail2ban.errors.unknown')}: ${errs}`, false);
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
            toast(`${t('fail2ban.errors.unknown')}: ${res.result?.errors?.join(', ') ?? t('fail2ban.errors.unknown')}`, false);
        }
    };

    const persistDb = async () => {
        const purgeVal = parseInt(fmPurgeage, 10);
        if (fmPurgeage !== '' && (isNaN(purgeVal) || purgeVal < 0)) {
            toast('dbpurgeage invalide — entrez un entier ≥ 0 (secondes)', false);
            return;
        }
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
            toast(`${t('fail2ban.errors.unknown')}: ${res.result?.errors?.join(', ') ?? t('fail2ban.errors.unknown')}`, false);
        }
    };

    const doReset = async () => {
        if (!window.confirm('Réinitialiser toutes les données fail2ban ?\n\nCela supprime : événements f2b_events, cache géo f2b_ip_geo, état de synchronisation.\nCette action est irréversible.')) return;
        setResetting(true);
        const res = await api.post<{ ok: boolean }>('/api/plugins/fail2ban/config/maintenance/reset', {});
        setResetting(false);
        if (res.success && res.result?.ok) {
            toast(`${t('fail2ban.backup.maintenanceReset')} ✓`, true);
            await loadParsed();
        } else {
            toast(t('fail2ban.errors.unknown'), false);
        }
    };


    const cfg = parsed?.cfg;
    const dbInfo = parsed?.dbInfo;

    const LOGLEVELS = ['CRITICAL', 'ERROR', 'WARNING', 'NOTICE', 'INFO', 'DEBUG'];

    const inp: React.CSSProperties = {
        background: '#161b22', border: `1px solid ${C.border}`, borderBottom: '1px solid #555',
        borderRadius: 4, color: C.text, padding: '.3rem .6rem', fontSize: '.82rem', width: '100%',
        fontFamily: 'monospace', outline: 'none',
        boxShadow: 'inset 0 2px 4px rgba(0,0,0,.55), inset 0 1px 0 rgba(0,0,0,.4), inset 0 -1px 0 rgba(255,255,255,.04)',
    };

    const sel: React.CSSProperties = { ...inp };

    // ── Shared column body style
    const colBody: React.CSSProperties = {
        border: `1px solid ${C.border}`, borderTop: 'none', borderRadius: '0 0 8px 8px',
        padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem', background: C.bg0,
    };

    return (
        <div style={{ paddingBottom: '2rem' }}>

            {/* ── Raw File Modal ────────────────────────────────────────────── */}
            {openRawModal && (
                <RawFileModal
                    rawFiles={rawFiles}
                    rawMtimes={rawMtimes}
                    rawTab={rawTab ?? 'jail.local'}
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

                    {/* ── Card fusionné : Diagnostic + Infos système fail2ban ── */}
                    {(() => {
                        const LABELS: Record<string, string> = {
                            socket: 'Socket Unix',
                            client: 'fail2ban-client',
                            daemon: 'Démon fail2ban',
                            sqlite: 'Base SQLite',
                            dropin: 'Drop-in systemd',
                        };
                        const diagChecks = checkResult ? (Object.entries(checkResult.checks) as [string, CheckItem][]) : [];
                        const hasErrors  = checkResult && !checkResult.ok;
                        const errCount   = diagChecks.filter(([, c]) => !c.ok).length;
                        return (
                    <div style={{ ...card, borderColor: hasErrors ? 'rgba(232,106,101,.35)' : C.border }}>
                        <div onClick={() => !checkLoading && setOpenDiag(o => !o)}
                            style={{ ...cardH, cursor: checkLoading ? 'default' : 'pointer', background: hasErrors ? 'rgba(232,106,101,.04)' : undefined }}>
                            <Stethoscope style={{ width: 14, height: 14, color: hasErrors ? C.red : C.cyan }} />
                            <span style={{ fontWeight: 600, fontSize: '.9rem' }}>
                                <span style={{ color: C.cyan, fontFamily: 'monospace' }}>fail2ban</span> — Service &amp; Système
                            </span>
                            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                                {parsed?.version && (
                                    <F2bTooltip title="Version fail2ban" color="blue" placement="bottom" width={300} bodyNode={<>
                                        {TT.section('Détection', '#58a6ff')}
                                        {TT.info('Récupérée via fail2ban-client version')}
                                        {TT.sep()}
                                        {TT.section('Utilisé pour')}
                                        {TT.info('Vérifier bantime.increment disponible')}
                                        {TT.info('Vérifier backend systemd compatible')}
                                    </>}>
                                        <HBadge color={C.blue} bg="rgba(88,166,255,.1)" border="rgba(88,166,255,.25)">v{parsed.version}</HBadge>
                                    </F2bTooltip>
                                )}
                                {checkLoading ? (
                                    <span style={{ fontSize: '.72rem', color: C.muted, display: 'flex', alignItems: 'center', gap: '.3rem' }}>
                                        <RefreshCw style={{ width: 11, height: 11, animation: 'spin 1s linear infinite' }} /> Analyse…
                                    </span>
                                ) : checkResult?.ok ? (
                                    <F2bTooltip color="green" title="Service fail2ban — OK" width={320} bodyNode={<>
                                        {TT.section('Checks effectués', '#3fb950')}
                                        {TT.ok('Daemon fail2ban actif (systemd)')}
                                        {TT.ok('Socket Unix accessible en R/W')}
                                        {TT.ok('Base SQLite lisible')}
                                        {TT.ok('Drop-in systemd en place')}
                                    </>}>
                                        <HBadge color={C.green} bg="rgba(63,185,80,.12)" border="rgba(63,185,80,.3)" icon={<CheckCircle style={{ width: 10, height: 10 }} />}>OK</HBadge>
                                    </F2bTooltip>
                                ) : checkResult ? (
                                    <F2bTooltip color="red" title="Service fail2ban — Erreur" width={340} bodyNode={<>
                                        {TT.section('Checks en échec', '#e86a65')}
                                        {TT.err('Daemon fail2ban (systemctl status fail2ban)')}
                                        {TT.err('Socket Unix /var/run/fail2ban/fail2ban.sock')}
                                        {TT.err('Droits SQLite ou drop-in systemd manquant')}
                                        {TT.sep()}
                                        {TT.info('Ouvrez ce cadre → script de correction')}
                                    </>}>
                                        <HBadge color={C.red} bg="rgba(232,106,101,.12)" border="rgba(232,106,101,.3)" icon={<AlertTriangle style={{ width: 10, height: 10 }} />}>{errCount} erreur{errCount > 1 ? 's' : ''}</HBadge>
                                    </F2bTooltip>
                                ) : null}
                                {openDiag ? <ChevronDown style={{ width: 13, height: 13, color: C.muted }} /> : <ChevronRight style={{ width: 13, height: 13, color: C.muted }} />}
                            </span>
                        </div>
                        {openDiag && (
                            <div style={{ ...cardB, display: 'flex', flexDirection: 'column', gap: '.5rem' }}>

                                {/* ── Checks service ── */}
                                {checkLoading ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.8rem', color: C.muted, padding: '.3rem 0' }}>
                                        <RefreshCw style={{ width: 12, height: 12, animation: 'spin 1s linear infinite' }} /> Analyse du service…
                                    </div>
                                ) : diagChecks.map(([key, c]) => c.ok ? (
                                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.38rem .6rem', borderRadius: 5, background: 'rgba(63,185,80,.05)', border: '1px solid rgba(63,185,80,.18)' }}>
                                        <CheckCircle style={{ width: 12, height: 12, color: C.green, flexShrink: 0 }} />
                                        <span style={{ fontSize: '.82rem', fontWeight: 600, color: C.green }}>{LABELS[key] ?? key}</span>
                                        {c.path && <code style={{ marginLeft: 'auto', fontSize: '.68rem', color: C.muted, fontFamily: 'monospace' }}>{c.path}</code>}
                                    </div>
                                ) : (
                                    <div key={key} style={{ borderRadius: 6, border: '1px solid rgba(232,106,101,.3)', background: 'rgba(232,106,101,.06)', overflow: 'hidden' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.45rem .6rem', borderBottom: c.fix ? '1px solid rgba(232,106,101,.2)' : undefined, background: 'rgba(232,106,101,.08)' }}>
                                            <XCircle style={{ width: 13, height: 13, color: C.red, flexShrink: 0 }} />
                                            <span style={{ fontWeight: 600, fontSize: '.82rem', color: C.red }}>{LABELS[key] ?? key}</span>
                                            {c.path && <code style={{ marginLeft: 'auto', fontSize: '.7rem', color: C.muted, fontFamily: 'monospace' }}>{c.path}</code>}
                                        </div>
                                        {c.fix && <div style={{ padding: '.6rem .75rem' }}>
                                            <pre style={{ margin: 0, fontSize: '.75rem', fontFamily: 'monospace', color: C.text, lineHeight: 1.55, whiteSpace: 'pre-wrap', background: C.bg3, borderRadius: 5, padding: '.5rem .7rem', border: `1px solid ${C.border}` }}>{c.fix}</pre>
                                        </div>}
                                    </div>
                                ))}

                                {/* Setup script si erreurs socket/dropin/sqlite */}
                                {checkResult && (['socket', 'dropin', 'sqlite'] as const).some(k => checkResult.checks[k as keyof typeof checkResult.checks] && !checkResult.checks[k as keyof typeof checkResult.checks].ok) && (
                                    <div style={{ borderRadius: 6, border: '1px solid rgba(88,166,255,.25)', background: 'rgba(88,166,255,.05)', overflow: 'hidden' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.45rem .75rem', background: 'rgba(88,166,255,.08)', borderBottom: '1px solid rgba(88,166,255,.2)' }}>
                                            <Terminal style={{ width: 12, height: 12, color: C.blue, flexShrink: 0 }} />
                                            <span style={{ fontWeight: 600, fontSize: '.82rem', color: C.blue }}>Setup automatique (recommandé)</span>
                                            <span style={{ marginLeft: 'auto', fontSize: '.7rem', color: C.muted }}>à lancer sur le host</span>
                                        </div>
                                        <div style={{ padding: '.6rem .75rem' }}>
                                            <pre style={{ margin: 0, fontSize: '.75rem', fontFamily: 'monospace', color: C.cyan, lineHeight: 1.55, whiteSpace: 'pre-wrap', background: C.bg3, borderRadius: 5, padding: '.5rem .7rem', border: `1px solid ${C.border}` }}>
                                                {'curl -fsSL https://raw.githubusercontent.com/Erreur32/LogviewR/main/scripts/setup-fail2ban-access.sh | sudo bash'}
                                            </pre>
                                            <p style={{ margin: '.5rem 0 0', fontSize: '.72rem', color: C.muted, lineHeight: 1.5 }}>
                                                Crée le groupe fail2ban, installe le drop-in systemd (socket 660, SQLite 644) et détecte automatiquement le GID au démarrage du container.
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {/* ── Séparateur + infos config ── */}
                                {cfg && <>
                                    <div style={{ borderTop: `1px solid ${C.border}`, margin: '.25rem 0' }} />
                                    <div style={{ fontSize: '.7rem', fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.1rem' }}>Configuration active</div>
                                    {parsed?.version && <Row label="Version" value={<span style={{ fontFamily: 'monospace', color: C.blue, fontWeight: 600 }}>v{parsed.version}</span>} />}
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
                                </>}

                            </div>
                        )}
                    </div>
                        );
                    })()}

                    {loading ? (
                        <div style={{ color: C.muted, fontSize: '.85rem', textAlign: 'center', padding: '2rem' }}>{t('fail2ban.messages.loadingData')}</div>
                    ) : cfg ? (
                        <>

                            {/* Card: SQLite fail2ban */}
                            <div style={{ ...card, borderColor: (dbInfo && (dbInfo.integrity !== 'ok' || dbInfo.fragPct > 20)) ? 'rgba(227,179,65,.4)' : C.border }}>
                                <div onClick={() => setOpenSqlite(o => !o)} style={{ ...cardH, cursor: 'pointer' }}>
                                    <Database style={{ width: 14, height: 14, color: C.purple }} />
                                    <span style={{ fontWeight: 600, fontSize: '.9rem' }}>SQLite <span style={{ fontFamily: 'monospace', color: C.cyan }}>fail2ban</span></span>
                                    {dbInfo && (dbInfo.integrity !== 'ok' || dbInfo.fragPct > 20) && (
                                        <WarnBadge count={[dbInfo.integrity !== 'ok', dbInfo.fragPct > 20].filter(Boolean).length}
                                            tip={[dbInfo.integrity !== 'ok' ? `Intégrité : ${dbInfo.integrity}` : '', dbInfo.fragPct > 20 ? `Fragmentation élevée : ${dbInfo.fragPct}%` : ''].filter(Boolean).join(' · ')} />
                                    )}
                                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                                        {dbInfo && (() => {
                                            const fc = dbInfo.fragPct > 40 ? C.red : dbInfo.fragPct > 20 ? C.orange : C.green;
                                            const bg = dbInfo.fragPct > 40 ? 'rgba(232,106,101,.12)' : dbInfo.fragPct > 20 ? 'rgba(227,179,65,.12)' : 'rgba(63,185,80,.1)';
                                            const bd = dbInfo.fragPct > 40 ? 'rgba(232,106,101,.3)' : dbInfo.fragPct > 20 ? 'rgba(227,179,65,.3)' : 'rgba(63,185,80,.25)';
                                            return (<>
                                                        <F2bTooltip color="blue" title="Taille — fail2ban.sqlite3" width={300} bodyNode={<>
                                                            {TT.section('Contenu', '#58a6ff')}
                                                            {TT.info('Historique des bans, jails et logs')}
                                                            {TT.info('Géré exclusivement par fail2ban')}
                                                            {TT.sep()}
                                                            {TT.info('VACUUM recommandé si fragmentation > 20%')}
                                                        </>}>
                                                            <HBadge color={C.blue} bg="rgba(88,166,255,.1)" border="rgba(88,166,255,.25)">{dbInfo.sizeFmt}</HBadge>
                                                        </F2bTooltip>
                                                        <F2bTooltip color={dbInfo.fragPct > 40 ? 'red' : dbInfo.fragPct > 20 ? 'orange' : 'green'} title="Fragmentation — fail2ban.sqlite3" width={320} bodyNode={<>
                                                            {TT.section('Mesure')}
                                                            {TT.info(`Pages libres / pages totales = ${dbInfo.fragPct}%`)}
                                                            {TT.sep()}
                                                            {TT.section('Niveau')}
                                                            {dbInfo.fragPct <= 20  && TT.ok('Sain — aucune action requise')}
                                                            {dbInfo.fragPct > 20 && dbInfo.fragPct <= 40 && TT.warn('Modérée — VACUUM conseillé')}
                                                            {dbInfo.fragPct > 40  && TT.err('Élevée — VACUUM fortement recommandé')}
                                                        </>}>
                                                            <HBadge color={fc} bg={bg} border={bd}>{dbInfo.fragPct}% frag.</HBadge>
                                                        </F2bTooltip>
                                            </>);
                                        })()}
                                        {openSqlite ? <ChevronDown style={{ width: 13, height: 13, color: C.muted }} /> : <ChevronRight style={{ width: 13, height: 13, color: C.muted }} />}
                                    </span>
                                </div>
                                {openSqlite && <div style={{ ...cardB }}>
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
                                </div>}
                            </div>

                            {/* Cards: Runtime + DB + Fichiers de config — même ligne */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', alignItems: 'stretch' }}>

                                {/* Paramètres runtime */}
                                <div style={{ ...card, display: 'flex', flexDirection: 'column' }}>
                                    <div onClick={() => setOpenRuntime(o => !o)} style={{ ...cardH, cursor: 'pointer', userSelect: 'none' }}>
                                        <Play style={{ width: 14, height: 14, color: C.blue }} />
                                        <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Runtime</span>
                                        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                                            <span style={{ fontSize: '.67rem', color: C.muted }}>sans redémarrage</span>
                                            {openRuntime ? <ChevronDown style={{ width: 13, height: 13, color: C.muted }} /> : <ChevronRight style={{ width: 13, height: 13, color: C.muted }} />}
                                        </span>
                                    </div>
                                    {openRuntime && <div style={{ ...cardB, display: 'flex', flexDirection: 'column', gap: '.75rem', flex: 1 }}>
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
                                        <div style={{ display: 'flex', gap: '.4rem', marginTop: 'auto' }}>
                                            <Btn onClick={applyRuntime} loading={saving === 'runtime'}
                                                bg="rgba(88,166,255,.15)" color={C.blue} border="rgba(88,166,255,.4)" small>
                                                <Play style={{ width: 11, height: 11 }} /> Appliquer en runtime
                                            </Btn>
                                            <Btn onClick={persistRuntime} loading={saving === 'persist-runtime'}
                                                bg="rgba(188,140,255,.15)" color={C.purple} border="rgba(188,140,255,.4)" small>
                                                <Save style={{ width: 11, height: 11 }} /> Appliquer + persister
                                            </Btn>
                                        </div>
                                    </div>}
                                </div>

                                {/* Base de données & Rétention */}
                                <div style={{ ...card, display: 'flex', flexDirection: 'column' }}>
                                    <div onClick={() => setOpenDb(o => !o)} style={{ ...cardH, cursor: 'pointer', userSelect: 'none' }}>
                                        <Database style={{ width: 14, height: 14, color: C.purple }} />
                                        <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Base de données</span>
                                        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                                            <span style={{ fontSize: '.67rem', color: C.muted }}>fail2ban.local</span>
                                            {openDb ? <ChevronDown style={{ width: 13, height: 13, color: C.muted }} /> : <ChevronRight style={{ width: 13, height: 13, color: C.muted }} />}
                                        </span>
                                    </div>
                                    {openDb && <div style={{ ...cardB, display: 'flex', flexDirection: 'column', gap: '.75rem', flex: 1 }}>
                                        <div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: '.3rem' }}>
                                                <label style={{ fontSize: '.75rem', color: C.muted }}>DB Purge Age (secondes)</label>
                                                <F2bTooltip
                                                    title="Rétention des bans (dbpurgeage)"
                                                    body={`Durée pendant laquelle fail2ban conserve les bans dans sa base SQLite.\n\nValeur par défaut : 86400 (1 jour)\n\nRecommandations :\n• 86400 = 1 jour (défaut — ok pour usage normal)\n• 604800 = 7 jours (bon équilibre)\n• 2592000 = 30 jours (historique long)\n• 0 = désactivé (conserve tout, risque de croissance illimitée)\n\nAugmenter si tu veux voir les bans anciens dans LogviewR. Ne pas dépasser 90 jours sans surveiller la taille de la DB.`}
                                                    color="blue" placement="top">
                                                    <span style={{ cursor: 'help', color: C.blue, fontSize: '.85rem', lineHeight: 1 }}>ⓘ</span>
                                                </F2bTooltip>
                                            </div>
                                            <input type="number" min="0" value={fmPurgeage}
                                                onChange={e => { const v = e.target.value; if (v === '' || /^\d+$/.test(v)) setFmPurgeage(v); }}
                                                style={{ ...inp, borderColor: fmPurgeage !== '' && (isNaN(parseInt(fmPurgeage, 10)) || parseInt(fmPurgeage, 10) < 0) ? C.red : undefined }} placeholder="86400" />
                                            <div style={{ fontSize: '.65rem', color: C.muted, marginTop: 2 }}>
                                                {parseInt(fmPurgeage, 10) > 0 ? `≈ ${Math.round(parseInt(fmPurgeage, 10) / 86400)} jour(s)` : parseInt(fmPurgeage, 10) === 0 ? 'Désactivé (0)' : ''}
                                            </div>
                                        </div>
                                        <div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: '.3rem' }}>
                                                <label style={{ fontSize: '.75rem', color: C.muted }}>DB Max Matches</label>
                                                <F2bTooltip
                                                    title="Historique de log par IP (dbmaxmatches)"
                                                    body={`Nombre de lignes de log conservées par IP et par jail dans la base fail2ban.\n\nValeur par défaut : 10\n\nUtilisé par : fail2ban-client get <jail> banip <ip> matches\n\nRecommandations :\n• 10 = défaut (suffisant pour diagnostiquer)\n• 20–50 = bon compromis pour plus de contexte\n• >100 = déconseillé sauf usage debug, augmente la taille de la DB\n\nModifier uniquement si tu as besoin de plus d'historique de log par IP bannie.`}
                                                    color="blue" placement="top">
                                                    <span style={{ cursor: 'help', color: C.blue, fontSize: '.85rem', lineHeight: 1 }}>ⓘ</span>
                                                </F2bTooltip>
                                            </div>
                                            <input type="number" min="1" max="10000" value={fmMaxmatches} onChange={e => setFmMaxmatches(e.target.value)} style={inp} />
                                            <div style={{ fontSize: '.65rem', color: C.muted, marginTop: 2 }}>Lignes de log max conservées par IP</div>
                                        </div>
                                        {/* Tip: bantime.increment */}
                                        <div style={{ border: '1px solid rgba(88,166,255,.2)', borderRadius: 6, overflow: 'hidden' }}>
                                            <div onClick={() => setOpenDbTip(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: '.35rem', padding: '.45rem .75rem', cursor: 'pointer', background: 'rgba(88,166,255,.06)', userSelect: 'none' }}>
                                                <span style={{ fontSize: '.85rem', color: C.blue }}>ⓘ</span>
                                                <span style={{ fontWeight: 600, fontSize: '.75rem', color: C.blue, flex: 1 }}>Conseil : escalade progressive des bans</span>
                                                {openDbTip ? <ChevronDown style={{ width: 12, height: 12, color: C.blue }} /> : <ChevronRight style={{ width: 12, height: 12, color: C.blue }} />}
                                            </div>
                                            {openDbTip && <div style={{ padding: '.55rem .75rem', display: 'flex', flexDirection: 'column', gap: '.3rem', background: 'rgba(88,166,255,.03)' }}>
                                                <div style={{ fontSize: '.72rem', color: C.muted, lineHeight: 1.55 }}>
                                                    En ajoutant dans <span style={{ fontFamily: 'monospace', color: C.orange }}>jail.local</span> section <span style={{ fontFamily: 'monospace', color: C.text }}>[DEFAULT]</span> :
                                                </div>
                                                <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '.68rem', color: C.cyan, background: 'rgba(0,0,0,.25)', borderRadius: 4, padding: '.35rem .5rem', lineHeight: 1.6 }}>{`bantime.increment = true\nbantime.factor    = 2\nbantime.maxtime   = 604800`}</pre>
                                                <div style={{ fontSize: '.71rem', color: C.muted, lineHeight: 1.55 }}>
                                                    Chaque récidive <strong style={{ color: C.text }}>double</strong> le bantime (1h → 2h → 4h → … → 7j max).<br />
                                                    Nécessite <span style={{ fontFamily: 'monospace', color: C.orange }}>dbpurgeage</span> suffisamment long pour se souvenir des anciens bans.<br />
                                                    Se combine avec le jail <span style={{ fontFamily: 'monospace', color: C.red }}>recidive</span> : l'escalade agit d'abord, recidive attrape les cas extrêmes (5 bans / 24h → 1 an).
                                                </div>
                                            </div>}
                                        </div>

                                        <div style={{ marginTop: 'auto' }}>
                                            <Btn onClick={persistDb} loading={saving === 'persist-db'}
                                                bg="rgba(188,140,255,.15)" color={C.purple} border="rgba(188,140,255,.4)">
                                                <Save style={{ width: 11, height: 11 }} /> Persister dans fail2ban.local
                                            </Btn>
                                        </div>
                                    </div>}
                                </div>

                                {/* Fichiers de configuration */}
                                <div style={{ ...card, display: 'flex', flexDirection: 'column' }}>
                                    <div style={{ ...cardH }}>
                                        <FileText style={{ width: 14, height: 14, color: C.blue }} />
                                        <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Fichiers de configuration</span>
                                        <span style={{ marginLeft: 'auto' }}>
                                            <button onClick={() => { setRawTab(t => t ?? 'jail.local'); setOpenRawModal(true); }} style={{
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

            {/* ══════════════════════════════════════════════════════════════
                COLONNE DROITE — Application LogviewR
            ══════════════════════════════════════════════════════════════ */}
            <div>
                <SectionHeader
                    color={C.orange} bg="rgba(227,179,65,.07)"
                    icon={<Settings style={{ width: 16, height: 16 }} />}
                    title="Application"
                    sub="Base de données interne LogviewR, maintenance"
                    collapsible
                    open={openAppSection}
                    onToggle={() => setOpenAppSection(o => !o)}
                    badge={parsed?.appDbInfo?.exists && (parsed.appDbInfo.fragPct ?? 0) <= 20
                        ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontSize: '.72rem', color: C.green, background: 'rgba(63,185,80,.10)', border: '1px solid rgba(63,185,80,.28)', borderRadius: 4, padding: '.08rem .42rem', fontWeight: 600 }}>
                            <CheckCircle style={{ width: 10, height: 10 }} /> OK
                          </span>
                        : undefined
                    }
                />
                {openAppSection && <div style={colBody}>

                    {/* Card: App DB + internal sync stats */}
                    <div style={{ ...card, borderColor: (parsed?.appDbInfo?.fragPct ?? 0) > 20 ? 'rgba(227,179,65,.4)' : C.border }}>
                        <div style={{ ...cardH, cursor: 'pointer' }} onClick={() => setOpenAppDb(o => !o)}>
                            <HardDrive style={{ width: 14, height: 14, color: C.cyan }} />
                            <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Base de données interne (dashboard.db)</span>
                            {(parsed?.appDbInfo?.fragPct ?? 0) > 20 && (
                                <WarnBadge count={1} tip={`Fragmentation élevée : ${parsed!.appDbInfo.fragPct}% — VACUUM recommandé`} />
                            )}
                            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                                {parsed?.appDbInfo && (() => {
                                    const db = parsed.appDbInfo;
                                    const fc = db.fragPct > 40 ? C.red : db.fragPct > 20 ? C.orange : C.green;
                                    const bg = db.fragPct > 40 ? 'rgba(232,106,101,.12)' : db.fragPct > 20 ? 'rgba(227,179,65,.12)' : 'rgba(63,185,80,.1)';
                                    const bd = db.fragPct > 40 ? 'rgba(232,106,101,.3)'  : db.fragPct > 20 ? 'rgba(227,179,65,.3)'  : 'rgba(63,185,80,.25)';
                                    return (<>
                                        <F2bTooltip color="blue" title="Taille — dashboard.db" width={300} bodyNode={<>
                                            {TT.section('Contenu', '#58a6ff')}
                                            {TT.info('Historique long terme des bans (f2b_events)')}
                                            {TT.info('Paramètres et utilisateurs de l\'application')}
                                            {TT.sep()}
                                            {TT.info('VACUUM recommandé si fragmentation > 20%')}
                                        </>}>
                                            <HBadge color={C.blue} bg="rgba(88,166,255,.1)" border="rgba(88,166,255,.25)">{db.sizeFmt}</HBadge>
                                        </F2bTooltip>
                                        <F2bTooltip color={db.fragPct > 40 ? 'red' : db.fragPct > 20 ? 'orange' : 'green'} title="Fragmentation — dashboard.db" width={320} bodyNode={<>
                                            {TT.section('Mesure')}
                                            {TT.info(`Pages libres / pages totales = ${db.fragPct}%`)}
                                            {TT.sep()}
                                            {TT.section('Niveau')}
                                            {db.fragPct <= 20  && TT.ok('Sain — aucune action requise')}
                                            {db.fragPct > 20 && db.fragPct <= 40 && TT.warn('Modérée — VACUUM conseillé')}
                                            {db.fragPct > 40  && TT.err('Élevée — VACUUM fortement recommandé')}
                                        </>}>
                                            <HBadge color={fc} bg={bg} border={bd}>{db.fragPct}% frag.</HBadge>
                                        </F2bTooltip>
                                    </>);
                                })()}
                                {openAppDb ? <ChevronDown style={{ width: 13, height: 13, color: C.muted }} /> : <ChevronRight style={{ width: 13, height: 13, color: C.muted }} />}
                            </span>
                        </div>
                        {openAppDb && <div style={{ ...cardB, display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                            {parsed?.appDbInfo ? (() => {
                                const db = parsed.appDbInfo;
                                const fragOk = db.fragPct <= 20;
                                const fragColor = db.fragPct > 40 ? C.red : db.fragPct > 20 ? C.orange : C.green;
                                return (<>
                                    {/* Stats métriques */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '.4rem' }}>
                                        {[
                                            { l: 'Taille',         v: db.sizeFmt,           c: C.blue   },
                                            { l: 'Fragmentation',  v: `${db.fragPct}%`,      c: fragColor },
                                            { l: 'État',           v: db.exists ? 'OK' : 'KO', c: db.exists ? C.green : C.red },
                                        ].map(s => (
                                            <div key={s.l} style={{ background: C.bg2, borderRadius: 6, padding: '.4rem .5rem', textAlign: 'center', border: `1px solid ${C.border}` }}>
                                                <div style={{ fontSize: '.88rem', fontWeight: 700, color: s.c, fontFamily: 'monospace' }}>{s.v}</div>
                                                <div style={{ fontSize: '.6rem', color: C.muted, textTransform: 'uppercase', marginTop: 2, letterSpacing: '.04em' }}>{s.l}</div>
                                            </div>
                                        ))}
                                    </div>
                                    {/* Check rows santé */}
                                    {[
                                        { label: 'Fichier dashboard.db', ok: db.exists,  detail: 'data/dashboard.db', warn: false, fix: db.exists ? null : 'Fichier introuvable — vérifiez le volume Docker data/' },
                                        { label: 'Fragmentation',        ok: fragOk,     detail: `${db.fragPct}%`,    warn: true,  fix: !fragOk ? 'Fragmentation élevée — VACUUM recommandé' : null },
                                    ].map(c => c.ok ? (
                                        <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.35rem .6rem', borderRadius: 5, background: 'rgba(63,185,80,.05)', border: '1px solid rgba(63,185,80,.18)' }}>
                                            <CheckCircle style={{ width: 12, height: 12, color: C.green, flexShrink: 0 }} />
                                            <span style={{ fontSize: '.8rem', fontWeight: 600, color: C.green }}>{c.label}</span>
                                            {c.detail && <code style={{ marginLeft: 'auto', fontSize: '.68rem', color: C.muted, fontFamily: 'monospace' }}>{c.detail}</code>}
                                        </div>
                                    ) : (
                                        <div key={c.label} style={{ borderRadius: 6, border: `1px solid ${c.warn ? 'rgba(227,179,65,.35)' : 'rgba(232,106,101,.3)'}`, background: c.warn ? 'rgba(227,179,65,.06)' : 'rgba(232,106,101,.06)', overflow: 'hidden' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.38rem .6rem' }}>
                                                {c.warn
                                                    ? <AlertTriangle style={{ width: 12, height: 12, color: C.orange, flexShrink: 0 }} />
                                                    : <XCircle style={{ width: 12, height: 12, color: C.red, flexShrink: 0 }} />}
                                                <span style={{ fontSize: '.8rem', fontWeight: 600, color: c.warn ? C.orange : C.red }}>{c.label}</span>
                                                {c.detail && <code style={{ marginLeft: 'auto', fontSize: '.68rem', color: C.muted, fontFamily: 'monospace' }}>{c.detail}</code>}
                                            </div>
                                            {c.fix && <div style={{ padding: '.3rem .6rem .4rem', fontSize: '.71rem', color: C.muted, borderTop: '1px solid rgba(255,255,255,.05)' }}>{c.fix}</div>}
                                        </div>
                                    ))}
                                    {!fragOk && (
                                        <DashboardVacuumAlert fragPct={db.fragPct} onDone={() => { void loadParsed(); }} />
                                    )}
                                </>);
                            })() : (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.4rem .6rem', borderRadius: 5, background: 'rgba(232,106,101,.06)', border: '1px solid rgba(232,106,101,.3)' }}>
                                    <XCircle style={{ width: 12, height: 12, color: C.red }} />
                                    <span style={{ fontSize: '.82rem', color: C.red }}>dashboard.db non disponible</span>
                                </div>
                            )}
                        </div>}
                    </div>

                    {/* Card: Synchronisation fail2ban ↔ dashboard.db */}
                    {(() => {
                        const synced   = syncStatus?.synced;
                        const syncOk   = synced === true;
                        const syncWarn = synced === false;
                        const borderColor = syncLoading ? C.border : syncWarn ? 'rgba(227,179,65,.4)' : syncOk ? 'rgba(63,185,80,.25)' : C.border;
                        return (
                    <div style={{ ...card, borderColor }}>
                        <div onClick={() => !syncLoading && setOpenSync(o => !o)}
                            style={{ ...cardH, cursor: syncLoading ? 'default' : 'pointer', background: syncWarn ? 'rgba(227,179,65,.04)' : undefined }}>
                            <RefreshCw style={{ width: 14, height: 14, color: syncWarn ? C.orange : C.cyan, ...(syncLoading ? { animation: 'spin 1s linear infinite' } : {}) }} />
                            <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Synchronisation <span style={{ fontFamily: 'monospace', color: C.cyan }}>fail2ban</span> ↔ dashboard.db</span>
                            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                                {syncLoading ? (
                                    <span style={{ fontSize: '.72rem', color: C.muted }}>Vérification…</span>
                                ) : syncOk ? (
                                    <F2bTooltip color="green" title="Synchronisation — OK" width={340} bodyNode={<>
                                        {TT.section('État', '#3fb950')}
                                        {TT.ok('fail2ban.sqlite3 → dashboard.db synchronisés')}
                                        {TT.sep()}
                                        {TT.section('Fonctionnement')}
                                        {TT.info('Service tourne en arrière-plan toutes les 60s')}
                                        {TT.info('Alimente l\'historique long terme de l\'app')}
                                    </>}>
                                        <HBadge color={C.green} bg="rgba(63,185,80,.12)" border="rgba(63,185,80,.3)" icon={<CheckCircle style={{ width: 10, height: 10 }} />}>OK</HBadge>
                                    </F2bTooltip>
                                ) : syncWarn ? (
                                    <F2bTooltip color="orange" title="Synchronisation — Décalage" width={340} bodyNode={<>
                                        {TT.section('Problème', '#e3b341')}
                                        {TT.warn('Décalage entre fail2ban.sqlite3 et dashboard.db')}
                                        {TT.sep()}
                                        {TT.section('Actions')}
                                        {TT.info('Attendez le prochain cycle (≤ 60s)')}
                                        {TT.info('Ou vérifiez que le service de synchro est actif')}
                                    </>}>
                                        <HBadge color={C.orange} bg="rgba(227,179,65,.12)" border="rgba(227,179,65,.3)" icon={<AlertTriangle style={{ width: 10, height: 10 }} />}>Décalage</HBadge>
                                    </F2bTooltip>
                                ) : syncStatus?.synced === null ? (
                                    <F2bTooltip color="muted" title="Synchronisation — SQLite non lisible" width={340} bodyNode={<>
                                        {TT.section('Problème', '#e3b341')}
                                        {TT.err('fail2ban.sqlite3 non accessible en lecture')}
                                        {TT.sep()}
                                        {TT.section('Correction')}
                                        {TT.warn('chmod o+r /var/lib/fail2ban/fail2ban.sqlite3')}
                                        {TT.info('Vérifiez le montage Docker de /var/lib/fail2ban')}
                                    </>}>
                                        <HBadge color={C.muted} bg="rgba(227,179,65,.08)" border={C.border} icon={<AlertTriangle style={{ width: 10, height: 10 }} />}>SQLite non lisible</HBadge>
                                    </F2bTooltip>
                                ) : null}
                                {!syncLoading && syncStatus && (openSync
                                    ? <ChevronDown style={{ width: 13, height: 13, color: C.muted }} />
                                    : <ChevronRight style={{ width: 13, height: 13, color: C.muted }} />
                                )}
                            </span>
                        </div>
                        {!syncLoading && syncStatus && openSync && (
                            <div style={{ ...cardB, display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
                                {/* fail2ban SQLite */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.38rem .6rem', borderRadius: 5, background: C.bg2, border: `1px solid ${C.border}` }}>
                                    <Database style={{ width: 12, height: 12, color: C.purple, flexShrink: 0 }} />
                                    <span style={{ fontSize: '.78rem', fontWeight: 600, color: C.text }}>fail2ban SQLite</span>
                                    <span style={{ marginLeft: 'auto', display: 'flex', gap: '.75rem' }}>
                                        {syncStatus.f2bMaxRowid !== null ? <>
                                            <span style={{ fontSize: '.72rem', color: C.muted }}>rowid max <code style={{ color: C.cyan }}>{syncStatus.f2bMaxRowid}</code></span>
                                            <span style={{ fontSize: '.72rem', color: C.muted }}>{syncStatus.f2bTotalBans?.toLocaleString()} bans total</span>
                                        </> : <span style={{ fontSize: '.72rem', color: C.orange }}>non lisible</span>}
                                    </span>
                                </div>
                                {/* dashboard.db */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.38rem .6rem', borderRadius: 5, background: C.bg2, border: `1px solid ${C.border}` }}>
                                    <HardDrive style={{ width: 12, height: 12, color: C.blue, flexShrink: 0 }} />
                                    <span style={{ fontSize: '.78rem', fontWeight: 600, color: C.text }}>dashboard.db</span>
                                    <span style={{ marginLeft: 'auto', display: 'flex', gap: '.75rem' }}>
                                        <span style={{ fontSize: '.72rem', color: C.muted }}>dernier rowid <code style={{ color: C.cyan }}>{syncStatus.lastSyncedRowid}</code></span>
                                        <span style={{ fontSize: '.72rem', color: C.muted }}>{syncStatus.internalEvents.toLocaleString()} événements</span>
                                    </span>
                                </div>
                                {/* Last sync + info */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.3rem .4rem', fontSize: '.68rem', color: C.muted }}>
                                    <Info style={{ width: 10, height: 10, flexShrink: 0 }} />
                                    {syncStatus.lastSyncAt
                                        ? `Dernière synchro : ${new Date(syncStatus.lastSyncAt).toLocaleString('fr-FR')} — sync auto toutes les 60s`
                                        : 'Synchronisation en attente (première exécution)'}
                                </div>
                                {syncWarn && (
                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.4rem', padding: '.4rem .6rem', borderRadius: 5, background: 'rgba(227,179,65,.07)', border: '1px solid rgba(227,179,65,.3)', fontSize: '.72rem', color: C.orange }}>
                                        <AlertTriangle style={{ width: 11, height: 11, flexShrink: 0, marginTop: 1 }} />
                                        Décalage détecté — la prochaine synchro automatique (≤60s) devrait corriger cet écart.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                        );
                    })()}

                    {/* Card: Pare-feu — Netfilter */}
                    {(() => {
                        const fwErrCount = FW_CHECKS_CFG.filter(c => fwStatuses[c.key] === 'error').length;
                        const fwOkAll    = FW_CHECKS_CFG.every(c => fwStatuses[c.key] === 'ok');
                        return (
                    <div style={{ ...card, borderColor: fwErrCount > 0 ? 'rgba(227,179,65,.4)' : C.border }}>
                        <div style={{ ...cardH, cursor: 'pointer', background: fwErrCount > 0 ? 'rgba(227,179,65,.04)' : undefined }} onClick={() => setOpenFw(o => !o)}>
                            <Layers style={{ width: 14, height: 14, color: fwErrCount > 0 ? C.orange : C.cyan }} />
                            <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Pare-feu — Netfilter <span style={{ fontWeight: 400, color: C.orange, fontSize: '.72rem' }}>(optionnel)</span></span>
                            {fwErrCount > 0 && (
                                <WarnBadge count={fwErrCount}
                                    tip={FW_CHECKS_CFG.filter(c => fwStatuses[c.key] === 'error').map(c => `${c.label} inaccessible`).join(' · ') + ' — NET_ADMIN + network_mode: host requis'} />
                            )}
                            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                                {fwOkAll ? (
                                    <F2bTooltip color="green" title="Pare-feu Netfilter — OK" width={340} bodyNode={<>
                                        {TT.section('Outils accessibles', '#3fb950')}
                                        {TT.ok('IPTables  —  règles netfilter via iptables-save')}
                                        {TT.ok('IPSet     —  sets blacklist / f2b-*')}
                                        {TT.ok('NFTables  —  ruleset nftables du host')}
                                        {TT.sep()}
                                        {TT.info('Requiert : network_mode: host + NET_ADMIN')}
                                    </>}>
                                        <HBadge color={C.green} bg="rgba(63,185,80,.12)" border="rgba(63,185,80,.3)" icon={<CheckCircle style={{ width: 10, height: 10 }} />}>OK</HBadge>
                                    </F2bTooltip>
                                ) : fwErrCount > 0 ? (
                                    <F2bTooltip color="orange" title="Pare-feu Netfilter — Non disponible" width={360} bodyNode={<>
                                        {TT.section('Prérequis manquants', '#e3b341')}
                                        {TT.warn('network_mode: host  dans docker-compose.yml')}
                                        {TT.warn('cap_add: [ NET_ADMIN ]  dans docker-compose.yml')}
                                        {TT.sep()}
                                        {TT.section('Impact')}
                                        {TT.info('Onglets IPTables / IPSet / NFTables limités')}
                                    </>}>
                                        <HBadge color={C.orange} bg="rgba(227,179,65,.12)" border="rgba(227,179,65,.3)" icon={<AlertTriangle style={{ width: 10, height: 10 }} />}>{fwErrCount} inaccessible{fwErrCount > 1 ? 's' : ''}</HBadge>
                                    </F2bTooltip>
                                ) : null}
                                {openFw ? <ChevronDown style={{ width: 13, height: 13, color: C.muted }} /> : <ChevronRight style={{ width: 13, height: 13, color: C.muted }} />}
                            </span>
                        </div>
                        {openFw && <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
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
                        </div>}
                    </div>
                        );
                    })()}

                    {/* Card: Intégrations — chemins SQLite & NPM */}
                    <div style={{ ...card, borderColor: npmDataPath ? C.border : 'rgba(227,179,65,.4)' }}>
                        <div onClick={() => setOpenInteg(o => !o)} style={{ ...cardH, cursor: 'pointer', background: (npmDataPath || npmMysqlOk) ? undefined : 'rgba(227,179,65,.04)' }}>
                            <Network style={{ width: 14, height: 14, color: (npmDataPath || npmMysqlOk) ? C.cyan : C.orange }} />
                            <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Intégrations <span style={{ fontWeight: 400, color: C.orange, fontSize: '.72rem' }}>(optionnel)</span></span>
                            {!(npmDataPath || npmMysqlOk) && <WarnBadge count={1} tip="NPM non configuré — Top Domaines inactif" />}
                            {(npmDataPath || npmMysqlOk) && (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontSize: '.72rem', color: C.green, background: 'rgba(63,185,80,.10)', border: '1px solid rgba(63,185,80,.28)', borderRadius: 4, padding: '.08rem .42rem', fontWeight: 600 }}>
                                    <CheckCircle style={{ width: 10, height: 10 }} /> NPM {npmMysqlOk ? 'MySQL' : 'SQLite'}
                                </span>
                            )}
                            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                                <HBadge color={C.cyan} bg="rgba(57,197,207,.08)" border="rgba(57,197,207,.25)">Nginx Proxy Manager</HBadge>
                                {openInteg ? <ChevronDown style={{ width: 13, height: 13, color: C.muted }} /> : <ChevronRight style={{ width: 13, height: 13, color: C.muted }} />}
                            </span>
                        </div>
                        {openInteg && <div style={{ ...cardB }}>
                            {!(npmDataPath || npmMysqlOk) && (
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.5rem', padding: '.5rem .7rem', borderRadius: 6, background: 'rgba(227,179,65,.08)', border: '1px solid rgba(227,179,65,.3)', marginBottom: '.75rem' }}>
                                    <AlertTriangle style={{ width: 14, height: 14, color: C.orange, flexShrink: 0, marginTop: 1 }} />
                                    <span style={{ fontSize: '.78rem', color: C.orange, lineHeight: 1.5 }}>
                                        NPM non configuré — les <strong>Top Domaines</strong> (onglet Stats) ne fonctionneront pas.
                                    </span>
                                </div>
                            )}
                            <Fail2banPathConfig
                                npmDataPath={npmDataPath}
                                onNpmDataPathChange={v => onNpmDataPathChange?.(v)}
                            />
                        </div>}
                    </div>

                    {/* Card: Maintenance */}
                    <div style={{ ...card }}>
                        <div onClick={() => setOpenMaint(o => !o)} style={{ ...cardH, cursor: 'pointer', userSelect: 'none' }}>
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


                </div>}
            </div>

            </div>{/* /grid */}
        </div>
    );
};
