/**
 * ConfEditorModal — view/edit fail2ban filter.conf or action.conf with syntax
 * highlighting, save support, and (for filters) a failregex tester.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Edit3, Save, FlaskConical, CheckCircle, XCircle } from 'lucide-react';
import { api } from '../../api/client';

// ── Syntax highlighter ────────────────────────────────────────────────────────

function highlightConfValue(val: string, lineKey: number): React.ReactNode[] {
    const re = /(%\([^)]+\)s|<[a-zA-Z_][a-zA-Z0-9_-]*>)/g;
    const nodes: React.ReactNode[] = [];
    let last = 0, idx = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(val)) !== null) {
        if (m.index > last) nodes.push(<span key={`${lineKey}-t${idx++}`} style={{ color: '#e6edf3' }}>{val.slice(last, m.index)}</span>);
        const isVar = m[0].startsWith('%');
        nodes.push(<span key={`${lineKey}-h${idx++}`} style={{ color: isVar ? '#bc8cff' : '#e3b341' }}>{m[0]}</span>);
        last = m.index + m[0].length;
    }
    if (last < val.length) nodes.push(<span key={`${lineKey}-t${idx}`} style={{ color: '#e6edf3' }}>{val.slice(last)}</span>);
    return nodes;
}

function highlightConfLine(line: string, key: number): React.ReactNode {
    if (/^\s*[#;]/.test(line))  return <span key={key} style={{ color: '#8b949e', fontStyle: 'italic' }}>{line}{'\n'}</span>;
    if (/^\s*\[.+\]/.test(line)) return <span key={key} style={{ color: '#e3b341', fontWeight: 700 }}>{line}{'\n'}</span>;
    const eq = line.indexOf('=');
    if (eq > 0) {
        return (
            <span key={key}>
                <span style={{ color: '#79c0ff' }}>{line.substring(0, eq)}</span>
                <span style={{ color: '#8b949e' }}>{'='}</span>
                {highlightConfValue(line.substring(eq + 1), key)}
                {'\n'}
            </span>
        );
    }
    return <span key={key}>{line}{'\n'}</span>;
}

const HighlightedConf: React.FC<{ content: string }> = ({ content }) => (
    <pre style={{ margin: 0, fontSize: '.78rem', fontFamily: 'monospace', lineHeight: 1.6, whiteSpace: 'pre-wrap', color: '#e6edf3' }}>
        {content.split('\n').map((line, i) => highlightConfLine(line, i))}
    </pre>
);

// ── Extract failregex lines ────────────────────────────────────────────────────

function extractFailregex(content: string): string {
    const lines = content.split('\n');
    const result: string[] = [];
    let inBlock = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (/^failregex\s*[+=]/i.test(trimmed)) {
            inBlock = true;
            const val = trimmed.replace(/^failregex\s*[+=]+\s*/i, '').trim();
            if (val && !val.startsWith('#')) result.push(val);
        } else if (inBlock && /^\s+\S/.test(line)) {
            if (!trimmed.startsWith('#')) result.push(trimmed);
        } else if (trimmed && !/^\s/.test(line)) {
            if (/^\[/.test(trimmed) || /^[a-zA-Z]/.test(trimmed)) inBlock = false;
        }
    }
    return result.join('\n');
}

// ── Styles ────────────────────────────────────────────────────────────────────

const btnBase: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '.3rem',
    padding: '.28rem .65rem', borderRadius: 5, cursor: 'pointer',
    fontSize: '.78rem', fontWeight: 600, border: '1px solid',
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ConfEditorTarget {
    type: 'filter' | 'action';
    name: string;
    jails?: string[];
}

interface TestResult {
    ok: boolean;
    match_count: number;
    total: number;
    matched: { line: string; host?: string }[];
    missed: string[];
}

// ── Component ─────────────────────────────────────────────────────────────────

