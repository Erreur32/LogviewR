/**
 * Log File History Modal
 *
 * Displays the history of log files already requested/opened by the user.
 * Provides a button to clear the history list.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { X, FileText, History, Trash2 } from 'lucide-react';
import { getPluginIcon } from '../../utils/pluginIcons';

export interface LogFileHistoryEntry {
    filePath: string;
    logType: string;
    pluginId: string;
    pluginName?: string;
    requestedAt: number;
    /** Number of times this log page has been displayed */
    viewCount?: number;
}

/** localStorage key for history (shared with dashboard card) */
export const LOGFILE_HISTORY_KEY = 'logviewr-logfile-history';

interface LogFileHistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    entries: LogFileHistoryEntry[];
    onClearHistory: () => void;
    /** When user clicks an entry, open that log (redirect) */
    onSelectEntry?: (entry: LogFileHistoryEntry) => void;
    osType?: string;
}

export const LogFileHistoryModal: React.FC<LogFileHistoryModalProps> = ({
    isOpen,
    onClose,
    entries,
    onClearHistory,
    onSelectEntry,
    osType
}) => {
    const { t } = useTranslation();
    if (!isOpen) return null;

    const formatDate = (ts: number) => {
        const d = new Date(ts);
        return d.toLocaleString('fr-FR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const displayName = (path: string) => path.split('/').pop() || path;

    return (
        <div
            className="fixed inset-0 z-[100] flex items-start justify-center bg-black/80 backdrop-blur-sm p-4 pt-16"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div
                className="bg-[#121212] border border-gray-700 rounded-lg w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between p-6 border-b border-gray-800 flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-amber-500/20 rounded-lg">
                            <History size={28} className="text-amber-400" />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold text-white">
                                {t('dashboard.logHistoryModalTitle')}
                            </h2>
                            <p className="text-sm text-gray-500 mt-0.5">
                                {t('dashboard.logHistoryModalSubtitle')}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white transition-colors p-2 hover:bg-gray-800 rounded-lg"
                    >
                        <X size={24} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    {entries.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <FileText size={48} className="mx-auto mb-4 text-gray-600" />
                            <p className="text-base font-medium">{t('dashboard.noFilesInHistory')}</p>
                            <p className="text-sm mt-1">{t('dashboard.filesYouOpenWillAppear')}</p>
                        </div>
                    ) : (
                        <ul className="space-y-2">
                            {entries.map((entry, index) => (
                                <li
                                    key={`${entry.filePath}-${entry.pluginId}-${entry.requestedAt}-${index}`}
                                    role={onSelectEntry ? 'button' : undefined}
                                    onClick={() => {
                                        if (onSelectEntry) {
                                            onSelectEntry(entry);
                                            onClose();
                                        }
                                    }}
                                    className={`flex items-center gap-3 px-4 py-3 bg-[#1a1a1a] border border-gray-800 rounded-lg ${onSelectEntry ? 'cursor-pointer hover:bg-[#252525] hover:border-gray-700 transition-colors' : ''}`}
                                >
                                    <img
                                        src={getPluginIcon(entry.pluginId, entry.pluginId === 'host-system' ? osType : undefined)}
                                        alt=""
                                        className="w-5 h-5 flex-shrink-0 opacity-80"
                                    />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-gray-200 truncate flex items-center gap-2" title={entry.filePath}>
                                            <span className="truncate">{displayName(entry.filePath)}</span>
                                            <span className="flex-shrink-0 text-xs font-normal text-amber-400/90 bg-amber-500/10 px-1.5 py-0.5 rounded" title="Nombre de fois affiché">
                                                ×{entry.viewCount ?? 1}
                                            </span>
                                        </p>
                                        <p className="text-xs text-gray-500">
                                            {entry.pluginName || entry.pluginId} · {entry.logType} · {formatDate(entry.requestedAt)}
                                        </p>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                {entries.length > 0 && (
                    <div className="p-4 border-t border-gray-800 flex justify-end bg-[#0a0a0a]/50">
                        <button
                            onClick={() => {
                                onClearHistory();
                                onClose();
                            }}
                            className="flex items-center gap-2 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg border border-red-500/40 transition-colors"
                        >
                            <Trash2 size={18} />
                            {t('dashboard.clearHistoryList')}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
