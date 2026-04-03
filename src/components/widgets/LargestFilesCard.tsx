import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HardDrive, ChevronDown, ChevronUp, RefreshCw, Archive } from 'lucide-react';
import { api } from '../../api/client';
import { getPluginIcon } from '../../utils/pluginIcons';
import { Tooltip } from '../ui/Tooltip';
import { formatBytes } from '../../utils/constants';
import { F2bTooltip, TT } from '../../pages/fail2ban/helpers';
import { DomainInitial } from '../../pages/fail2ban/DomainInitial';

const TYPE_STYLE: Record<string, { color: string; border: string; bg: string }> = {
    access:  { color: '#3fb950', border: 'rgba(63,185,80,.35)',   bg: 'rgba(63,185,80,.08)'   },
    error:   { color: '#e86a65', border: 'rgba(232,106,101,.35)', bg: 'rgba(232,106,101,.08)' },
    syslog:  { color: '#58a6ff', border: 'rgba(88,166,255,.35)',  bg: 'rgba(88,166,255,.08)'  },
    auth:    { color: '#e3b341', border: 'rgba(227,179,65,.35)',  bg: 'rgba(227,179,65,.08)'  },
    system:  { color: '#39c5cf', border: 'rgba(57,197,207,.35)',  bg: 'rgba(57,197,207,.08)'  },
    kernel:  { color: '#bc8cff', border: 'rgba(188,140,255,.35)', bg: 'rgba(188,140,255,.08)' },
    default: { color: '#8b949e', border: 'rgba(139,148,158,.35)', bg: 'rgba(139,148,158,.08)' },
};

const TypeBadge: React.FC<{ type: string }> = ({ type }) => {
    const s = TYPE_STYLE[type] ?? TYPE_STYLE.default;
    return (
        <span style={{
            display: 'inline-block', padding: '.1rem .45rem', borderRadius: 4,
            fontSize: '.7rem', fontWeight: 600, letterSpacing: '.02em',
            color: s.color, border: `1px solid ${s.border}`, background: s.bg,
            whiteSpace: 'nowrap',
        }}>
            {type}
        </span>
    );
};

interface LargestFileEntry {
    path: string;
    size: number;
    pluginId: string;
    pluginName: string;
    type: string;
    modified: string;
    isCompressed: boolean;
    domain?: string;
}

interface Props {
    limit?: number;
}

const Toggle: React.FC<{ checked: boolean; onChange: () => void; color?: string }> = ({ checked, onChange, color = 'bg-amber-500' }) => (
    <div
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        className={`relative w-8 h-4 rounded-full transition-colors duration-150 shrink-0 cursor-pointer ${checked ? color : 'bg-gray-700 hover:bg-gray-600'}`}
    >
        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform duration-150 ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </div>
);

