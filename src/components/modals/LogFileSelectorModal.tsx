/**
 * Log File Selector Modal
 * 
 * Modal for selecting log files from available files
 */

import React, { useEffect, useRef } from 'react';
import { X, FileText } from 'lucide-react';
import { LogFileSelector } from '../log-viewer/LogFileSelector';
import type { LogFileInfo } from '../../types/logViewer';
import { usePluginStore } from '../../stores/pluginStore';

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
    const { plugins } = usePluginStore();
    
    // Get readCompressed setting from plugin
    const readCompressed = pluginId 
        ? (plugins.find(p => p.id === pluginId)?.settings?.readCompressed as boolean) ?? false
        : false;

    // Force re-render when files change (for plugin switching)
    const filesKey = files.map(f => f.path).join('|');
    const contentRef = useRef<HTMLDivElement>(null);
    
    // Auto-scroll to selected file when modal opens
    useEffect(() => {
        if (isOpen && selectedFilePath && contentRef.current) {
            // Wait for DOM to render, then scroll to selected file
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
                // Close modal when clicking on backdrop
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
                    />
                    )}
                </div>
            </div>
        </div>
    );
};
