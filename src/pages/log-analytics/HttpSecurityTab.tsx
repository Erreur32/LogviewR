/**
 * HttpSecurityTab - LogviewR /log-analytics
 *
 * Bot vs Human detection, HTTP methods & codes-by-domain breakdown, and response
 * time distribution — the diagnostics that still require a live raw-log scan
 * (too high-cardinality to reduce to a daily rollup blob).
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { DualBarChart } from '../../components/widgets/DualBarChart';
import { DonutChart } from '../../components/widgets/DonutChart';
import { ResponseTimeChart } from '../../components/widgets/ResponseTimeChart';
import { RankBadge } from '../../components/widgets/RankBadge';
import type {
    AnalyticsDistribution,
    AnalyticsStatusByHostItem,
    AnalyticsBotVsHuman,
    AnalyticsResponseTimeDistribution
} from '../../types/analytics';
import { SectionHeading, NoDataOrLoading, DistributionChart, type HeadingCommon } from './shared';
import { getStatusColor, noDataOrLoadingText } from './utils';

interface HttpSecurityTabProps {
    heading: HeadingCommon;
    isLoading: boolean;
    botVsHuman: AnalyticsBotVsHuman | null;
    distMethods: AnalyticsDistribution[];
    statusByHost: AnalyticsStatusByHostItem[];
    responseTimeDist: AnalyticsResponseTimeDistribution | null;
}

export const HttpSecurityTab: React.FC<HttpSecurityTabProps> = ({
    heading, isLoading, botVsHuman, distMethods, statusByHost, responseTimeDist
}) => {
    const { t } = useTranslation();
    return (
        <>
            {/* Bot vs Human */}
            {isLoading && !botVsHuman ? (
                <div id="section-bot-detection" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                    <SectionHeading {...heading}>{t('logAnalytics.botDetectionTitle')}</SectionHeading>
                    <NoDataOrLoading loading={isLoading} />
                </div>
            ) : botVsHuman && (botVsHuman.bots > 0 || botVsHuman.humans > 0) && (
                <div id="section-bot-detection" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                    <SectionHeading {...heading}>{t('logAnalytics.botDetectionTitle')}</SectionHeading>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <DonutChart
                            segments={[
                                { label: t('logAnalytics.humanLabel'), value: botVsHuman.humans, color: '#059669' },
                                { label: t('logAnalytics.botLabel'), value: botVsHuman.bots, color: '#4b5563' }
                            ]}
                            centerValue={`${botVsHuman.botPercent}%`}
                            centerLabel={t('logAnalytics.botLabel')}
                        />
                        {botVsHuman.topBots.length > 0 && (
                            <div>
                                <h4 className="text-sm font-semibold text-gray-400 mb-3">
                                    {t('logAnalytics.topBotsTitle')}
                                </h4>
                                <div className="space-y-1 max-h-48 overflow-y-auto -mx-1.5">
                                    {botVsHuman.topBots.map((bot, idx) => (
                                        <div
                                            key={bot.key}
                                            className="flex items-center gap-2 text-sm px-1.5 py-1 rounded-md border-l-2 border-transparent hover:border-gray-500/70 hover:bg-white/[0.03] transition-colors"
                                        >
                                            <RankBadge rank={idx} />
                                            <span className="font-mono text-[13px] text-gray-400 truncate flex-1 min-w-0" title={bot.key}>{bot.key}</span>
                                            <span className="text-white font-semibold shrink-0 tabular-nums">{bot.count.toLocaleString()}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Panel: HTTP Methods & Codes by domain */}
            <div id="section-http-methods" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                <SectionHeading {...heading}>{t('logAnalytics.httpMethodsAndDomainPanel')}</SectionHeading>
                <DistributionChart
                    title={t('logAnalytics.httpMethodsDistribution')}
                    items={distMethods}
                    labelMinWidth="7rem"
                    loading={isLoading}
                />
                {statusByHost.length > 0 && (
                    <div className="mt-6 pt-6 border-t border-gray-800">
                        <h4 className="text-base font-semibold text-white mb-4">
                            {t('logAnalytics.statusByHost')}
                        </h4>
                        <DualBarChart
                            data={statusByHost.map((item) => ({
                                key: `${item.host} | ${item.status}`,
                                count: item.count,
                                uniqueVisitors: item.uniqueVisitors
                            }))}
                            colorByKey={(key) => {
                                const status = key.split(' | ')[1] ?? '';
                                return getStatusColor(status);
                            }}
                            labelWidth={450}
                            hitsLabel={t('logAnalytics.hits')}
                            visitorsLabel={t('logAnalytics.visitors')}
                            tableLayout
                        />
                    </div>
                )}
            </div>

            {/* Response Time Distribution */}
            {isLoading && !responseTimeDist ? (
                <div id="section-response-time" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                    <SectionHeading {...heading}>{t('logAnalytics.responseTimeTitle')}</SectionHeading>
                    <NoDataOrLoading loading={isLoading} />
                </div>
            ) : responseTimeDist && (
                <div id="section-response-time" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                    <SectionHeading {...heading}>{t('logAnalytics.responseTimeTitle')}</SectionHeading>
                    <ResponseTimeChart
                        avg={responseTimeDist.avg}
                        p50={responseTimeDist.p50}
                        p95={responseTimeDist.p95}
                        p99={responseTimeDist.p99}
                        max={responseTimeDist.max}
                        buckets={responseTimeDist.buckets}
                        noDataText={noDataOrLoadingText(t, isLoading)}
                    />
                </div>
            )}
        </>
    );
};
