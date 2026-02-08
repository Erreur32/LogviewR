/**
 * Regex Editor Modal
 * 
 * Modal for editing custom regex patterns for log files
 */

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Save, Code, AlertCircle, CheckCircle2 } from 'lucide-react';
import { api } from '../../api/client';

interface RegexEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    pluginId: string;
    filePath: string;
    logType: string;
    onSave?: () => void;
}

interface RegexConfig {
    regex: string;
    groups?: {
        timestamp?: number;
        level?: number;
        message?: number;
        [key: string]: number | undefined;
    };
    levelMapping?: Record<string, string>;
}

export const RegexEditorModal: React.FC<RegexEditorModalProps> = ({
    isOpen,
    onClose,
    pluginId,
    filePath,
    logType,
    onSave
}) => {
    const { t } = useTranslation();
    const [regex, setRegex] = useState('');
    const [defaultRegex, setDefaultRegex] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [testLine, setTestLine] = useState('');
    const [testResult, setTestResult] = useState<{ success: boolean; matches?: string[]; error?: string } | null>(null);
    const [hasChanges, setHasChanges] = useState(false);

    // Load current regex configuration
    useEffect(() => {
        if (isOpen && pluginId && filePath) {
            loadRegexConfig();
            loadDefaultRegex();
        }
    }, [isOpen, pluginId, filePath, logType]);

    const loadRegexConfig = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await api.get<{ regex?: string; config?: RegexConfig }>(
                `/api/log-viewer/plugins/${pluginId}/regex-config?filePath=${encodeURIComponent(filePath)}`
            );
            if (response.success && response.result) {
                if (response.result.regex) {
                    setRegex(response.result.regex);
                } else if (response.result.config?.regex) {
                    setRegex(response.result.config.regex);
                } else {
                    setRegex('');
                }
                setHasChanges(false);
            }
        } catch (err) {
            console.error('Failed to load regex config:', err);
            setRegex('');
        } finally {
            setIsLoading(false);
        }
    };

    const loadDefaultRegex = async () => {
        try {
            const response = await api.get<{ regex: string }>(
                `/api/log-viewer/plugins/${pluginId}/default-regex?logType=${encodeURIComponent(logType)}`
            );
            if (response.success && response.result) {
                setDefaultRegex(response.result.regex);
            }
        } catch (err) {
            console.warn('Failed to load default regex:', err);
            setDefaultRegex(null);
        }
    };

    const handleSave = async () => {
        if (!regex.trim()) {
            setError(t('regex.editorRegexRequired'));
            return;
        }

        // Validate regex
        try {
            new RegExp(regex);
        } catch (err) {
            setError(t('regex.editorInvalidRegex', { message: err instanceof Error ? err.message : String(err) }));
            return;
        }

        setIsSaving(true);
        setError(null);
        try {
            const response = await api.put<{ success: boolean }>(
                `/api/log-viewer/plugins/${pluginId}/regex-config`,
                {
                    filePath,
                    logType,
                    regex: regex.trim()
                }
            );
            if (response.success) {
                setHasChanges(false);
                if (onSave) {
                    onSave();
                }
                onClose();
            } else {
                setError(response.error?.message || 'Erreur lors de la sauvegarde');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : t('regex.editorSaveError'));
        } finally {
            setIsSaving(false);
        }
    };

    const handleTest = () => {
        if (!testLine.trim()) {
            setTestResult({ success: false, error: t('regex.editorEnterTestLine') });
            return;
        }

        if (!regex.trim()) {
            setTestResult({ success: false, error: t('regex.editorEnterRegex') });
            return;
        }

        try {
            const regexObj = new RegExp(regex);
            const match = testLine.match(regexObj);
            if (match) {
                setTestResult({
                    success: true,
                    matches: match.map((m, i) => t('regex.editorGroupMatch', { index: i, value: m || t('regex.empty') }))
                });
            } else {
                setTestResult({
                    success: false,
                    error: t('regex.editorNoMatchFound')
                });
            }
        } catch (err) {
            setTestResult({
                success: false,
                error: t('regex.editorInvalidRegex', { message: err instanceof Error ? err.message : String(err) })
            });
        }
    };

    const handleUseDefault = () => {
        if (defaultRegex) {
            setRegex(defaultRegex);
            setHasChanges(true);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-[#121212] border border-gray-700 rounded-lg w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-800 flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-purple-500/20 rounded-lg">
                            <Code size={24} className="text-purple-400" />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold text-white">
                                {t('regex.editorTitle')}
                            </h2>
                            <p className="text-sm text-gray-400 mt-1">
                                {filePath.split('/').pop()}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white transition-colors p-2 hover:bg-gray-800 rounded-lg"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {error && (
                        <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-400 text-sm flex items-start gap-2">
                            <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    {/* Default Regex Section */}
                    {defaultRegex && (
                        <div className="p-4 bg-blue-900/20 border border-blue-700/50 rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-sm font-medium text-blue-400">{t('regex.editorDefaultRegex')}</h3>
                                <button
                                    onClick={handleUseDefault}
                                    className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                                >
                                    {t('regex.editorUseDefault')}
                                </button>
                            </div>
                            <code className="text-xs text-gray-300 break-all block bg-[#1a1a1a] p-2 rounded border border-gray-800">
                                {defaultRegex}
                            </code>
                        </div>
                    )}

                    {/* Regex Input */}
                    <div>
                        <label className="block text-sm font-medium text-white mb-2">
                            {t('regex.editorRegexLabel')}
                        </label>
                        <textarea
                            value={regex}
                            onChange={(e) => {
                                setRegex(e.target.value);
                                setHasChanges(true);
                                setError(null);
                                setTestResult(null);
                            }}
                            placeholder={t('regex.editorRegexPlaceholder')}
                            className="w-full px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm font-mono focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
                            rows={4}
                        />
                        <p className="text-xs text-gray-400 mt-1">
                            💡 {t('regex.editorCaptureHint')}
                        </p>
                    </div>

                    {/* Test Section */}
                    <div>
                        <label className="block text-sm font-medium text-white mb-2">
                            {t('regex.editorTestRegex')}
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={testLine}
                                onChange={(e) => {
                                    setTestLine(e.target.value);
                                    setTestResult(null);
                                }}
                                placeholder={t('regex.editorTestLinePlaceholder')}
                                className="flex-1 px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm font-mono focus:outline-none focus:border-purple-500"
                            />
                            <button
                                onClick={handleTest}
                                disabled={!regex.trim() || !testLine.trim()}
                                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
                            >
                                {t('regex.editorTestButton')}
                            </button>
                        </div>
                        {testResult && (
                            <div className={`mt-2 p-3 rounded-lg text-sm ${
                                testResult.success
                                    ? 'bg-green-900/30 border border-green-700 text-green-400'
                                    : 'bg-red-900/30 border border-red-700 text-red-400'
                            }`}>
                                <div className="flex items-start gap-2">
                                    {testResult.success ? (
                                        <CheckCircle2 size={18} className="mt-0.5 flex-shrink-0" />
                                    ) : (
                                        <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
                                    )}
                                    <div className="flex-1">
                                        {testResult.success ? (
                                            <div>
                                                <p className="font-medium mb-1">{t('regex.editorMatchFound')}</p>
                                                <ul className="list-disc list-inside space-y-1 text-xs">
                                                    {testResult.matches?.map((match, idx) => (
                                                        <li key={idx} className="font-mono">{match}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        ) : (
                                            <p>{testResult.error || t('regex.editorNoMatch')}</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-800 flex-shrink-0">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors"
                    >
                        {t('regex.editorCancel')}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving || !regex.trim() || !hasChanges}
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:opacity-50 text-white text-sm rounded-lg transition-colors flex items-center gap-2"
                    >
                        {isSaving ? (
                            <>
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                {t('regex.editorSaving')}
                            </>
                        ) : (
                            <>
                                <Save size={16} />
                                {t('regex.editorSave')}
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};
