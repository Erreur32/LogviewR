import React, { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { api } from '../../api/client';
import { card } from './helpers';

interface TabNetworkRawProps {
    title: string;
    endpoint: string;
    icon: React.ReactNode;
}

export const TabNetworkRaw: React.FC<TabNetworkRawProps> = ({ title, endpoint, icon }) => {
    const [data, setData]       = useState<{ ok: boolean; output: string; error?: string } | null>(null);
    const [loading, setLoading] = useState(true);
    const [lastLoaded, setLastLoaded] = useState<number>(0);

    useEffect(() => {
        setLoading(true);
        api.get<{ ok: boolean; output: string; error?: string }>(endpoint)
            .then(res => {
                if (res.success) setData(res.result ?? null);
                setLastLoaded(Date.now());
            })
            .finally(() => setLoading(false));
    }, [endpoint]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontWeight: 600, fontSize: '.95rem', margin: 0 }}>
                    {icon} {title}
                </h3>
                {lastLoaded > 0 && !loading && (
                    <span style={{ marginLeft: 'auto', fontSize: '.68rem', color: '#8b949e', whiteSpace: 'nowrap' }}>
                        ↻ {new Date(lastLoaded).toLocaleTimeString('fr-FR')}
                    </span>
                )}
                {loading && (
                    <span style={{ marginLeft: 'auto', fontSize: '.72rem', color: '#8b949e' }}>Chargement…</span>
                )}
            </div>
            {data && !data.ok && (
                <div style={{ background: 'rgba(227,179,65,.07)', border: '1px solid rgba(227,179,65,.25)', borderRadius: 8, padding: '1rem' }}>
                    <p style={{ color: '#e3b341', fontWeight: 600, fontSize: '.85rem', marginBottom: '.5rem', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                        <AlertTriangle style={{ width: 14, height: 14 }} /> Commande non disponible
                    </p>
                    <pre style={{ fontSize: '.78rem', color: '#8b949e', fontFamily: 'monospace', margin: 0 }}>{data.error}</pre>
                </div>
            )}
            {data?.ok && (
                <pre style={{ ...card, padding: '1rem', fontSize: '.78rem', fontFamily: 'monospace', color: '#e6edf3', overflowX: 'auto', maxHeight: '60vh', lineHeight: 1.6, margin: 0 }}>
                    {data.output || '(vide)'}
                </pre>
            )}
        </div>
    );
};
