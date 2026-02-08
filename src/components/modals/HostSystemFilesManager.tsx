/**
 * Host System Files Manager
 * 
 * Component for managing host-system log files in 3 categories:
 * 1. System Base Files (critical system logs)
 * 2. Auto-detected Files (validated with standard regex)
 * 3. Custom Files (require custom regex)
 */

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, CheckCircle, XCircle, Code, Wand2, FileText, AlertCircle, Trash2, Plus } from 'lucide-react';
import { api } from '../../api/client';
import { Button } from '../ui/Button';

interface SystemBaseFile {
    path: string;
    type: 'syslog' | 'journald' | 'auth' | 'kern' | 'daemon' | 'mail';
    enabled: boolean;
    detected: boolean;
    validated: boolean;
    isSystemCritical: boolean;
}

interface AutoDetectedFile {
    path: string;
    type: 'syslog' | 'auth' | 'kern' | 'daemon' | 'mail' | 'custom';
    enabled: boolean;
    detected: boolean;
    validated: boolean;
    parserType: string;
}

interface CustomFile {
    path: string;
    type: 'custom';
    enabled: boolean;
    customParserConfig: {
        regex: string;
        groups?: Record<string, number>;
        levelMapping?: Record<string, string>;
    };
    detected: boolean;
}

interface HostSystemFilesManagerProps {
    pluginId: string;
    currentConfig?: {
        systemBaseFiles?: SystemBaseFile[];
        autoDetectedFiles?: AutoDetectedFile[];
        customFiles?: CustomFile[];
        logFiles?: Array<{ path: string; type: string; enabled: boolean }>; // Legacy
    };
    onConfigChange: (config: {
        systemBaseFiles?: SystemBaseFile[];
        autoDetectedFiles?: AutoDetectedFile[];
        customFiles?: CustomFile[];
    }) => void;
}

