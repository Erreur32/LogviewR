import React, { useState, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

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

// ── F2bTooltip — PHP jd-tt style tooltip ─────────────────────────────────────
// Replicates .jd-tt-root / .jd-tt-box / .jd-tt--{color} from Fail2ban-web CSS.
// Usage: <F2bTooltip title="Bantime" body="Durée du ban" color="cyan"> ... </F2bTooltip>

export type F2bTtColor = 'blue' | 'red' | 'orange' | 'purple' | 'green' | 'cyan' | 'muted';

const TT_ACCENT: Record<F2bTtColor, string> = {
    blue: '#58a6ff', red: '#e86a65', orange: '#e3b341',
    purple: '#bc8cff', green: '#3fb950', cyan: '#39c5cf', muted: '#8b949e',
};
const TT_BORDER: Record<F2bTtColor, string> = {
    blue: '#58a6ff', red: '#e86a65', orange: '#e3b341',
    purple: '#bc8cff', green: '#3fb950', cyan: '#39c5cf', muted: '#30363d',
};

interface F2bTooltipProps {
    title: string;
    body?: string;
    /** Rich ReactNode body — overrides body string when provided */
    bodyNode?: React.ReactNode;
    color?: F2bTtColor;
    children: React.ReactNode;
    /** Use a div wrapper instead of span — needed when children are block-level */
    block?: boolean;
    /** Force placement. Default: auto (below if trigger is in top half of viewport) */
    placement?: 'top' | 'bottom';
}

export const F2bTooltip: React.FC<F2bTooltipProps> = ({
    title, body, bodyNode, color = 'blue', children, block = false, placement,
}) => {
    const [visible, setVisible] = useState(false);
    const [pos, setPos] = useState({ left: 0, top: 0 });
    const [below, setBelow] = useState(false);
    const [ready, setReady] = useState(false);
    const triggerRef = useRef<HTMLDivElement & HTMLSpanElement>(null);
    const boxRef = useRef<HTMLDivElement>(null);

    const accent = TT_ACCENT[color];
    const border = TT_BORDER[color];
    const bgTitle = '#161b22';
    const bgBody  = '#21262d';

    useLayoutEffect(() => {
        if (!visible || !triggerRef.current || !boxRef.current) return;
        const tr = triggerRef.current.getBoundingClientRect();
        const br = boxRef.current.getBoundingClientRect();
        const margin = 10;
        let left = tr.left + tr.width / 2;
        // Auto placement: below if trigger is in top 40% of viewport or forced
        const autoBelow = placement === 'bottom' || (placement !== 'top' && tr.top < window.innerHeight * 0.4);
        setBelow(autoBelow);
        const top = autoBelow ? tr.bottom + 6 : tr.top - 6;
        // Clamp horizontally so tooltip stays in viewport
        left = Math.max(margin + br.width / 2, Math.min(left, window.innerWidth - br.width / 2 - margin));
        setPos({ left, top });
        setReady(true);
    }, [visible, placement]);

    const show = () => { setReady(false); setVisible(true); };
    const hide = () => { setVisible(false); setReady(false); };

    const Wrapper = block ? 'div' : 'span';

    const tooltip = visible && createPortal(
        <div
            ref={boxRef}
            style={{
                position: 'fixed',
                left: pos.left,
                top: pos.top,
                transform: below ? 'translate(-50%, 0)' : 'translate(-50%, -100%) translateY(-4px)',
                zIndex: 10002,
                pointerEvents: 'none',
                opacity: ready ? 1 : 0,
                transition: 'opacity .15s ease',
                visibility: ready ? 'visible' : 'hidden',
            }}
        >
            {/* Box */}
            <div style={{
                position: 'relative',
                background: bgBody,
                border: `1px solid ${border}`,
                borderLeftWidth: 4,
                borderRadius: 8,
                minWidth: 160,
                maxWidth: 380,
                boxShadow: '0 6px 24px rgba(0,0,0,.6)',
                fontSize: '.82rem',
                lineHeight: 1.5,
                overflow: 'hidden',
            }}>
                {title && (
                    <span style={{
                        display: 'block',
                        fontWeight: 700,
                        fontSize: '.88rem',
                        color: accent,
                        padding: '.4rem .85rem .3rem',
                        borderBottom: '1px solid rgba(255,255,255,.06)',
                        background: bgTitle,
                    }}>
                        {title}
                    </span>
                )}
                <span style={{
                    display: 'block',
                    color: '#e6edf3',
                    fontSize: '.8rem',
                    lineHeight: 1.5,
                    padding: '.35rem .85rem .5rem',
                    whiteSpace: 'pre-wrap',
                }}>
                    {bodyNode ?? body}
                </span>
                {/* Arrow — points toward trigger */}
                <div style={{
                    position: 'absolute',
                    left: '50%',
                    ...(below
                        ? { top: -7,    borderBottom: `7px solid ${bgBody}`, borderTop: 'none' }
                        : { bottom: -7, borderTop:    `7px solid ${bgBody}`, borderBottom: 'none' }),
                    transform: 'translateX(-50%)',
                    width: 0, height: 0,
                    borderLeft: '7px solid transparent',
                    borderRight: '7px solid transparent',
                }} />
            </div>
        </div>,
        document.body,
    );

    return (
        <>
            <Wrapper
                ref={triggerRef as React.RefObject<HTMLDivElement>}
                onMouseEnter={show}
                onMouseLeave={hide}
                style={{ display: block ? 'block' : 'inline-flex' } as React.CSSProperties}
            >
                {children}
            </Wrapper>
            {tooltip}
        </>
    );
};
