/**
 * Log History Card (Dashboard)
 *
 * Displays recent log files from history (localStorage).
 * Clicking an entry navigates to the log viewer with that file selected.
 */

import React, { useState, useEffect } from 'react';
import { History, FileText } from 'lucide-react';
import { LOGFILE_HISTORY_KEY, type LogFileHistoryEntry } from '../modals/LogFileHistoryModal';
import { getPluginIcon } from '../../utils/pluginIcons';

const MAX_ENTRIES = 10;

interface LogHistoryCardProps {
    onOpenLog: (entry: LogFileHistoryEntry) => void;
    osType?: string;
}

function loadHistoryFromStorage(): LogFileHistoryEntry[] {
    try {
        const raw = localStorage.getItem(LOGFILE_HISTORY_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as LogFileHistoryEntry[];
        return Array.isArray(parsed) ? parsed.slice(0, MAX_ENTRIES) : [];
    } catch {
        return [];
    }
}

export const LogHistoryCard: React.FC<LogHistoryCardProps> = ({ onOpenLog, osType }) => {
    const [entries, setEntries] = useState<LogFileHistoryEntry[]>(loadHistoryFromStorage);

    // Re-read when component mounts (e.g. user navigates back to dashboard)
    useEffect(() => {
        setEntries(loadHistoryFromStorage());
    }, []);

    const formatDate = (ts: number) => {
        const d = new Date(ts);
        return d.toLocaleString('fr-FR', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const displayName = (path: string) => path.split('/').pop() || path;

    return (
        <div className="bg-theme-tertiary rounded-xl border border-theme-border overflow-hidden flex flex-col h-full">
            <div className="p-4 border-b border-theme-border flex items-center gap-3">
                <div className="p-2 bg-amber-500/20 rounded-lg">
                    <History size={22} className="text-amber-400" />
                </div>
                <div>
                    <h3 className="font-semibold text-theme-primary">Historique des logs</h3>
                    <p className="text-xs text-gray-500">Fichiers déjà demandés</p>
                </div>
            </div>
            <div className="p-4 flex-1 overflow-y-auto min-h-0">
                {entries.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        <FileText size={40} className="mx-auto mb-3 text-gray-600" />
                        <p className="text-sm">Aucun fichier dans l'historique</p>
                        <p className="text-xs mt-1">Les fichiers ouverts apparaîtront ici</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {entries.map((entry, index) => (
                            <button
                                type="button"
                                key={`${entry.filePath}-${entry.pluginId}-${entry.requestedAt}-${index}`}
                                onClick={() => onOpenLog(entry)}
                                className="flex items-center gap-3 px-3 py-2.5 bg-theme-secondary hover:bg-theme-primary border border-theme-border rounded-lg cursor-pointer transition-colors text-left w-full"
                            >
                                <img
                                    src={getPluginIcon(entry.pluginId, entry.pluginId === 'host-system' ? osType : undefined)}
                                    alt=""
                                    className="w-5 h-5 flex-shrink-0 opacity-80"
                                />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-theme-primary truncate flex items-center gap-2" title={entry.filePath}>
                                        <span className="truncate">{displayName(entry.filePath)}</span>
                                        <span className="flex-shrink-0 text-xs font-normal text-amber-400/90 bg-amber-500/10 px-1.5 py-0.5 rounded" title="Nombre de fois affiché">
                                            ×{entry.viewCount ?? 1}
                                        </span>
                                    </p>
                                    <p className="text-xs text-gray-500">
                                        {entry.pluginName || entry.pluginId} · {formatDate(entry.requestedAt)}
                                    </p>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
