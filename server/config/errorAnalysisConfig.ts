/**
 * Error Analysis configuration for dashboard "Files with errors" card and security checks.
 * Stored in AppConfig under key error_analysis_config.
 */

import { AppConfigRepository } from '../database/models/AppConfig.js';

export type SecurityCheckDepth = 'light' | 'normal' | 'deep';

export interface ErrorAnalysisConfig {
    /** When false, error log scan is disabled and dashboard shows nothing for analysis (options kept in DB). */
    errorSummaryEnabled: boolean;
    /** Plugin IDs to include in error summary (apache, nginx, npm; host-system optional) */
    enabledPlugins: string[];
    /** Max error log files to process per plugin */
    maxFilesPerPlugin: number;
    /** Max lines to read per file (tail) */
    linesPerFile: number;
    /** Skip files larger than this (bytes) */
    maxFileSizeBytes: number;
    /** Enable suspicious/intrusion pattern detection (errorExplanations) */
    securityCheckEnabled: boolean;
    /** Depth of check: light = fewer lines, normal = default, deep = more lines */
    securityCheckDepth: SecurityCheckDepth;
    /** Placeholder for future: use external security bases (CVE, threat intel) */
    useExternalSecurityBases: boolean;
    /** Placeholder: include .tar.gz/.tgz in scan (not used yet; archives are always excluded) */
    analyzeArchives: boolean;
}

const CONFIG_KEY = 'error_analysis_config';

/** Allowed plugin IDs for error summary (must be log source plugins) */
export const ALLOWED_PLUGINS = ['apache', 'nginx', 'npm', 'host-system'] as const;

export const DEFAULT_ERROR_ANALYSIS_CONFIG: ErrorAnalysisConfig = {
    errorSummaryEnabled: false,
    enabledPlugins: ['apache', 'nginx', 'npm'],
    maxFilesPerPlugin: 20,
    linesPerFile: 1000,
    maxFileSizeBytes: 10 * 1024 * 1024, // 10 MB
    securityCheckEnabled: true,
    securityCheckDepth: 'normal',
    useExternalSecurityBases: false,
    analyzeArchives: false
};

/** Map depth to effective lines per file when depth overrides (optional; can use linesPerFile only) */
export const DEPTH_TO_LINES: Record<SecurityCheckDepth, number> = {
    light: 500,
    normal: 1000,
    deep: 2000
};

/**
 * Get current error analysis config (merge stored with defaults).
 */
export function getErrorAnalysisConfig(): ErrorAnalysisConfig {
    const json = AppConfigRepository.get(CONFIG_KEY);
    if (!json) {
        return { ...DEFAULT_ERROR_ANALYSIS_CONFIG };
    }
    try {
        const stored = JSON.parse(json) as Partial<ErrorAnalysisConfig>;
        return mergeWithDefaults(stored);
    } catch {
        return { ...DEFAULT_ERROR_ANALYSIS_CONFIG };
    }
}

/**
 * Save error analysis config.
 */
export function setErrorAnalysisConfig(config: Partial<ErrorAnalysisConfig>): boolean {
    const merged = mergeWithDefaults(config);
    return AppConfigRepository.set(CONFIG_KEY, JSON.stringify(merged));
}

function mergeWithDefaults(partial: Partial<ErrorAnalysisConfig>): ErrorAnalysisConfig {
    const def = DEFAULT_ERROR_ANALYSIS_CONFIG;
    const enabledPlugins = Array.isArray(partial.enabledPlugins)
        ? partial.enabledPlugins.filter((id) => ALLOWED_PLUGINS.includes(id as typeof ALLOWED_PLUGINS[number]))
        : def.enabledPlugins;
    if (enabledPlugins.length === 0) {
        enabledPlugins.push(...def.enabledPlugins);
    }
    return {
        errorSummaryEnabled: partial.errorSummaryEnabled ?? def.errorSummaryEnabled,
        enabledPlugins,
        maxFilesPerPlugin: clamp(partial.maxFilesPerPlugin ?? def.maxFilesPerPlugin, 1, 100),
        linesPerFile: clamp(partial.linesPerFile ?? def.linesPerFile, 100, 10000),
        maxFileSizeBytes: clamp(partial.maxFileSizeBytes ?? def.maxFileSizeBytes, 1024 * 1024, 100 * 1024 * 1024),
        securityCheckEnabled: partial.securityCheckEnabled ?? def.securityCheckEnabled,
        securityCheckDepth: ['light', 'normal', 'deep'].includes(partial.securityCheckDepth ?? '')
            ? (partial.securityCheckDepth as SecurityCheckDepth)
            : def.securityCheckDepth,
        useExternalSecurityBases: partial.useExternalSecurityBases ?? def.useExternalSecurityBases,
        analyzeArchives: partial.analyzeArchives ?? def.analyzeArchives
    };
}

function clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
}
