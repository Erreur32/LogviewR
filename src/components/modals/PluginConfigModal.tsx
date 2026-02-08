/**
 * Plugin Configuration Modal
 * 
 * Modal for configuring plugins (UniFi, etc.)
 * Reusable for any plugin that needs configuration
 */

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Settings, CheckCircle, XCircle, RefreshCw, AlertCircle, Save, Eye, EyeOff, Plus, Trash2, FileText, Code } from 'lucide-react';
import { usePluginStore, type Plugin } from '../../stores/pluginStore';
import { Button } from '../ui/Button';
import { api } from '../../api/client';
import { HostSystemFilesManager } from './HostSystemFilesManager';

interface PluginConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    pluginId: string;
}

export const PluginConfigModal: React.FC<PluginConfigModalProps> = ({ isOpen, onClose, pluginId }) => {
    const { t } = useTranslation();
    const { plugins, updatePluginConfig, testPluginConnection, fetchPlugins } = usePluginStore();
    const [isSaving, setIsSaving] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [showPassword, setShowPassword] = useState(false);
    
    // Host system log files management
    const [logFiles, setLogFiles] = useState<Array<{ path: string; type: string; enabled: boolean }>>([]);
    const [defaultLogFiles, setDefaultLogFiles] = useState<Array<{ path: string; type: string; enabled: boolean }>>([]);
    const [rsyslogFiles, setRsyslogFiles] = useState<Array<{ path: string; type: string; enabled: boolean }>>([]);
    const [isLoadingLogFiles, setIsLoadingLogFiles] = useState(false);
    const [newLogFile, setNewLogFile] = useState({ path: '', type: 'custom' });
    
    // Custom regex management
    const [customRegexes, setCustomRegexes] = useState<Array<{ filePath: string; logType: string; regex: string; updatedAt?: string }>>([]);
    const [isLoadingRegexes, setIsLoadingRegexes] = useState(false);

    const plugin = plugins.find(p => p.id === pluginId);

    // Determine if this is a log source plugin
    const isLogSourcePlugin = pluginId === 'host-system' || pluginId === 'nginx' || pluginId === 'apache' || pluginId === 'npm';

    // Get default values for log source plugins
    const getDefaultValues = () => {
        if (!isLogSourcePlugin) return {};
        
        switch (pluginId) {
            case 'host-system':
                return {
                    basePath: '/var/log',
                    accessLogPattern: '',
                    errorLogPattern: '',
                    maxLines: 0 // 0 = no limit
                };
            case 'nginx':
                return {
                    basePath: '/var/log/nginx',
                    accessLogPattern: 'access*.log',
                    errorLogPattern: 'error*.log',
                    maxLines: 0 // 0 = no limit
                };
            case 'apache':
                return {
                    basePath: '/var/log/apache2',
                    accessLogPattern: 'access*.log',
                    errorLogPattern: 'error*.log',
                    maxLines: 0 // 0 = no limit
                };
            case 'npm':
                return {
                    basePath: '/data/logs',
                    accessLogPattern: 'proxy-host-*.log',
                    errorLogPattern: '',
                    maxLines: 0 // 0 = no limit
                };
            default:
                return {};
        }
    };

    // Form state based on plugin type
    const [formData, setFormData] = useState<Record<string, string | number | boolean>>({
        // Log source plugin fields
        basePath: '',
        accessLogPattern: '',
        errorLogPattern: '',
        maxLines: 0 // 0 = no limit
    });

    // Initialize form with plugin settings or defaults
    useEffect(() => {
        if (plugin && plugin.settings) {
            if (isLogSourcePlugin) {
                // Log source plugin configuration
                const defaults = getDefaultValues();
                setFormData({
                    basePath: (plugin.settings.basePath as string) || defaults.basePath || '',
                    accessLogPattern: (plugin.settings.accessLogPattern as string) || defaults.accessLogPattern || '',
                    errorLogPattern: (plugin.settings.errorLogPattern as string) || defaults.errorLogPattern || '',
                    maxLines: (plugin.settings.maxLines as number) ?? defaults.maxLines ?? 0
                });
            }
        } else if (plugin && isLogSourcePlugin) {
            // Initialize with default values if no settings exist
            const defaults = getDefaultValues();
            setFormData({
                basePath: defaults.basePath || '',
                accessLogPattern: defaults.accessLogPattern || '',
                errorLogPattern: defaults.errorLogPattern || '',
                maxLines: defaults.maxLines ?? 0
            });
        }
    }, [plugin, isLogSourcePlugin, pluginId]);

    // Load default log files and rsyslog files for host-system plugin
    useEffect(() => {
        if (pluginId === 'host-system' && isOpen) {
            loadLogFiles();
        }
    }, [pluginId, isOpen]);

    // Load custom regexes for log source plugins
    useEffect(() => {
        if (isLogSourcePlugin && isOpen && plugin) {
            loadCustomRegexes();
        }
    }, [pluginId, isOpen, isLogSourcePlugin, plugin]);

    const loadLogFiles = async () => {
        setIsLoadingLogFiles(true);
        try {
            // Load default log files based on OS
            const defaultResponse = await api.get<{ logFiles: Array<{ path: string; type: string; enabled: boolean }> }>('/api/log-viewer/default-log-files');
            if (defaultResponse.success && defaultResponse.result) {
                setDefaultLogFiles(defaultResponse.result.logFiles);
            }

            // Load rsyslog files
            const rsyslogResponse = await api.get<{ logFiles: Array<{ path: string; type: string; enabled: boolean }> }>('/api/log-viewer/rsyslog-files');
            if (rsyslogResponse.success && rsyslogResponse.result) {
                setRsyslogFiles(rsyslogResponse.result.logFiles.map(f => ({ ...f, enabled: false })));
            }

            // Load current configured log files
            if (plugin?.settings?.logFiles) {
                setLogFiles(plugin.settings.logFiles as Array<{ path: string; type: string; enabled: boolean }>);
            } else {
                // Initialize with default files
                setLogFiles(defaultResponse.success && defaultResponse.result ? defaultResponse.result.logFiles : []);
            }
        } catch (error) {
            console.error('Failed to load log files:', error);
        } finally {
            setIsLoadingLogFiles(false);
        }
    };

    const loadCustomRegexes = async () => {
        setIsLoadingRegexes(true);
        try {
            // Get plugin config to extract custom regexes
            if (plugin?.settings) {
                const customRegex = (plugin.settings as any).customRegex;
                if (customRegex && typeof customRegex === 'object') {
                    const regexList = Object.entries(customRegex).map(([filePath, config]: [string, any]) => ({
                        filePath,
                        logType: config.logType || 'custom',
                        regex: config.regex || '',
                        updatedAt: config.updatedAt
                    }));
                    setCustomRegexes(regexList);
                } else {
                    setCustomRegexes([]);
                }
            } else {
                setCustomRegexes([]);
            }
        } catch (error) {
            console.error('Failed to load custom regexes:', error);
            setCustomRegexes([]);
        } finally {
            setIsLoadingRegexes(false);
        }
    };

    const addLogFile = (file: { path: string; type: string; enabled: boolean }) => {
        if (!file.path.trim()) return;
        if (logFiles.find(f => f.path === file.path)) return; // Already exists
        
        setLogFiles([...logFiles, file]);
        setNewLogFile({ path: '', type: 'custom' });
    };

    const removeLogFile = (path: string) => {
        setLogFiles(logFiles.filter(f => f.path !== path));
    };

    const toggleLogFile = (path: string) => {
        setLogFiles(logFiles.map(f => 
            f.path === path ? { ...f, enabled: !f.enabled } : f
        ));
    };

    const addFromDefault = (file: { path: string; type: string; enabled: boolean }) => {
        addLogFile(file);
    };

    const addFromRsyslog = (file: { path: string; type: string; enabled: boolean }) => {
        addLogFile(file);
    };

    if (!isOpen || !plugin) return null;

    const handleInputChange = (field: string, value: string | number | boolean) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        setTestResult(null);
    };

    // Validate form data
    const validateForm = (): { valid: boolean; error?: string } => {
        if (isLogSourcePlugin) {
            // Validate log source plugin configuration
            if (!formData.basePath || typeof formData.basePath !== 'string' || !formData.basePath.trim()) {
                return { valid: false, error: t('pluginConfig.basePathRequired') };
            }
            
            if (pluginId === 'nginx' || pluginId === 'apache') {
                if (!formData.accessLogPattern || typeof formData.accessLogPattern !== 'string' || !formData.accessLogPattern.trim()) {
                    return { valid: false, error: t('pluginConfig.accessPatternRequired') };
                }
                if (!formData.errorLogPattern || typeof formData.errorLogPattern !== 'string' || !formData.errorLogPattern.trim()) {
                    return { valid: false, error: t('pluginConfig.errorPatternRequired') };
                }
            } else if (pluginId === 'npm') {
                if (!formData.accessLogPattern || typeof formData.accessLogPattern !== 'string' || !formData.accessLogPattern.trim()) {
                    return { valid: false, error: t('pluginConfig.accessPatternRequired') };
                }
            }
            
            if (typeof formData.maxLines !== 'number' || formData.maxLines < 0) {
                return { valid: false, error: t('pluginConfig.maxLinesInvalid') };
            }
            
            return { valid: true };
        }
        return { valid: true };
    };

    const handleSaveAndEnable = async () => {
        setIsSaving(true);
        setTestResult(null);

        // Validate form first
        const validation = validateForm();
        if (!validation.valid) {
            setTestResult({
                success: false,
                message: validation.error || t('pluginConfig.fillRequired')
            });
            setIsSaving(false);
            return;
        }

        try {
            // Prepare settings with logFiles for host-system
            const settings = { ...formData };
            if (pluginId === 'host-system') {
                // Use new 3-category structure if available, otherwise fallback to legacy logFiles
                if ((settings as any).systemBaseFiles || (settings as any).autoDetectedFiles || (settings as any).customFiles) {
                    // New structure already set by HostSystemFilesManager via onConfigChange
                } else {
                    // Legacy structure
                (settings as any).logFiles = logFiles;
                }
            }

            // Save config and enable plugin
            const success = await updatePluginConfig(pluginId, {
                enabled: true,
                settings
            });

            if (success) {
                await fetchPlugins();
                // Test connection after save
                await testPluginConnection(pluginId);
                await fetchPlugins();
                setTestResult({
                    success: true,
                    message: t('pluginConfig.saveSuccess')
                });
                // Close modal after a short delay
                setTimeout(() => {
                    onClose();
                }, 1500);
            } else {
                setTestResult({
                    success: false,
                    message: t('pluginConfig.saveError')
                });
            }
        } catch (error) {
            setTestResult({
                success: false,
                message: error instanceof Error ? error.message : t('pluginConfig.saveError')
            });
        } finally {
            setIsSaving(false);
        }
    };

    const handleTest = async () => {
        setIsTesting(true);
        setTestResult(null);

        // Validate form first
        const validation = validateForm();
        if (!validation.valid) {
            setTestResult({
                success: false,
                message: validation.error || t('pluginConfig.fillRequired')
            });
            setIsTesting(false);
            return;
        }

        try {
            // Prepare config based on plugin type
            let configToTest: Record<string, any> = {};
            
            if (isLogSourcePlugin) {
                // Log source plugin configuration
                configToTest = {
                    basePath: String(formData.basePath || '').trim(),
                    maxLines: Number(formData.maxLines) || 0
                };
                
                if (pluginId === 'nginx' || pluginId === 'apache') {
                    configToTest.accessLogPattern = String(formData.accessLogPattern || '').trim();
                    configToTest.errorLogPattern = String(formData.errorLogPattern || '').trim();
                } else if (pluginId === 'npm') {
                    configToTest.accessLogPattern = String(formData.accessLogPattern || '').trim();
                } else if (pluginId === 'host-system') {
                    // Host system uses logFiles array, handled separately
                    configToTest.journaldEnabled = Boolean(formData.journaldEnabled);
                }
            }

            // Test connection with the provided settings (without saving first)
            const result = await testPluginConnection(pluginId, configToTest);
            if (result) {
                if (result.connected) {
                    // If test is successful, check if we should auto-save and enable
                    const isDefaultPath = pluginId === 'host-system' && 
                        (formData.basePath === '/var/log' || formData.basePath === '/host/logs');
                    const isFirstConfig = !plugin?.settings?.basePath;
                    
                    if (isDefaultPath && isFirstConfig) {
                        // Auto-save and enable plugin if using default path and first config
                        setTestResult({
                            success: true,
                            message: t('pluginConfig.testSuccessAutoSave')
                        });
                        // Auto-save and enable
                        await handleSaveAndEnable();
                    } else {
                        setTestResult({
                            success: true,
                            message: t('pluginConfig.testSuccess')
                        });
                    }
                } else {
                    setTestResult({
                        success: false,
                        message: result.message || t('pluginConfig.testFailed')
                    });
                }
            } else {
                setTestResult({
                    success: false,
                    message: t('plugins.testImpossible')
                });
            }

            // Refresh plugins to update connection status
            await fetchPlugins();
        } catch (error) {
            setTestResult({
                success: false,
                message: error instanceof Error ? error.message : t('pluginConfig.testFailed')
            });
        } finally {
            setIsTesting(false);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        setTestResult(null);

        // Validate form first
        const validation = validateForm();
        if (!validation.valid) {
            setTestResult({
                success: false,
                message: validation.error || t('pluginConfig.fillRequired')
            });
            setIsSaving(false);
            return;
        }

        try {
            // Test connection first before saving
            let configToTest: Record<string, any> = {};
            if (isLogSourcePlugin) {
                configToTest = {
                    basePath: String(formData.basePath || '').trim(),
                    maxLines: Number(formData.maxLines) || 0
                };
                if (pluginId === 'nginx' || pluginId === 'apache') {
                    configToTest.accessLogPattern = String(formData.accessLogPattern || '').trim();
                    configToTest.errorLogPattern = String(formData.errorLogPattern || '').trim();
                } else if (pluginId === 'npm') {
                    configToTest.accessLogPattern = String(formData.accessLogPattern || '').trim();
                }
            }

            // Test before saving
            const testResult = await testPluginConnection(pluginId, configToTest);
            if (testResult && !testResult.connected) {
                setTestResult({
                    success: false,
                    message: testResult.message || t('pluginConfig.testFailed')
                });
                setIsSaving(false);
                return;
            }

            // Save config and enable plugin if test was successful
            // Prepare settings with logFiles for host-system
            const settings = { ...formData };
            if (pluginId === 'host-system') {
                // Use new 3-category structure if available, otherwise fallback to legacy logFiles
                if ((settings as any).systemBaseFiles || (settings as any).autoDetectedFiles || (settings as any).customFiles) {
                    // New structure already set by HostSystemFilesManager via onConfigChange
                } else {
                    // Legacy structure
                (settings as any).logFiles = logFiles;
                }
            }

            const success = await updatePluginConfig(pluginId, {
                enabled: testResult?.connected || false,
                settings
            });

            if (success) {
                await fetchPlugins();
                // Test connection after save
                await testPluginConnection(pluginId);
                await fetchPlugins();
                
                if (testResult?.connected) {
                    setTestResult({
                        success: true,
                        message: t('pluginConfig.saveSuccess')
                    });
                } else {
                    setTestResult({
                        success: true,
                        message: t('pluginConfig.saveSuccessAfterTest')
                    });
                }
                
                // Close modal after a short delay
                setTimeout(() => {
                    onClose();
                }, 1500);
            } else {
                setTestResult({
                    success: false,
                    message: t('pluginConfig.saveError')
                });
            }
        } catch (error) {
            setTestResult({
                success: false,
                message: error instanceof Error ? error.message : t('pluginConfig.saveError')
            });
        } finally {
            setIsSaving(false);
        }
    };

    const getPluginIcon = () => {
        switch (pluginId) {
            case 'host-system':
                return '🖥️';
            case 'nginx':
                return '🌐';
            case 'apache':
                return '🔧';
            case 'npm':
                return '📦';
            default:
                return '🔌';
        }
    };

    const getPluginColor = () => {
        switch (pluginId) {
            case 'host-system':
                return 'cyan';
            case 'nginx':
                return 'green';
            case 'apache':
                return 'orange';
            case 'npm':
                return 'blue';
            default:
                return 'gray';
        }
    };

    const colorClass = getPluginColor();
    const colorBg = colorClass === 'cyan' ? 'bg-cyan-500/20' : colorClass === 'green' ? 'bg-green-500/20' : colorClass === 'orange' ? 'bg-orange-500/20' : colorClass === 'blue' ? 'bg-blue-500/20' : 'bg-gray-500/20';
    const colorText = colorClass === 'cyan' ? 'text-cyan-400' : colorClass === 'green' ? 'text-green-400' : colorClass === 'orange' ? 'text-orange-400' : colorClass === 'blue' ? 'text-blue-400' : 'text-gray-400';
    const colorBorder = colorClass === 'cyan' ? 'border-cyan-700' : colorClass === 'green' ? 'border-green-700' : colorClass === 'orange' ? 'border-orange-700' : colorClass === 'blue' ? 'border-blue-700' : 'border-gray-700';

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className={`bg-[#151515] w-full max-w-md rounded-2xl border border-gray-800 shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto`}>
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-800 bg-[#1a1a1a]">
                    <div className="flex items-center gap-2">
                        <div className={`p-1.5 ${colorBg} rounded-lg`}>
                            <Settings size={20} className={colorText} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white">{t('pluginConfig.title', { name: plugin.name })}</h2>
                            <p className="text-xs text-gray-500">{t('pluginConfig.subtitle')}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={(e) => { e.preventDefault(); handleSave(); }} className="p-4 space-y-4">
                    {/* Log Source Plugin Configuration */}
                    {isLogSourcePlugin && (
                        <>
                            {/* Base Path */}
                            <div>
                                <label htmlFor="base-path" className="block text-sm font-medium text-gray-300 mb-2">
                                    {t('pluginConfig.basePath')} <span className="text-red-500">*</span>
                                </label>
                                <input
                                    id="base-path"
                                    name="base-path"
                                    type="text"
                                    value={String(formData.basePath || '')}
                                    onChange={(e) => handleInputChange('basePath', e.target.value)}
                                    placeholder={pluginId === 'host-system' ? '/var/log' : pluginId === 'npm' ? '/data/logs' : pluginId === 'nginx' ? '/var/log/nginx' : '/var/log/apache2'}
                                    className="w-full px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    required
                                />
                                <p className="text-xs text-gray-500 mt-1">
                                    {t('pluginConfig.basePathHelp')}
                                    {pluginId === 'host-system' && (
                                        <span className="text-blue-400 block mt-1">
                                            💡 {t('pluginConfig.basePathDefault')}
                                        </span>
                                    )}
                                </p>
                            </div>

                            {/* Access Log Pattern */}
                            {(pluginId === 'nginx' || pluginId === 'apache' || pluginId === 'npm') && (
                                <div>
                                    <label htmlFor="access-pattern" className="block text-sm font-medium text-gray-300 mb-2">
                                        {t('pluginConfig.accessPattern')} <span className="text-red-500">*</span>
                                        {(() => {
                                            const defaults = getDefaultValues();
                                            const isDefault = !plugin?.settings?.accessLogPattern && String(formData.accessLogPattern || '') === (defaults.accessLogPattern || '');
                                            return isDefault && (
                                                <span className="ml-2 px-2 py-0.5 text-xs bg-green-500/20 text-green-400 border border-green-500/30 rounded">
                                                    {t('pluginConfig.defaultValue')}
                                                </span>
                                            );
                                        })()}
                                    </label>
                                    <input
                                        id="access-pattern"
                                        name="access-pattern"
                                        type="text"
                                        value={String(formData.accessLogPattern || '')}
                                        onChange={(e) => handleInputChange('accessLogPattern', e.target.value)}
                                        placeholder={(() => {
                                            const defaults = getDefaultValues();
                                            return defaults.accessLogPattern || '';
                                        })()}
                                        className={`w-full px-3 py-2 bg-[#1a1a1a] border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 ${
                                            (() => {
                                                const defaults = getDefaultValues();
                                                const isDefault = !plugin?.settings?.accessLogPattern && String(formData.accessLogPattern || '') === (defaults.accessLogPattern || '');
                                                return isDefault ? 'border-green-500/50 bg-green-500/5' : 'border-gray-700';
                                            })()
                                        }`}
                                        required
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        {t('pluginConfig.accessPatternHelp')}
                                        {(() => {
                                            const defaults = getDefaultValues();
                                            return defaults.accessLogPattern && (
                                                <span className="text-green-400 block mt-1">
                                                    💡 {t('pluginConfig.defaultValueLabel')}: <code className="bg-green-500/20 px-1 rounded">{defaults.accessLogPattern}</code>
                                                </span>
                                            );
                                        })()}
                                    </p>
                                </div>
                            )}

                            {/* Error Log Pattern */}
                            {(pluginId === 'nginx' || pluginId === 'apache') && (
                                <div>
                                    <label htmlFor="error-pattern" className="block text-sm font-medium text-gray-300 mb-2">
                                        {t('pluginConfig.errorPattern')} <span className="text-red-500">*</span>
                                        {(() => {
                                            const defaults = getDefaultValues();
                                            const isDefault = !plugin?.settings?.errorLogPattern && String(formData.errorLogPattern || '') === (defaults.errorLogPattern || '');
                                            return isDefault && (
                                                <span className="ml-2 px-2 py-0.5 text-xs bg-green-500/20 text-green-400 border border-green-500/30 rounded">
                                                    {t('pluginConfig.defaultValue')}
                                                </span>
                                            );
                                        })()}
                                    </label>
                                    <input
                                        id="error-pattern"
                                        name="error-pattern"
                                        type="text"
                                        value={String(formData.errorLogPattern || '')}
                                        onChange={(e) => handleInputChange('errorLogPattern', e.target.value)}
                                        placeholder={(() => {
                                            const defaults = getDefaultValues();
                                            return defaults.errorLogPattern || '';
                                        })()}
                                        className={`w-full px-3 py-2 bg-[#1a1a1a] border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 ${
                                            (() => {
                                                const defaults = getDefaultValues();
                                                const isDefault = !plugin?.settings?.errorLogPattern && String(formData.errorLogPattern || '') === (defaults.errorLogPattern || '');
                                                return isDefault ? 'border-green-500/50 bg-green-500/5' : 'border-gray-700';
                                            })()
                                        }`}
                                        required
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        {t('pluginConfig.errorPatternHelp')}
                                        {(() => {
                                            const defaults = getDefaultValues();
                                            return defaults.errorLogPattern && (
                                                <span className="text-green-400 block mt-1">
                                                    💡 {t('pluginConfig.defaultValueLabel')}: <code className="bg-green-500/20 px-1 rounded">{defaults.errorLogPattern}</code>
                                                </span>
                                            );
                                        })()}
                                    </p>
                                </div>
                            )}

                            {/* Max Lines */}
                            <div>
                                <label htmlFor="max-lines" className="block text-sm font-medium text-gray-300 mb-2">
                                    {t('pluginConfig.maxLines')}
                                </label>
                                <input
                                    id="max-lines"
                                    name="max-lines"
                                    type="number"
                                    min="0"
                                    value={Number(formData.maxLines ?? 0)}
                                    onChange={(e) => handleInputChange('maxLines', parseInt(e.target.value, 10) || 0)}
                                    className="w-full px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                                />
                                <p className="text-xs text-gray-500 mt-1">
                                    {t('pluginConfig.maxLinesHelp')}
                                </p>
                            </div>

                            {/* Log Files Management (host-system only) - New 3 Categories System */}
                            {pluginId === 'host-system' && (
                                <div className="mt-6 pt-6 border-t border-gray-800">
                                    <HostSystemFilesManager
                                        pluginId={pluginId}
                                        currentConfig={{
                                            systemBaseFiles: (plugin?.settings as any)?.systemBaseFiles,
                                            autoDetectedFiles: (plugin?.settings as any)?.autoDetectedFiles,
                                            customFiles: (plugin?.settings as any)?.customFiles,
                                            logFiles: (plugin?.settings as any)?.logFiles // Legacy support
                                        }}
                                        onConfigChange={(config) => {
                                            // Update formData with new config structure
                                            const settings = { ...formData };
                                            (settings as any).systemBaseFiles = config.systemBaseFiles;
                                            (settings as any).autoDetectedFiles = config.autoDetectedFiles;
                                            (settings as any).customFiles = config.customFiles;
                                            setFormData(settings);
                                        }}
                                    />
                                </div>
                            )}
                            
                            {/* Legacy Log Files Management (host-system only) - Keep for backward compatibility */}
                            {pluginId === 'host-system' && false && (
                                <div className="mt-6 pt-6 border-t border-gray-800">
                                    <div className="flex items-center justify-between mb-4">
                                        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                                            <FileText size={16} />
                                            Fichiers de logs système
                                        </h3>
                                        <button
                                            type="button"
                                            onClick={loadLogFiles}
                                            className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors flex items-center gap-1"
                                        >
                                            <RefreshCw size={12} />
                                            Actualiser
                                        </button>
                                    </div>

                                    {isLoadingLogFiles ? (
                                        <div className="text-center py-4 text-gray-500 text-sm">Chargement...</div>
                                    ) : (
                                        <>
                                            {/* Default Log Files (from OS) */}
                                            {defaultLogFiles.length > 0 && (
                                                <div className="mb-4">
                                                    <label className="block text-xs font-medium text-gray-400 mb-2">
                                                        Fichiers par défaut (selon OS)
                                                    </label>
                                                    <div className="space-y-2 max-h-32 overflow-y-auto">
                                                        {defaultLogFiles.filter(f => !f.path.endsWith('.gz') && !f.path.endsWith('.bz2') && !f.path.endsWith('.xz')).map((file, idx) => {
                                                            const isAdded = logFiles.find(f => f.path === file.path);
                                                            return (
                                                                <div key={idx} className="flex items-center gap-2 p-2 bg-[#0f0f0f] rounded border border-gray-800">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={isAdded ? logFiles.find(f => f.path === file.path)?.enabled || false : false}
                                                                        onChange={() => isAdded ? toggleLogFile(file.path) : addFromDefault({ ...file, enabled: true })}
                                                                        className="w-4 h-4 rounded border-gray-600 bg-[#1a1a1a] text-cyan-500 focus:ring-cyan-500"
                                                                    />
                                                                    <span className="flex-1 text-xs text-gray-300">{file.path}</span>
                                                                    <span className="text-xs text-gray-500 px-2 py-0.5 bg-gray-800 rounded">{file.type}</span>
                                                                    {!isAdded && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => addFromDefault({ ...file, enabled: true })}
                                                                            className="text-xs px-2 py-1 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 rounded transition-colors"
                                                                        >
                                                                            <Plus size={12} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Rsyslog Files */}
                                            {rsyslogFiles.length > 0 && (
                                                <div className="mb-4">
                                                    <label className="block text-xs font-medium text-gray-400 mb-2">
                                                        Fichiers depuis rsyslog.conf
                                                    </label>
                                                    <div className="space-y-2 max-h-32 overflow-y-auto">
                                                        {rsyslogFiles.filter(f => !f.path.endsWith('.gz') && !f.path.endsWith('.bz2') && !f.path.endsWith('.xz')).map((file, idx) => {
                                                            const isAdded = logFiles.find(f => f.path === file.path);
                                                            return (
                                                                <div key={idx} className="flex items-center gap-2 p-2 bg-[#0f0f0f] rounded border border-gray-800">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={isAdded ? logFiles.find(f => f.path === file.path)?.enabled || false : false}
                                                                        onChange={() => isAdded ? toggleLogFile(file.path) : addFromRsyslog({ ...file, enabled: true })}
                                                                        className="w-4 h-4 rounded border-gray-600 bg-[#1a1a1a] text-purple-500 focus:ring-purple-500"
                                                                    />
                                                                    <span className="flex-1 text-xs text-gray-300">{file.path}</span>
                                                                    <span className="text-xs text-gray-500 px-2 py-0.5 bg-gray-800 rounded">{file.type}</span>
                                                                    {!isAdded && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => addFromRsyslog({ ...file, enabled: true })}
                                                                            className="text-xs px-2 py-1 bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 rounded transition-colors"
                                                                        >
                                                                            <Plus size={12} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Configured Log Files */}
                                            <div>
                                                <label className="block text-xs font-medium text-gray-400 mb-2">
                                                    Fichiers configurés ({logFiles.filter(f => !f.path.endsWith('.gz') && !f.path.endsWith('.bz2') && !f.path.endsWith('.xz')).length})
                                                </label>
                                                <div className="space-y-2 max-h-48 overflow-y-auto">
                                                    {logFiles.filter(f => !f.path.endsWith('.gz') && !f.path.endsWith('.bz2') && !f.path.endsWith('.xz')).length === 0 ? (
                                                        <div className="text-center py-4 text-gray-500 text-xs">Aucun fichier configuré</div>
                                                    ) : (
                                                        logFiles.filter(f => !f.path.endsWith('.gz') && !f.path.endsWith('.bz2') && !f.path.endsWith('.xz')).map((file, idx) => (
                                                            <div key={idx} className="flex items-center gap-2 p-2 bg-[#1a1a1a] rounded border border-gray-700">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={file.enabled}
                                                                    onChange={() => toggleLogFile(file.path)}
                                                                    className="w-4 h-4 rounded border-gray-600 bg-[#1a1a1a] text-cyan-500 focus:ring-cyan-500"
                                                                />
                                                                <span className={`flex-1 text-xs ${file.enabled ? 'text-white' : 'text-gray-500'}`}>{file.path}</span>
                                                                <span className="text-xs text-gray-500 px-2 py-0.5 bg-gray-800 rounded">{file.type}</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => removeLogFile(file.path)}
                                                                    className="text-xs px-2 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded transition-colors"
                                                                >
                                                                    <Trash2 size={12} />
                                                                </button>
                                                            </div>
                                                        ))
                                                    )}
                                                </div>
                                            </div>

                                            {/* Add Custom Log File */}
                                            <div className="mt-4 pt-4 border-t border-gray-800">
                                                <label className="block text-xs font-medium text-gray-400 mb-2">
                                                    Ajouter un fichier personnalisé
                                                </label>
                                                <div className="flex gap-2">
                                                    <input
                                                        type="text"
                                                        value={newLogFile.path}
                                                        onChange={(e) => setNewLogFile({ ...newLogFile, path: e.target.value })}
                                                        placeholder="/var/log/custom.log"
                                                        className="flex-1 px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-xs placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                                                    />
                                                    <select
                                                        value={newLogFile.type}
                                                        onChange={(e) => setNewLogFile({ ...newLogFile, type: e.target.value })}
                                                        className="px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500"
                                                    >
                                                        <option value="syslog">Syslog</option>
                                                        <option value="auth">Auth</option>
                                                        <option value="kern">Kernel</option>
                                                        <option value="daemon">Daemon</option>
                                                        <option value="mail">Mail</option>
                                                        <option value="custom">Custom</option>
                                                    </select>
                                                    <button
                                                        type="button"
                                                        onClick={() => addLogFile({ ...newLogFile, enabled: true })}
                                                        className="px-3 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 rounded transition-colors"
                                                    >
                                                        <Plus size={16} />
                                                    </button>
                                                </div>
                                            </div>
                                        </>
                                    )}

                                    {/* Custom Regex Section */}
                                    {isLogSourcePlugin && (
                                        <div className="mt-6 pt-6 border-t border-gray-800">
                                            <div className="flex items-center gap-2 mb-4">
                                                <Code size={18} className="text-purple-400" />
                                                <h3 className="text-sm font-semibold text-white">Regex personnalisées</h3>
                                            </div>
                                            {isLoadingRegexes ? (
                                                <div className="text-center py-4 text-gray-500 text-xs">
                                                    <RefreshCw size={16} className="animate-spin mx-auto mb-2" />
                                                    Chargement...
                                                </div>
                                            ) : customRegexes.length === 0 ? (
                                                <div className="text-center py-4 text-gray-500 text-xs">
                                                    Aucune regex personnalisée configurée
                                                </div>
                                            ) : (
                                                <div className="space-y-2 max-h-64 overflow-y-auto">
                                                    {customRegexes.filter(item => !item.filePath.endsWith('.gz') && !item.filePath.endsWith('.bz2') && !item.filePath.endsWith('.xz')).map((item, idx) => (
                                                        <div key={idx} className="p-3 bg-[#1a1a1a] rounded border border-gray-700">
                                                            <div className="flex items-start justify-between gap-2 mb-2">
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="text-xs font-medium text-white truncate" title={item.filePath}>
                                                                        {item.filePath.split('/').pop()}
                                                                    </div>
                                                                    <div className="text-xs text-gray-400 mt-0.5">
                                                                        Type: {item.logType}
                                                                    </div>
                                                                    {item.updatedAt && (
                                                                        <div className="text-xs text-gray-500 mt-0.5">
                                                                            Modifié: {new Date(item.updatedAt).toLocaleString('fr-FR')}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <code className="block text-xs text-gray-300 bg-[#0f0f0f] p-2 rounded border border-gray-800 break-all font-mono">
                                                                {item.regex}
                                                            </code>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                            <p className="text-xs text-gray-500 mt-2">
                                                💡 Les regex personnalisées sont configurées depuis l'éditeur de regex dans le header du visualiseur de logs.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}

                    {/* API Mode Selection (UniFi only) */}
                    {pluginId === 'unifi' && (
                        <div>
                            <label htmlFor="api-mode" className="block text-sm font-medium text-gray-300 mb-2">
                                {t('pluginConfig.connectionMode')}
                            </label>
                            <select
                                id="api-mode"
                                name="api-mode"
                                value={formData.apiMode || 'controller'}
                                onChange={(e) => handleInputChange('apiMode', e.target.value)}
                                className="w-full px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                            >
                                <option value="controller">{t('pluginConfig.apiModeController')}</option>
                                <option value="site-manager">{t('pluginConfig.apiModeSiteManager')}</option>
                            </select>
                            <p className="text-xs text-gray-500 mt-1">
                                {formData.apiMode === 'site-manager' 
                                    ? t('pluginConfig.apiModeSiteManagerHelp')
                                    : t('pluginConfig.apiModeControllerHelp')}
                            </p>
                        </div>
                    )}

                    {/* Site Manager API Key */}
                    {pluginId === 'unifi' && formData.apiMode === 'site-manager' && (
                        <div>
                            <label htmlFor="api-key" className="block text-sm font-medium text-gray-300 mb-2">
                                {t('pluginConfig.apiKeyLabel')} <span className="text-red-500">*</span>
                            </label>
                            <div className="relative">
                                <input
                                    id="api-key"
                                    name="api-key"
                                    type={showPassword ? 'text' : 'password'}
                                    value={formData.apiKey || ''}
                                    onChange={(e) => handleInputChange('apiKey', e.target.value)}
                                    placeholder={t('pluginConfig.apiKeyPlaceholder')}
                                    className={`w-full px-3 py-2 bg-[#1a1a1a] border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 pr-10 ${
                                        !formData.apiKey || !formData.apiKey.trim() 
                                            ? 'border-red-600 focus:ring-red-500' 
                                            : 'border-gray-700'
                                    }`}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                            {(!formData.apiKey || !formData.apiKey.trim()) && (
                                <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded-lg">
                                    <div className="flex items-center gap-2 text-red-400 text-xs">
                                        <AlertCircle size={14} />
                                        <span>⚠️ {t('pluginConfig.apiKeyRequired')}</span>
                                    </div>
                                </div>
                            )}
                            <p className="text-xs text-gray-500 mt-1">
                                {t('pluginConfig.getApiKey')}{' '}
                                <a 
                                    href="https://unifi.ui.com/api" 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="text-purple-400 hover:underline"
                                >
                                    unifi.ui.com/api
                                </a>
                                {' '}(Documentation:{' '}
                                <a 
                                    href="https://developer.ui.com/site-manager-api/gettingstarted/" 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="text-purple-400 hover:underline"
                                >
                                    Site Manager API
                                </a>
                                )
                            </p>
                        </div>
                    )}

                    {/* Controller API Fields */}
                    {pluginId === 'unifi' && formData.apiMode === 'controller' && (
                        <>
                            {/* URL */}
                            <div>
                                <label htmlFor="unifi-url" className="block text-sm font-medium text-gray-300 mb-2">
                                    {t('pluginConfig.unifiControllerUrl')} <span className="text-red-500">*</span>
                                </label>
                                <input
                                    id="unifi-url"
                                    name="unifi-url"
                                    type="url"
                                    value={formData.url}
                                    onChange={(e) => handleInputChange('url', e.target.value)}
                                    placeholder="https://unifi.example.com:8443"
                                    className="w-full px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:outline-none transition-colors"
                                    required
                                    pattern="https?://.+"
                                />
                                <p className="text-xs text-gray-500 mt-1">
                                    {t('pluginConfig.unifiControllerUrlHelp')}
                                </p>
                                <p className="text-xs text-gray-400 mt-1">
                                    Documentation:{' '}
                                    <a 
                                        href="https://help.ui.com/hc/en-us/articles/30076656117655-Getting-Started-with-the-Official-UniFi-API" 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="text-blue-400 hover:underline"
                                    >
                                        UniFi Controller API
                                    </a>
                                </p>
                            </div>

                            {/* Username */}
                            <div>
                                <label htmlFor="unifi-username" className="block text-sm font-medium text-gray-300 mb-2">
                                    {t('pluginConfig.unifiUsername')} <span className="text-red-500">*</span>
                                </label>
                                <input
                                    id="unifi-username"
                                    name="unifi-username"
                                    type="text"
                                    value={formData.username}
                                    onChange={(e) => handleInputChange('username', e.target.value)}
                                    placeholder="admin"
                                    className="w-full px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:outline-none transition-colors"
                                    required
                                />
                            </div>

                            {/* Password */}
                            <div>
                                <label htmlFor="unifi-password" className="block text-sm font-medium text-gray-300 mb-2">
                                    {t('pluginConfig.unifiPassword')} <span className="text-red-500">*</span>
                                </label>
                                <div className="relative">
                                    <input
                                        id="unifi-password"
                                        name="unifi-password"
                                        type={showPassword ? 'text' : 'password'}
                                        value={formData.password}
                                        onChange={(e) => handleInputChange('password', e.target.value)}
                                        placeholder="••••••••"
                                        className="w-full px-3 py-2 pr-10 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:outline-none transition-colors"
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-white transition-colors"
                                    >
                                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            </div>

                            {/* Site */}
                            <div>
                                <label htmlFor="unifi-site" className="block text-sm font-medium text-gray-300 mb-2">
                                    {t('pluginConfig.unifiSite')}
                                </label>
                                <input
                                    id="unifi-site"
                                    name="unifi-site"
                                    type="text"
                                    value={formData.site}
                                    onChange={(e) => handleInputChange('site', e.target.value)}
                                    placeholder="default"
                                    className="w-full px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:outline-none transition-colors"
                                />
                                <p className="text-xs text-gray-500 mt-1">
                                    {t('pluginConfig.unifiSiteHelp')}
                                </p>
                            </div>
                        </>
                    )}

                    {/* Freebox info */}
                    {pluginId === 'freebox' && (
                        <div className="p-4 bg-blue-900/20 border border-blue-700 rounded-lg">
                            <div className="flex items-start gap-2">
                                <AlertCircle size={20} className="text-blue-400 mt-0.5" />
                                <div className="text-sm text-gray-300">
                                    <p className="font-medium mb-1">{t('pluginConfig.freeboxTitle')}</p>
                                    <p className="text-gray-400">
                                        {t('pluginConfig.freeboxMessage')}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Test Result */}
                    {testResult && (
                        <div className={`p-3 rounded-lg border ${
                            testResult.success
                                ? 'bg-green-900/20 border-green-700'
                                : 'bg-red-900/20 border-red-700'
                        }`}>
                            <div className="flex items-center gap-2">
                                {testResult.success ? (
                                    <CheckCircle size={16} className="text-green-400" />
                                ) : (
                                    <XCircle size={16} className="text-red-400" />
                                )}
                                <span className={`text-sm ${
                                    testResult.success ? 'text-green-400' : 'text-red-400'
                                }`}>
                                    {testResult.message}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Connection Status */}
                    {plugin.connectionStatus && (
                        <div className="p-3 bg-green-900/20 border border-green-700 rounded-lg">
                            <div className="flex items-center gap-2">
                                <CheckCircle size={16} className="text-green-400" />
                                <span className="text-sm text-green-400">{t('pluginConfig.pluginConnected')}</span>
                            </div>
                        </div>
                    )}

                    {/* Default values info for log source plugins */}
                    {isLogSourcePlugin && (() => {
                        const defaults = getDefaultValues();
                        const hasDefaults = defaults.basePath && (!plugin?.settings?.basePath || String(formData.basePath || '') === defaults.basePath);
                        return hasDefaults && (
                            <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                                <div className="flex items-center gap-2 text-green-400 text-sm">
                                    <CheckCircle size={16} />
                                    <span className="font-medium">{t('pluginConfig.defaultsDetected')}</span>
                                </div>
                                <p className="text-xs text-gray-400 mt-1">
                                    {t('pluginConfig.defaultsDetectedHelp')}
                                </p>
                            </div>
                        );
                    })()}

                    {/* Actions */}
                    <div className="flex gap-2 pt-4 border-t border-gray-700">
                        <Button
                            type="button"
                            onClick={handleTest}
                            disabled={isTesting || isSaving}
                            variant={isLogSourcePlugin ? "primary" : "secondary"}
                            className={`flex-1 ${isLogSourcePlugin ? 'bg-green-600 hover:bg-green-700 text-white' : ''}`}
                        >
                            {isTesting ? (
                                <>
                                    <RefreshCw size={16} className="animate-spin" />
                                    {t('pluginConfig.testRunning')}
                                </>
                            ) : (
                                <>
                                    <RefreshCw size={16} />
                                    {t('pluginConfig.testButton')}
                                </>
                            )}
                        </Button>
                        <Button
                            type="submit"
                            disabled={isSaving || isTesting}
                            className="flex-1"
                        >
                            {isSaving ? (
                                <>
                                    <RefreshCw size={16} className="animate-spin" />
                                    {t('pluginConfig.saving')}
                                </>
                            ) : (
                                <>
                                    <Save size={16} />
                                    {t('pluginConfig.saveButton')}
                                </>
                            )}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};

