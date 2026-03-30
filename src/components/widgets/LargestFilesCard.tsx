import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HardDrive, ChevronDown, ChevronUp, RefreshCw, Archive } from 'lucide-react';
import { api } from '../../api/client';
import { getPluginIcon } from '../../utils/pluginIcons';
import { Badge } from '../ui/Badge';
import { Tooltip } from '../ui/Tooltip';
import { formatBytes } from '../../utils/constants';

interface LargestFileEntry {
    path: string;
    size: number;
    pluginId: string;
    pluginName: string;
    type: string;
    modified: string;
    isCompressed: boolean;
}

export const LargestFilesCard: React.FC = () => {
    const { t } = useTranslation();
    const [largestFiles, setLargestFiles] = useState<LargestFileEntry[]>([]);
    const [isLoadingLargestFiles, setIsLoadingLargestFiles] = useState(true);
    const [isExpanded, setIsExpanded] = useState(false);

    useEffect(() => {
        const fetchLargestFiles = async (quick: boolean = false): Promise<void> => {
            setIsLoadingLargestFiles(true);
            try {
                const quickParam = quick ? '&quick=true' : '';
                const response = await api.get<{
                    files: LargestFileEntry[];
                    total: number;
                }>(`/api/log-viewer/largest-files?limit=10${quickParam}`);

                if (response.success && response.result) {
                    setLargestFiles(response.result.files);
                    setIsLoadingLargestFiles(false);

                    // If quick mode, load complete data in background
                    if (quick) {
                        fetchLargestFiles(false).catch((err) => {
                            console.warn('Failed to load complete largest files:', err);
                        });
                    }
                } else {
                    setIsLoadingLargestFiles(false);
                }
            } catch (error) {
                console.error('Failed to fetch largest files:', error);
                setIsLoadingLargestFiles(false);
            }
        };

        // Load quick first, then complete in background
        fetchLargestFiles(true).catch((err) => {
            console.error('Failed to fetch largest files (initial):', err);
            setIsLoadingLargestFiles(false);
        });
    }, []);

    return (
        <section className="bg-theme-tertiary rounded-xl border border-theme-border overflow-hidden">
            <button
                type="button"
                onClick={() => setIsExpanded((prev) => !prev)}
                className="w-full flex items-center justify-between p-4 md:p-5 hover:bg-theme-secondary transition-colors"
            >
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-orange-500/20 rounded-lg">
                        <HardDrive size={22} className="text-orange-400" />
                    </div>
                    <div className="text-left">
                        <h2 className="text-sm md:text-base font-semibold text-theme-primary">
                            {t('analytics.largestFilesTitle')}
                        </h2>
                        <p className="text-xs text-gray-500">{t('analytics.largestFilesDesc')}</p>
                    </div>
                </div>
                {isExpanded ? (
                    <ChevronUp size={18} className="text-gray-400" />
                ) : (
                    <ChevronDown size={18} className="text-gray-400" />
                )}
            </button>

            {isExpanded && (
                <div className="px-4 md:px-6 pb-4 md:pb-6">
                    {isLoadingLargestFiles ? (
                        <div className="flex items-center justify-center py-6">
                            <RefreshCw className="w-5 h-5 text-gray-500 animate-spin" />
                            <span className="ml-2 text-gray-500 text-sm">{t('analytics.loading')}</span>
                        </div>
                    ) : largestFiles.length === 0 ? (
                        <div className="bg-[#0a0a0a] rounded-lg p-4 border border-gray-700">
                            <div className="text-sm text-gray-500">{t('analytics.noFilesFound')}</div>
                        </div>
                    ) : (
                        <div className="bg-[#0a0a0a] rounded-lg border border-gray-700 overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead className="bg-[#0f0f0f] border-b border-gray-800">
                                        <tr>
                                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase">
                                                #
                                            </th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase">
                                                {t('analytics.tablePlugin')}
                                            </th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase">
                                                {t('analytics.tablePath')}
                                            </th>
                                            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400 uppercase">
                                                {t('analytics.tableSize')}
                                            </th>
                                            <th className="px-4 py-3 text-center text-xs font-semibold text-gray-400 uppercase">
                                                {t('analytics.tableType')}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-800">
                                        {largestFiles.map((file, index) => (
                                            <tr key={`${file.pluginId}:${file.path}:${index}`} className="hover:bg-[#0f0f0f] transition-colors">
                                                <td className="px-4 py-3 text-sm text-gray-400 font-mono">
                                                    {index + 1}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-2">
                                                        <img
                                                            src={getPluginIcon(file.pluginId)}
                                                            alt={file.pluginName}
                                                            className="w-4 h-4 flex-shrink-0"
                                                        />
                                                        <span className="text-sm text-gray-300">{file.pluginName}</span>
                                                        {file.isCompressed && (
                                                            <Tooltip content={t('analytics.compressedFileTooltip')}>
                                                                <Archive size={14} className="text-red-400 cursor-help" />
                                                            </Tooltip>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="text-xs md:text-sm text-gray-300 font-mono break-all">
                                                        {file.path}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    <span className="text-sm font-semibold text-white">
                                                        {formatBytes(file.size)}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    <Badge variant="default" size="sm">
                                                        {file.type}
                                                    </Badge>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}

