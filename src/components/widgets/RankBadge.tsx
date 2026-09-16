/**
 * RankBadge - small numbered circle for ranked lists (Top URLs/IPs/..., referring sites, etc).
 * Top 3 get a gold/silver/bronze accent, the rest a neutral badge.
 */

import React from 'react';

const RANK_STYLES = [
    'bg-amber-400/15 text-amber-300 border-amber-400/50 shadow-[0_0_8px_rgba(251,191,36,0.3)]',
    'bg-slate-300/15 text-slate-200 border-slate-300/40',
    'bg-orange-700/20 text-orange-400 border-orange-700/50'
];

export const RankBadge: React.FC<{ rank: number }> = ({ rank }) => (
    <span
        className={`flex items-center justify-center shrink-0 w-5 h-5 rounded-full border text-[10px] font-bold tabular-nums ${
            RANK_STYLES[rank] ?? 'bg-gray-800/80 text-gray-500 border-gray-700'
        }`}
    >
        {rank + 1}
    </span>
);