export const HostSystemFilesManager: React.FC<HostSystemFilesManagerProps> = ({
    pluginId,
    currentConfig,
    onConfigChange
}) => {
    const { t } = useTranslation();
    const [systemBaseFiles, setSystemBaseFiles] = useState<SystemBaseFile[]>(currentConfig?.systemBaseFiles || []);
    const [autoDetectedFiles, setAutoDetectedFiles] = useState<AutoDetectedFile[]>(currentConfig?.autoDetectedFiles || []);
    const [customFiles, setCustomFiles] = useState<CustomFile[]>(currentConfig?.customFiles || []);
    const [isLoading, setIsLoading] = useState(false);
    const [isDetecting, setIsDetecting] = useState<string | null>(null);
    const [editingCustomRegex, setEditingCustomRegex] = useState<string | null>(null);
    const [customRegexValue, setCustomRegexValue] = useState<string>('');

    // Load files classification from backend
    const loadFilesClassification = async () => {
        setIsLoading(true);
        try {
            // First, check if we have existing config
            if (currentConfig?.systemBaseFiles || currentConfig?.autoDetectedFiles || currentConfig?.customFiles) {
                // Use existing config
                setSystemBaseFiles(currentConfig.systemBaseFiles || []);
                setAutoDetectedFiles(currentConfig.autoDetectedFiles || []);
                setCustomFiles(currentConfig.customFiles || []);
                setIsLoading(false);
                return;
            }

            // Scan files first
            const scanResponse = await api.post<{ result: { files: Array<{ path: string; type: string; size: number; modified: string }> } }>(
                `/api/log-viewer/plugins/${pluginId}/scan`,
                {
                    basePath: '/var/log',
                    patterns: []
                }
            );

            if (scanResponse.success && scanResponse.result?.files) {
                // Classify files using backend classification
                // For now, we'll use a simple classification based on file paths
                // In production, this should call a dedicated classification endpoint
                const files = scanResponse.result.files;
                
                const systemBase: SystemBaseFile[] = [];
                const autoDetected: AutoDetectedFile[] = [];
                const custom: CustomFile[] = [];

                const criticalFiles = ['syslog', 'messages', 'auth.log', 'secure', 'kern.log', 'daemon.log', 'mail.log', 'maillog'];

                for (const file of files) {
                    // Normalize path (remove rotation/compression)
                    const normalizedPath = file.path
                        .replace(/\.\d+(\.(gz|bz2|xz))?$/, '')
                        .replace(/\.\d{8}(\.(gz|bz2|xz))?$/, '')
                        .replace(/\.(gz|bz2|xz)$/, '');
                    
                    const baseFilename = normalizedPath.split('/').pop()?.toLowerCase() || '';
                    const isCritical = criticalFiles.some(critical => baseFilename === critical || baseFilename.startsWith(critical));

                    if (isCritical) {
                        systemBase.push({
                            path: normalizedPath,
                            type: file.type as any,
                            enabled: false,
                            detected: true,
                            validated: true,
                            isSystemCritical: true
                        });
                    } else {
                        // Try to detect format
                        autoDetected.push({
                            path: normalizedPath,
                            type: file.type as any,
                            enabled: false,
                            detected: true,
                            validated: false,
                            parserType: file.type
                        });
                    }
                }

                setSystemBaseFiles(systemBase);
                setAutoDetectedFiles(autoDetected);
                setCustomFiles(custom);
                
                onConfigChange({
                    systemBaseFiles: systemBase,
                    autoDetectedFiles: autoDetected,
                    customFiles: custom
                });
            }
        } catch (error) {
            console.error('Failed to load files classification:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (pluginId === 'host-system') {
            // Initialize with current config if available
            if (currentConfig?.systemBaseFiles || currentConfig?.autoDetectedFiles || currentConfig?.customFiles) {
                setSystemBaseFiles(currentConfig.systemBaseFiles || []);
                setAutoDetectedFiles(currentConfig.autoDetectedFiles || []);
                setCustomFiles(currentConfig.customFiles || []);
            } else {
                // Load files classification from backend
                loadFilesClassification();
            }
        }
    }, [pluginId]);

    // Update parent when files change
    useEffect(() => {
        if (pluginId === 'host-system') {
            onConfigChange({
                systemBaseFiles,
                autoDetectedFiles,
                customFiles
            });
        }
    }, [systemBaseFiles, autoDetectedFiles, customFiles, pluginId]);

    const toggleFile = (category: 'systemBase' | 'autoDetected' | 'custom', path: string) => {
        if (category === 'systemBase') {
            setSystemBaseFiles(files => files.map(f => f.path === path ? { ...f, enabled: !f.enabled } : f));
        } else if (category === 'autoDetected') {
            setAutoDetectedFiles(files => files.map(f => f.path === path ? { ...f, enabled: !f.enabled } : f));
        } else {
            setCustomFiles(files => files.map(f => f.path === path ? { ...f, enabled: !f.enabled } : f));
        }
    };

    const detectFormat = async (filePath: string) => {
        setIsDetecting(filePath);
        try {
            const response = await api.post<{ result: { format: string; confidence: number; parserType: string; validated: boolean } }>(
                `/api/log-viewer/plugins/${pluginId}/detect-format`,
                { filePath, sampleSize: 50 }
            );

            if (response.success && response.result) {
                // Move file from custom to autoDetected if format detected
                const customFile = customFiles.find(f => f.path === filePath);
                if (customFile && response.result.confidence >= 70) {
                    setCustomFiles(files => files.filter(f => f.path !== filePath));
                    setAutoDetectedFiles(files => [...files, {
                        path: filePath,
                        type: response.result.parserType as any,
                        enabled: customFile.enabled,
                        detected: true,
                        validated: response.result.validated,
                        parserType: response.result.parserType
                    }]);
                }
            }
        } catch (error) {
            console.error('Failed to detect format:', error);
        } finally {
            setIsDetecting(null);
        }
    };

    const startEditingRegex = (filePath: string) => {
        const customFile = customFiles.find(f => f.path === filePath);
        setCustomRegexValue(customFile?.customParserConfig.regex || '');
        setEditingCustomRegex(filePath);
    };

    const saveCustomRegex = (filePath: string) => {
        setCustomFiles(files => files.map(f => 
            f.path === filePath 
                ? { ...f, customParserConfig: { ...f.customParserConfig, regex: customRegexValue } }
                : f
        ));
        setEditingCustomRegex(null);
        setCustomRegexValue('');
    };

    const removeFile = (category: 'systemBase' | 'autoDetected' | 'custom', path: string) => {
        if (category === 'systemBase') {
            // System base files cannot be removed, only disabled
            return;
        } else if (category === 'autoDetected') {
            setAutoDetectedFiles(files => files.filter(f => f.path !== path));
        } else {
            setCustomFiles(files => files.filter(f => f.path !== path));
        }
    };

    return (
        <div className="space-y-6">
            {/* System Base Files */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                        <FileText size={16} className="text-green-400" />
                        {t('hostSystemFiles.systemBase')}
                    </h3>
                    <span className="text-xs text-gray-500 bg-green-500/20 px-2 py-1 rounded border border-green-500/30">
                        {t('hostSystemFiles.enabledCount', { count: systemBaseFiles.filter(f => f.enabled).length })}
                    </span>
                </div>
                <p className="text-xs text-gray-500 mb-3">
                    {t('hostSystemFiles.systemBaseHelp')}
                </p>
                {isLoading ? (
                    <div className="text-center py-4 text-gray-500 text-sm">
                        <RefreshCw size={16} className="animate-spin mx-auto mb-2" />
                        {t('pluginOptions.loading')}
                    </div>
                ) : systemBaseFiles.length === 0 ? (
                    <div className="text-center py-4 text-gray-500 text-xs">{t('hostSystemFiles.noSystemFiles')}</div>
                ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                        {systemBaseFiles.map((file, idx) => (
                            <div key={idx} className="flex items-center gap-2 p-2 bg-[#1a1a1a] rounded border border-gray-700">
                                <input
                                    type="checkbox"
                                    checked={file.enabled}
                                    onChange={() => toggleFile('systemBase', file.path)}
                                    className="w-4 h-4 rounded border-gray-600 bg-[#1a1a1a] text-green-500 focus:ring-green-500"
                                />
                                <span className={`flex-1 text-xs ${file.enabled ? 'text-white' : 'text-gray-500'}`}>
                                    {file.path}
                                </span>
                                <span className="text-xs text-gray-500 px-2 py-0.5 bg-gray-800 rounded">{file.type}</span>
                                {file.validated && (
                                    <CheckCircle size={14} className="text-green-400" title={t('hostSystemFiles.regexValidated')} />
                                )}
                                {file.isSystemCritical && (
                                    <span className="text-xs text-green-400 bg-green-500/20 px-1.5 py-0.5 rounded border border-green-500/30">
                                        {t('hostSystemFiles.system')}
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Auto-detected Files */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                        <Wand2 size={16} className="text-blue-400" />
                        {t('hostSystemFiles.autoDetected')}
                    </h3>
                    <span className="text-xs text-gray-500 bg-blue-500/20 px-2 py-1 rounded border border-blue-500/30">
                        {t('hostSystemFiles.enabledCount', { count: autoDetectedFiles.filter(f => f.enabled).length })}
                    </span>
                </div>
                <p className="text-xs text-gray-500 mb-3">
                    {t('hostSystemFiles.autoDetectedHelp')}
                </p>
                {autoDetectedFiles.length === 0 ? (
                    <div className="text-center py-4 text-gray-500 text-xs">{t('hostSystemFiles.noAutoDetected')}</div>
                ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                        {autoDetectedFiles.map((file, idx) => (
                            <div key={idx} className="flex items-center gap-2 p-2 bg-[#1a1a1a] rounded border border-gray-700">
                                <input
                                    type="checkbox"
                                    checked={file.enabled}
                                    onChange={() => toggleFile('autoDetected', file.path)}
                                    className="w-4 h-4 rounded border-gray-600 bg-[#1a1a1a] text-blue-500 focus:ring-blue-500"
                                />
                                <span className={`flex-1 text-xs ${file.enabled ? 'text-white' : 'text-gray-500'}`}>
                                    {file.path}
                                </span>
                                <span className="text-xs text-gray-500 px-2 py-0.5 bg-gray-800 rounded">{file.parserType}</span>
                                {file.validated && (
                                    <CheckCircle size={14} className="text-blue-400" title={t('hostSystemFiles.regexValidated')} />
                                )}
                                <button
                                    type="button"
                                    onClick={() => removeFile('autoDetected', file.path)}
                                    className="text-xs px-2 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded transition-colors"
                                >
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Custom Files */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                        <Code size={16} className="text-purple-400" />
                        {t('hostSystemFiles.customFiles')}
                    </h3>
                    <span className="text-xs text-gray-500 bg-purple-500/20 px-2 py-1 rounded border border-purple-500/30">
                        {t('hostSystemFiles.enabledCount', { count: customFiles.filter(f => f.enabled).length })}
                    </span>
                </div>
                <p className="text-xs text-gray-500 mb-3">
                    {t('hostSystemFiles.customFilesHelp')}
                </p>
                {customFiles.length === 0 ? (
                    <div className="text-center py-4 text-gray-500 text-xs">{t('hostSystemFiles.noCustomFiles')}</div>
                ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                        {customFiles.map((file, idx) => (
                            <div key={idx} className="p-3 bg-[#1a1a1a] rounded border border-gray-700">
                                <div className="flex items-center gap-2 mb-2">
                                    <input
                                        type="checkbox"
                                        checked={file.enabled}
                                        onChange={() => toggleFile('custom', file.path)}
                                        className="w-4 h-4 rounded border-gray-600 bg-[#1a1a1a] text-purple-500 focus:ring-purple-500"
                                    />
                                    <span className={`flex-1 text-xs ${file.enabled ? 'text-white' : 'text-gray-500'}`}>
                                        {file.path}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => detectFormat(file.path)}
                                        disabled={isDetecting === file.path}
                                        className="text-xs px-2 py-1 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded transition-colors disabled:opacity-50 flex items-center gap-1"
                                    >
                                        {isDetecting === file.path ? (
                                            <>
                                                <RefreshCw size={12} className="animate-spin" />
                                                {t('hostSystemFiles.detecting')}
                                            </>
                                        ) : (
                                            <>
                                                <Wand2 size={12} />
                                                {t('hostSystemFiles.detect')}
                                            </>
                                        )}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => removeFile('custom', file.path)}
                                        className="text-xs px-2 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded transition-colors"
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                                {editingCustomRegex === file.path ? (
                                    <div className="space-y-2">
                                        <textarea
                                            value={customRegexValue}
                                            onChange={(e) => setCustomRegexValue(e.target.value)}
                                            className="w-full px-2 py-1 bg-[#0f0f0f] border border-gray-800 rounded text-xs text-white font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
                                            rows={3}
                                            placeholder={t('hostSystemFiles.enterRegex')}
                                        />
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={() => saveCustomRegex(file.path)}
                                                className="text-xs px-2 py-1 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded transition-colors"
                                            >
                                                {t('hostSystemFiles.save')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setEditingCustomRegex(null);
                                                    setCustomRegexValue('');
                                                }}
                                                className="text-xs px-2 py-1 bg-gray-500/20 hover:bg-gray-500/30 text-gray-400 rounded transition-colors"
                                            >
                                                {t('hostSystemFiles.cancel')}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div>
                                        {file.customParserConfig.regex ? (
                                            <code className="block text-xs text-gray-300 bg-[#0f0f0f] p-2 rounded border border-gray-800 break-all font-mono">
                                                {file.customParserConfig.regex}
                                            </code>
                                        ) : (
                                            <div className="text-xs text-yellow-400 bg-yellow-500/10 p-2 rounded border border-yellow-500/30 flex items-center gap-2">
                                                <AlertCircle size={12} />
                                                {t('hostSystemFiles.customRegexRequired')}
                                            </div>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => startEditingRegex(file.path)}
                                            className="mt-2 text-xs px-2 py-1 bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 rounded transition-colors"
                                        >
                                            {file.customParserConfig.regex ? t('hostSystemFiles.editRegex') : t('hostSystemFiles.addRegex')}
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Refresh Button */}
            <div className="flex justify-end">
                <button
                    type="button"
                    onClick={loadFilesClassification}
                    disabled={isLoading}
                    className="text-xs px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                    <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                    {t('hostSystemFiles.refreshDetection')}
                </button>
            </div>
        </div>
    );
};
