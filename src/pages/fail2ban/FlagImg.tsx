import React from 'react';

export const FlagImg: React.FC<{ code: string; size?: number }> = ({ code, size = 20 }) => {
    const c = (code || '').toLowerCase().replaceAll(/[^a-z]/g, '');
    const src = c.length === 2 ? `/icons/country/${c}.svg` : '/icons/country/xx.svg';
    return (
        <img
            src={src}
            width={size} height={Math.round(size * 0.75)}
            alt={c.toUpperCase()}
            style={{ verticalAlign: 'middle', borderRadius: 2, flexShrink: 0, display: 'inline-block' }}
            onError={e => { (e.currentTarget as HTMLImageElement).src = '/icons/country/xx.svg'; }}
        />
    );
};
