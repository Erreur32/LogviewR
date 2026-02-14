/**
 * Log File Selector Modal
 *
 * Modal for selecting log files from available files.
 * Options: search by filename, hide empty files (.gz and 0-byte files).
 * User preference for "hide empty" is persisted in localStorage.
 */

import React, { useEffect, useRef, useState } from 'react';
import { X, FileText, Search, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LogFileSelector } from '../log-viewer/LogFileSelector';
import type { LogFileInfo } from '../../types/logViewer';
import { usePluginStore } from '../../stores/pluginStore';
import { HIDE_EMPTY_FILES_STORAGE_KEY } from '../../utils/constants';

interface LogFileSelectorModalProps {
    isOpen: boolean;
    onClose: () => void;
    files: LogFileInfo[];
    selectedFilePath?: string;
    onFileSelect: (filePath: string, logType: string) => void;
    pluginName?: string;
    pluginId?: string;
}

export const LogFileSelectorModal: React.FC<LogFileSelectorModalProps> = ({
    isOpen,
    onClose,
    files,
    selectedFilePath,
    onFileSelect,
    pluginName,
    pluginId
}) => {
    const { t } = useTranslation();
    const { plugins } = usePluginStore();
    const [fileSearchQuery, setFileSearchQuery] = useState('');
    const [showOnlyNonGzWithData, setShowOnlyNonGzWithData] = useState(() => {
        try {
            const stored = localStorage.getItem(HIDE_EMPTY_FILES_STORAGE_KEY);
            if (stored !== null) return stored === 'true';
        } catch {
            /* ignore */
        }
        return true; // Default: hide empty files
    });

    // Persist user preference when changed
    useEffect(() => {
        try {
            localStorage.setItem(HIDE_EMPTY_FILES_STORAGE_KEY, String(showOnlyNonGzWithData));
        } catch {
            /* ignore */
        }
    }, [showOnlyNonGzWithData]);

    // Get readCompressed setting from plugin
    const readCompressed = pluginId
        ? (plugins.find(p => p.id === pluginId)?.settings?.readCompressed as boolean) ?? false
        : false;

    // Reset search when modal closes (keep hide-empty preference)
    useEffect(() => {
        if (!isOpen) setFileSearchQuery('');
    }, [isOpen]);

    // Force re-render when files change (for plugin switching)
    const filesKey = files.map(f => f.path).join('|');
    const contentRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to selected file when modal opens
    useEffect(() => {
        if (isOpen && selectedFilePath && contentRef.current) {
            setTimeout(() => {
                const selectedElement = contentRef.current?.querySelector(`[data-selected-file="${selectedFilePath}"]`);
                if (selectedElement) {
                    selectedElement.scrollIntoView({
                        behavior: 'smooth',
                        block: 'center',
                        inline: 'nearest'
                    });
                }
            }, 200);
        }
    }, [isOpen, selectedFilePath]);

    if (!isOpen) return null;

    const handleFileSelect = (filePath: string, logType: string) => {
        onFileSelect(filePath, logType);
        onClose();
    };

    return (
        <div
            className="fixed inset-0 z-[100] flex items-start justify-center bg-black/80 backdrop-blur-sm p-4 pt-16"
            onClick={(e) => {
                if (e.target === e.currentTarget) {
                    onClose();
                }
            }}
        >
            <div
                className="bg-[#121212] border border-gray-700 rounded-lg w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-800 flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-500/20 rounded-lg">
                            <FileText size={28} className="text-blue-400" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-semibold text-white">
                                Fichiers de logs {pluginName && `- ${pluginName}`}
                            </h2>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={onClose}
                            className="text-gray-400 hover:text-white transition-colors p-2 hover:bg-gray-800 rounded-lg"
                        >
                            <X size={24} />
                        </button>
                    </div>
                </div>

                {/* Search and filter options - for all log systems (machine, apache, npm, nginx) */}
                {files.length > 0 && (
                    <div className="px-6 py-3 border-b border-gray-800 flex flex-wrap items-center gap-4 bg-[#0a0a0a]/50">
                        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                            <Search size={18} className="text-gray-500 flex-shrink-0" />
                            <input
                                type="text"
                                value={fileSearchQuery}
                                onChange={(e) => setFileSearchQuery(e.target.value)}
                                placeholder="Rechercher un fichier de log..."
                                className="flex-1 px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                            />
                        </div>
                        <label
                            className="flex items-center gap-2.5 cursor-pointer group"
                            title={t('logViewer.hideEmptyFilesTooltip')}
                        >
                            <span className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full bg-gray-700/80 transition-colors duration-200 ease-in-out focus-within:ring-2 focus-within:ring-cyan-500/50 focus-within:ring-offset-2 focus-within:ring-offset-[#0a0a0a] group-hover:bg-gray-600/80">
                                <input
                                    type="checkbox"
                                    checked={showOnlyNonGzWithData}
                                    onChange={(e) => setShowOnlyNonGzWithData(e.target.checked)}
                                    className="peer sr-only"
                                />
                                <span className="pointer-events-none inline-block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out peer-checked:translate-x-5 peer-checked:bg-emerald-500" />
                            </span>
                            <EyeOff size={14} className="text-gray-500 group-hover:text-cyan-500/70 transition-colors flex-shrink-0" />
                            <span className="text-sm text-gray-300 group-hover:text-gray-200 transition-colors">
                                {t('logViewer.hideEmptyFiles')}
                            </span>
                        </label>
                    </div>
                )}

                {/* Content */}
                <div ref={contentRef} key={filesKey} className="flex-1 overflow-y-auto p-6">
                    {files.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                            <FileText size={48} className="mx-auto mb-4 text-gray-600" />
                            <p className="text-lg font-medium mb-2">
                                Aucun fichier disponible
                            </p>
                        </div>
                    ) : (
                        <LogFileSelector
                            files={files}
                            selectedFilePath={selectedFilePath}
                            onFileSelect={handleFileSelect}
                            collapsed={false}
                            pluginId={pluginId}
                            readCompressed={readCompressed}
                            fileSearchQuery={fileSearchQuery}
                            showOnlyNonGzWithData={showOnlyNonGzWithData}
                        />
                    )}
                </div>
            </div>
        </div>
    );
};
