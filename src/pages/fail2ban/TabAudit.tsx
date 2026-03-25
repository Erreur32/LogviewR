import React from 'react';
import { ClipboardList, ArrowRight } from 'lucide-react';
import { card, cardH } from './helpers';

export const TabAudit: React.FC = () => {
    return (
        <div style={card}>
            <div style={{ ...cardH, gap: '.5rem' }}>
                <ClipboardList style={{ width: 14, height: 14, color: '#8b949e' }} />
                <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Audit</span>
            </div>
            <div style={{ padding: '2rem', textAlign: 'center', color: '#8b949e', fontSize: '.85rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.75rem' }}>
                <div style={{ fontSize: '1.5rem' }}>📋</div>
                <p style={{ margin: 0 }}>
                    L'historique des événements (bans, débans) est disponible dans l'onglet{' '}
                    <strong style={{ color: '#e6edf3' }}>Statistiques</strong>
                    {' '}→ section <strong style={{ color: '#39c5cf' }}>Derniers événements</strong>.
                </p>
                <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '.35rem', fontSize: '.78rem' }}>
                    <ArrowRight style={{ width: 12, height: 12, color: '#39c5cf' }} />
                    Filtrage par IP, jail, période et tri disponibles dans cette section.
                </p>
            </div>
        </div>
    );
};