export const ConfEditorModal: React.FC<{ target: ConfEditorTarget; onClose: () => void }> = ({ target, onClose }) => {
    const fileName = `${target.name}.conf`;
    const baseUrl  = target.type === 'filter'
        ? `/api/plugins/fail2ban/filters/${encodeURIComponent(fileName)}`
        : `/api/plugins/fail2ban/actions/${encodeURIComponent(fileName)}`;

    const [content,  setContent]  = useState('');
    const [draft,    setDraft]    = useState('');
    const [editMode, setEditMode] = useState(false);
    const [loading,  setLoading]  = useState(true);
    const [saving,   setSaving]   = useState(false);
    const [saveMsg,  setSaveMsg]  = useState<{ ok: boolean; text: string } | null>(null);
    const [testerOpen, setTesterOpen] = useState(false);
    const [logLines,   setLogLines]   = useState('');
    const [testResult, setTestResult] = useState<TestResult | null>(null);
    const [testing,    setTesting]    = useState(false);
    const taRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        setLoading(true);
        api.get<{ ok: boolean; content: string }>(baseUrl)
            .then(res => {
                const c = res.success && res.result?.ok ? (res.result.content ?? '') : '# Fichier non trouvé';
                setContent(c); setDraft(c);
            })
            .finally(() => setLoading(false));
    }, [baseUrl]);

    useEffect(() => {
        const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', fn);
        return () => window.removeEventListener('keydown', fn);
    }, [onClose]);

    const switchEdit = (on: boolean) => { if (on) setDraft(content); setEditMode(on); setSaveMsg(null); };

    const handleSave = useCallback(async () => {
        setSaving(true); setSaveMsg(null);
        const res = await api.post<{ ok: boolean; error?: string }>(`${baseUrl}/save`, { content: draft, jails: target.jails ?? [] });
        if (res.success && res.result?.ok) {
            setContent(draft); setSaveMsg({ ok: true, text: 'Sauvegardé.' }); setEditMode(false);
        } else {
            setSaveMsg({ ok: false, text: res.result?.error ?? 'Erreur inconnue' });
        }
        setSaving(false);
    }, [baseUrl, draft, target.jails]);

    const handleTest = useCallback(async () => {
        setTesting(true); setTestResult(null);
        const failregex = extractFailregex(editMode ? draft : content);
        const res = await api.post<TestResult>(
            `/api/plugins/fail2ban/filters/${encodeURIComponent(fileName)}/test`,
            { failregex, log_lines: logLines }
        );
        if (res.success && res.result?.ok) setTestResult(res.result);
        setTesting(false);
    }, [editMode, draft, content, fileName, logLines]);

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.65)' }}
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 10, width: 'min(860px, 96vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,.6)' }}>

                {/* Header */}
                <div style={{ background: '#21262d', padding: '.65rem 1rem', borderBottom: '1px solid #30363d', display: 'flex', alignItems: 'center', gap: '.5rem', flexShrink: 0 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '.88rem', fontWeight: 700, color: target.type === 'filter' ? '#3fb950' : '#e3b341', flexShrink: 0 }}>
                        {target.type === 'filter' ? '⚙' : '⚡'}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: '.9rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {fileName}
                        <span style={{ marginLeft: '.5rem', fontSize: '.72rem', color: '#8b949e', fontWeight: 400 }}>
                            ({target.type === 'filter' ? 'filter.d' : 'action.d'})
                        </span>
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexShrink: 0 }}>
                        {!editMode && !loading && (
                            <>
                                {target.type === 'filter' && (
                                    <button onClick={() => setTesterOpen(t => !t)}
                                        style={{ ...btnBase, borderColor: testerOpen ? 'rgba(57,197,207,.4)' : '#30363d', background: testerOpen ? 'rgba(57,197,207,.1)' : 'transparent', color: testerOpen ? '#39c5cf' : '#8b949e' }}>
                                        <FlaskConical style={{ width: 12, height: 12 }} /> Tester
                                    </button>
                                )}
                                <button onClick={() => switchEdit(true)}
                                    style={{ ...btnBase, borderColor: 'rgba(88,166,255,.35)', background: 'rgba(88,166,255,.1)', color: '#58a6ff' }}>
                                    <Edit3 style={{ width: 12, height: 12 }} /> Modifier
                                </button>
                            </>
                        )}
                        {editMode && (
                            <>
                                <button onClick={handleSave} disabled={saving}
                                    style={{ ...btnBase, borderColor: 'rgba(63,185,80,.4)', background: 'rgba(63,185,80,.12)', color: '#3fb950', opacity: saving ? .6 : 1 }}>
                                    <Save style={{ width: 12, height: 12 }} /> {saving ? 'Enregistrement…' : 'Sauvegarder'}
                                </button>
                                <button onClick={() => switchEdit(false)}
                                    style={{ ...btnBase, borderColor: '#30363d', background: 'transparent', color: '#8b949e' }}>
                                    Annuler
                                </button>
                            </>
                        )}
                        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', padding: '.2rem', display: 'flex', alignItems: 'center' }}>
                            <X style={{ width: 16, height: 16 }} />
                        </button>
                    </div>
                </div>

                {saveMsg && (
                    <div style={{ padding: '.4rem 1rem', fontSize: '.8rem', color: saveMsg.ok ? '#3fb950' : '#e86a65', background: saveMsg.ok ? 'rgba(63,185,80,.07)' : 'rgba(232,106,101,.07)', borderBottom: '1px solid #30363d', display: 'flex', alignItems: 'center', gap: '.4rem', flexShrink: 0 }}>
                        {saveMsg.ok ? <CheckCircle style={{ width: 13, height: 13 }} /> : <XCircle style={{ width: 13, height: 13 }} />}
                        {saveMsg.text}
                    </div>
                )}

                {/* Content */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
                    {loading ? (
                        <div style={{ color: '#8b949e', fontSize: '.85rem' }}>Chargement…</div>
                    ) : editMode ? (
                        <textarea ref={taRef} value={draft} onChange={e => setDraft(e.target.value)} spellCheck={false}
                            style={{ width: '100%', minHeight: 360, padding: '.75rem', fontFamily: 'monospace', fontSize: '.78rem', lineHeight: 1.6, background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
                    ) : (
                        <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, padding: '.75rem', overflowX: 'auto' }}>
                            <HighlightedConf content={content} />
                        </div>
                    )}
                </div>

                {/* Tester section */}
                {testerOpen && target.type === 'filter' && !editMode && (
                    <div style={{ borderTop: '1px solid #30363d', padding: '1rem', flexShrink: 0, maxHeight: 340, overflowY: 'auto' }}>
                        <div style={{ fontSize: '.8rem', fontWeight: 600, color: '#39c5cf', marginBottom: '.5rem', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                            <FlaskConical style={{ width: 13, height: 13 }} /> Tester les failregex
                        </div>
                        <textarea value={logLines} onChange={e => setLogLines(e.target.value)}
                            placeholder="Collez des lignes de log ici (une par ligne)…" spellCheck={false}
                            style={{ width: '100%', height: 80, padding: '.5rem .65rem', fontFamily: 'monospace', fontSize: '.75rem', background: '#0d1117', border: '1px solid #30363d', borderRadius: 5, color: '#e6edf3', outline: 'none', resize: 'vertical', boxSizing: 'border-box', marginBottom: '.5rem' }} />
                        <button onClick={handleTest} disabled={testing || !logLines.trim()}
                            style={{ ...btnBase, borderColor: 'rgba(57,197,207,.4)', background: 'rgba(57,197,207,.1)', color: '#39c5cf', opacity: (!logLines.trim() || testing) ? .5 : 1 }}>
                            <FlaskConical style={{ width: 12, height: 12 }} /> {testing ? 'Test en cours…' : 'Tester'}
                        </button>
                        {testResult && (
                            <div style={{ marginTop: '.65rem' }}>
                                <div style={{ fontSize: '.76rem', marginBottom: '.4rem' }}>
                                    <span style={{ color: testResult.match_count > 0 ? '#3fb950' : '#8b949e', fontWeight: 700 }}>
                                        {testResult.match_count}/{testResult.total} lignes matchées
                                    </span>
                                </div>
                                {testResult.matched.length > 0 && (
                                    <div style={{ marginBottom: '.5rem' }}>
                                        <div style={{ fontSize: '.66rem', fontWeight: 700, color: '#3fb950', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.2rem' }}>Matchées ({testResult.matched.length})</div>
                                        <div style={{ background: '#0d1117', border: '1px solid rgba(63,185,80,.25)', borderRadius: 5 }}>
                                            {testResult.matched.map((m, i) => (
                                                <div key={i} style={{ padding: '.25rem .6rem', borderBottom: i < testResult.matched.length - 1 ? '1px solid #30363d' : undefined, fontSize: '.74rem', fontFamily: 'monospace', display: 'flex', gap: '.75rem', alignItems: 'center' }}>
                                                    {m.host && <span style={{ color: '#e86a65', flexShrink: 0, minWidth: 110 }}>{m.host}</span>}
                                                    <span style={{ color: '#e6edf3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.line}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {testResult.missed.length > 0 && (
                                    <div>
                                        <div style={{ fontSize: '.66rem', fontWeight: 700, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.2rem' }}>Non matchées ({testResult.missed.length})</div>
                                        <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 5 }}>
                                            {testResult.missed.slice(0, 10).map((line, i) => (
                                                <div key={i} style={{ padding: '.25rem .6rem', borderBottom: i < Math.min(testResult!.missed.length, 10) - 1 ? '1px solid #30363d' : undefined, fontSize: '.74rem', fontFamily: 'monospace', color: '#8b949e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {line}
                                                </div>
                                            ))}
                                            {testResult.missed.length > 10 && <div style={{ padding: '.25rem .6rem', fontSize: '.7rem', color: '#8b949e' }}>+{testResult.missed.length - 10} de plus…</div>}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
