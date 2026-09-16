/**
 * Presentational components shared across LogAnalyticsPage and its tab components
 * (OverviewTab, TopsTab, HttpSecurityTab).
 */

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Maximize2, Minimize2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { RankBadge } from '../../components/widgets/RankBadge';
import type { AnalyticsTopItem, AnalyticsTopUrlItem, AnalyticsDistribution } from '../../types/analytics';
import { formatBytes, getMethodColor, getStatusColor } from './utils';

/** Plugin source badge (NPM/Apache/all). Module-level to avoid re-creating the component on every render. */
export const SourceBadge: React.FC<{ label: string; colorClass: string }> = ({ label, colorClass }) => (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${colorClass}`}>
        {label}
    </span>
);

/** Current selected period badge (1h / 24h / 7j / 30j / custom). */
export const PeriodBadge: React.FC<{ label: string }> = ({ label }) => (
    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-sky-500/10 text-sky-400 border-sky-500/25 font-mono">
        {label}
    </span>
);

/** Info badge marking charts whose window is independent of the timeRange selector. */
export const FixedWindowBadge: React.FC<{ label?: string }> = ({ label = '12 mois' }) => (
    <span
        className="text-[.6rem] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
        title="Fenêtre d'agrégation du graphique — indépendant du sélecteur de période"
    >
        {label}
    </span>
);

export type LiveWindow = '24H' | 'SEMAINE';
const LIVE_WINDOW_LONG: Record<LiveWindow, string> = { '24H': '24h', 'SEMAINE': '7 jours' };

/** Toggle between the 12-month aggregate and a shorter "live" window (24h or 7d). */
export const LiveToggle: React.FC<{ live: boolean; onToggle: () => void; window: LiveWindow }> = ({ live, onToggle, window }) => {
    const title = live
        ? 'Revenir à la moyenne 12 mois'
        : `Afficher les dernières ${LIVE_WINDOW_LONG[window]} (live)`;
    const cls = live
        ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
        : 'border-gray-600/50 bg-gray-800/40 text-gray-400 hover:text-cyan-300 hover:border-cyan-500/40';
    return (
        <button
            type="button"
            onClick={onToggle}
            className={`text-[.6rem] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border transition-colors ${cls}`}
            title={title}
        >
            {live ? `LIVE ${window}` : window}
        </button>
    );
};

/** Exclusive 2-button switch between the 12-month aggregate and a shorter "live" window (24h or 7d). */
export const WindowSwitch: React.FC<{ live: boolean; onToggle: () => void; window: LiveWindow; fixedLabel?: string }> = ({ live, onToggle, window, fixedLabel = '12 mois' }) => {
    const base = 'text-[.6rem] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border transition-colors';
    const activeCls = 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300';
    const inactiveCls = 'border-gray-700/50 bg-gray-800/20 text-gray-600 hover:text-gray-400';
    return (
        <div className="flex items-center gap-1">
            <button
                type="button"
                onClick={() => { if (live) onToggle(); }}
                className={`${base} ${!live ? activeCls : inactiveCls}`}
                title="Moyenne sur 12 mois"
                aria-pressed={!live}
            >
                {fixedLabel}
            </button>
            <button
                type="button"
                onClick={() => { if (!live) onToggle(); }}
                className={`${base} ${live ? activeCls : inactiveCls}`}
                title={`Afficher les dernières ${LIVE_WINDOW_LONG[window]} (live)`}
                aria-pressed={live}
            >
                {window}
            </button>
        </div>
    );
};

/** Generic 2-3 option exclusive toggle (e.g. snapshot/trend view switches). For the specific 12-month/live-window case, use <WindowSwitch> instead. */
export function SegmentedToggle<T extends string>({ value, options, onChange }: {
    value: T;
    options: { value: T; label: string }[];
    onChange: (value: T) => void;
}) {
    const base = 'text-[.6rem] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border transition-colors';
    const activeCls = 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300';
    const inactiveCls = 'border-gray-700/50 bg-gray-800/20 text-gray-600 hover:text-gray-400';
    return (
        <div className="flex items-center gap-1">
            {options.map((opt) => (
                <button
                    key={opt.value}
                    type="button"
                    onClick={() => onChange(opt.value)}
                    className={`${base} ${value === opt.value ? activeCls : inactiveCls}`}
                    aria-pressed={value === opt.value}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    );
}

export interface SectionHeadingProps {
    children: React.ReactNode;
    sourceLabel: string;
    sourceColorClass: string;
    periodLabel: string;
    hidePeriod?: boolean;
    extras?: React.ReactNode;
    /** Shows a small spinner next to the title while this section's data is still being fetched/refreshed. */
    loading?: boolean;
}

export const SectionHeading: React.FC<SectionHeadingProps> = ({
    children, sourceLabel, sourceColorClass, periodLabel, hidePeriod, extras, loading
}) => (
    <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2.5">
        <span>{children}</span>
        <SourceBadge label={sourceLabel} colorClass={sourceColorClass} />
        {!hidePeriod && <PeriodBadge label={periodLabel} />}
        {loading && <Loader2 size={14} className="text-emerald-500/70 animate-spin" aria-hidden />}
        {extras}
    </h3>
);

/** Common props every <SectionHeading {...headingCommon}> spreads — precomputed once in LogAnalyticsPage. */
export type HeadingCommon = Pick<SectionHeadingProps, 'sourceLabel' | 'sourceColorClass' | 'periodLabel' | 'loading'>;

/** Empty-state placeholder that distinguishes "still fetching" from "genuinely no data" — avoids a confusing flash of "no data" while the full scan is still in flight (e.g. HTTP/Tops tab sections not covered by the DB-first quick preview). */
export const NoDataOrLoading: React.FC<{ loading?: boolean }> = ({ loading }) => {
    const { t } = useTranslation();
    return (
        <div className="h-32 flex flex-col items-center justify-center gap-2 text-gray-500 text-sm">
            {loading ? (
                <>
                    <Loader2 size={18} className="text-emerald-500/60 animate-spin" />
                    <span>{t('logAnalytics.loadingData')}</span>
                </>
            ) : (
                t('logAnalytics.noData')
            )}
        </div>
    );
};

/** TopPanel - extracted to module level so state (showAll) persists across parent re-renders. */
export const TopPanel: React.FC<{
    title: string;
    items: AnalyticsTopItem[];
    maxKeyLength?: number;
    showBar?: boolean;
    maxVisibleWithoutScroll?: number;
    scrollWhenCollapsed?: boolean;
    twoColumns?: boolean;
    sourceBadge?: React.ReactNode;
    /** Shown while items is still empty because the underlying fetch hasn't resolved yet (distinct from a genuinely empty result). */
    loading?: boolean;
}> = ({ title, items, showBar = true, maxVisibleWithoutScroll, scrollWhenCollapsed = true, twoColumns = false, sourceBadge, loading }) => {
    const { t } = useTranslation();
    const [hoveredItem, setHoveredItem] = useState<AnalyticsTopItem | null>(null);
    const [tooltipRect, setTooltipRect] = useState<DOMRect | null>(null);
    const [showAll, setShowAll] = useState(false);
    const maxPct = Math.max(...items.map((i) => i.percent ?? 0), 1);
    const limit = maxVisibleWithoutScroll ?? 5;
    const displayItems = showAll ? items : (maxVisibleWithoutScroll != null ? items.slice(0, limit) : items);
    const listMaxHeight = scrollWhenCollapsed && !showAll ? 'max-h-56' : '';
    const canToggle = maxVisibleWithoutScroll != null;
    return (
        <div className="bg-[#0a0a0a] rounded-lg border border-gray-800 overflow-hidden relative">
            <div className="flex items-center justify-between gap-2 px-4 py-2 text-sm font-semibold text-gray-300 border-b border-gray-800 bg-[#0f0f0f]">
                <div className="flex items-center gap-2 min-w-0">
                    <h4 className="truncate min-w-0">{title}</h4>
                    {items.length > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full bg-gray-800/80 text-[10px] text-gray-400 font-normal tabular-nums shrink-0">
                            {items.length}
                        </span>
                    )}
                    {sourceBadge}
                </div>
                {canToggle && (
                    <button
                        type="button"
                        onClick={() => setShowAll((v) => !v)}
                        className="p-1 rounded hover:bg-gray-700/50 text-gray-400 hover:text-emerald-400 transition-colors shrink-0"
                        title={showAll ? t('logAnalytics.showLimitedItems') : t('logAnalytics.showAllItems')}
                        aria-label={showAll ? t('logAnalytics.showLimitedItems') : t('logAnalytics.showAllItems')}
                    >
                        {showAll ? (
                            <Minimize2 size={16} />
                        ) : (
                            <Maximize2 size={16} />
                        )}
                    </button>
                )}
            </div>
            <div className="flex flex-col min-h-0">
                <div className={listMaxHeight ? `${listMaxHeight} overflow-y-auto` : ''}>
                    {items.length === 0 ? (
                        <div className="px-4 py-6 text-sm text-gray-500 text-center flex items-center justify-center gap-2">
                            {loading ? (
                                <>
                                    <Loader2 size={14} className="text-emerald-500/70 animate-spin" />
                                    {t('logAnalytics.loadingData')}
                                </>
                            ) : (
                                t('logAnalytics.noData')
                            )}
                        </div>
                    ) : (
                        <ul className={twoColumns ? 'grid grid-cols-2 gap-x-6' : 'divide-y divide-gray-800/40'}>
                            {displayItems.map((item, idx) => (
                                <li
                                    key={`${item.key}-${idx}`}
                                    className={`group px-3.5 py-2.5 relative border-l-2 border-transparent hover:border-emerald-500/70 hover:bg-emerald-500/[0.04] transition-colors duration-150 ${twoColumns ? 'border-b border-gray-800/40' : ''}`}
                                    onMouseEnter={(e) => {
                                        setHoveredItem(item);
                                        setTooltipRect(e.currentTarget.getBoundingClientRect());
                                    }}
                                    onMouseLeave={() => {
                                        setHoveredItem(null);
                                        setTooltipRect(null);
                                    }}
                                >
                                    <div className="flex items-center justify-between gap-2.5">
                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                            <RankBadge rank={idx} />
                                            <span className="text-[13px] font-mono text-gray-300 truncate group-hover:text-gray-100 transition-colors">
                                                {item.key}
                                            </span>
                                        </div>
                                        <span className="text-sm font-semibold text-white shrink-0 tabular-nums">
                                            {item.count.toLocaleString()}
                                            {item.percent != null && (
                                                <span className="text-gray-500 font-normal ml-1">({item.percent}%)</span>
                                            )}
                                        </span>
                                    </div>
                                    {showBar && item.percent != null && (
                                        <div className="mt-1.5 ml-7 h-1.5 bg-gray-800/60 rounded-full overflow-hidden">
                                            <div
                                                className="h-full rounded-full origin-left"
                                                style={{
                                                    width: `${(item.percent / maxPct) * 100}%`,
                                                    minWidth: item.percent > 0 ? 3 : 0,
                                                    background: idx === 0
                                                        ? 'linear-gradient(90deg, #059669, #34d399)'
                                                        : 'linear-gradient(90deg, #047857a0, #10b981)',
                                                    animation: 'barGrow 0.4s ease-out forwards',
                                                    animationDelay: `${idx * 30}ms`
                                                }}
                                            />
                                        </div>
                                    )}
                                    {hoveredItem?.key === item.key && tooltipRect && createPortal(
                                        <div
                                            className="fixed z-[99999] px-4 py-3 border border-gray-600 rounded-lg shadow-2xl text-sm pointer-events-none max-w-[min(90vw,480px)]"
                                            style={{ left: tooltipRect.left, top: tooltipRect.bottom + 6, backgroundColor: 'rgb(17, 24, 39)' }}
                                        >
                                            <div className="font-medium text-white break-all leading-relaxed">{item.key}</div>
                                            <div className="mt-2 pt-2 border-t border-gray-600/50 flex gap-4 text-gray-300">
                                                <span>{t('logAnalytics.hits')}: <strong className="text-white">{item.count}</strong></span>
                                                {item.percent != null && (
                                                    <span>{t('logAnalytics.total')}: <strong className="text-emerald-400">{item.percent}%</strong></span>
                                                )}
                                            </div>
                                        </div>,
                                        document.body
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
};

export const RequestedFileTableRow: React.FC<{
    item: AnalyticsTopUrlItem;
    idx: number;
}> = ({ item, idx }) => {
    const [hovered, setHovered] = useState(false);
    const [tooltipRect, setTooltipRect] = useState<DOMRect | null>(null);
    return (
        <tr
            className={`border-t border-gray-800/60 hover:bg-white/[0.03] transition-colors ${idx % 2 === 1 ? 'bg-white/[0.015]' : ''}`}
            onMouseEnter={(e) => {
                setHovered(true);
                setTooltipRect(e.currentTarget.getBoundingClientRect());
            }}
            onMouseLeave={() => {
                setHovered(false);
                setTooltipRect(null);
            }}
        >
            <td className="py-1.5 min-w-[200px] max-w-[500px] relative">
                <div className="flex items-center gap-2 min-w-0">
                    <RankBadge rank={idx} />
                    <div className="font-mono text-[13px] text-gray-300 truncate">{item.key}</div>
                </div>
                {hovered && tooltipRect && createPortal(
                    <div
                        className="fixed z-[99999] px-3 py-2.5 border border-gray-700 rounded-lg shadow-xl text-sm pointer-events-none"
                        style={{
                            left: tooltipRect.left,
                            top: tooltipRect.bottom + 4,
                            backgroundColor: 'rgb(17, 24, 39)'
                        }}
                    >
                        <div className="font-medium text-white break-all mb-1.5">{item.key}</div>
                        <div className="text-gray-300">Hits: {item.count}</div>
                        <div className="text-emerald-600">Visitors: {item.uniqueVisitors}</div>
                        {item.txAmount != null && item.txAmount > 0 && (
                            <div className="text-purple-300 mt-0.5">Traffic: {formatBytes(item.txAmount)}</div>
                        )}
                    </div>,
                    document.body
                )}
            </td>
            <td className="py-1.5 text-right text-white font-semibold tabular-nums">{item.count.toLocaleString()}</td>
            <td className="py-1.5 text-right text-emerald-400 tabular-nums">{item.uniqueVisitors.toLocaleString()}</td>
            <td className="py-1.5 text-right text-purple-300 tabular-nums">{formatBytes(item.txAmount ?? 0)}</td>
            <td className="py-1.5 text-center">
                {item.method ? (
                    <span className={`inline-block px-1.5 py-0.5 rounded border text-[11px] font-mono font-medium ${getMethodColor(item.method)}`}>
                        {item.method}
                    </span>
                ) : (
                    <span className="text-gray-600">-</span>
                )}
            </td>
            <td className="py-1.5 text-center text-gray-400 font-mono text-xs">{item.protocol ?? '-'}</td>
        </tr>
    );
};

/** Distribution bar chart (methods / status codes). `loading` gates the empty-state spinner. */
export const DistributionChart: React.FC<{
    title: string;
    items: AnalyticsDistribution[];
    colorByKey?: (key: string) => string;
    /** Min width for label column (e.g. 5rem for status codes, 6rem for method names like PROPFIND/UNKNOWN). */
    labelMinWidth?: string;
    loading?: boolean;
}> = ({ title, items, colorByKey, labelMinWidth = '6rem', loading }) => {
    const maxCount = Math.max(...items.map((i) => i.count), 1);
    const getColor = colorByKey ?? getStatusColor;
    return (
        <div className="bg-[#121212] rounded-xl border border-gray-800 p-6">
            <h3 className="text-lg font-semibold text-white mb-4">{title}</h3>
            {items.length === 0 ? (
                <NoDataOrLoading loading={loading} />
            ) : (
                <div className="space-y-2.5">
                    {items.map((item) => (
                        <div key={item.key} className="flex items-center gap-3">
                            <span className="text-sm font-mono text-gray-400 text-right shrink-0" style={{ minWidth: labelMinWidth }}>
                                {item.key}
                            </span>
                            <div className="flex-1 h-6 bg-gray-800/60 rounded overflow-hidden">
                                <div
                                    className="h-full rounded transition-all duration-500"
                                    style={{ width: `${(item.count / maxCount) * 100}%`, backgroundColor: getColor(item.key) }}
                                />
                            </div>
                            <span className="text-sm font-semibold text-white shrink-0 tabular-nums w-16 text-right">
                                {item.count.toLocaleString()}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
