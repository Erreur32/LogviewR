import React, { useState } from 'react';
import { ClipboardList, ScrollText, List } from 'lucide-react';
import { TabJailsEvents, TabJailsFiles } from './TabJails';

type AuditTab = 'events' | 'logs';

export const TabAudit: React.FC = () => {
    const [tab, setTab] = useState<AuditTab>('events');

    const subBtnStyle = (active: boolean): React.CSSProperties => ({
        display: 'inline-flex', alignItems: 'center', gap: '.35rem',
        padding: '.28rem .65rem', fontSize: '.8rem', fontWeight: active ? 600 : 400,
        borderRadius: 4, border: 'none', cursor: 'pointer',
        background: active ? 'rgba(88,166,255,.15)' : 'transparent',
        color: active ? '#58a6ff' : '#8b949e',
        transition: 'color .12s, background .12s',
    });

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
            {/* Sub-tab switcher */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                <ClipboardList style={{ width: 14, height: 14, color: '#8b949e', flexShrink: 0 }} />
                <div style={{ display: 'inline-flex', background: '#161b22', border: '1px solid #30363d', borderRadius: 6, padding: '.2rem', gap: '.1rem' }}>
                    <button style={subBtnStyle(tab === 'events')} onClick={() => setTab('events')}>
                        <List style={{ width: 12, height: 12 }} /> Événements
                    </button>
                    <button style={subBtnStyle(tab === 'logs')} onClick={() => setTab('logs')}>
                        <ScrollText style={{ width: 12, height: 12 }} /> Fichiers log
                    </button>
                </div>
            </div>

            <div style={{ display: tab === 'events' ? undefined : 'none' }}>
                <TabJailsEvents />
            </div>
            {tab === 'logs' && <TabJailsFiles />}
        </div>
    );
};
