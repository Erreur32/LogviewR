import React from 'react';

// ── Formatters ────────────────────────────────────────────────────────────────

export const fmtTs = (ts: number) =>
    new Date(ts * 1000).toLocaleString('fr-FR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });

export const fmtSecs = (s: number): string => {
    if (s < 0) return 'permanent';
    if (s >= 86400) return `${Math.floor(s / 86400)}j`;
    if (s >= 3600)  return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 60)}m`;
};

// ── Shared card styles (PHP-style dark theme) ────────────────────────────────

export const card: React.CSSProperties = {
    background: '#161b22', border: '1px solid #30363d', borderRadius: 8, overflow: 'hidden',
};
export const cardH: React.CSSProperties = {
    background: '#21262d', padding: '.65rem 1rem', borderBottom: '1px solid #30363d',
    display: 'flex', alignItems: 'center', gap: '.5rem',
};
export const cardB: React.CSSProperties = { padding: '1rem' };

// ── Period selector config ────────────────────────────────────────────────────

export const PERIODS = [
    { label: '24h',  days: 1,   title: 'Bans des dernières 24h' },
    { label: '7j',   days: 7,   title: 'Bans des 7 derniers jours' },
    { label: '30j',  days: 30,  title: 'Bans des 30 derniers jours' },
    { label: '6m',   days: 180, title: 'Bans des 6 derniers mois' },
    { label: '1an',  days: 365, title: "Bans de l'année passée" },
    { label: 'Tous', days: -1,  title: 'Toutes les données disponibles (SQLite)' },
] as const;

export type PeriodDays = (typeof PERIODS)[number]['days'];

// ── Badge component (replicates PHP jbadge classes) ──────────────────────────

type BadgeColor = 'green' | 'blue' | 'orange' | 'red' | 'purple' | 'muted';

const BADGE_STYLES: Record<BadgeColor, React.CSSProperties> = {
    green:  { background: 'rgba(63,185,80,.1)',    color: '#3fb950', border: '1px solid rgba(63,185,80,.25)'    },
    blue:   { background: 'rgba(88,166,255,.1)',   color: '#58a6ff', border: '1px solid rgba(88,166,255,.25)'   },
    orange: { background: 'rgba(227,179,65,.1)',   color: '#e3b341', border: '1px solid rgba(227,179,65,.25)'   },
    red:    { background: 'rgba(232,106,101,.08)', color: '#e86a65', border: '1px solid rgba(232,106,101,.2)'   },
    purple: { background: 'rgba(188,140,255,.1)',  color: '#bc8cff', border: '1px solid rgba(188,140,255,.25)'  },
    muted:  { background: 'rgba(255,255,255,.04)', color: '#8b949e', border: '1px solid rgba(255,255,255,.08)',
              fontSize: '.66rem', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' },
};

export const Badge: React.FC<{ color: BadgeColor; children: React.ReactNode }> = ({ color, children }) => (
    <span style={{
        ...BADGE_STYLES[color],
        display: 'inline-flex', alignItems: 'center', gap: '.25rem',
        padding: '.18rem .5rem', borderRadius: 4,
        fontSize: '.75rem', fontWeight: 500, lineHeight: 1.4, flexShrink: 0,
    }}>
        {children}
    </span>
);

// ── Status dot (like PHP jd-dot) ─────────────────────────────────────────────

export const StatusDot: React.FC<{ banned: number; failed: number }> = ({ banned, failed }) => {
    const color = banned > 0 ? '#e86a65' : failed > 0 ? '#e3b341' : '#3fb950';
    const title = banned > 0 ? 'Bans actifs' : failed > 0 ? 'Échecs en cours' : 'OK';
    return (
        <span title={title} style={{
            display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
            background: color, flexShrink: 0, boxShadow: `0 0 4px ${color}88`,
        }} />
    );
};