export const LargestFilesCard: React.FC<Props> = ({ limit = 20 }) => {
    const { t } = useTranslation();
    const [files, setFiles] = useState<LargestFileEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isExpanded, setIsExpanded] = useState(false);
    const [hideGz, setHideGz] = useState(false);
    const [hideRotated, setHideRotated] = useState(false);
    const [showAll, setShowAll] = useState(false);

    useEffect(() => {
        const fetchFiles = async (quick: boolean = false): Promise<void> => {
            setIsLoading(true);
            try {
                const quickParam = quick ? '&quick=true' : '';
                const response = await api.get<{ files: LargestFileEntry[]; total: number }>(
                    `/api/log-viewer/largest-files?limit=${limit}${quickParam}`
                );
                if (response.success && response.result) {
                    setFiles(response.result.files);
                    setIsLoading(false);
                    if (quick) {
                        fetchFiles(false).catch(() => {});
                    }
                } else {
                    setIsLoading(false);
                }
            } catch {
                setIsLoading(false);
            }
        };
        fetchFiles(true).catch(() => setIsLoading(false));
    }, [limit]);

    const filtered = files.filter(f => {
        const lower = f.path.toLowerCase();
        if (hideGz && (lower.endsWith('.gz') || lower.endsWith('.tgz'))) return false;
        if (hideRotated && /\.log\.\d+$/.test(lower)) return false;
        return true;
    });

    const displayed = showAll ? filtered : filtered.slice(0, 10);

    return (
        <section className="bg-theme-tertiary rounded-xl border border-theme-border overflow-hidden">
            <button
                type="button"
                onClick={() => setIsExpanded(prev => !prev)}
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
                {isExpanded ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
            </button>

            {isExpanded && (
                <div className="px-4 md:px-6 pb-4 md:pb-6">
                    {/* Filter bar */}
                    <div className="flex flex-wrap items-center gap-3 mb-4">
                        <label className="flex items-center gap-2 cursor-pointer select-none group">
                            <Toggle checked={showAll} onChange={() => setShowAll(v => !v)} color="bg-cyan-500" />
                            <span className="text-xs text-gray-400 group-hover:text-gray-300">Tout afficher</span>
                        </label>
                        <div className="w-px h-4 bg-gray-700" />
                        <label className="flex items-center gap-2 cursor-pointer select-none group">
                            <Toggle checked={hideGz} onChange={() => setHideGz(v => !v)} />
                            <span className="text-xs text-gray-400 group-hover:text-gray-300">Masquer .gz</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer select-none group">
                            <Toggle checked={hideRotated} onChange={() => setHideRotated(v => !v)} />
                            <span className="text-xs text-gray-400 group-hover:text-gray-300">Masquer .log.1</span>
                        </label>
                        {isLoading && <RefreshCw size={13} className="text-gray-500 animate-spin ml-auto" />}
                    </div>

                    {isLoading ? (
                        <div className="flex items-center justify-center py-6">
                            <RefreshCw className="w-5 h-5 text-gray-500 animate-spin" />
                            <span className="ml-2 text-gray-500 text-sm">{t('analytics.loading')}</span>
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="bg-[#0a0a0a] rounded-lg p-4 border border-gray-700">
                            <div className="text-sm text-gray-500">{t('analytics.noFilesFound')}</div>
                        </div>
                    ) : (
                        <div className="bg-[#0a0a0a] rounded-lg border border-gray-700 overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead className="bg-[#0f0f0f] border-b border-gray-800">
                                        <tr>
                                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase">#</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase">{t('analytics.tablePlugin')}</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase">{t('analytics.tablePath')}</th>
                                            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400 uppercase">{t('analytics.tableSize')}</th>
                                            <th className="px-4 py-3 text-center text-xs font-semibold text-gray-400 uppercase">{t('analytics.tableType')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-800">
                                        {displayed.map((file, index) => (
                                            <tr key={`${file.pluginId}:${file.path}:${index}`} className="hover:bg-[#0f0f0f] transition-colors">
                                                <td className="px-4 py-3 text-sm text-gray-400 font-mono">{index + 1}</td>
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-2">
                                                        <img
                                                            src={getPluginIcon(file.pluginId)}
                                                            alt={file.pluginName}
                                                            className="w-4 h-4 flex-shrink-0"
                                                        />
                                                        <span className="text-sm text-gray-300 whitespace-nowrap">{file.pluginName}</span>
                                                        {file.isCompressed && (
                                                            <Tooltip content={t('analytics.compressedFileTooltip')}>
                                                                <Archive size={14} className="text-red-400 cursor-help" />
                                                            </Tooltip>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <F2bTooltip
                                                        title={file.path.split('/').pop() || file.path}
                                                        color="muted"
                                                        width={360}
                                                        bodyNode={<>
                                                            {TT.section('Chemin complet')}
                                                            {TT.info(file.path)}
                                                            {TT.sep()}
                                                            {TT.section('Informations')}
                                                            {TT.info(`Plugin : ${file.pluginName}`)}
                                                            {TT.info(`Type : ${file.type}`)}
                                                            {TT.info(`Taille : ${formatBytes(file.size)}`)}
                                                            {file.modified && TT.info(`Modifié : ${new Date(file.modified).toLocaleDateString('fr-FR')}`)}
                                                            {file.domain && <>{TT.sep()}{TT.section('Domaine')}{TT.row(<DomainInitial domain={file.domain} size={12} />, file.domain)}</>}
                                                        </>}
                                                    >
                                                        <a
                                                            href={`#log/${file.pluginId}${file.path}`}
                                                            className="text-xs md:text-sm text-blue-400 hover:text-blue-300 font-mono break-all hover:underline"
                                                            onClick={e => e.stopPropagation()}
                                                        >
                                                            {file.path}
                                                        </a>
                                                    </F2bTooltip>
                                                    {file.domain && (
                                                        <div className="flex items-center gap-1 mt-0.5">
                                                            <DomainInitial domain={file.domain} size={12} />
                                                            <span className="text-xs text-gray-500 italic">{file.domain}</span>
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    <span className="text-sm font-semibold text-white whitespace-nowrap">
                                                        {formatBytes(file.size)}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    <TypeBadge type={file.type} />
                                                </td>
                                            </tr>
                                        ))}
                                        {!showAll && filtered.length > 10 && (
                                            <tr>
                                                <td colSpan={5} className="px-4 py-2 text-center">
                                                    <button
                                                        onClick={() => setShowAll(true)}
                                                        className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                                                    >
                                                        + {filtered.length - 10} fichier{filtered.length - 10 > 1 ? 's' : ''} supplémentaire{filtered.length - 10 > 1 ? 's' : ''}
                                                    </button>
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                            {showAll && (
                                <div className="px-4 py-2 border-t border-gray-800 text-xs text-gray-600">
                                    {filtered.length} fichier{filtered.length !== 1 ? 's' : ''} affiché{filtered.length !== 1 ? 's' : ''}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </section>
    );
};
