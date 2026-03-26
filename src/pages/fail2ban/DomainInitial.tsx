import React, { useState } from 'react';

/** Hash string → stable hue (0–359) */
function domainHue(domain: string): number {
    let h = 0;
    for (let i = 0; i < domain.length; i++) h = (h * 31 + domain.charCodeAt(i)) & 0xfffffff;
    return h % 360;
}

/** Letter avatar SVG — final fallback when all favicon sources fail */
const LetterAvatar: React.FC<{ domain: string; size: number }> = ({ domain, size }) => {
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

/**
 * Domain favicon with fallback chain:
 *   1. DuckDuckGo  (icons.duckduckgo.com/ip3/{domain}.ico)
 *   2. Google      (google.com/s2/favicons?domain=…&sz=32)
 *   3. Letter SVG  (generated locally — no external request)
 */
export const DomainInitial: React.FC<{ domain: string; size?: number }> = ({ domain, size = 14 }) => {
    const [stage, setStage] = useState<0 | 1 | 2>(0);

    if (stage === 2) return <LetterAvatar domain={domain} size={size} />;

    const src = stage === 0
        ? `https://icons.duckduckgo.com/ip3/${domain}.ico`
        : `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;

    return (
        <img
            src={src}
            width={size} height={size}
            style={{ borderRadius: 2, flexShrink: 0, display: 'inline-block', verticalAlign: 'middle' }}
            title={domain} alt={domain} loading="lazy"
            onError={() => setStage(s => (s < 2 ? (s + 1) as 1 | 2 : 2))}
        />
    );
};
