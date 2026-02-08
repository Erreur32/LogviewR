/**
 * Regex Management Section
 * 
 * Component for managing custom regex patterns in Administration settings
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Code, Edit2, Trash2, Play, Copy, CheckCircle2, AlertCircle, Loader2, Sparkles } from 'lucide-react';
import { Section, SettingRow } from './SettingsSection';
import { api } from '../api/client';
import { RegexEditorModal } from './modals/RegexEditorModal';
import { usePluginStore } from '../stores/pluginStore';

interface CustomRegex {
    pluginId: string;
    filePath: string;
    logType: string;
    regex: string;
    updatedAt?: string;
}

interface GeneratedRegex {
    regex: string;
    groups: string[];
    testResult: Record<string, string>;
}

export const RegexManagementSection: React.FC = () => {
    const { t, i18n } = useTranslation();
    const { plugins } = usePluginStore();
    const [customRegexes, setCustomRegexes] = useState<Record<string, CustomRegex[]>>({});
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    
    // Regex generator state
    const [logLine, setLogLine] = useState('');
    const [generatedRegex, setGeneratedRegex] = useState<GeneratedRegex | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [generateError, setGenerateError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    
    // Edit modal state
    const [editModalOpen, setEditModalOpen] = useState(false);
    const [editingRegex, setEditingRegex] = useState<CustomRegex | null>(null);
    
    // Test modal state
    const [testModalOpen, setTestModalOpen] = useState(false);
    const [testingRegex, setTestingRegex] = useState<CustomRegex | null>(null);

    // Load all custom regexes
    useEffect(() => {
        loadCustomRegexes();
    }, []);

    const loadCustomRegexes = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await api.get<Record<string, Record<string, { regex: string; logType: string; updatedAt?: string }>>>(
                '/api/log-viewer/custom-regexes'
            );
            
            if (response.success && response.result) {
                // Transform the response into grouped format
                const grouped: Record<string, CustomRegex[]> = {};
                
                Object.entries(response.result).forEach(([pluginId, files]) => {
                    grouped[pluginId] = Object.entries(files).map(([filePath, config]) => ({
                        pluginId,
                        filePath,
                        logType: config.logType || 'custom',
                        regex: config.regex,
                        updatedAt: config.updatedAt
                    }));
                });
                
                setCustomRegexes(grouped);
            }
        } catch (err) {
            console.error('Failed to load custom regexes:', err);
            setError(err instanceof Error ? err.message : t('regex.loadError'));
        } finally {
            setIsLoading(false);
        }
    };

    const handleGenerateRegex = async () => {
        if (!logLine.trim()) {
            setGenerateError(t('regex.pleasePasteLogLine'));
            return;
        }

        setIsGenerating(true);
        setGenerateError(null);
        setGeneratedRegex(null);

        try {
            const response = await api.post<GeneratedRegex>('/api/log-viewer/generate-regex', {
                logLine: logLine.trim()
            });

            if (response.success && response.result) {
                setGeneratedRegex(response.result);
            } else {
                setGenerateError(response.error?.message || t('regex.generateError'));
            }
        } catch (err) {
            console.error('Failed to generate regex:', err);
            setGenerateError(err instanceof Error ? err.message : t('regex.generateError'));
        } finally {
            setIsGenerating(false);
        }
    };

    const handleCopyRegex = () => {
        if (generatedRegex) {
            navigator.clipboard.writeText(generatedRegex.regex);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handleEdit = (regex: CustomRegex) => {
        setEditingRegex(regex);
        setEditModalOpen(true);
    };

    const handleTest = (regex: CustomRegex) => {
        setTestingRegex(regex);
        setTestModalOpen(true);
    };

    const handleDelete = async (pluginId: string, filePath: string) => {
        if (!confirm(t('regex.deleteConfirm', { path: filePath }))) {
            return;
        }

        try {
            const response = await api.delete(`/api/log-viewer/plugins/${pluginId}/regex-config?filePath=${encodeURIComponent(filePath)}`);

            if (response.success) {
                // Reload regexes
                await loadCustomRegexes();
            } else {
                alert(response.error?.message || t('regex.deleteError'));
            }
        } catch (err) {
            console.error('Failed to delete regex:', err);
            alert(err instanceof Error ? err.message : t('regex.deleteError'));
        }
    };

    const getPluginName = (pluginId: string): string => {
        const plugin = plugins.find(p => p.id === pluginId);
        if (plugin) {
            return plugin.name;
        }
        switch (pluginId) {
            case 'host-system':
                return t('regex.pluginSystem');
            case 'nginx':
                return t('regex.pluginNginx');
            case 'apache':
                return t('regex.pluginApache');
            case 'npm':
                return t('regex.pluginNpm');
            default:
                return pluginId;
        }
    };

    const totalRegexCount = Object.values(customRegexes).reduce((sum, regexes) => sum + regexes.length, 0);

    return (
        <>
            {/* Liste des regex custom */}
            <Section title={t('regex.customTitle')} icon={Code} iconColor="purple">
                {isLoading ? (
                    <div className="flex items-center justify-center py-8">
                        <Loader2 size={24} className="text-gray-400 animate-spin" />
                    </div>
                ) : error ? (
                    <div className="flex items-center gap-2 text-red-400 py-4">
                        <AlertCircle size={18} />
                        <span>{error}</span>
                    </div>
                ) : totalRegexCount === 0 ? (
                    <div className="text-center py-8 text-gray-400">
                        <Code size={32} className="mx-auto mb-3 opacity-50" />
                        <p>{t('regex.noCustomConfigured')}</p>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {Object.entries(customRegexes).map(([pluginId, regexes]) => (
                            <div key={pluginId} className="border border-theme rounded-lg p-4">
                                <div className="flex items-center justify-between mb-3">
                                    <h4 className="font-medium text-theme-primary flex items-center gap-2">
                                        <Code size={16} className="text-purple-400" />
                                        {getPluginName(pluginId)}
                                    </h4>
                                    <span className="text-xs text-gray-400">
                                        {t('regex.regexCount', { count: regexes.filter(r => !r.filePath.endsWith('.gz') && !r.filePath.endsWith('.bz2') && !r.filePath.endsWith('.xz')).length })}
                                    </span>
                                </div>
                                
                                <div className="space-y-3">
                                    {regexes.filter(regex => !regex.filePath.endsWith('.gz') && !regex.filePath.endsWith('.bz2') && !regex.filePath.endsWith('.xz')).map((regex, index) => (
                                        <div
                                            key={`${regex.filePath}-${index}`}
                                            className="bg-theme-secondary rounded-lg p-3 border border-theme"
                                        >
                                            <div className="flex items-start justify-between gap-3 mb-2">
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-sm font-mono text-gray-300 truncate mb-1" title={regex.filePath}>
                                                        {regex.filePath}
                                                    </div>
                                                    <div className="text-xs text-gray-400 mb-2">
                                                        {t('regex.type')}: {regex.logType}
                                                        {regex.updatedAt && (
                                                            <span className="ml-2">
                                                                • {new Date(regex.updatedAt).toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-GB')}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-xs font-mono text-gray-500 bg-[#1a1a1a] p-2 rounded border border-gray-800 break-all">
                                                        {regex.regex}
                                                    </div>
                                                </div>
                                                
                                                <div className="flex items-center gap-2 flex-shrink-0">
                                                    <button
                                                        onClick={() => handleTest(regex)}
                                                        className="p-2 hover:bg-theme-primary rounded-lg transition-colors"
                                                        title={t('regex.testRegex')}
                                                    >
                                                        <Play size={16} className="text-blue-400" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleEdit(regex)}
                                                        className="p-2 hover:bg-theme-primary rounded-lg transition-colors"
                                                        title={t('regex.editRegex')}
                                                    >
                                                        <Edit2 size={16} className="text-yellow-400" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(regex.pluginId, regex.filePath)}
                                                        className="p-2 hover:bg-theme-primary rounded-lg transition-colors"
                                                        title={t('regex.deleteRegex')}
                                                    >
                                                        <Trash2 size={16} className="text-red-400" />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </Section>

            {/* Générateur de regex */}
            <Section title={t('regex.generatorTitle')} icon={Sparkles} iconColor="purple">
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-theme-primary mb-2">
                            {t('regex.pasteLogLine')}
                        </label>
                        <textarea
                            value={logLine}
                            onChange={(e) => setLogLine(e.target.value)}
                            placeholder={t('regex.pasteLogLinePlaceholder')}
                            className="w-full px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm font-mono focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
                            rows={3}
                        />
                    </div>

                    <button
                        onClick={handleGenerateRegex}
                        disabled={!logLine.trim() || isGenerating}
                        className="flex items-center gap-2 px-4 py-2 bg-purple-500 hover:bg-purple-600 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                    >
                        {isGenerating ? (
                            <>
                                <Loader2 size={16} className="animate-spin" />
                                <span>{t('regex.generating')}</span>
                            </>
                        ) : (
                            <>
                                <Sparkles size={16} />
                                <span>{t('regex.generateButton')}</span>
                            </>
                        )}
                    </button>

                    {generateError && (
                        <div className="flex items-center gap-2 text-red-400 text-sm">
                            <AlertCircle size={16} />
                            <span>{generateError}</span>
                        </div>
                    )}

                    {generatedRegex && (
                        <div className="space-y-4 p-4 bg-theme-secondary rounded-lg border border-theme">
                            <div className="flex items-center justify-between">
                                <h4 className="font-medium text-theme-primary">{t('regex.generatedRegex')}</h4>
                                <button
                                    onClick={handleCopyRegex}
                                    className="flex items-center gap-2 px-3 py-1.5 bg-theme-primary hover:bg-theme-tertiary rounded-lg transition-colors text-sm"
                                >
                                    {copied ? (
                                        <>
                                            <CheckCircle2 size={14} className="text-green-400" />
                                            <span className="text-green-400">{t('regex.copied')}</span>
                                        </>
                                    ) : (
                                        <>
                                            <Copy size={14} />
                                            <span>{t('regex.copy')}</span>
                                        </>
                                    )}
                                </button>
                            </div>

                            <div className="space-y-2">
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">{t('regex.regexLabel')}</label>
                                    <div className="text-xs font-mono text-gray-300 bg-[#1a1a1a] p-3 rounded border border-gray-800 break-all">
                                        {generatedRegex.regex}
                                    </div>
                                </div>

                                {generatedRegex.groups.length > 0 && (
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">{t('regex.capturedGroups')}</label>
                                        <div className="flex flex-wrap gap-2">
                                            {generatedRegex.groups.map((group, idx) => (
                                                <span
                                                    key={idx}
                                                    className="px-2 py-1 bg-purple-500/20 text-purple-300 rounded text-xs font-mono"
                                                >
                                                    {group}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {Object.keys(generatedRegex.testResult).length > 0 && (
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">{t('regex.testResult')}</label>
                                        <div className="space-y-1">
                                            {Object.entries(generatedRegex.testResult).map(([key, value]) => (
                                                <div key={key} className="text-xs font-mono">
                                                    <span className="text-purple-400">{key}:</span>{' '}
                                                    <span className="text-gray-300">{value || t('regex.empty')}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </Section>

            {/* Edit Modal */}
            {editingRegex && (
                <RegexEditorModal
                    isOpen={editModalOpen}
                    onClose={() => {
                        setEditModalOpen(false);
                        setEditingRegex(null);
                        loadCustomRegexes();
                    }}
                    pluginId={editingRegex.pluginId}
                    filePath={editingRegex.filePath}
                    logType={editingRegex.logType}
                    onSave={() => {
                        loadCustomRegexes();
                    }}
                />
            )}

            {/* Test Modal - réutiliser RegexEditorModal en mode test uniquement */}
            {testingRegex && (
                <RegexEditorModal
                    isOpen={testModalOpen}
                    onClose={() => {
                        setTestModalOpen(false);
                        setTestingRegex(null);
                    }}
                    pluginId={testingRegex.pluginId}
                    filePath={testingRegex.filePath}
                    logType={testingRegex.logType}
                />
            )}
        </>
    );
};
