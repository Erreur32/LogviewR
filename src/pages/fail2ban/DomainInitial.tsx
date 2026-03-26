import React from 'react';

/** Hash string → stable hue (0–359) */
function domainHue(domain: string): number {
    let h = 0;
    for (let i = 0; i < domain.length; i++) h = (h * 31 + domain.charCodeAt(i)) & 0xfffffff;
    return h % 360;
}

/**
 * Local SVG initial avatar for a domain — no external requests.
 * Replaces Google/DuckDuckGo favicon APIs.
 */
export const DomainInitial: React.FC<{ domain: string; size?: number }> = ({ domain, size = 14 }) => {
    const root = domain.replace(/^(www\.|m\.)/, '').split('.')[0] ?? '?';
    const letter = root[0]?.toUpperCase() ?? '?';
    const hue = domainHue(domain);
    const bg  = `hsl(${hue},45%,28%)`;
    const fg  = `hsl(${hue},70%,80%)`;
    const r   = Math.round(size * 0.18);
    return (
        <svg width={size} height={size} viewBox="0 0 14 14" style={{ flexShrink: 0, verticalAlign: 'middle', display: 'inline-block' }}>
            <rect width="14" height="14" rx={r} fill={bg} />
            <text x="7" y="10.5" textAnchor="middle" fontSize="8" fontWeight="700"
                fontFamily="system-ui,sans-serif" fill={fg}>{letter}</text>
        </svg>
    );
};
