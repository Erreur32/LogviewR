import React, { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { card, cardH } from './helpers';

interface TabFileListProps {
    title: string;
    endpoint: string;
    icon: React.ReactNode;
    label: string;
}

export const TabFileList: React.FC<TabFileListProps> = ({ title, endpoint, icon, label }) => {
    const [files, setFiles]       = useState<string[]>([]);
    const [selected, setSelected] = useState<string | null>(null);
    const [content, setContent]   = useState<string>('');
    const [loading, setLoading]   = useState(true);
    const [error, setError]       = useState<string | null>(null);

    useEffect(() => {
        api.get<{ ok: boolean; files: string[]; error?: string }>(endpoint).then(res => {
            if (res.success && res.result?.ok) setFiles(res.result.files);
            else setError(res.result?.error ?? 'Erreur lecture');
            setLoading(false);
        });
    }, [endpoint]);

    const openFile = async (name: string) => {
        setSelected(name); setContent('');
        const res = await api.get<{ ok: boolean; content: string }>(`${endpoint}/${encodeURIComponent(name)}`);
        if (res.success && res.result?.ok) setContent(res.result.content);
    };

    return (
        <div style={{ display: 'flex', gap: '.75rem', height: 'calc(100vh - 180px)' }}>
            <div style={{ ...card, width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
                <div style={{ ...cardH, fontSize: '.85rem', fontWeight: 600 }}>
                    {icon} {title}
                    {!loading && <span style={{ marginLeft: 'auto', fontSize: '.72rem', color: '#8b949e' }}>{files.length}</span>}
                </div>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {loading ? <div style={{ padding: '1rem', fontSize: '.8rem', color: '#8b949e' }}>Chargement…</div>
                    : error  ? <div style={{ padding: '1rem', fontSize: '.8rem', color: '#e86a65' }}>{error}</div>
                    : files.map(f => (
                        <button key={f} onClick={() => openFile(f)}
                            style={{ width: '100%', textAlign: 'left', padding: '.4rem .75rem', fontSize: '.8rem', fontFamily: 'monospace', background: selected === f ? 'rgba(232,106,101,.08)' : 'transparent', color: selected === f ? '#e86a65' : '#e6edf3', border: 'none', cursor: 'pointer', transition: 'background .12s' }}>
                            {f}
                        </button>
                    ))}
                </div>
            </div>
            <div style={{ ...card, flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ ...cardH, fontSize: '.8rem', fontFamily: 'monospace', color: '#8b949e' }}>
                    {selected ? `${label}/${selected}` : 'Sélectionnez un fichier'}
                </div>
                <pre style={{ flex: 1, overflowY: 'auto', padding: '1rem', fontSize: '.78rem', fontFamily: 'monospace', color: '#e6edf3', lineHeight: 1.6, whiteSpace: 'pre-wrap', margin: 0 }}>
                    {content || (selected ? 'Chargement…' : 'Cliquez sur un fichier pour voir son contenu')}
                </pre>
            </div>
        </div>
    );
};
