/**
 * TopsTab - LogviewR /log-analytics
 *
 * All rankings ("Top X") in one place: one representation per category — the
 * detailed table/dual-bar-chart for URLs and referrers (they carry hits +
 * visitors + bytes + method/protocol, more info than a small TopPanel), and
 * the compact TopPanel format for IPs/status/browsers/user-agents (no
 * detailed-table equivalent exists for those). Top 404 lives here too — it's
 * a ranking like the others, no strong reason it was split into the HTTP tab.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { DualBarChart } from '../../components/widgets/DualBarChart';
import type {
    AnalyticsTopItem,
    AnalyticsTopItemWithVisitors,
    AnalyticsTopUrlItem
} from '../../types/analytics';
import { SectionHeading, NoDataOrLoading, TopPanel, RequestedFileTableRow, SourceBadge, type HeadingCommon } from './shared';

interface TopsTabProps {
    heading: HeadingCommon;
    isLoading: boolean;
    sourceLabel: string;
    sourceColorClass: string;
    referringSites: AnalyticsTopItemWithVisitors[];
    hostWithVisitors: AnalyticsTopItemWithVisitors[];
    referrerWithVisitors: AnalyticsTopItemWithVisitors[];
    urlsWithExtras: AnalyticsTopUrlItem[];
    notFoundUrls: AnalyticsTopItemWithVisitors[];
    topIps: AnalyticsTopItem[];
    topStatus: AnalyticsTopItem[];
    topBrowsers: AnalyticsTopItem[];
    topUserAgents: AnalyticsTopItem[];
}

export const TopsTab: React.FC<TopsTabProps> = ({
    heading, isLoading, sourceLabel, sourceColorClass,
    referringSites, hostWithVisitors, referrerWithVisitors, urlsWithExtras, notFoundUrls,
    topIps, topStatus, topBrowsers, topUserAgents
}) => {
    const { t } = useTranslation();
    const sourceBadge = <SourceBadge label={sourceLabel} colorClass={sourceColorClass} />;
    return (
        <>
            {/* Referring Sites & Virtual Hosts */}
            <div id="section-referring" className="grid grid-cols-1 lg:grid-cols-2 gap-6 scroll-mt-24">
                <div className="bg-[#121212] rounded-xl border border-gray-800 p-6">
                    <SectionHeading {...heading}>{t('logAnalytics.referringSites')}</SectionHeading>
                    {referringSites.length > 0 ? (
                        <DualBarChart
                            data={referringSites}
                            labelWidth={500}
                            hitsLabel={t('logAnalytics.hits')}
                            visitorsLabel={t('logAnalytics.visitors')}
                            tableLayout
                        />
                    ) : (
                        <NoDataOrLoading loading={isLoading} />
                    )}
                </div>
                <div id="section-virtual-hosts" className="bg-[#121212] rounded-xl border border-gray-800 p-6">
                    <SectionHeading {...heading}>{t('logAnalytics.virtualHosts')}</SectionHeading>
                    {hostWithVisitors.length > 0 ? (
                        <DualBarChart
                            data={hostWithVisitors}
                            labelWidth={500}
                            hitsLabel={t('logAnalytics.hits')}
                            visitorsLabel={t('logAnalytics.visitors')}
                            tableLayout
                        />
                    ) : (
                        <NoDataOrLoading loading={isLoading} />
                    )}
                </div>
            </div>

            {/* Referrer URLs (with visitors) */}
            <div id="section-referrer-urls" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                <SectionHeading {...heading}>{t('logAnalytics.referrerUrls')}</SectionHeading>
                {referrerWithVisitors.length > 0 ? (
                    <DualBarChart
                        data={referrerWithVisitors}
                        labelWidth={600}
                        hitsLabel={t('logAnalytics.hits')}
                        visitorsLabel={t('logAnalytics.visitors')}
                        tableLayout
                    />
                ) : (
                    <NoDataOrLoading loading={isLoading} />
                )}
            </div>

            {/* Requested Files (URLs with extras) */}
            <div id="section-requested-files" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                <SectionHeading {...heading}>{t('logAnalytics.requestedFiles')}</SectionHeading>
                {urlsWithExtras.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm border-separate border-spacing-0">
                            <thead>
                                <tr className="text-[11px] text-gray-500 uppercase tracking-wide">
                                    <th className="text-left py-2 font-medium">{t('logAnalytics.topUrls')}</th>
                                    <th className="text-right py-2 font-medium">{t('logAnalytics.hits')}</th>
                                    <th className="text-right py-2 font-medium">{t('logAnalytics.visitors')}</th>
                                    <th className="text-right py-2 font-medium">{t('logAnalytics.txAmount')}</th>
                                    <th className="text-center py-2 font-medium">{t('logAnalytics.method')}</th>
                                    <th className="text-center py-2 font-medium">{t('logAnalytics.protocol')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {urlsWithExtras.slice(0, 15).map((item, idx) => (
                                    <RequestedFileTableRow
                                        key={`${item.key}-${idx}`}
                                        item={item}
                                        idx={idx}
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <NoDataOrLoading loading={isLoading} />
                )}
            </div>

            {/* Top 404 URLs */}
            {isLoading && notFoundUrls.length === 0 ? (
                <div id="section-top404" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                    <SectionHeading {...heading}>{t('logAnalytics.top404Title')}</SectionHeading>
                    <NoDataOrLoading loading={isLoading} />
                </div>
            ) : notFoundUrls.length > 0 && (
                <div id="section-top404" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                    <SectionHeading {...heading}>{t('logAnalytics.top404Title')}</SectionHeading>
                    <DualBarChart
                        data={notFoundUrls}
                        labelWidth={500}
                        hitsLabel={t('logAnalytics.hits')}
                        visitorsLabel={t('logAnalytics.visitors')}
                        tableLayout
                    />
                </div>
            )}

            {/* Top panels: IPs / status / browsers / user-agents — no detailed-table equivalent for these */}
            <div id="section-top-panels" className="space-y-4 scroll-mt-24">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <TopPanel
                        title={t('logAnalytics.topIps')}
                        items={topIps}
                        loading={isLoading && topIps.length === 0}
                        maxVisibleWithoutScroll={5}
                        scrollWhenCollapsed={false}
                        sourceBadge={sourceBadge}
                    />
                    <TopPanel
                        title={t('logAnalytics.topStatus')}
                        items={topStatus}
                        loading={isLoading && topStatus.length === 0}
                        maxVisibleWithoutScroll={5}
                        scrollWhenCollapsed={false}
                        sourceBadge={sourceBadge}
                    />
                    <TopPanel
                        title={t('logAnalytics.topBrowsers')}
                        items={topBrowsers}
                        loading={isLoading && topBrowsers.length === 0}
                        maxKeyLength={25}
                        maxVisibleWithoutScroll={5}
                        scrollWhenCollapsed={false}
                        sourceBadge={sourceBadge}
                    />
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <TopPanel
                        title={t('logAnalytics.topUserAgents')}
                        items={topUserAgents}
                        loading={isLoading && topUserAgents.length === 0}
                        maxKeyLength={50}
                        maxVisibleWithoutScroll={5}
                        scrollWhenCollapsed={false}
                        sourceBadge={sourceBadge}
                    />
                </div>
            </div>
        </>
    );
};
