/**
 * Plugin Options Panel
 * 
 * Inline expandable panel for configuring plugins
 * Displays plugin options directly under the plugin card
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Settings, CheckCircle, XCircle, RefreshCw, AlertCircle, Save, Eye, EyeOff, Plus, Trash2, FileText, Code, ChevronUp, ChevronDown, RotateCw } from 'lucide-react';
import { usePluginStore, type Plugin } from '../stores/pluginStore';
import { Button } from './ui/Button';
import { api } from '../api/client';

interface PluginOptionsPanelProps {
    pluginId: string;
    onClose?: () => void;
}

export const PluginOptionsPanel: React.FC<PluginOptionsPanelProps> = ({ pluginId, onClose }) => {
    const { plugins, updatePluginConfig, testPluginConnection, fetchPlugins } = usePluginStore();
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
    
    // Inline notification state (position-based)
    const [inlineNotification, setInlineNotification] = useState<{
        id: string;
        message: string;
        position?: { top: number; left: number };
    } | null>(null);
    
    // Host system log files management
    const [logFiles, setLogFiles] = useState<Array<{ path: string; type: string; enabled: boolean }>>([]);
    const [defaultLogFiles, setDefaultLogFiles] = useState<Array<{ path: string; type: string; enabled: boolean }>>([]);
    const [rsyslogFiles, setRsyslogFiles] = useState<Array<{ path: string; type: string; enabled: boolean }>>([]);
    const [isLoadingLogFiles, setIsLoadingLogFiles] = useState(false);
    const [newLogFile, setNewLogFile] = useState({ path: '', type: 'access' });
    
    // Custom regex management
    const [customRegexes, setCustomRegexes] = useState<Array<{ filePath: string; logType: string; regex: string; updatedAt?: string }>>([]);
    const [isLoadingRegexes, setIsLoadingRegexes] = useState(false);
    
    // Detected files with regex info
    const [detectedFiles, setDetectedFiles] = useState<Array<{
        path: string;
        type: string;
        size: number;
        modified: string;
        regex: string;
        isCustom: boolean;
        isDefaultOverride: boolean;
        defaultRegex: string;
    }>>([]);
    const [isLoadingDetectedFiles, setIsLoadingDetectedFiles] = useState(false);
    const [editingRegex, setEditingRegex] = useState<{ filePath: string; regex: string } | null>(null);
    
    // System detected files (from logging services detection)
    const [systemDetectedFiles, setSystemDetectedFiles] = useState<Array<{
        path: string;
        type: string;
        enabled: boolean;
        detected: boolean;
        validated: boolean;
        isSystemCritical?: boolean;
    }>>([]);

    // Exclusion filters state
    const [excludeFilters, setExcludeFilters] = useState<{
        files?: string[];
        directories?: string[];
        paths?: string[];
    }>({
        files: [],
        directories: [],
        paths: []
    });

    // Log rotation info state
    const [logRotationInfo, setLogRotationInfo] = useState<{
        rotationSystem: string;
        active: boolean;
        configPath?: string;
        configFiles?: string[];
        configuredLogFiles: Array<{ path: string; type: string; rotationPattern?: string; keepDays?: number; compress?: boolean }>;
        commonLogFiles?: Array<{ path: string; type: string; osTypes: string[] }>;
    } | null>(null);
    
    // Collapsible state for rotation files
    const [isRotationFilesExpanded, setIsRotationFilesExpanded] = useState(false);
    
    // Collapsible states for detected files categories (host-system)
    const [isSystemFilesExpanded, setIsSystemFilesExpanded] = useState(false);
    const [isRotationDetectedFilesExpanded, setIsRotationDetectedFilesExpanded] = useState(false);
    const [isSupplementaryFilesExpanded, setIsSupplementaryFilesExpanded] = useState(false);
    
    // Collapsible states for log files sections (host-system)
    const [isDefaultLogFilesExpanded, setIsDefaultLogFilesExpanded] = useState(false);
    const [isConfiguredLogFilesExpanded, setIsConfiguredLogFilesExpanded] = useState(false);
    
    // Collapsible state for exclusion filters section
    const [isExclusionFiltersExpanded, setIsExclusionFiltersExpanded] = useState(false);
    
    // Collapsible states for log rotation and log files sections
    const [isLogRotationExpanded, setIsLogRotationExpanded] = useState(false);
    const [isLogFilesExpanded, setIsLogFilesExpanded] = useState(false);
    
    // Collapsible state for detected files with regex section (closed by default for npm, apache, nginx)
    const [isDetectedFilesExpanded, setIsDetectedFilesExpanded] = useState(false);

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
                    maxLines: 0, // 0 = no limit
                    readCompressed: false
                };
            case 'nginx':
                return {
                    basePath: '/var/log/nginx',
                    accessLogPattern: 'access*.log',
                    errorLogPattern: 'error*.log',
                    maxLines: 0, // 0 = no limit
                    readCompressed: false
                };
            case 'apache':
                return {
                    basePath: '/var/log/apache2',
                    accessLogPattern: 'access*.log',
                    errorLogPattern: 'error*.log',
                    maxLines: 0, // 0 = no limit
                    readCompressed: false
                };
            case 'npm':
                return {
                    basePath: '/data/logs',
                    accessLogPattern: 'proxy-host-*.log',
                    errorLogPattern: '',
                    maxLines: 0, // 0 = no limit
                    readCompressed: false
                };
            default:
                return {};
        }
    };

    // Form state based on plugin type
    const [formData, setFormData] = useState<Record<string, string | number | boolean>>({
        basePath: '',
        accessLogPattern: '',
        errorLogPattern: '',
        maxLines: 0, // 0 = no limit
        readCompressed: false
    });

    // Initialize form with plugin settings or defaults
    useEffect(() => {
        if (plugin && plugin.settings) {
            if (isLogSourcePlugin) {
                const defaults = getDefaultValues();
                setFormData({
                    basePath: (plugin.settings.basePath as string) || defaults.basePath || '',
                    accessLogPattern: (plugin.settings.accessLogPattern as string) || defaults.accessLogPattern || '',
                    errorLogPattern: (plugin.settings.errorLogPattern as string) || defaults.errorLogPattern || '',
                    maxLines: (plugin.settings.maxLines as number) ?? defaults.maxLines ?? 0,
                    readCompressed: (plugin.settings.readCompressed as boolean) ?? (defaults.readCompressed ?? false)
                });
                
                // Initialize exclude filters
                const filters = (plugin.settings as any).excludeFilters;
                if (filters && typeof filters === 'object') {
                    setExcludeFilters({
                        files: Array.isArray(filters.files) ? filters.files : [],
                        directories: Array.isArray(filters.directories) ? filters.directories : [],
                        paths: Array.isArray(filters.paths) ? filters.paths : []
                    });
                } else {
                    setExcludeFilters({ files: [], directories: [], paths: [] });
                }
            }
        } else if (plugin && isLogSourcePlugin) {
            const defaults = getDefaultValues();
            setFormData({
                basePath: defaults.basePath || '',
                accessLogPattern: defaults.accessLogPattern || '',
                errorLogPattern: defaults.errorLogPattern || '',
                maxLines: defaults.maxLines ?? 0,
                readCompressed: defaults.readCompressed ?? false
            });
        }
    }, [plugin, isLogSourcePlugin, pluginId]);

    // Reset detected files expanded state when plugin changes
    useEffect(() => {
        setIsDetectedFilesExpanded(pluginId === 'host-system');
    }, [pluginId]);

    // Create a stable key from logFiles to detect changes
    const logFilesKey = useMemo(() => {
        if (!plugin?.settings?.logFiles || !Array.isArray(plugin.settings.logFiles)) {
            return '';
        }
        return JSON.stringify(plugin.settings.logFiles);
    }, [plugin?.settings?.logFiles]);

    // Load log files from plugin settings (DB) and system detected files
    useEffect(() => {
        if (pluginId === 'host-system') {
            // Load from plugin settings (DB) first
            if (plugin?.settings?.logFiles && Array.isArray(plugin.settings.logFiles)) {
                const dbFiles = plugin.settings.logFiles as Array<{ path: string; type: string; enabled: boolean }>;
                setLogFiles(dbFiles);
                // Also set rsyslogFiles for display
                setRsyslogFiles(dbFiles.map(f => ({ ...f, enabled: false })));
            } else {
                // Clear log files if no files in settings
                setLogFiles([]);
                setRsyslogFiles([]);
            }
            // Load default files for display (OS-specific, no scan)
            const loadDefaultFiles = async () => {
                try {
                    const defaultResponse = await api.get<{ logFiles: Array<{ path: string; type: string; enabled: boolean }> }>('/api/log-viewer/default-log-files');
                    if (defaultResponse.success && defaultResponse.result) {
                        setDefaultLogFiles(defaultResponse.result.logFiles);
                    }
                } catch (error) {
                    console.warn('Failed to load default log files:', error);
                }
            };
            loadDefaultFiles();
            setNewLogFile({ path: '', type: 'custom' });
            
            // Always load system detected files (even if files are in DB)
            // This ensures the "Fichiers de logs système" section shows detected files
            const loadSystemDetectedFiles = async () => {
                try {
                    setIsLoadingLogFiles(true);
                    const detectResponse = await api.get<{
                        primaryService: { type: string; active: boolean; logFilesCount: number } | null;
                        allServices: Array<{ type: string; active: boolean; logFilesCount: number }>;
                        categorizedFiles: {
                            systemBaseFiles: Array<{ path: string; type: string; enabled: boolean; detected: boolean; validated: boolean; isSystemCritical?: boolean }>;
                            autoDetectedFiles: Array<{ path: string; type: string; enabled: boolean; detected: boolean; validated: boolean; parserType: string }>;
                        };
                        logRotation?: {
                            rotationSystem: string;
                            active: boolean;
                            configPath?: string;
                            configFiles?: string[];
                            configuredLogFiles: Array<{ path: string; type: string; rotationPattern?: string; keepDays?: number; compress?: boolean }>;
                            commonLogFiles?: Array<{ path: string; type: string; osTypes: string[] }>;
                        };
                    }>('/api/log-viewer/detect-logging-services');
                    
                    if (detectResponse.success && detectResponse.result) {
                        // Store system detected files for display
                        setSystemDetectedFiles([
                            ...(detectResponse.result.categorizedFiles.systemBaseFiles || []),
                            ...(detectResponse.result.categorizedFiles.autoDetectedFiles || [])
                        ]);
                        
                        // Set log rotation info if available
                        if (detectResponse.result.logRotation) {
                            setLogRotationInfo({
                                ...detectResponse.result.logRotation,
                                commonLogFiles: detectResponse.result.logRotation.commonLogFiles || []
                            });
                        } else {
                            // Try to load rotation info separately
                            try {
                                const rotationResponse = await api.get<{
                                    rotationSystem: string;
                                    active: boolean;
                                    configPath?: string;
                                    configFiles?: string[];
                                    configuredLogFiles: Array<{ path: string; type: string; rotationPattern?: string; keepDays?: number; compress?: boolean }>;
                                    commonLogFiles: Array<{ path: string; type: string; osTypes: string[] }>;
                                }>('/api/log-viewer/log-rotation-info');
                                if (rotationResponse.success && rotationResponse.result) {
                                    setLogRotationInfo(rotationResponse.result);
                                }
                            } catch (rotationError) {
                                console.warn('Failed to load log rotation info:', rotationError);
                            }
                        }
                    }
                } catch (error) {
                    console.warn('Failed to load system detected files:', error);
                    // Don't block UI if detection fails
                } finally {
                    setIsLoadingLogFiles(false);
                }
            };
            
            // Load system detected files in background (non-blocking)
            loadSystemDetectedFiles();
        } else if (pluginId === 'apache' || pluginId === 'nginx' || pluginId === 'npm') {
            // Load custom log files from plugin settings
            if (plugin?.settings?.logFiles) {
                setLogFiles(plugin.settings.logFiles as Array<{ path: string; type: string; enabled: boolean }>);
            } else {
                setLogFiles([]);
            }
            setNewLogFile({ path: '', type: 'access' });
        }
    }, [pluginId, plugin, logFilesKey]);

    // Load custom regexes for log source plugins
    // Note: loadDetectedFiles is now only called manually via "Valider" button, not on basePath change
    useEffect(() => {
        if (isLogSourcePlugin && plugin) {
            loadCustomRegexes();
            // Load detected files only on initial load or when plugin changes
            // Not on basePath change to avoid reloading while user is typing
            if (formData.basePath) {
                loadDetectedFiles(true);
            }
        }
    }, [pluginId, isLogSourcePlugin, plugin]);
    
    const loadDetectedFiles = async (quick: boolean = false) => {
        if (!isLogSourcePlugin || !formData.basePath) return;
        
        setIsLoadingDetectedFiles(true);
        try {
            const quickParam = quick ? '&quick=true' : '';
            const response = await api.get<{
                files: Array<{
                    path: string;
                    type: string;
                    size: number;
                    modified: string;
                    regex: string;
                    isCustom: boolean;
                    isDefaultOverride: boolean;
                    defaultRegex: string;
                }>;
            }>(`/api/log-viewer/plugins/${pluginId}/detected-files?basePath=${encodeURIComponent(String(formData.basePath))}${quickParam}`);
            
            if (response.success && response.result) {
                setDetectedFiles(response.result.files);
                setIsLoadingDetectedFiles(false);
                
                // If quick mode, load complete data in background
                if (quick) {
                    loadDetectedFiles(false).catch(err => {
                        console.warn('Failed to load complete detected files:', err);
                    });
                }
            }
        } catch (error) {
            console.error('Failed to load detected files:', error);
            setDetectedFiles([]);
            setIsLoadingDetectedFiles(false);
        }
    };

    const loadLogFiles = async (forceScan: boolean = false) => {
        setIsLoadingLogFiles(true);
        try {
            // Load default log files (OS-specific) - fast, no scan
            let defaultFiles: Array<{ path: string; type: string; enabled: boolean }> = [];
        try {
            const defaultResponse = await api.get<{ logFiles: Array<{ path: string; type: string; enabled: boolean }> }>('/api/log-viewer/default-log-files');
            if (defaultResponse.success && defaultResponse.result) {
                    defaultFiles = defaultResponse.result.logFiles;
                    setDefaultLogFiles(defaultFiles);
                }
            } catch (error) {
                console.warn('Failed to load default log files:', error);
                // Continue even if default files fail
            }

            // Only scan if forceScan is true (user clicked "Actualiser") or if no files in DB
            const hasFilesInDb = plugin?.settings?.logFiles && Array.isArray(plugin.settings.logFiles) && plugin.settings.logFiles.length > 0;
            
            if (forceScan || !hasFilesInDb) {
                // Try to detect logging services (journalctl, syslog-ng, rsyslog) and get configured files
                let detectedFiles: Array<{ path: string; type: string; enabled: boolean }> = [];
                try {
                    const detectResponse = await api.get<{
                        primaryService: { type: string; active: boolean; logFilesCount: number } | null;
                        allServices: Array<{ type: string; active: boolean; logFilesCount: number }>;
                        categorizedFiles: {
                            systemBaseFiles: Array<{ path: string; type: string; enabled: boolean; detected: boolean; validated: boolean; isSystemCritical?: boolean }>;
                            autoDetectedFiles: Array<{ path: string; type: string; enabled: boolean; detected: boolean; validated: boolean; parserType: string }>;
                        };
                        logRotation?: {
                            rotationSystem: string;
                            active: boolean;
                            configPath?: string;
                            configFiles?: string[];
                            configuredLogFiles: Array<{ path: string; type: string; rotationPattern?: string; keepDays?: number; compress?: boolean }>;
                            commonLogFiles?: Array<{ path: string; type: string; osTypes: string[] }>;
                        };
                    }>('/api/log-viewer/detect-logging-services');
                    
                    if (detectResponse.success && detectResponse.result) {
                        // Combine systemBaseFiles and autoDetectedFiles
                        const allDetected = [
                            ...(detectResponse.result.categorizedFiles.systemBaseFiles || []),
                            ...(detectResponse.result.categorizedFiles.autoDetectedFiles || [])
                        ];
                        detectedFiles = allDetected.map(f => ({ path: f.path, type: f.type, enabled: false }));
                        setRsyslogFiles(detectedFiles);
                        
                        // Store system detected files for categorization
                        setSystemDetectedFiles([
                            ...(detectResponse.result.categorizedFiles.systemBaseFiles || []),
                            ...(detectResponse.result.categorizedFiles.autoDetectedFiles || [])
                        ]);
                        
                        // Set log rotation info if available
                        if (detectResponse.result.logRotation) {
                            setLogRotationInfo({
                                ...detectResponse.result.logRotation,
                                commonLogFiles: detectResponse.result.logRotation.commonLogFiles || []
                            });
                        } else {
                            // Try to load rotation info separately
                            try {
                                const rotationResponse = await api.get<{
                                    rotationSystem: string;
                                    active: boolean;
                                    configPath?: string;
                                    configFiles?: string[];
                                    configuredLogFiles: Array<{ path: string; type: string; rotationPattern?: string; keepDays?: number; compress?: boolean }>;
                                    commonLogFiles: Array<{ path: string; type: string; osTypes: string[] }>;
                                }>('/api/log-viewer/log-rotation-info');
                                if (rotationResponse.success && rotationResponse.result) {
                                    setLogRotationInfo(rotationResponse.result);
                                }
                            } catch (rotationError) {
                                console.warn('Failed to load log rotation info:', rotationError);
                            }
                        }
                        
                        // If no files in DB, save detected files to DB
                        if (!hasFilesInDb && detectedFiles.length > 0) {
                            // Save to plugin config
                            try {
                                const settings = { ...plugin?.settings, logFiles: detectedFiles.map(f => ({ ...f, enabled: true })) };
                                await updatePluginConfig(pluginId, {
                                    enabled: plugin?.enabled ?? false,
                                    settings
                                });
                                await fetchPlugins();
                            } catch (saveError) {
                                console.warn('Failed to save detected files to DB:', saveError);
                            }
                        }
                    }
                } catch (error) {
                    console.warn('Failed to detect logging services, trying legacy rsyslog endpoint:', error);
                    // Fallback to legacy rsyslog endpoint
                    try {
            const rsyslogResponse = await api.get<{ logFiles: Array<{ path: string; type: string; enabled: boolean }> }>('/api/log-viewer/rsyslog-files');
            if (rsyslogResponse.success && rsyslogResponse.result) {
                            detectedFiles = rsyslogResponse.result.logFiles.map(f => ({ ...f, enabled: false }));
                            setRsyslogFiles(detectedFiles);
                            
                            // If no files in DB, save detected files to DB
                            if (!hasFilesInDb && detectedFiles.length > 0) {
                                try {
                                    const settings = { ...plugin?.settings, logFiles: detectedFiles.map(f => ({ ...f, enabled: true })) };
                                    await updatePluginConfig(pluginId, {
                                        enabled: plugin?.enabled ?? false,
                                        settings
                                    });
                                    await fetchPlugins();
                                } catch (saveError) {
                                    console.warn('Failed to save detected files to DB:', saveError);
                                }
                            }
                        }
                    } catch (rsyslogError) {
                        console.warn('Failed to load rsyslog files:', rsyslogError);
                        // Continue even if rsyslog detection fails
                    }
                }
            } else {
                // Load from DB (already loaded in useEffect, but ensure rsyslogFiles is set)
                if (plugin?.settings?.logFiles) {
                    setRsyslogFiles((plugin.settings.logFiles as Array<{ path: string; type: string; enabled: boolean }>).map(f => ({ ...f, enabled: false })));
            }
            }

            // Set log files from plugin settings or use defaults
            if (plugin?.settings?.logFiles) {
                setLogFiles(plugin.settings.logFiles as Array<{ path: string; type: string; enabled: boolean }>);
            } else {
                // Use default files if available, otherwise empty array
                setLogFiles(defaultFiles.length > 0 ? defaultFiles : []);
            }
        } catch (error) {
            console.error('Failed to load log files:', error);
            // Ensure we still set empty arrays to show something
            setDefaultLogFiles([]);
            setRsyslogFiles([]);
            setLogFiles(plugin?.settings?.logFiles as Array<{ path: string; type: string; enabled: boolean }> || []);
        } finally {
            setIsLoadingLogFiles(false);
        }
    };

    const loadCustomRegexes = async () => {
        setIsLoadingRegexes(true);
        try {
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

    // Auto-save helper with debounce
    const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    
    // Ref to store latest formData for autoSave callback
    const formDataRef = useRef(formData);
    useEffect(() => {
        formDataRef.current = formData;
    }, [formData]);

    const autoSave = async (skipValidation: boolean = false) => {
        // Clear existing timeout
        if (autoSaveTimeoutRef.current) {
            clearTimeout(autoSaveTimeoutRef.current);
        }
        
        // Set new timeout for debounce (500ms)
        autoSaveTimeoutRef.current = setTimeout(async () => {
            try {
                // Use ref to get latest formData values (avoids closure issues)
                const currentFormData = formDataRef.current;
                
                // Skip validation for auto-save (only validate on manual test)
                const settings = { ...currentFormData };
                if (isLogSourcePlugin) {
                    (settings as any).logFiles = logFiles;
                    // Save exclude filters
                    const hasFilters = excludeFilters.files?.length || excludeFilters.directories?.length || excludeFilters.paths?.length;
                    if (hasFilters) {
                        (settings as any).excludeFilters = excludeFilters;
                    }
                }
                
                await updatePluginConfig(pluginId, {
                    enabled: plugin?.enabled ?? false,
                    settings
                });
                // Force refresh to update component state
                await fetchPlugins(true);
            } catch (error) {
                console.error('Auto-save failed:', error);
            }
        }, 500);
    };

    // Helper to auto-save exclude filters
    const autoSaveExcludeFilters = async (newFilters: typeof excludeFilters) => {
        if (autoSaveTimeoutRef.current) {
            clearTimeout(autoSaveTimeoutRef.current);
        }
        autoSaveTimeoutRef.current = setTimeout(async () => {
            try {
                const settings = { ...formData };
                if (isLogSourcePlugin) {
                    (settings as any).logFiles = logFiles;
                    (settings as any).excludeFilters = newFilters;
                }
                await updatePluginConfig(pluginId, {
                    enabled: plugin?.enabled ?? false,
                    settings
                });
                await fetchPlugins();
            } catch (error) {
                console.error('Auto-save exclude filters failed:', error);
            }
        }, 500);
    };

    const addLogFile = async (file: { path: string; type: string; enabled: boolean }, elementRef?: HTMLElement | null) => {
        if (!file.path.trim()) return;
        if (logFiles.find(f => f.path === file.path)) return;
        const newLogFiles = [...logFiles, file];
        setLogFiles(newLogFiles);
        setNewLogFile({ path: '', type: 'custom' });
        
        // Show notification
        showInlineNotification(`Fichier "${file.path.split('/').pop()}" ajouté`, elementRef);
        
        // Auto-save with new logFiles
        if (autoSaveTimeoutRef.current) {
            clearTimeout(autoSaveTimeoutRef.current);
        }
        autoSaveTimeoutRef.current = setTimeout(async () => {
            try {
                const settings = { ...formData };
                if (isLogSourcePlugin) {
                    (settings as any).logFiles = newLogFiles;
                    const hasFilters = excludeFilters.files?.length || excludeFilters.directories?.length || excludeFilters.paths?.length;
                    if (hasFilters) {
                        (settings as any).excludeFilters = excludeFilters;
                    }
                }
                await updatePluginConfig(pluginId, {
                    enabled: plugin?.enabled ?? false,
                    settings
                });
                await fetchPlugins();
            } catch (error) {
                console.error('Auto-save failed:', error);
            }
        }, 500);
    };

    const removeLogFile = async (path: string, elementRef?: HTMLElement | null) => {
        const newLogFiles = logFiles.filter(f => f.path !== path);
        setLogFiles(newLogFiles);
        
        // Show notification
        showInlineNotification(`Fichier "${path.split('/').pop()}" supprimé`, elementRef);
        
        // Auto-save with new logFiles
        if (autoSaveTimeoutRef.current) {
            clearTimeout(autoSaveTimeoutRef.current);
        }
        autoSaveTimeoutRef.current = setTimeout(async () => {
            try {
                const settings = { ...formData };
                if (isLogSourcePlugin) {
                    (settings as any).logFiles = newLogFiles;
                    const hasFilters = excludeFilters.files?.length || excludeFilters.directories?.length || excludeFilters.paths?.length;
                    if (hasFilters) {
                        (settings as any).excludeFilters = excludeFilters;
                    }
                }
                await updatePluginConfig(pluginId, {
                    enabled: plugin?.enabled ?? false,
                    settings
                });
                await fetchPlugins();
            } catch (error) {
                console.error('Auto-save failed:', error);
            }
        }, 500);
    };

    const toggleLogFile = async (path: string, elementRef?: HTMLElement | null) => {
        const file = logFiles.find(f => f.path === path);
        const newEnabled = !file?.enabled;
        const newLogFiles = logFiles.map(f => 
            f.path === path ? { ...f, enabled: newEnabled } : f
        );
        setLogFiles(newLogFiles);
        
        // Show notification
        const fileName = path.split('/').pop() || path;
        showInlineNotification(`Fichier "${fileName}" ${newEnabled ? 'activé' : 'désactivé'}`, elementRef);
        
        // Auto-save with new logFiles
        if (autoSaveTimeoutRef.current) {
            clearTimeout(autoSaveTimeoutRef.current);
        }
        autoSaveTimeoutRef.current = setTimeout(async () => {
            try {
                const settings = { ...formData };
                if (isLogSourcePlugin) {
                    (settings as any).logFiles = newLogFiles;
                    const hasFilters = excludeFilters.files?.length || excludeFilters.directories?.length || excludeFilters.paths?.length;
                    if (hasFilters) {
                        (settings as any).excludeFilters = excludeFilters;
                    }
                }
                await updatePluginConfig(pluginId, {
                    enabled: plugin?.enabled ?? false,
                    settings
                });
                await fetchPlugins();
            } catch (error) {
                console.error('Auto-save failed:', error);
            }
        }, 500);
    };

    const addFromDefault = (file: { path: string; type: string; enabled: boolean }, elementRef?: HTMLElement | null) => {
        addLogFile(file, elementRef);
    };

    const addFromRsyslog = (file: { path: string; type: string; enabled: boolean }, elementRef?: HTMLElement | null) => {
        addLogFile(file, elementRef);
    };

    if (!plugin) return null;

    // Helper to show inline notification near an element
    const showInlineNotification = (message: string, elementRef?: HTMLElement | null) => {
        let position: { top: number; left: number } | undefined;
        
        if (elementRef) {
            const rect = elementRef.getBoundingClientRect();
            const scrollY = window.scrollY || window.pageYOffset;
            const scrollX = window.scrollX || window.pageXOffset;
            position = {
                top: rect.bottom + scrollY + 10,
                left: rect.left + scrollX + (rect.width / 2) - 100 // Center relative to element
            };
        } else {
            // Fallback: use current viewport center
            position = {
                top: window.scrollY + window.innerHeight / 2,
                left: window.scrollX + window.innerWidth / 2 - 150
            };
        }
        
        const notificationId = `notification-${Date.now()}`;
        setInlineNotification({
            id: notificationId,
            message,
            position
        });
        
        // Auto-hide after 2 seconds
        setTimeout(() => {
            setInlineNotification(prev => prev?.id === notificationId ? null : prev);
        }, 2000);
    };

    const handleInputChange = async (field: string, value: string | number | boolean, elementRef?: HTMLElement | null) => {
        // Update form data first
        setFormData(prev => ({ ...prev, [field]: value }));
        setTestResult(null);
        
        // Auto-save logic:
        // - readCompressed: Auto-save (toggle)
        // - maxLines: Auto-save (toggle or number input)
        // - basePath, accessLogPattern, errorLogPattern: NO auto-save (wait for "Enregistrer" or "Valider")
        // - logFiles (add/remove/toggle): Auto-save via their own functions
        // - excludeFilters: Auto-save via autoSaveExcludeFilters
        
        if (field === 'readCompressed' || field === 'maxLines') {
            // Auto-save for toggles and number inputs
            const fieldLabels: Record<string, string> = {
                maxLines: 'Limite de lignes',
                readCompressed: 'Lire les fichiers compressés'
            };
            
            // Use updated formData in autoSave
            await autoSave();
            const fieldLabel = fieldLabels[field] || field;
            showInlineNotification(`${fieldLabel} sauvegardé`, elementRef);
        }
        // For basePath, accessLogPattern, errorLogPattern: no auto-save, wait for manual save
    };

    const validateForm = (): { valid: boolean; error?: string } => {
        if (isLogSourcePlugin) {
            if (!formData.basePath || typeof formData.basePath !== 'string' || !formData.basePath.trim()) {
                return { valid: false, error: 'Le chemin de base est requis' };
            }
            
            if (pluginId === 'nginx' || pluginId === 'apache') {
                if (!formData.accessLogPattern || typeof formData.accessLogPattern !== 'string' || !formData.accessLogPattern.trim()) {
                    return { valid: false, error: 'Le pattern pour les logs d\'accès est requis' };
                }
                if (!formData.errorLogPattern || typeof formData.errorLogPattern !== 'string' || !formData.errorLogPattern.trim()) {
                    return { valid: false, error: 'Le pattern pour les logs d\'erreur est requis' };
                }
            } else if (pluginId === 'npm') {
                if (!formData.accessLogPattern || typeof formData.accessLogPattern !== 'string' || !formData.accessLogPattern.trim()) {
                    return { valid: false, error: 'Le pattern pour les logs d\'accès est requis' };
                }
            }
            
            if (typeof formData.maxLines !== 'number' || formData.maxLines < 0) {
                return { valid: false, error: 'Le nombre maximum de lignes doit être un nombre positif ou zéro (0 = illimité)' };
            }
            
            return { valid: true };
        }
        return { valid: true };
    };

    const handleSave = async () => {
        const validation = validateForm();
        if (!validation.valid) {
            setTestResult({
                success: false,
                message: validation.error || 'Veuillez remplir tous les champs requis'
            });
            return;
        }

        try {
            const settings = { ...formData };
            if (isLogSourcePlugin) {
                (settings as any).logFiles = logFiles;
                const hasFilters = excludeFilters.files?.length || excludeFilters.directories?.length || excludeFilters.paths?.length;
                if (hasFilters) {
                    (settings as any).excludeFilters = excludeFilters;
                }
            }
            
            await updatePluginConfig(pluginId, {
                enabled: plugin?.enabled ?? false,
                settings
            });
            // Force refresh plugins to update the component
            await fetchPlugins(true);
            
            // Reload detected files after saving basePath
            if (isLogSourcePlugin && formData.basePath) {
                loadDetectedFiles(true);
            }
            
            // Reload log files for host-system plugin after save
            if (pluginId === 'host-system') {
                // The useEffect will automatically reload logFiles when plugin.settings.logFiles changes
                // But we can also explicitly reload if needed
            }
            
            showInlineNotification('Configuration enregistrée avec succès');
            setTestResult({
                success: true,
                message: 'Configuration enregistrée avec succès'
            });
        } catch (error) {
            console.error('Failed to save configuration:', error);
            setTestResult({
                success: false,
                message: 'Erreur lors de l\'enregistrement de la configuration'
            });
        }
    };

    const handleTest = async () => {
        setIsTesting(true);
        setTestResult(null);

        const validation = validateForm();
        if (!validation.valid) {
            setTestResult({
                success: false,
                message: validation.error || 'Veuillez remplir tous les champs requis'
            });
            setIsTesting(false);
            return;
        }

        // After successful validation, save automatically before testing
        try {
            const settings = { ...formData };
            if (isLogSourcePlugin) {
                (settings as any).logFiles = logFiles;
                const hasFilters = excludeFilters.files?.length || excludeFilters.directories?.length || excludeFilters.paths?.length;
                if (hasFilters) {
                    (settings as any).excludeFilters = excludeFilters;
                }
            }
            
            await updatePluginConfig(pluginId, {
                enabled: plugin?.enabled ?? false,
                settings
            });
            // Force refresh plugins to update the component
            await fetchPlugins(true);
            
            // Reload detected files after saving basePath
            if (isLogSourcePlugin && formData.basePath) {
                loadDetectedFiles(true);
            }
            
            // Reload log files for host-system plugin after save
            if (pluginId === 'host-system') {
                // The useEffect will automatically reload logFiles when plugin.settings.logFiles changes
            }
        } catch (error) {
            console.error('Failed to save configuration:', error);
            // Continue with test even if save fails
        }

        try {
            let configToTest: Record<string, any> = {};
            
            if (isLogSourcePlugin) {
                configToTest = {
                    basePath: String(formData.basePath || '').trim(),
                    maxLines: Number(formData.maxLines) || 0,
                    readCompressed: Boolean(formData.readCompressed)
                };
                
                if (pluginId === 'nginx' || pluginId === 'apache') {
                    configToTest.accessLogPattern = String(formData.accessLogPattern || '').trim();
                    configToTest.errorLogPattern = String(formData.errorLogPattern || '').trim();
                } else if (pluginId === 'npm') {
                    configToTest.accessLogPattern = String(formData.accessLogPattern || '').trim();
                } else if (pluginId === 'host-system') {
                    configToTest.journaldEnabled = Boolean(formData.journaldEnabled);
                }
            }

            const result = await testPluginConnection(pluginId, configToTest);
            if (result) {
                if (result.connected) {
                    setTestResult({
                        success: true,
                        message: 'Test réussi ! Vous pouvez maintenant sauvegarder.'
                    });
                } else {
                    setTestResult({
                        success: false,
                        message: result.message || 'Échec du test. Vérifiez le chemin et les permissions.'
                    });
                }
            } else {
                setTestResult({
                    success: false,
                    message: 'Test de connexion impossible (voir logs backend)'
                });
            }

            await fetchPlugins();
        } catch (error) {
            setTestResult({
                success: false,
                message: error instanceof Error ? error.message : 'Erreur lors du test de connexion'
            });
        } finally {
            setIsTesting(false);
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
        <div className="mt-3 p-4 bg-[#0f0f0f] border border-gray-800 rounded-lg animate-in slide-in-from-top-2 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-800">
                <div className="flex items-center gap-2">
                    <div className={`p-1.5 ${colorBg} rounded-lg`}>
                        <Settings size={18} className={colorText} />
                    </div>
                    <div>
                        <h3 className="text-base font-semibold text-white">Configuration {plugin.name}</h3>
                        <p className="text-xs text-gray-500">Paramètres de connexion</p>
                    </div>
                </div>
                {onClose && (
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white transition-colors"
                        title="Fermer"
                    >
                        <ChevronUp size={18} />
                    </button>
                )}
            </div>

            {/* Form */}
            <form onSubmit={(e) => { e.preventDefault(); handleTest(); }} className="space-y-4">
                {/* Test Result */}
                {testResult && (
                    <div className={`p-3 rounded-lg border-2 flex items-center gap-2 ${
                        testResult.success
                            ? 'border-green-600 bg-green-900/40 text-green-100'
                            : 'border-red-600 bg-red-900/40 text-red-100'
                    }`}>
                        {testResult.success ? (
                            <CheckCircle size={18} className="text-green-400 flex-shrink-0" />
                        ) : (
                            <XCircle size={18} className="text-red-400 flex-shrink-0" />
                        )}
                        <div className="flex-1 text-sm">{testResult.message}</div>
                    </div>
                )}

                {/* Log Source Plugin Configuration */}
                {isLogSourcePlugin && (
                    <div>
                        {/* Grid Layout: 2 columns for better organization */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            {/* Column 1: Basic Configuration */}
                            <div className="bg-gradient-to-r from-cyan-500/10 to-blue-500/10 rounded-lg border border-cyan-500/30 p-4 space-y-4">
                                <h4 className="text-base font-bold text-cyan-400 flex items-center gap-2 pb-3 mb-4 border-b border-cyan-500/20">
                                    <Settings size={18} />
                                    Configuration de base
                                </h4>
                                
                                {/* Base Path */}
                                <div>
                                    <label htmlFor={`base-path-${pluginId}`} className="block text-sm font-medium text-gray-300 mb-2">
                                        Chemin de base <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        id={`base-path-${pluginId}`}
                                        type="text"
                                        value={String(formData.basePath || '')}
                                        onChange={(e) => handleInputChange('basePath', e.target.value, e.currentTarget)}
                                        placeholder={pluginId === 'host-system' ? '/var/log' : pluginId === 'npm' ? '/data/logs' : pluginId === 'nginx' ? '/var/log/nginx' : '/var/log/apache2'}
                                        className="w-full px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                                        required
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        Chemin du répertoire contenant les fichiers de logs
                                    </p>
                                </div>

                                {/* Access Log Pattern */}
                                {(pluginId === 'nginx' || pluginId === 'apache' || pluginId === 'npm') && (
                                    <div>
                                        <label htmlFor={`access-pattern-${pluginId}`} className="block text-sm font-medium text-gray-300 mb-2">
                                            Pattern logs d'accès <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            id={`access-pattern-${pluginId}`}
                                            type="text"
                                            value={String(formData.accessLogPattern || '')}
                                            onChange={(e) => handleInputChange('accessLogPattern', e.target.value, e.currentTarget)}
                                            placeholder={getDefaultValues().accessLogPattern || ''}
                                            className="w-full px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                                            required
                                        />
                                        <p className="text-xs text-gray-500 mt-1">
                                            Pattern pour détecter les fichiers de logs d'accès
                                        </p>
                                    </div>
                                )}

                                {/* Error Log Pattern */}
                                {(pluginId === 'nginx' || pluginId === 'apache') && (
                                    <div>
                                        <label htmlFor={`error-pattern-${pluginId}`} className="block text-sm font-medium text-gray-300 mb-2">
                                            Pattern logs d'erreur <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            id={`error-pattern-${pluginId}`}
                                            type="text"
                                            value={String(formData.errorLogPattern || '')}
                                            onChange={(e) => handleInputChange('errorLogPattern', e.target.value, e.currentTarget)}
                                            placeholder={getDefaultValues().errorLogPattern || ''}
                                            className="w-full px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                                            required
                                        />
                                        <p className="text-xs text-gray-500 mt-1">
                                            Pattern pour détecter les fichiers de logs d'erreur
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* Column 2: Advanced Options */}
                            <div className="bg-gradient-to-r from-orange-500/10 to-purple-500/10 rounded-lg border border-orange-500/30 p-4 space-y-4">
                                <h4 className="text-sm font-semibold text-white flex items-center gap-2 pb-2 mb-4 border-b border-orange-500/20">
                                    <AlertCircle size={14} />
                                    Options avancées
                                </h4>

                                {/* Read Compressed Files */}
                                <div>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={Boolean(formData.readCompressed)}
                                            onChange={(e) => {
                                                handleInputChange('readCompressed', e.target.checked, e.currentTarget);
                                            }}
                                            className="w-4 h-4 rounded border-gray-600 bg-[#1a1a1a] text-purple-500 focus:ring-purple-500"
                                        />
                                        <span className="text-sm text-gray-300">Lire les fichiers compressés (.gz)</span>
                                    </label>
                                    <p className="text-xs text-gray-500 mt-1 ml-6">
                                        Active la lecture des fichiers de logs compressés en .gz (gzip uniquement pour l'instant)
                                    </p>
                                </div>

                                {/* Max Lines */}
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label htmlFor={`max-lines-${pluginId}`} className="block text-sm font-medium text-gray-300">
                                            Limite de lignes
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={Number(formData.maxLines ?? 0) > 0}
                                                onChange={(e) => {
                                                    const newValue = e.target.checked ? 10000 : 0; // Default to 10000 when enabled, 0 when disabled
                                                    handleInputChange('maxLines', newValue, e.currentTarget);
                                                }}
                                                className="w-4 h-4 rounded border-gray-600 bg-[#1a1a1a] text-purple-500 focus:ring-purple-500"
                                            />
                                            <span className="text-xs text-gray-400">
                                                {Number(formData.maxLines ?? 0) > 0 ? 'Activée' : 'Désactivée (illimité)'}
                                            </span>
                                        </label>
                                    </div>
                                    {Number(formData.maxLines ?? 0) > 0 ? (
                                        <>
                                            <input
                                                id={`max-lines-${pluginId}`}
                                                type="number"
                                                min="1"
                                                value={Number(formData.maxLines ?? 0)}
                                                onChange={(e) => handleInputChange('maxLines', parseInt(e.target.value, 10) || 0, e.currentTarget)}
                                                className="w-full px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                                            />
                                            <p className="text-xs text-gray-500 mt-1">
                                                Nombre maximum de lignes à charger depuis chaque fichier de log
                                            </p>
                                        </>
                                    ) : (
                                        <div className="px-3 py-2 bg-[#0a0a0a] border border-gray-800 rounded-lg text-sm text-gray-500">
                                            Aucune limite - tous les logs seront chargés
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Exclusion Filters - Collapsible */}
                        {isLogSourcePlugin && (
                            <div className="mt-4 pt-4 border-t border-gray-800">
                                <button
                                    type="button"
                                    onClick={() => setIsExclusionFiltersExpanded(!isExclusionFiltersExpanded)}
                                    className="w-full flex items-center justify-between p-3 bg-[#1a1a1a] rounded border border-gray-700 hover:bg-[#252525] transition-colors mb-3"
                                >
                                    <h4 className="text-base font-bold text-orange-400 flex items-center gap-2">
                                        <AlertCircle size={18} />
                                        Filtres d'exclusion
                                    </h4>
                                    {isExclusionFiltersExpanded ? (
                                        <ChevronUp size={18} className="text-gray-400" />
                                    ) : (
                                        <ChevronDown size={18} className="text-gray-400" />
                                    )}
                                </button>
                                
                                {isExclusionFiltersExpanded && (
                                    <div className="bg-[#0f0f0f] rounded-lg border border-gray-800 p-4">
                                        <p className="text-xs text-gray-400 mb-4">
                                            Configurez les patterns pour exclure automatiquement des fichiers ou dossiers lors du scan.
                                            Les patterns supportent la syntaxe glob (*, ?, **).
                                        </p>
                                        
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                            {/* Exclude Files */}
                                            <div>
                                                <label className="block text-xs font-medium text-gray-400 mb-2">
                                                    Exclure fichiers
                                                </label>
                                                <div className="space-y-2">
                                            {(excludeFilters.files || []).map((pattern, idx) => (
                                                <div key={idx} className="flex items-center gap-2">
                                                    <input
                                                        type="text"
                                                        value={pattern}
                                                        onChange={(e) => {
                                                            const newFiles = [...(excludeFilters.files || [])];
                                                            newFiles[idx] = e.target.value;
                                                            const newFilters = { ...excludeFilters, files: newFiles };
                                                            setExcludeFilters(newFilters);
                                                            autoSaveExcludeFilters(newFilters);
                                                        }}
                                                        placeholder="*.tmp"
                                                        className="flex-1 px-2 py-1.5 bg-[#1a1a1a] border border-gray-700 rounded text-white text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            const newFiles = [...(excludeFilters.files || [])];
                                                            newFiles.splice(idx, 1);
                                                            const newFilters = { ...excludeFilters, files: newFiles };
                                                            setExcludeFilters(newFilters);
                                                            autoSaveExcludeFilters(newFilters);
                                                            showInlineNotification('Filtre d\'exclusion de fichier supprimé', e.currentTarget);
                                                        }}
                                                        className="px-2 py-1 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded text-xs"
                                                    >
                                                        ×
                                                    </button>
                                                </div>
                                            ))}
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const newFilters = {
                                                        ...excludeFilters,
                                                        files: [...(excludeFilters.files || []), '']
                                                    };
                                                    setExcludeFilters(newFilters);
                                                    // Don't auto-save empty pattern
                                                }}
                                                className="w-full px-2 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs flex items-center justify-center gap-1"
                                            >
                                                + Ajouter
                                            </button>
                                        </div>
                                    </div>

                                    {/* Exclude Directories */}
                                    <div>
                                        <label className="block text-xs font-medium text-gray-400 mb-2">
                                            Exclure dossiers
                                        </label>
                                        <div className="space-y-2">
                                            {(excludeFilters.directories || []).map((pattern, idx) => (
                                                <div key={idx} className="flex items-center gap-2">
                                                    <input
                                                        type="text"
                                                        value={pattern}
                                                        onChange={(e) => {
                                                            const newDirs = [...(excludeFilters.directories || [])];
                                                            newDirs[idx] = e.target.value;
                                                            const newFilters = { ...excludeFilters, directories: newDirs };
                                                            setExcludeFilters(newFilters);
                                                            autoSaveExcludeFilters(newFilters);
                                                            showInlineNotification('Filtre d\'exclusion de dossier sauvegardé', e.currentTarget);
                                                        }}
                                                        placeholder="node_modules"
                                                        className="flex-1 px-2 py-1.5 bg-[#1a1a1a] border border-gray-700 rounded text-white text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            const newDirs = [...(excludeFilters.directories || [])];
                                                            newDirs.splice(idx, 1);
                                                            const newFilters = { ...excludeFilters, directories: newDirs };
                                                            setExcludeFilters(newFilters);
                                                            autoSaveExcludeFilters(newFilters);
                                                            showInlineNotification('Filtre d\'exclusion de dossier supprimé', e.currentTarget);
                                                        }}
                                                        className="px-2 py-1 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded text-xs"
                                                    >
                                                        ×
                                                    </button>
                                                </div>
                                            ))}
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const newFilters = {
                                                                ...excludeFilters,
                                                                directories: [...(excludeFilters.directories || []), '']
                                                            };
                                                            setExcludeFilters(newFilters);
                                                            // Don't auto-save empty pattern
                                                        }}
                                                        className="w-full px-2 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs flex items-center justify-center gap-1"
                                                    >
                                                        + Ajouter
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Exclude Paths */}
                                            <div>
                                                <label className="block text-xs font-medium text-gray-400 mb-2">
                                                    Exclure chemins complets
                                                </label>
                                                <div className="space-y-2">
                                            {(excludeFilters.paths || []).map((pattern, idx) => (
                                                <div key={idx} className="flex items-center gap-2">
                                                    <input
                                                        type="text"
                                                        value={pattern}
                                                        onChange={(e) => {
                                                            const newPaths = [...(excludeFilters.paths || [])];
                                                            newPaths[idx] = e.target.value;
                                                            const newFilters = { ...excludeFilters, paths: newPaths };
                                                            setExcludeFilters(newFilters);
                                                            autoSaveExcludeFilters(newFilters);
                                                            showInlineNotification('Filtre d\'exclusion de chemin sauvegardé', e.currentTarget);
                                                        }}
                                                        placeholder="/var/log/old"
                                                        className="flex-1 px-2 py-1.5 bg-[#1a1a1a] border border-gray-700 rounded text-white text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            const newPaths = [...(excludeFilters.paths || [])];
                                                            newPaths.splice(idx, 1);
                                                            const newFilters = { ...excludeFilters, paths: newPaths };
                                                            setExcludeFilters(newFilters);
                                                            autoSaveExcludeFilters(newFilters);
                                                            showInlineNotification('Filtre d\'exclusion de chemin supprimé', e.currentTarget);
                                                        }}
                                                        className="px-2 py-1 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded text-xs"
                                                    >
                                                        ×
                                                    </button>
                                                </div>
                                            ))}
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const newFilters = {
                                                                ...excludeFilters,
                                                                paths: [...(excludeFilters.paths || []), '']
                                                            };
                                                            setExcludeFilters(newFilters);
                                                            // Don't auto-save empty pattern
                                                        }}
                                                        className="w-full px-2 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs flex items-center justify-center gap-1"
                                                    >
                                                        + Ajouter
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Log Files Management (host-system, apache, nginx, npm) - Collapsible */}
                        {(pluginId === 'host-system' || pluginId === 'apache' || pluginId === 'nginx' || pluginId === 'npm') && (
                            <div className="mt-4 pt-4 border-t border-gray-800">
                                <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => setIsLogFilesExpanded(!isLogFilesExpanded)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            setIsLogFilesExpanded(!isLogFilesExpanded);
                                        }
                                    }}
                                    className="w-full flex items-center justify-between p-3 bg-[#1a1a1a] rounded border border-purple-500/30 hover:bg-[#252525] transition-colors mb-3 cursor-pointer"
                                >
                                    <h4 className="text-base font-bold text-purple-400 flex items-center gap-2">
                                        <FileText size={18} />
                                        {pluginId === 'host-system' ? 'Fichiers de logs système' : 'Fichiers de logs personnalisés'}
                                    </h4>
                                    <div className="flex items-center gap-2">
                                    {pluginId === 'host-system' && (
                                        <button
                                            type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    loadLogFiles(true);
                                                }}
                                                className="text-xs px-2 py-1 bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 rounded transition-colors flex items-center gap-1"
                                                title="Rescanner les services de logging (journalctl, syslog-ng, rsyslog)"
                                        >
                                            <RefreshCw size={12} />
                                            Actualiser
                                        </button>
                                    )}
                                        {isLogFilesExpanded ? (
                                            <ChevronUp size={18} className="text-gray-400" />
                                        ) : (
                                            <ChevronDown size={18} className="text-gray-400" />
                                    )}
                                </div>
                                </div>

                                {isLogFilesExpanded && (
                                    <div className="bg-[#0f0f0f] rounded-lg border border-gray-800 p-4">
                                {isLoadingLogFiles && pluginId === 'host-system' && (!logFiles || logFiles.length === 0) && (!systemDetectedFiles || systemDetectedFiles.length === 0) ? (
                                    <div className="text-center py-4 text-gray-500 text-xs">Chargement...</div>
                                ) : (
                                    <>
                                        {pluginId === 'host-system' ? (
                                            /* Host System: 2 columns layout */
                                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                                {/* Default Log Files - Collapsible */}
                                                {defaultLogFiles.length > 0 && (
                                                    <div>
                                                        <button
                                                            type="button"
                                                            onClick={() => setIsDefaultLogFilesExpanded(!isDefaultLogFilesExpanded)}
                                                            className="w-full flex items-center justify-between p-2 bg-[#1a1a1a] rounded border border-gray-700 hover:bg-[#252525] transition-colors mb-2"
                                                        >
                                                            <span className="text-xs font-medium text-gray-300">
                                                                Fichiers par défaut ({defaultLogFiles.length})
                                                            </span>
                                                            {isDefaultLogFilesExpanded ? (
                                                                <ChevronUp size={14} className="text-gray-400" />
                                                            ) : (
                                                                <ChevronDown size={14} className="text-gray-400" />
                                                            )}
                                                        </button>
                                                        {isDefaultLogFilesExpanded && (
                                                        <div className="space-y-1">
                                                            {defaultLogFiles.map((file, idx) => {
                                                                const isAdded = logFiles.find(f => f.path === file.path);
                                                                return (
                                                                    <div key={idx} className="flex items-center gap-2 p-1.5 bg-[#0a0a0a] rounded border border-gray-800">
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={isAdded ? logFiles.find(f => f.path === file.path)?.enabled || false : false}
                                                                                onChange={(e) => isAdded ? toggleLogFile(file.path, e.currentTarget.closest('div')) : addFromDefault({ ...file, enabled: true }, e.currentTarget.closest('div'))}
                                                                            className="w-3.5 h-3.5 rounded border-gray-600 bg-[#1a1a1a] text-cyan-500 focus:ring-cyan-500"
                                                                        />
                                                                        <span className="flex-1 text-xs text-gray-300 truncate">{file.path}</span>
                                                                        <span className="text-xs text-gray-500 px-1.5 py-0.5 bg-gray-800 rounded">{file.type}</span>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                        )}
                                                    </div>
                                                )}

                                                {/* Configured Log Files - Collapsible */}
                                                <div>
                                                    <button
                                                        type="button"
                                                        onClick={() => setIsConfiguredLogFilesExpanded(!isConfiguredLogFilesExpanded)}
                                                        className="w-full flex items-center justify-between p-2 bg-[#1a1a1a] rounded border border-gray-700 hover:bg-[#252525] transition-colors mb-2"
                                                    >
                                                        <span className="text-xs font-medium text-gray-300">
                                                        Fichiers configurés ({logFiles.length})
                                                        </span>
                                                        {isConfiguredLogFilesExpanded ? (
                                                            <ChevronUp size={14} className="text-gray-400" />
                                                        ) : (
                                                            <ChevronDown size={14} className="text-gray-400" />
                                                        )}
                                                    </button>
                                                    {isConfiguredLogFilesExpanded && (
                                                    <div className="space-y-1">
                                                        {logFiles.length === 0 ? (
                                                            <div className="text-center py-2 text-gray-500 text-xs">Aucun fichier configuré</div>
                                                        ) : (
                                                            logFiles.map((file, idx) => (
                                                                <div key={idx} className="flex items-center gap-2 p-1.5 bg-[#1a1a1a] rounded border border-gray-700">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={file.enabled}
                                                                            onChange={(e) => toggleLogFile(file.path, e.currentTarget.closest('div'))}
                                                                        className="w-3.5 h-3.5 rounded border-gray-600 bg-[#1a1a1a] text-cyan-500 focus:ring-cyan-500"
                                                                    />
                                                                    <span className={`flex-1 text-xs ${file.enabled ? 'text-white' : 'text-gray-500'} truncate`}>{file.path}</span>
                                                                    <span className="text-xs text-gray-500 px-1.5 py-0.5 bg-gray-800 rounded">{file.type}</span>
                                                                    <button
                                                                        type="button"
                                                                            onClick={(e) => removeLogFile(file.path, e.currentTarget.closest('div'))}
                                                                        className="text-xs px-1.5 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded transition-colors"
                                                                    >
                                                                        <Trash2 size={12} />
                                                                    </button>
                                                                </div>
                                                            ))
                                                        )}
                                                    </div>
                                                    )}
                                                </div>
                                            </div>
                                        ) : (
                                            /* Other plugins: single column */
                                            <div>
                                                <label className="block text-xs font-medium text-gray-400 mb-2">
                                                    Fichiers configurés ({logFiles.length})
                                                </label>
                                                <div className="space-y-1">
                                                    {logFiles.length === 0 ? (
                                                        <div className="text-center py-2 text-gray-500 text-xs">Aucun fichier configuré</div>
                                                    ) : (
                                                        logFiles.map((file, idx) => (
                                                            <div key={idx} className="flex items-center gap-2 p-1.5 bg-[#1a1a1a] rounded border border-gray-700">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={file.enabled}
                                                                    onChange={(e) => toggleLogFile(file.path, e.currentTarget.closest('div'))}
                                                                    className="w-3.5 h-3.5 rounded border-gray-600 bg-[#1a1a1a] text-cyan-500 focus:ring-cyan-500"
                                                                />
                                                                <span className={`flex-1 text-xs ${file.enabled ? 'text-white' : 'text-gray-500'} truncate`}>{file.path}</span>
                                                                <span className="text-xs text-gray-500 px-1.5 py-0.5 bg-gray-800 rounded">{file.type}</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => removeLogFile(file.path)}
                                                                    className="text-xs px-1.5 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded transition-colors"
                                                                >
                                                                    <Trash2 size={12} />
                                                                </button>
                                                            </div>
                                                        ))
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {/* Add Custom Log File */}
                                        <div className="mt-3 pt-3 border-t border-gray-800">
                                            <label className="block text-xs font-medium text-gray-400 mb-2">
                                                Ajouter un fichier personnalisé
                                            </label>
                                            <div className="flex gap-2">
                                                <input
                                                    type="text"
                                                    value={newLogFile.path}
                                                    onChange={(e) => setNewLogFile({ ...newLogFile, path: e.target.value })}
                                                    placeholder={pluginId === 'apache' ? '/var/log/apache2/custom.log' : pluginId === 'nginx' ? '/var/log/nginx/custom.log' : pluginId === 'npm' ? '/data/logs/custom.log' : '/var/log/custom.log'}
                                                    className="flex-1 px-2 py-1.5 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-xs placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                                                />
                                                <select
                                                    value={newLogFile.type}
                                                    onChange={(e) => setNewLogFile({ ...newLogFile, type: e.target.value })}
                                                    className="px-2 py-1.5 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500"
                                                >
                                                    {pluginId === 'host-system' ? (
                                                        <>
                                                            <option value="syslog">Syslog</option>
                                                            <option value="auth">Auth</option>
                                                            <option value="kern">Kernel</option>
                                                            <option value="daemon">Daemon</option>
                                                            <option value="mail">Mail</option>
                                                            <option value="custom">Custom</option>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <option value="access">Access</option>
                                                            <option value="error">Error</option>
                                                            <option value="custom">Custom</option>
                                                        </>
                                                    )}
                                                </select>
                                                <button
                                                    type="button"
                                                    onClick={(e) => addLogFile({ ...newLogFile, enabled: true }, e.currentTarget)}
                                                    className="px-2 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 rounded transition-colors"
                                                >
                                                    <Plus size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    </>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Log Rotation Info Section - Host System Only - Collapsible */}
                        {pluginId === 'host-system' && logRotationInfo && (
                            <div className="mt-4 pt-4 border-t border-gray-800">
                                <button
                                    type="button"
                                    onClick={() => setIsLogRotationExpanded(!isLogRotationExpanded)}
                                    className="w-full flex items-center justify-between p-3 bg-[#1a1a1a] rounded border border-yellow-500/30 hover:bg-[#252525] transition-colors mb-3"
                                >
                                    <h4 className="text-base font-bold text-yellow-400 flex items-center gap-2">
                                        <RotateCw size={18} />
                                        Système de rotation des logs
                                    </h4>
                                    {isLogRotationExpanded ? (
                                        <ChevronUp size={18} className="text-gray-400" />
                                    ) : (
                                        <ChevronDown size={18} className="text-gray-400" />
                                    )}
                                </button>
                                
                                {isLogRotationExpanded && (
                                    <div className="bg-[#0f0f0f] rounded-lg border border-gray-800 p-4">
                                        <div className="space-y-3">
                                    {/* Rotation System Info - Multi-column layout */}
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        {/* System Detected */}
                                        <div className="p-3 bg-[#1a1a1a] rounded border border-gray-700">
                                            <div className="text-xs font-medium text-gray-400 mb-2">Système détecté</div>
                                            <div className={`text-xs px-2 py-1 rounded inline-block ${
                                                logRotationInfo.active 
                                                    ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                                                    : 'bg-gray-800 text-gray-400 border border-gray-700'
                                            }`}>
                                                {logRotationInfo.rotationSystem === 'logrotate' ? 'logrotate' :
                                                 logRotationInfo.rotationSystem === 'systemd' ? 'systemd (journald)' :
                                                 logRotationInfo.rotationSystem === 'none' ? 'Aucun' : 'Inconnu'}
                                            </div>
                                        </div>
                                        
                                        {/* Config Path */}
                                        {logRotationInfo.configPath && (
                                            <div className="p-3 bg-[#1a1a1a] rounded border border-gray-700">
                                                <div className="text-xs font-medium text-gray-400 mb-2">Fichier de config</div>
                                                <div className="text-xs text-gray-300 font-mono truncate" title={logRotationInfo.configPath}>
                                                    {logRotationInfo.configPath}
                                                </div>
                                            </div>
                                        )}
                                        
                                        {/* Config Files Count */}
                                        {logRotationInfo.configFiles && logRotationInfo.configFiles.length > 0 && (
                                            <div className="p-3 bg-[#1a1a1a] rounded border border-gray-700">
                                                <div className="text-xs font-medium text-gray-400 mb-2">Fichiers de config</div>
                                                <div className="text-xs text-gray-300">{logRotationInfo.configFiles.length}</div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Configured Log Files - Collapsible */}
                                    {logRotationInfo.configuredLogFiles.length > 0 && (
                                        <div>
                                            <button
                                                type="button"
                                                onClick={() => setIsRotationFilesExpanded(!isRotationFilesExpanded)}
                                                className="w-full flex items-center justify-between p-2 bg-[#1a1a1a] rounded border border-gray-700 hover:bg-[#252525] transition-colors mb-2"
                                            >
                                                <span className="text-xs font-medium text-gray-300">
                                                    Fichiers configurés dans logrotate ({logRotationInfo.configuredLogFiles.length})
                                                </span>
                                                {isRotationFilesExpanded ? (
                                                    <ChevronUp size={16} className="text-gray-400" />
                                                ) : (
                                                    <ChevronDown size={16} className="text-gray-400" />
                                                )}
                                            </button>
                                            
                                            {isRotationFilesExpanded && (
                                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                                    {logRotationInfo.configuredLogFiles.map((file, idx) => (
                                                        <div key={idx} className="p-2 bg-[#0a0a0a] rounded border border-gray-800">
                                                            <div className="flex items-start justify-between mb-1 gap-2">
                                                                <span className="text-xs text-white font-mono break-all flex-1" title={file.path}>
                                                                    {file.path}
                                                                </span>
                                                                <span className="text-xs text-gray-500 px-1.5 py-0.5 bg-gray-800 rounded flex-shrink-0">
                                                                    {file.type}
                                                                </span>
                                                            </div>
                                                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500 mt-1">
                                                                {file.rotationPattern && (
                                                                    <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">
                                                                        {file.rotationPattern}
                                                                    </span>
                                                                )}
                                                                {file.keepDays && (
                                                                    <span className="px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded">
                                                                        {file.keepDays}j
                                                                    </span>
                                                                )}
                                                                {file.compress && (
                                                                    <span className="px-1.5 py-0.5 bg-orange-500/20 text-orange-400 rounded">
                                                                        Comp
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                </div>
                            </div>
                        )}
                        </div>
                    )}

                        {/* Detected Files with Regex Section */}
                        {(['apache', 'nginx', 'npm', 'host-system'].includes(pluginId)) && formData.basePath && (
                            <div className="mt-4 pt-4 border-t border-gray-800">
                                <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => setIsDetectedFilesExpanded(!isDetectedFilesExpanded)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            setIsDetectedFilesExpanded(!isDetectedFilesExpanded);
                                        }
                                    }}
                                    className="w-full flex items-center justify-between p-3 bg-[#1a1a1a] rounded border border-cyan-500/30 hover:bg-[#252525] transition-colors mb-3 cursor-pointer"
                                >
                                    <h4 className="text-base font-bold text-cyan-400 flex items-center gap-2">
                                        <FileText size={18} />
                                        Fichiers détectés avec regex
                                    </h4>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                loadDetectedFiles();
                                            }}
                                            className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors flex items-center gap-1"
                                            title="Actualiser la liste des fichiers"
                                        >
                                            <RefreshCw size={12} className={isLoadingDetectedFiles ? 'animate-spin' : ''} />
                                            Actualiser
                                        </button>
                                        {isDetectedFilesExpanded ? (
                                            <ChevronUp size={18} className="text-gray-400" />
                                        ) : (
                                            <ChevronDown size={18} className="text-gray-400" />
                                        )}
                                    </div>
                                </div>
                                
                                {isDetectedFilesExpanded && (
                                    <>
                                {isLoadingDetectedFiles ? (
                                    <div className="text-center py-4 text-gray-500 text-xs">
                                        <RefreshCw size={16} className="animate-spin mx-auto mb-2" />
                                        Scan en cours...
                                    </div>
                                ) : (() => {
                                    // Helper to check if a file is rotated or compressed
                                    // These files inherit regex from the base file, so we don't show them
                                    const isRotatedOrCompressed = (filePath: string): boolean => {
                                        const filename = filePath.split('/').pop() || '';
                                        // Check for compression extensions
                                        if (filename.endsWith('.gz') || filename.endsWith('.bz2') || filename.endsWith('.xz')) {
                                            return true;
                                        }
                                        // Check for rotation numbers (.1, .2, .20240101, etc.)
                                        if (/\.\d+(\.(gz|bz2|xz))?$/.test(filename) || /\.\d{8}(\.(gz|bz2|xz))?$/.test(filename)) {
                                            return true;
                                        }
                                        return false;
                                    };
                                    
                                    // Filter out rotated and compressed files (they inherit regex from base file)
                                    let baseFilesOnly = detectedFiles.filter(file => !isRotatedOrCompressed(file.path));
                                    
                                    // For host-system: categorize files into 3 groups
                                    if (pluginId === 'host-system') {
                                        const systemFilePaths = systemDetectedFiles.map(f => f.path);
                                        const rotationFilePaths = logRotationInfo?.configuredLogFiles?.map(f => f.path) || [];
                                        const manuallyAddedPaths = logFiles.map(f => f.path);
                                        
                                        // Normalize paths for comparison (remove trailing slashes, resolve relative paths)
                                        const normalizePath = (path: string) => path.replace(/\/$/, '').trim();
                                        const normalizedSystemPaths = systemFilePaths.map(normalizePath);
                                        const normalizedRotationPaths = rotationFilePaths.map(normalizePath);
                                        const normalizedManuallyAddedPaths = manuallyAddedPaths.map(normalizePath);
                                        
                                        // Standard system log file names (common system logs)
                                        const standardSystemLogNames = [
                                            'syslog', 'messages', 'auth.log', 'secure', 'kern.log', 'daemon.log', 
                                            'mail.log', 'maillog', 'user.log', 'cron.log', 'boot.log'
                                        ];
                                        
                                        // Helper to check if a file is a standard system log
                                        const isStandardSystemLog = (filePath: string): boolean => {
                                            const filename = filePath.split('/').pop()?.toLowerCase() || '';
                                            return standardSystemLogNames.some(name => filename === name || filename.startsWith(name + '.'));
                                        };
                                        
                                        // Categorize files - System files have priority
                                        // 1. System: files detected by system OR standard system log files (even if also in rotation or manually added)
                                        const systemFiles = baseFilesOnly.filter(file => {
                                            const normalizedPath = normalizePath(file.path);
                                            return normalizedSystemPaths.includes(normalizedPath) || isStandardSystemLog(file.path);
                                        });
                                        
                                        // 2. Rotation: files in rotation config but NOT system files
                                        const rotationFiles = baseFilesOnly.filter(file => {
                                            const normalizedPath = normalizePath(file.path);
                                            return normalizedRotationPaths.includes(normalizedPath) && 
                                                   !normalizedSystemPaths.includes(normalizedPath);
                                        });
                                        
                                        // 3. Supplementary: manually added files that are NOT system and NOT rotation
                                        const supplementaryFiles = baseFilesOnly.filter(file => {
                                            const normalizedPath = normalizePath(file.path);
                                            return normalizedManuallyAddedPaths.includes(normalizedPath) && 
                                                   !normalizedSystemPaths.includes(normalizedPath) && 
                                                   !normalizedRotationPaths.includes(normalizedPath);
                                        });
                                        
                                        // Render function for a file card
                                        const renderFileCard = (file: typeof baseFilesOnly[0], idx: number) => {
                                            const isEditing = editingRegex?.filePath === file.path;
                                            const currentRegex = isEditing ? editingRegex.regex : file.regex;
                                            const isInRotationConfig = rotationFilePaths.includes(file.path);
                                            const rotationConfig = logRotationInfo?.configuredLogFiles?.find(f => f.path === file.path);
                                            
                                            return (
                                                <div key={idx} className={`p-3 bg-[#1a1a1a] rounded border ${
                                                    isInRotationConfig ? 'border-yellow-500/50' : 'border-gray-700'
                                                }`}>
                                                    <div className="flex items-start justify-between gap-2 mb-2">
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2">
                                                            <div className="text-xs font-medium text-white break-all" title={file.path}>
                                                                {file.path.split('/').pop()}
                                                                </div>
                                                                {isInRotationConfig && (
                                                                    <span className="text-xs px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded border border-yellow-500/30" title="Configuré dans logrotate">
                                                                        Rotation
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
                                                                <span>Type: {file.type}</span>
                                                                <span className="text-gray-600">•</span>
                                                                <span className="text-yellow-200">{(file.size / 1024).toFixed(1)} KB</span>
                                                                {rotationConfig?.rotationPattern && (
                                                                    <>
                                                                        <span className="text-gray-600">•</span>
                                                                        <span className="text-blue-400">{rotationConfig.rotationPattern}</span>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-1 flex-shrink-0">
                                                            {file.isCustom && (
                                                                <span className="text-xs px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded border border-purple-500/30">
                                                                    Custom
                                                                </span>
                                                            )}
                                                            {file.isDefaultOverride && (
                                                                <span className="text-xs px-1.5 py-0.5 bg-orange-500/20 text-orange-400 rounded border border-orange-500/30">
                                                                    Override
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    
                                                    <div className="mt-2">
                                                        <label className="block text-xs font-medium text-gray-400 mb-1">
                                                            Regex {file.isCustom && <span className="text-purple-400">(Custom)</span>}
                                                        </label>
                                                        {isEditing ? (
                                                            <div className="space-y-2">
                                                                <textarea
                                                                    value={currentRegex}
                                                                    onChange={(e) => setEditingRegex({ filePath: file.path, regex: e.target.value })}
                                                                    className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-gray-600 rounded text-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500 break-all"
                                                                    rows={3}
                                                                />
                                                                <div className="flex items-center gap-2">
                                                                    <button
                                                                        type="button"
                                                                        onClick={async () => {
                                                                            try {
                                                                                await api.put(`/api/log-viewer/plugins/${pluginId}/regex-config`, {
                                                                                    filePath: file.path,
                                                                                    regex: currentRegex,
                                                                                    logType: file.type
                                                                                });
                                                                                setEditingRegex(null);
                                                                                await loadDetectedFiles();
                                                                                await loadCustomRegexes();
                                                                            } catch (error) {
                                                                                console.error('Failed to save regex:', error);
                                                                            }
                                                                        }}
                                                                        className="text-xs px-2 py-1 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded transition-colors"
                                                                    >
                                                                        <Save size={12} className="inline mr-1" />
                                                                        Sauvegarder
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setEditingRegex(null)}
                                                                        className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
                                                                    >
                                                                        Annuler
                                                                    </button>
                                                                    {file.regex !== file.defaultRegex && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={async () => {
                                                                                try {
                                                                                    await api.delete(`/api/log-viewer/plugins/${pluginId}/regex-config?filePath=${encodeURIComponent(file.path)}`);
                                                                                    setEditingRegex(null);
                                                                                    await loadDetectedFiles();
                                                                                    await loadCustomRegexes();
                                                                                } catch (error) {
                                                                                    console.error('Failed to delete regex:', error);
                                                                                }
                                                                            }}
                                                                            className="text-xs px-2 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded transition-colors"
                                                                        >
                                                                            Réinitialiser
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="space-y-1">
                                                                <div className="text-xs text-gray-500 font-mono break-all bg-[#0a0a0a] px-2 py-1.5 rounded border border-gray-800" title={currentRegex}>
                                                                    {currentRegex || '(Aucune regex)'}
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setEditingRegex({ filePath: file.path, regex: currentRegex })}
                                                                    className="text-xs px-2 py-1 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 rounded transition-colors"
                                                                >
                                                                    <Code size={12} className="inline mr-1" />
                                                                    Éditer
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        };
                                        
                                        // Render categorized sections
                                        return (
                                            <div className="space-y-4">
                                                {/* System Files Category - Collapsible */}
                                                {systemFiles.length > 0 && (
                                                    <div>
                                                        <button
                                                            type="button"
                                                            onClick={() => setIsSystemFilesExpanded(!isSystemFilesExpanded)}
                                                            className="w-full flex items-center justify-between p-2 bg-[#1a1a1a] rounded border border-gray-700 hover:bg-[#252525] transition-colors mb-2"
                                                        >
                                                            <div className="flex items-center gap-2">
                                                                <FileText size={14} className="text-cyan-400" />
                                                                <span className="text-xs font-semibold text-cyan-400">
                                                                    Système ({systemFiles.length})
                                                                </span>
                                                                    </div>
                                                            {isSystemFilesExpanded ? (
                                                                <ChevronUp size={14} className="text-gray-400" />
                                                            ) : (
                                                                <ChevronDown size={14} className="text-gray-400" />
                                                            )}
                                                        </button>
                                                        {isSystemFilesExpanded && (
                                                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                                                {systemFiles.map((file, idx) => renderFileCard(file, idx))}
                                                                    </div>
                                                        )}
                                                    </div>
                                                )}
                                                
                                                {/* Rotation Files Category - Collapsible */}
                                                {rotationFiles.length > 0 && (
                                                    <div>
                                                        <button
                                                            type="button"
                                                            onClick={() => setIsRotationDetectedFilesExpanded(!isRotationDetectedFilesExpanded)}
                                                            className="w-full flex items-center justify-between p-2 bg-[#1a1a1a] rounded border border-gray-700 hover:bg-[#252525] transition-colors mb-2"
                                                        >
                                                            <div className="flex items-center gap-2">
                                                                <RotateCw size={14} className="text-yellow-400" />
                                                                <span className="text-xs font-semibold text-yellow-400">
                                                                    Rotation ({rotationFiles.length})
                                                                </span>
                                                                    </div>
                                                            {isRotationDetectedFilesExpanded ? (
                                                                <ChevronUp size={14} className="text-gray-400" />
                                                            ) : (
                                                                <ChevronDown size={14} className="text-gray-400" />
                                                            )}
                                                        </button>
                                                        {isRotationDetectedFilesExpanded && (
                                                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                                                {rotationFiles.map((file, idx) => renderFileCard(file, idx))}
                                                                    </div>
                                                        )}
                                                    </div>
                                                )}
                                                
                                                {/* Supplementary Files Category - Collapsible */}
                                                {supplementaryFiles.length > 0 && (
                                                    <div>
                                                        <button
                                                            type="button"
                                                            onClick={() => setIsSupplementaryFilesExpanded(!isSupplementaryFilesExpanded)}
                                                            className="w-full flex items-center justify-between p-2 bg-[#1a1a1a] rounded border border-gray-700 hover:bg-[#252525] transition-colors mb-2"
                                                        >
                                                            <div className="flex items-center gap-2">
                                                                <Plus size={14} className="text-green-400" />
                                                                <span className="text-xs font-semibold text-green-400">
                                                                    Supplémentaires ({supplementaryFiles.length})
                                                                </span>
                                                                    </div>
                                                            {isSupplementaryFilesExpanded ? (
                                                                <ChevronUp size={14} className="text-gray-400" />
                                                            ) : (
                                                                <ChevronDown size={14} className="text-gray-400" />
                                                            )}
                                                        </button>
                                                        {isSupplementaryFilesExpanded && (
                                                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                                                {supplementaryFiles.map((file, idx) => renderFileCard(file, idx))}
                                                    </div>
                                                )}
                                                    </div>
                                                )}
                                                
                                                {systemFiles.length === 0 && rotationFiles.length === 0 && supplementaryFiles.length === 0 && (
                                                    <div className="text-center py-4 text-gray-500 text-xs">
                                                        Aucun fichier détecté. Vérifiez le chemin de base et les patterns.
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    } else {
                                        // For other plugins, use the original display
                                        return baseFilesOnly.length === 0 ? (
                                            <div className="text-center py-4 text-gray-500 text-xs">
                                                Aucun fichier détecté. Vérifiez le chemin de base et les patterns.
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                                {baseFilesOnly.map((file, idx) => {
                                                    const isEditing = editingRegex?.filePath === file.path;
                                                    const currentRegex = isEditing ? editingRegex.regex : file.regex;
                                        
                                        return (
                                                        <div key={idx} className="p-3 bg-[#1a1a1a] rounded border border-gray-700">
                                                            <div className="flex items-start justify-between gap-2 mb-2">
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="text-xs font-medium text-white break-all" title={file.path}>
                                                                        {file.path.split('/').pop()}
                                                                    </div>
                                                                    <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
                                                                        <span>Type: {file.type}</span>
                                                                        <span className="text-gray-600">•</span>
                                                                        <span className="text-yellow-200">{(file.size / 1024).toFixed(1)} KB</span>
                                                                    </div>
                                                                    </div>
                                                                <div className="flex items-center gap-1 flex-shrink-0">
                                                                    {file.isCustom && (
                                                                        <span className="text-xs px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded border border-purple-500/30">
                                                                            Custom
                                                                        </span>
                                                                    )}
                                                                    {file.isDefaultOverride && (
                                                                        <span className="text-xs px-1.5 py-0.5 bg-orange-500/20 text-orange-400 rounded border border-orange-500/30">
                                                                            Override
                                                                        </span>
                                                                    )}
                                                                </div>
                                                        </div>
                                                            
                                                            <div className="mt-2">
                                                                <label className="block text-xs font-medium text-gray-400 mb-1">
                                                                    Regex {file.isCustom && <span className="text-purple-400">(Custom)</span>}
                                                        </label>
                                                                {isEditing ? (
                                                        <div className="space-y-2">
                                                                        <textarea
                                                                            value={currentRegex}
                                                                            onChange={(e) => setEditingRegex({ filePath: file.path, regex: e.target.value })}
                                                                            className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-gray-600 rounded text-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500 break-all"
                                                                            rows={3}
                                                                        />
                                                                        <div className="flex items-center gap-2">
                                                                            <button
                                                                                type="button"
                                                                                onClick={async () => {
                                                                                    try {
                                                                                        await api.put(`/api/log-viewer/plugins/${pluginId}/regex-config`, {
                                                                                            filePath: file.path,
                                                                                            regex: currentRegex,
                                                                                            logType: file.type
                                                                                        });
                                                                                        setEditingRegex(null);
                                                                                        await loadDetectedFiles();
                                                                                        await loadCustomRegexes();
                                                                                    } catch (error) {
                                                                                        console.error('Failed to save regex:', error);
                                                                                    }
                                                                                }}
                                                                                className="text-xs px-2 py-1 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded transition-colors"
                                                                            >
                                                                                <Save size={12} className="inline mr-1" />
                                                                                Sauvegarder
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => setEditingRegex(null)}
                                                                                className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
                                                                            >
                                                                                Annuler
                                                                            </button>
                                                                            {file.regex !== file.defaultRegex && (
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={async () => {
                                                                                        try {
                                                                                            await api.delete(`/api/log-viewer/plugins/${pluginId}/regex-config?filePath=${encodeURIComponent(file.path)}`);
                                                                                            setEditingRegex(null);
                                                                                            await loadDetectedFiles();
                                                                                            await loadCustomRegexes();
                                                                                        } catch (error) {
                                                                                            console.error('Failed to delete regex:', error);
                                                                                        }
                                                                                    }}
                                                                                    className="text-xs px-2 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded transition-colors"
                                                                                >
                                                                                    Réinitialiser
                                                                                </button>
                                                                            )}
                                                                    </div>
                                                                    </div>
                                                                ) : (
                                                                    <div className="space-y-1">
                                                                        <div className="text-xs text-gray-500 font-mono break-all bg-[#0a0a0a] px-2 py-1.5 rounded border border-gray-800" title={currentRegex}>
                                                                            {currentRegex || '(Aucune regex)'}
                                                                    </div>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => setEditingRegex({ filePath: file.path, regex: currentRegex })}
                                                                            className="text-xs px-2 py-1 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 rounded transition-colors"
                                                                        >
                                                                            <Code size={12} className="inline mr-1" />
                                                                            Éditer
                                                                        </button>
                                                                </div>
                                                                )}
                                                        </div>
                                                    </div>
                                                    );
                                                })}
                                            </div>
                                        );
                                    }
                                })()}
                                    </>
                                )}
                            </div>
                        )}

                    </div>
                )}

                {/* Actions */}
                <div className="flex items-center justify-center gap-3 pt-6 border-t border-gray-800">
                    <button
                        type="button"
                        onClick={handleSave}
                        className="px-6 py-3 rounded-lg font-semibold text-base transition-all duration-200 flex items-center gap-2 bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white shadow-lg hover:shadow-xl transform hover:scale-105 active:scale-95"
                    >
                        <Save size={18} />
                        <span>Enregistrer</span>
                    </button>
                    <button
                        type="button"
                        onClick={handleTest}
                        disabled={isTesting}
                        className={`px-8 py-3 rounded-lg font-semibold text-base transition-all duration-200 flex items-center gap-2 ${
                            isTesting
                                ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white cursor-not-allowed opacity-75'
                                : 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white shadow-lg hover:shadow-xl transform hover:scale-105 active:scale-95'
                        }`}
                    >
                        {isTesting ? (
                            <>
                                <RefreshCw size={18} className="animate-spin" />
                                <span>Test en cours...</span>
                            </>
                        ) : (
                            <>
                                <RefreshCw size={18} />
                                <span>Valider</span>
                            </>
                        )}
                    </button>
                </div>
            </form>
            
            {/* Inline Notification - Positioned near the modified element */}
            {inlineNotification && inlineNotification.position && (
                <div
                    className="fixed z-[100] pointer-events-none"
                    style={{
                        top: `${inlineNotification.position.top}px`,
                        left: `${inlineNotification.position.left}px`,
                        transform: 'translateX(-50%)'
                    }}
                >
                    <div className="bg-emerald-900/95 border border-emerald-700 text-emerald-100 px-3 py-2 rounded-lg shadow-lg flex items-center gap-2 text-sm animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <CheckCircle size={16} className="text-emerald-400 flex-shrink-0" />
                        <span>{inlineNotification.message}</span>
                    </div>
                </div>
            )}
        </div>
    );
};
