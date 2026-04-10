/**
 * Security Section
 * 
 * Component for security settings within Administration
 * Organized in blocks with multiple columns
 */

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, Lock, AlertTriangle, Save, Loader2, CheckCircle, XCircle, Info, Trash2, RefreshCw, Plus, Globe } from 'lucide-react';
import { Section, SettingRow } from './SettingsSection';
import { api } from '../api/client';
import { useUserAuthStore } from '../stores/userAuthStore';

export const SecuritySection: React.FC<{ view?: 'protection' | 'auth' | 'network' }> = ({ view }) => {
    const { t } = useTranslation();
    const { user } = useUserAuthStore();
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    
    // Security settings state
    const [jwtSecretWarning, setJwtSecretWarning] = useState(false);
    const [maxLoginAttempts, setMaxLoginAttempts] = useState(5);
    const [lockoutDuration, setLockoutDuration] = useState(15); // minutes
    const [trackingWindow, setTrackingWindow] = useState(30); // minutes
    const [sessionTimeoutHours, setSessionTimeoutHours] = useState(168); // hours (7 days default)
    const [showSessionWarning, setShowSessionWarning] = useState(false);
    
    // Blocked IPs state
    const [blockedIPs, setBlockedIPs] = useState<Array<{
        identifier: string;
        count: number;
        blockedUntil: number;
        remainingTime: number;
    }>>([]);
    const [isLoadingBlockedIPs, setIsLoadingBlockedIPs] = useState(false);
    
    // CORS configuration state
    const [corsConfig, setCorsConfig] = useState<{
        allowedOrigins?: string[];
        allowCredentials?: boolean;
        allowedMethods?: string[];
        allowedHeaders?: string[];
    } | null>(null);
    const [newOrigin, setNewOrigin] = useState('');
    const [newMethod, setNewMethod] = useState('');
    const [newHeader, setNewHeader] = useState('');

    // Track initial values to detect unsaved changes
    const [initialSecuritySettings, setInitialSecuritySettings] = useState<{
        maxLoginAttempts: number;
        lockoutDuration: number;
        sessionTimeoutHours: number;
    } | null>(null);
    const [initialCorsConfig, setInitialCorsConfig] = useState<{
        allowedOrigins?: string[];
        allowCredentials?: boolean;
        allowedMethods?: string[];
        allowedHeaders?: string[];
    } | null>(null);

    // Check if there are unsaved changes
    const hasUnsavedSecurityChanges = initialSecuritySettings && (
        maxLoginAttempts !== initialSecuritySettings.maxLoginAttempts ||
        lockoutDuration !== initialSecuritySettings.lockoutDuration ||
        sessionTimeoutHours !== initialSecuritySettings.sessionTimeoutHours
    );

    const hasUnsavedCorsChanges = initialCorsConfig && corsConfig && (
        JSON.stringify(corsConfig.allowedOrigins?.sort()) !== JSON.stringify(initialCorsConfig.allowedOrigins?.sort()) ||
        corsConfig.allowCredentials !== initialCorsConfig.allowCredentials ||
        JSON.stringify(corsConfig.allowedMethods?.sort()) !== JSON.stringify(initialCorsConfig.allowedMethods?.sort()) ||
        JSON.stringify(corsConfig.allowedHeaders?.sort()) !== JSON.stringify(initialCorsConfig.allowedHeaders?.sort())
    );

    const hasUnsavedChanges = hasUnsavedSecurityChanges || hasUnsavedCorsChanges;

    useEffect(() => {
        checkSecuritySettings();
        loadBlockedIPs();
        loadCorsConfig();
    }, []);

    const checkSecuritySettings = async () => {
        try {
            const response = await api.get<{
                jwtSecretIsDefault: boolean;
                sessionTimeout: number;
                requireHttps: boolean;
                rateLimitEnabled: boolean;
                maxLoginAttempts: number;
                lockoutDuration: number;
                trackingWindow: number;
            }>('/api/system/security');
            if (response.success && response.result) {
                setJwtSecretWarning(response.result.jwtSecretIsDefault || false);
                const maxAttempts = response.result.maxLoginAttempts || 5;
                const lockout = response.result.lockoutDuration || 15;
                const timeout = response.result.sessionTimeout || 168;
                setMaxLoginAttempts(maxAttempts);
                setLockoutDuration(lockout);
                setTrackingWindow(response.result.trackingWindow || 30);
                setSessionTimeoutHours(timeout);
                // Store initial values
                setInitialSecuritySettings({
                    maxLoginAttempts: maxAttempts,
                    lockoutDuration: lockout,
                    sessionTimeoutHours: timeout
                });
            }
        } catch (error) {
            console.log('Security settings endpoint not available');
        }
    };

    const handleSaveSecuritySettings = async () => {
        setIsLoading(true);
        setMessage(null);
        
        try {
            const response = await api.post('/api/system/security', {
                maxLoginAttempts,
                lockoutDuration,
                sessionTimeoutHours
            });
            
            if (response.success) {
                const result = response.result as { message?: string } | undefined;
                const messageText = result?.message 
                    ? result.message 
                    : t('security.saveSuccess');
                setMessage({ type: 'success', text: messageText });
                // Reload settings to get updated values
                await checkSecuritySettings();
                setShowSessionWarning(false);
                // Reset initial values after save
                setInitialSecuritySettings({
                    maxLoginAttempts,
                    lockoutDuration,
                    sessionTimeoutHours
                });
            } else {
                const error = response.error as { message?: string } | undefined;
                setMessage({ type: 'error', text: error?.message || t('security.saveError') });
            }
        } catch (error) {
            setMessage({ type: 'error', text: error instanceof Error ? error.message : t('security.saveError') });
        } finally {
            setIsLoading(false);
        }
    };

    const handleSessionTimeoutChange = (value: number) => {
        setSessionTimeoutHours(value);
        // Show warning if changing from default or if value is significantly different
        if (value !== 168) {
            setShowSessionWarning(true);
        } else {
            setShowSessionWarning(false);
        }
    };

    const loadBlockedIPs = async () => {
        setIsLoadingBlockedIPs(true);
        try {
            const response = await api.get<Array<{
                identifier: string;
                count: number;
                blockedUntil: number;
                remainingTime: number;
            }>>('/api/security/blocked');
            if (response.success && response.result) {
                setBlockedIPs(response.result);
            }
        } catch (error) {
            console.error('Failed to load blocked IPs:', error);
        } finally {
            setIsLoadingBlockedIPs(false);
        }
    };

    const handleUnblock = async (identifier: string) => {
        try {
            const response = await api.post(`/api/security/blocked/${encodeURIComponent(identifier)}/unblock`);
            if (response.success) {
                // Reload the list
                await loadBlockedIPs();
                setMessage({ type: 'success', text: t('security.unblockSuccess', { id: identifier }) });
                setTimeout(() => setMessage(null), 3000);
            }
        } catch (error: unknown) {
            const errorMessage = (error as any)?.response?.data?.error?.message || t('security.unblockError');
            setMessage({ 
                type: 'error', 
                text: errorMessage
            });
            setTimeout(() => setMessage(null), 3000);
        }
    };

    const formatRemainingTime = (seconds: number): string => {
        if (seconds <= 0) return t('security.expired');
        const minutes = Math.ceil(seconds / 60);
        if (minutes < 60) return t('security.minutesShort', { count: minutes });
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        if (remainingMinutes === 0) {
            return t('security.hoursShort', { hours });
        }
        return t('security.hoursMinutes', { hours, minutes: remainingMinutes });
    };

    const loadCorsConfig = async () => {
        try {
            const response = await api.get<{ corsConfig?: {
                allowedOrigins?: string[];
                allowCredentials?: boolean;
                allowedMethods?: string[];
                allowedHeaders?: string[];
            } }>('/api/system/general');
            if (response.success && response.result) {
                const config = response.result.corsConfig || null;
                setCorsConfig(config);
                // Store initial values (deep copy)
                setInitialCorsConfig(config ? JSON.parse(JSON.stringify(config)) : null);
            }
        } catch (error) {
            console.error('Failed to load CORS config:', error);
        }
    };

    const handleSaveCorsConfig = async () => {
        setIsLoading(true);
        setMessage(null);
        
        try {
            const response = await api.put('/api/system/general', {
                corsConfig: corsConfig || {
                    allowedOrigins: [],
                    allowCredentials: true,
                    allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
                    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
                }
            });
            
            if (response.success) {
                setMessage({ type: 'success', text: t('security.corsSaveSuccess') });
                setTimeout(() => setMessage(null), 5000);
                // Reload CORS config to get updated values
                await loadCorsConfig();
            } else {
                const error = response.error as { message?: string } | undefined;
                setMessage({ type: 'error', text: error?.message || t('security.saveError') });
            }
        } catch (error) {
            setMessage({ type: 'error', text: error instanceof Error ? error.message : t('security.saveError') });
        } finally {
            setIsLoading(false);
        }
    };

    const addOrigin = () => {
        if (newOrigin.trim()) {
            const origins = corsConfig?.allowedOrigins || [];
            if (!origins.includes(newOrigin.trim())) {
                setCorsConfig({
                    ...corsConfig,
                    allowedOrigins: [...origins, newOrigin.trim()],
                    allowCredentials: corsConfig?.allowCredentials !== undefined ? corsConfig.allowCredentials : true,
                    allowedMethods: corsConfig?.allowedMethods || ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
                    allowedHeaders: corsConfig?.allowedHeaders || ['Content-Type', 'Authorization', 'X-Requested-With']
                });
                setNewOrigin('');
            }
        }
    };

    const removeOrigin = (origin: string) => {
        const origins = corsConfig?.allowedOrigins || [];
        setCorsConfig({
            ...corsConfig,
            allowedOrigins: origins.filter(o => o !== origin),
            allowCredentials: corsConfig?.allowCredentials !== undefined ? corsConfig.allowCredentials : true,
            allowedMethods: corsConfig?.allowedMethods || ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
            allowedHeaders: corsConfig?.allowedHeaders || ['Content-Type', 'Authorization', 'X-Requested-With']
        });
    };

    const toggleMethod = (method: string) => {
        const methods = corsConfig?.allowedMethods || [];
        const next = methods.includes(method) ? methods.filter(m => m !== method) : [...methods, method];
        setCorsConfig({ ...corsConfig, allowedMethods: next, allowedOrigins: corsConfig?.allowedOrigins || [], allowCredentials: corsConfig?.allowCredentials ?? true, allowedHeaders: corsConfig?.allowedHeaders || [] });
    };

    const toggleHeader = (header: string) => {
        const headers = corsConfig?.allowedHeaders || [];
        const next = headers.includes(header) ? headers.filter(h => h !== header) : [...headers, header];
        setCorsConfig({ ...corsConfig, allowedHeaders: next, allowedOrigins: corsConfig?.allowedOrigins || [], allowCredentials: corsConfig?.allowCredentials ?? true, allowedMethods: corsConfig?.allowedMethods || [] });
    };

    const addMethod = () => {
        if (newMethod.trim()) {
            const methods = corsConfig?.allowedMethods || [];
            if (!methods.includes(newMethod.trim().toUpperCase())) {
                setCorsConfig({
                    ...corsConfig,
                    allowedMethods: [...methods, newMethod.trim().toUpperCase()],
                    allowedOrigins: corsConfig?.allowedOrigins || [],
                    allowCredentials: corsConfig?.allowCredentials !== undefined ? corsConfig.allowCredentials : true,
                    allowedHeaders: corsConfig?.allowedHeaders || ['Content-Type', 'Authorization', 'X-Requested-With']
                });
                setNewMethod('');
            }
        }
    };

    const removeMethod = (method: string) => {
        const methods = corsConfig?.allowedMethods || [];
        setCorsConfig({
            ...corsConfig,
            allowedMethods: methods.filter(m => m !== method),
            allowedOrigins: corsConfig?.allowedOrigins || [],
            allowCredentials: corsConfig?.allowCredentials !== undefined ? corsConfig.allowCredentials : true,
            allowedHeaders: corsConfig?.allowedHeaders || ['Content-Type', 'Authorization', 'X-Requested-With']
        });
    };

    const addHeader = () => {
        if (newHeader.trim()) {
            const headers = corsConfig?.allowedHeaders || [];
            if (!headers.includes(newHeader.trim())) {
                setCorsConfig({
                    ...corsConfig,
                    allowedHeaders: [...headers, newHeader.trim()],
                    allowedOrigins: corsConfig?.allowedOrigins || [],
                    allowCredentials: corsConfig?.allowCredentials !== undefined ? corsConfig.allowCredentials : true,
                    allowedMethods: corsConfig?.allowedMethods || ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']
                });
                setNewHeader('');
            }
        }
    };

    const removeHeader = (header: string) => {
        const headers = corsConfig?.allowedHeaders || [];
        setCorsConfig({
            ...corsConfig,
            allowedHeaders: headers.filter(h => h !== header),
            allowedOrigins: corsConfig?.allowedOrigins || [],
            allowCredentials: corsConfig?.allowCredentials !== undefined ? corsConfig.allowCredentials : true,
            allowedMethods: corsConfig?.allowedMethods || ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']
        });
    };

    return (
        <div className="space-y-6">
            {/* Unsaved Changes Notification */}
            {hasUnsavedChanges && (
                <div className="p-4 bg-amber-900/20 border border-amber-700/50 rounded-lg flex items-start gap-3">
                    <AlertTriangle size={20} className="text-amber-400 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                        <h4 className="text-sm font-medium text-amber-400 mb-1">
                            {t('security.unsavedTitle')}
                        </h4>
                        <p className="text-xs text-amber-300">
                            {t('security.unsavedHint')}
                        </p>
                    </div>
                </div>
            )}

            {/* Message Banner */}
            {message && (
                <div className={`p-3 rounded-lg flex items-center gap-2 ${
                    message.type === 'success' 
                        ? 'bg-green-900/20 border border-green-700 text-green-400' 
                        : 'bg-red-900/20 border border-red-700 text-red-400'
                }`}>
                    {message.type === 'success' ? (
                        <CheckCircle size={16} />
                    ) : (
                        <AlertTriangle size={16} />
                    )}
                    <span className="text-sm">{message.text}</span>
                </div>
            )}

            {/* JWT Secret Warning - Full Width Alert */}
            {jwtSecretWarning && (
                <div className="p-4 bg-yellow-900/20 border border-yellow-700/50 rounded-lg">
                    <div className="flex items-start gap-3">
                        <AlertTriangle size={20} className="text-yellow-400 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                            <h4 className="text-sm font-medium text-yellow-400 mb-1">
                                {t('security.jwtWarningTitle')}
                            </h4>
                            <p className="text-xs text-yellow-300 mb-2">
                                {t('security.jwtWarningBody')}
                            </p>
                            <p className="text-xs text-gray-400">
                                {t('security.jwtWarningProduction')}
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Attack Protection */}
            {(!view || view === 'protection') && (
            <div className="space-y-6">
                    {/* Protection Brute Force */}
                    <Section title={t('security.attackProtectionTitle')} icon={Shield} iconColor="red" collapsible>
                        <div className="space-y-4">
                            <SettingRow
                                label={t('security.maxLoginAttempts')}
                                description={t('security.maxLoginAttemptsDesc')}
                            >
                                <div className="flex items-center gap-2 w-44">
                                    <input
                                        type="number"
                                        min="3"
                                        max="10"
                                        value={maxLoginAttempts}
                                        onChange={(e) => setMaxLoginAttempts(Number.parseInt(e.target.value) || 5)}
                                        className="w-20 px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm focus:outline-none"
                                    />
                                    <span className="text-sm text-gray-400">{t('security.attempts')}</span>
                                </div>
                            </SettingRow>

                            <SettingRow
                                label={t('security.lockoutDuration')}
                                description={t('security.lockoutDurationDesc')}
                            >
                                <div className="flex items-center gap-2 w-44">
                                    <input
                                        type="number"
                                        min="5"
                                        max="60"
                                        value={lockoutDuration}
                                        onChange={(e) => setLockoutDuration(Number.parseInt(e.target.value) || 15)}
                                        className="w-20 px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm focus:outline-none"
                                    />
                                    <span className="text-sm text-gray-400">{t('security.minutes')}</span>
                                </div>
                            </SettingRow>

                            <SettingRow
                                label={t('security.trackingWindow')}
                                description={<><span>{t('security.trackingWindowDesc')}</span> <span className="text-gray-600">— {t('security.readOnly')}</span></>}
                            >
                                <div className="flex items-center gap-2 w-44">
                                    <input
                                        type="number"
                                        min="15"
                                        max="120"
                                        value={trackingWindow}
                                        onChange={(e) => setTrackingWindow(Number.parseInt(e.target.value) || 30)}
                                        disabled
                                        className="w-20 px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm focus:outline-none opacity-50 cursor-not-allowed"
                                    />
                                    <span className="text-sm text-gray-400">{t('security.minutes')}</span>
                                </div>
                            </SettingRow>

                            <div className="mt-4 p-3 bg-green-900/10 border border-green-700/30 rounded-lg">
                                <div className="flex items-start gap-2">
                                    <CheckCircle size={16} className="text-green-400 mt-0.5 flex-shrink-0" />
                                    <div className="flex-1">
                                        <p className="text-xs text-green-400 font-medium mb-1">{t('security.protectionActive')}</p>
                                        <p className="text-xs text-gray-400">
                                            {t('security.protectionActiveDesc', { max: maxLoginAttempts, duration: lockoutDuration })}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Section>
            </div>
            )}

            {/* Authentification */}
            {(!view || view === 'auth') && (
                    <Section title={t('security.authTitle')} icon={Lock} iconColor="blue">
                        <div className="space-y-4">
                            <SettingRow
                                label={t('security.sessionTimeout')}
                                description={t('security.sessionTimeoutDesc')}
                            >
                                <div className="flex items-center gap-2 w-44 flex-wrap">
                                    <input
                                        type="number"
                                        min="1"
                                        max="168"
                                        value={sessionTimeoutHours}
                                        onChange={(e) => handleSessionTimeoutChange(Number.parseInt(e.target.value) || 168)}
                                        className="w-20 px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm focus:outline-none"
                                    />
                                    <span className="text-sm text-gray-400">{t('security.hours')}</span>
                                    {sessionTimeoutHours >= 24 && (
                                        <span className="text-sm text-blue-400 font-medium">
                                            ({sessionTimeoutHours % 24 === 0 
                                                ? `${sessionTimeoutHours / 24} ${sessionTimeoutHours >= 48 ? t('security.days') : t('security.day')}`
                                                : `${Math.round((sessionTimeoutHours / 24) * 10) / 10} ${sessionTimeoutHours >= 48 ? t('security.days') : t('security.day')}`
                                            })
                                        </span>
                                    )}
                                </div>
                                {showSessionWarning && (
                                    <div className="mt-2 flex items-start gap-2 p-2 bg-yellow-900/20 rounded border border-yellow-700/50">
                                        <AlertTriangle size={14} className="text-yellow-400 mt-0.5 flex-shrink-0" />
                                        <p className="text-xs text-yellow-300">
                                            {t('security.sessionWarning')}
                                        </p>
                                    </div>
                                )}
                                <div className="mt-2 flex items-start gap-2 p-2 bg-gray-900/50 rounded border border-gray-800">
                                    <Info size={14} className="text-gray-500 mt-0.5 flex-shrink-0" />
                                    <p className="text-xs text-gray-500">
                                        {t('security.sessionStorageNote')}
                                    </p>
                                </div>
                            </SettingRow>
                        </div>
                    </Section>
            )}


            {/* Blocked IPs */}
            {(!view || view === 'protection') && (
                <Section title={t('security.blockedTitle')} icon={Shield} iconColor="red" collapsible>
                    <div className="space-y-4">
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-sm text-gray-400">
                                {t('security.blockedListDesc')}
                            </p>
                            <button
                                onClick={loadBlockedIPs}
                                disabled={isLoadingBlockedIPs}
                                className="flex items-center gap-2 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <RefreshCw size={14} className={isLoadingBlockedIPs ? 'animate-spin' : ''} />
                                <span>{t('security.refresh')}</span>
                            </button>
                        </div>

                        {isLoadingBlockedIPs ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="animate-spin text-blue-400" size={20} />
                            </div>
                        ) : blockedIPs.length === 0 ? (
                            <div className="py-8 text-center">
                                <CheckCircle size={32} className="text-green-400 mx-auto mb-2" />
                                <p className="text-sm text-gray-400">{t('security.noBlocked')}</p>
                            </div>
                        ) : (
                            <div className="space-y-2 max-h-80 overflow-y-auto">
                                {blockedIPs.map((item) => (
                                    <div
                                        key={item.identifier}
                                        className="flex items-center justify-between p-3 bg-[#1a1a1a] rounded-lg border border-gray-800 hover:border-red-700/50 transition-colors"
                                    >
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-sm font-medium text-white font-mono truncate">
                                                    {item.identifier}
                                                </span>
                                                <span className="px-2 py-0.5 bg-red-900/30 text-red-400 text-xs rounded shrink-0">
                                                    {t('security.attempt', { count: item.count })}
                                                </span>
                                            </div>
                                            <div className="text-xs text-gray-500">
                                                {t('security.blockedFor')} <span className="text-orange-400 font-medium">{formatRemainingTime(item.remainingTime)}</span>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleUnblock(item.identifier)}
                                            className="flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-sm rounded-lg transition-colors shrink-0"
                                            title={t('security.unblockTitle')}
                                        >
                                            <Trash2 size={14} />
                                            <span>{t('security.unblock')}</span>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </Section>
            )}

            {/* CORS */}
            {(!view || view === 'network') && (
                <Section title={t('security.corsTitle')} icon={Globe} iconColor="cyan">
                <div className="space-y-4">
                    <div className="p-3 bg-blue-900/10 border border-blue-700/30 rounded-lg">
                        <div className="flex items-start gap-2">
                            <Info size={16} className="text-blue-400 mt-0.5 flex-shrink-0" />
                            <div className="flex-1">
                                <p className="text-xs text-blue-300 mb-1">
                                    <strong>{t('security.corsIntroTitle')}</strong>
                                </p>
                                <p className="text-xs text-gray-400">
                                    {t('security.corsIntroDesc')}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Allowed Origins */}
                    <SettingRow
                        label={t('security.allowedOrigins')}
                        description={t('security.allowedOriginsDesc')}
                    >
                        <div className="w-full space-y-2">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={newOrigin}
                                    onChange={(e) => setNewOrigin(e.target.value)}
                                    onKeyPress={(e) => e.key === 'Enter' && addOrigin()}
                                    placeholder={t('security.originPlaceholder')}
                                    className="flex-1 px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
                                />
                                <button
                                    onClick={addOrigin}
                                    className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors flex items-center gap-2"
                                >
                                    <Plus size={14} />
                                    <span>{t('security.add')}</span>
                                </button>
                            </div>
                            {corsConfig?.allowedOrigins && corsConfig.allowedOrigins.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {corsConfig.allowedOrigins.map((origin) => (
                                        <div
                                            key={origin}
                                            className="flex items-center gap-2 px-3 py-1.5 bg-[#1a1a1a] border border-gray-700 rounded-lg"
                                        >
                                            <span className="text-sm text-white font-mono">{origin}</span>
                                            <button
                                                onClick={() => removeOrigin(origin)}
                                                className="text-red-400 hover:text-red-300 transition-colors"
                                                title={t('security.remove')}
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {(!corsConfig?.allowedOrigins || corsConfig.allowedOrigins.length === 0) && (
                                <p className="text-xs text-gray-500">{t('security.noOriginsConfigured')}</p>
                            )}
                            <p className="text-xs text-gray-600">
                                💡 Si vous avez une <span className="text-gray-500">URL publique</span> configurée dans <em>Général</em>, ajoutez-la ici comme origine autorisée.
                            </p>
                        </div>
                    </SettingRow>

                    {/* Credentials + Methods + Headers — disabled when no origins configured */}
                    <div className={`space-y-4 transition-opacity ${(corsConfig?.allowedOrigins?.length ?? 0) === 0 ? 'opacity-40 pointer-events-none select-none' : ''}`}>

                    {/* Allow Credentials */}
                    <SettingRow
                        label={t('security.allowCredentials')}
                        description={t('security.allowCredentialsDesc')}
                    >
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={corsConfig?.allowCredentials !== undefined ? corsConfig.allowCredentials : true}
                                onChange={(e) => setCorsConfig({
                                    ...corsConfig,
                                    allowCredentials: e.target.checked,
                                    allowedOrigins: corsConfig?.allowedOrigins || [],
                                    allowedMethods: corsConfig?.allowedMethods || ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
                                    allowedHeaders: corsConfig?.allowedHeaders || ['Content-Type', 'Authorization', 'X-Requested-With']
                                })}
                                className="w-4 h-4 text-blue-600 bg-[#1a1a1a] border-gray-700 rounded focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-400">
                                {corsConfig?.allowCredentials !== undefined && corsConfig.allowCredentials ? t('security.enabled') : t('security.disabled')}
                            </span>
                        </div>
                    </SettingRow>

                    {/* Allowed Methods */}
                    <SettingRow
                        label={t('security.allowedMethods')}
                        description={t('security.allowedMethodsDesc')}
                    >
                        <div className="w-full space-y-3">
                            {/* Common method presets */}
                            <div className="flex flex-wrap gap-1.5">
                                {['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'].map((m) => {
                                    const active = corsConfig?.allowedMethods?.includes(m) ?? false;
                                    return (
                                        <button
                                            key={m}
                                            type="button"
                                            onClick={() => toggleMethod(m)}
                                            className={`px-2.5 py-1 rounded text-xs font-mono font-semibold border transition-colors ${active ? 'bg-blue-600/20 border-blue-500/60 text-blue-300' : 'bg-[#1a1a1a] border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300'}`}
                                        >
                                            {m}
                                        </button>
                                    );
                                })}
                            </div>
                            {/* Custom method input */}
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={newMethod}
                                    onChange={(e) => setNewMethod(e.target.value.toUpperCase())}
                                    onKeyPress={(e) => e.key === 'Enter' && addMethod()}
                                    placeholder="Méthode custom (ex: PROPFIND)"
                                    className="flex-1 px-3 py-1.5 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
                                />
                                <button
                                    onClick={addMethod}
                                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors flex items-center gap-1.5"
                                >
                                    <Plus size={13} />
                                    <span>{t('security.add')}</span>
                                </button>
                            </div>
                            {/* Custom (non-preset) methods added */}
                            {corsConfig?.allowedMethods && corsConfig.allowedMethods.filter(m => !['GET','POST','PUT','DELETE','PATCH','OPTIONS','HEAD'].includes(m)).length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                    {corsConfig.allowedMethods.filter(m => !['GET','POST','PUT','DELETE','PATCH','OPTIONS','HEAD'].includes(m)).map((method) => (
                                        <div key={method} className="flex items-center gap-1.5 px-2.5 py-1 bg-purple-600/15 border border-purple-500/40 rounded text-xs font-mono text-purple-300">
                                            <span>{method}</span>
                                            <button onClick={() => removeMethod(method)} className="text-red-400 hover:text-red-300 transition-colors"><Trash2 size={11} /></button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </SettingRow>

                    {/* Allowed Headers */}
                    <SettingRow
                        label={t('security.allowedHeaders')}
                        description={t('security.allowedHeadersDesc')}
                    >
                        <div className="w-full space-y-3">
                            {/* Common header presets */}
                            <div className="flex flex-wrap gap-1.5">
                                {['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'Cache-Control', 'X-CSRF-Token', 'X-Api-Key'].map((h) => {
                                    const active = corsConfig?.allowedHeaders?.includes(h) ?? false;
                                    return (
                                        <button
                                            key={h}
                                            type="button"
                                            onClick={() => toggleHeader(h)}
                                            className={`px-2.5 py-1 rounded text-xs font-mono border transition-colors ${active ? 'bg-cyan-600/20 border-cyan-500/60 text-cyan-300' : 'bg-[#1a1a1a] border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300'}`}
                                        >
                                            {h}
                                        </button>
                                    );
                                })}
                            </div>
                            {/* Custom header input */}
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={newHeader}
                                    onChange={(e) => setNewHeader(e.target.value)}
                                    onKeyPress={(e) => e.key === 'Enter' && addHeader()}
                                    placeholder="Header custom (ex: X-Custom-Header)"
                                    className="flex-1 px-3 py-1.5 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
                                />
                                <button
                                    onClick={addHeader}
                                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors flex items-center gap-1.5"
                                >
                                    <Plus size={13} />
                                    <span>{t('security.add')}</span>
                                </button>
                            </div>
                            {/* Custom (non-preset) headers added */}
                            {corsConfig?.allowedHeaders && corsConfig.allowedHeaders.filter(h => !['Content-Type','Authorization','X-Requested-With','Accept','Origin','Cache-Control','X-CSRF-Token','X-Api-Key'].includes(h)).length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                    {corsConfig.allowedHeaders.filter(h => !['Content-Type','Authorization','X-Requested-With','Accept','Origin','Cache-Control','X-CSRF-Token','X-Api-Key'].includes(h)).map((header) => (
                                        <div key={header} className="flex items-center gap-1.5 px-2.5 py-1 bg-purple-600/15 border border-purple-500/40 rounded text-xs font-mono text-purple-300">
                                            <span>{header}</span>
                                            <button onClick={() => removeHeader(header)} className="text-red-400 hover:text-red-300 transition-colors"><Trash2 size={11} /></button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </SettingRow>

                    </div>{/* end credentials+methods+headers */}

                    {/* Save CORS Config Button */}
                    <div className="flex justify-end pt-2 border-t border-gray-800">
                        <button
                            onClick={handleSaveCorsConfig}
                            disabled={isLoading}
                            className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                            <span>{t('security.saveCors')}</span>
                        </button>
                    </div>
                </div>
            </Section>
            )}


            {/* Save Button — protection + auth views */}
            {(!view || view === 'protection' || view === 'auth') && (
            <div className="flex justify-end pt-4 border-t border-gray-800">
                <button
                    onClick={handleSaveSecuritySettings}
                    disabled={isLoading}
                    className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                    {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                    <span>{t('security.saveSettings')}</span>
                </button>
            </div>
            )}
        </div>
    );
};
