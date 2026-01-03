/**
 * Host System Log Plugin
 * 
 * Plugin for reading system logs (syslog, journald, etc.)
 */

import { BasePlugin } from '../base/BasePlugin.js';
import { SyslogParser } from './SyslogParser.js';
import { AuthLogParser } from './AuthLogParser.js';
import { KernLogParser } from './KernLogParser.js';
import { DaemonLogParser } from './DaemonLogParser.js';
import { MailLogParser } from './MailLogParser.js';
import { CustomLogParser, type CustomParserConfig } from './CustomLogParser.js';
import { parseJournaldJson, isJournaldJson } from './JournaldJsonParser.js';
import { detectOS, getDefaultLogFiles, getDefaultFilePatterns } from './OSDetector.js';
import { detectLogFormatFromLines, validateDetectedFormat } from './LogFormatDetector.js';
import { logReaderService } from '../../services/logReaderService.js';
import { detectLoggingServices, getPrimaryLoggingService, type DetectedLoggingService } from './LoggingServiceDetector.js';
import type { LogSourcePlugin, LogFileInfo, ParsedLogEntry } from '../base/LogSourcePluginInterface.js';
import type { PluginStats } from '../base/PluginInterface.js';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';

export interface HostSystemPluginConfig {
    // Catégorie 1 : Fichiers Système de Base
    // Auto-détectés avec regex standard validée, fichiers importants du système
    systemBaseFiles?: Array<{
        path: string;
        type: 'syslog' | 'journald' | 'auth' | 'kern' | 'daemon' | 'mail';
        enabled: boolean;
        detected: boolean; // Auto-détecté par le système
        validated: boolean; // Regex standard validée et fonctionnelle
        isSystemCritical: boolean; // Fichier important du système
    }>;
    
    // Catégorie 2 : Fichiers Auto-détectés Validés
    // Auto-détectés et validés, mais ne faisant pas partie du système de base
    autoDetectedFiles?: Array<{
        path: string;
        type: 'syslog' | 'auth' | 'kern' | 'daemon' | 'mail' | 'custom';
        enabled: boolean;
        detected: boolean;
        validated: boolean; // Regex standard validée
        parserType: string; // Type de parser utilisé (syslog, auth, etc.)
    }>;
    
    // Catégorie 3 : Fichiers Custom
    // Nécessitent une regex custom par fichier
    customFiles?: Array<{
        path: string;
        type: 'custom';
        enabled: boolean;
        customParserConfig: CustomParserConfig; // Regex custom obligatoire
        detected: boolean; // Peut être auto-détecté mais nécessite regex custom
    }>;
    
    // Legacy support: pour compatibilité avec anciennes configurations
    logFiles?: Array<{
        path: string;
        type: 'syslog' | 'journald' | 'auth' | 'kern' | 'daemon' | 'mail' | 'custom';
        enabled: boolean;
        customParserConfig?: CustomParserConfig;
    }>;
    
    journaldEnabled: boolean;
    follow: boolean;
    maxLines: number;
    
    // Exclusion filters for files and directories
    // Patterns support glob syntax (*, ?, **) and will be matched against file/directory names
    excludeFilters?: {
        files?: string[];      // Patterns to exclude files (e.g., ['*.tmp', 'debug.log'])
        directories?: string[]; // Patterns to exclude directories (e.g., ['node_modules', 'cache'])
        paths?: string[];       // Full paths to exclude (e.g., ['/var/log/old', '/var/log/backup'])
    };
}

export class HostSystemLogPlugin extends BasePlugin implements LogSourcePlugin {
    // Host root path used when running inside Docker with host filesystem mounted
    private readonly HOST_ROOT_PATH = process.env.HOST_ROOT_PATH || '/host';
    private readonly DOCKER_LOG_PATH = '/host/logs';
    private readonly STANDARD_LOG_PATH = '/var/log';

    private defaultLogFiles: Array<{ path: string; type: string; enabled: boolean }> = [];

    private osInfo: Awaited<ReturnType<typeof detectOS>> | null = null;

    constructor() {
        super('host-system', 'Host System Logs', '0.1.5');
        // Detect OS on initialization and set default log files
        detectOS().then(info => {
            this.osInfo = info;
            this.defaultLogFiles = getDefaultLogFiles(info.type);
            console.log('[HostSystemLogPlugin] OS detected:', info);
            console.log('[HostSystemLogPlugin] Default log files:', this.defaultLogFiles);
        }).catch(err => {
            console.warn('[HostSystemLogPlugin] Failed to detect OS:', err);
            // Fallback to Debian/Ubuntu defaults
            this.defaultLogFiles = getDefaultLogFiles('debian');
        });
    }

    /**
     * Get the base path for logs (Docker or standard)
     */
    private getLogBasePath(): string {
        if (this.isDocker()) {
            // Check if /host/logs exists (symlink created by docker-entrypoint.sh)
            if (fsSync.existsSync(this.DOCKER_LOG_PATH)) {
                return this.DOCKER_LOG_PATH;
            }
            // Fallback: use /host/var/log directly if symlink doesn't exist
            const directPath = `${this.HOST_ROOT_PATH}/var/log`;
            if (fsSync.existsSync(directPath)) {
                return directPath;
            }
        }
        // Fallback to standard path
        return this.STANDARD_LOG_PATH;
    }

    // Note: convertToDockerPath is now inherited from BasePlugin

    async getStats(): Promise<PluginStats> {
        // Host system plugin doesn't provide device/network stats
        return {};
    }

    async testConnection(): Promise<boolean> {
        // Test if we can read at least one log file
        try {
            const config = this.config?.settings as unknown as HostSystemPluginConfig | undefined;
            const logFiles = config?.logFiles || this.defaultLogFiles;
            const basePath = this.getLogBasePath();
            
            // Test if base path is accessible
            try {
                await fs.access(basePath);
            } catch {
                return false;
            }
            
            for (const logFile of logFiles) {
                if (logFile.enabled) {
                    try {
                        const dockerPath = this.convertToDockerPath(logFile.path);
                        await fs.access(dockerPath);
                        return true;
                    } catch {
                        // File doesn't exist, continue
                    }
                }
            }
            
            // If journald is enabled, consider it a valid connection
            if (config?.journaldEnabled) {
                return true;
            }
            
            return false;
        } catch {
            return false;
        }
    }

    /**
     * Check if a file or directory should be excluded based on configured filters
     * For host-system plugin: by default, exclude all directories in basePath
     * (since system log files are already detected, user will add subdirectories manually if needed)
     */
    private shouldExclude(filePath: string, entryName: string, isDirectory: boolean, basePath: string): boolean {
        const config = this.config?.settings as unknown as HostSystemPluginConfig | undefined;
        const excludeFilters = config?.excludeFilters;
        
        // For host-system plugin: by default, exclude all directories in basePath
        // This prevents scanning subdirectories since system log files are already detected
        // User can manually add specific files/directories if needed
        if (isDirectory) {
            // Check if this directory is within the basePath
            // Normalize paths to handle different separators and relative paths
            const normalizedBasePath = path.resolve(basePath).replace(/\\/g, '/');
            const normalizedFilePath = path.resolve(filePath).replace(/\\/g, '/');
            
            // If directory is inside basePath (but not the basePath itself) and no explicit filters are configured
            if (normalizedFilePath.startsWith(normalizedBasePath + '/') && 
                normalizedFilePath !== normalizedBasePath) {
                // Only exclude if no explicit directory filters are configured
                // This allows user to override by configuring excludeFilters
                if (!excludeFilters || !excludeFilters.directories || excludeFilters.directories.length === 0) {
                    // Exclude all subdirectories by default
                    return true;
                }
            }
        }
        
        // If no filters configured, return false (except for directories which are excluded above)
        if (!excludeFilters) {
            return false;
        }
        
        // Check full path exclusions
        if (excludeFilters.paths && excludeFilters.paths.length > 0) {
            for (const excludePath of excludeFilters.paths) {
                // Support both exact match and prefix match
                if (filePath === excludePath || filePath.startsWith(excludePath + '/')) {
                    return true;
                }
            }
        }
        
        // Convert glob patterns to regex
        const globToRegex = (pattern: string): RegExp => {
            let regexStr = pattern
                .replace(/\./g, '\\.')
                .replace(/\*\*/g, '.*')
                .replace(/\*/g, '[^/]*')
                .replace(/\?/g, '.');
            return new RegExp(`^${regexStr}$`);
        };
        
        // Check directory exclusions (explicit user configuration)
        if (isDirectory && excludeFilters.directories && excludeFilters.directories.length > 0) {
            for (const dirPattern of excludeFilters.directories) {
                const regex = globToRegex(dirPattern);
                if (regex.test(entryName)) {
                    return true;
                }
            }
        }
        
        // Check file exclusions
        if (!isDirectory && excludeFilters.files && excludeFilters.files.length > 0) {
            for (const filePattern of excludeFilters.files) {
                const regex = globToRegex(filePattern);
                if (regex.test(entryName)) {
                    return true;
                }
            }
        }
        
        return false;
    }

    async scanLogFiles(basePath: string, patterns: string[]): Promise<LogFileInfo[]> {
        const results: LogFileInfo[] = [];
        
        try {
            // Convert basePath to Docker path if needed (handles /var/log, /var/log/apache2, etc.)
            const actualBasePath = this.convertToDockerPath(basePath);

            // If no patterns provided, use default patterns
            const actualPatterns = patterns.length > 0 ? patterns : this.getDefaultFilePatterns();

            // Convert glob patterns to regex patterns
            const regexPatterns = actualPatterns.map(p => {
                // Convert glob pattern to regex
                // * -> .*, ? -> ., ** -> .*
                let regexStr = p
                    .replace(/\./g, '\\.')
                    .replace(/\*\*/g, '.*')
                    .replace(/\*/g, '[^/]*')
                    .replace(/\?/g, '.');
                
                // If pattern ends with .log, allow optional rotation numbers (.1, .2, etc.) and compression extensions (.gz, .bz2, .xz)
                // This handles: syslog, syslog.1, syslog.1.gz, auth.log, auth.log.1, auth.log.1.gz, etc.
                if (regexStr.endsWith('\\.log')) {
                    // Allow optional rotation number (.1, .2, .20240101, etc.) followed by optional compression
                    regexStr = regexStr + '(?:\\.\\d+)?(?:\\.(?:gz|bz2|xz))?';
                }
                
                return new RegExp(`^${regexStr}$`);
            });

            // For host-system: only scan the base directory, not subdirectories
            // System log files are already detected via logging service detection
            // User can manually add files/directories if needed
            const scanDirectory = async (dir: string, depth: number = 0): Promise<void> => {
                // Only scan base directory (depth 0), skip all subdirectories by default
                if (depth > 0) {
                    return;
                }

                try {
                    const entries = await fs.readdir(dir, { withFileTypes: true });
                    
                    for (const entry of entries) {
                        const fullPath = path.join(dir, entry.name);
                        
                        // Check exclusion filters first (includes default directory exclusion for host-system)
                        if (this.shouldExclude(fullPath, entry.name, entry.isDirectory(), actualBasePath)) {
                            continue;
                        }
                        
                        // Skip common non-log directories (fallback if not in excludeFilters)
                        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'lost+found') {
                            continue;
                        }
                        
                        if (entry.isDirectory()) {
                            // For host-system: skip all subdirectories by default
                            // User can manually add specific files/directories if needed
                            continue;
                        } else if (entry.isFile()) {
                            // Skip compressed files (.gz, .bz2, .xz, .tar.gz) for now
                            const filename = entry.name.toLowerCase();
                            if (filename.endsWith('.gz') || filename.endsWith('.bz2') || 
                                filename.endsWith('.xz') || filename.endsWith('.tar.gz') ||
                                filename.endsWith('.tar.bz2') || filename.endsWith('.tar.xz')) {
                                continue;
                            }
                            
                            // Check if filename matches any pattern
                            const matches = regexPatterns.some(regex => regex.test(entry.name));
                            
                            if (matches) {
                                try {
                                    // Double-check that file exists and is accessible
                                    const stats = await fs.stat(fullPath);
                                    
                                    // Verify it's actually a file (not a directory or symlink)
                                    if (!stats.isFile()) {
                                        continue;
                                    }
                                    
                                    const logType = this.determineLogType(fullPath);
                                    
                                    results.push({
                                        path: fullPath,
                                        type: logType,
                                        size: stats.size,
                                        modified: stats.mtime
                                    });
                                } catch (statError) {
                                    // Skip files we can't access or that don't exist
                                    // This ensures we only list files that actually exist
                                    continue;
                                }
                            }
                        }
                    }
                } catch (readError) {
                    // Skip directories we can't access
                    // Log error in debug mode only
                    if (process.env.DEBUG) {
                        console.error(`[HostSystemLogPlugin] Cannot read directory ${dir}:`, readError);
                    }
                }
            };

            await scanDirectory(actualBasePath);
        } catch (error) {
            console.error(`[HostSystemLogPlugin] Error scanning files:`, error);
        }
        
        return results;
    }

    parseLogLine(line: string, logType: string): ParsedLogEntry | null {
        if (!line || line.trim().length === 0) {
            return null;
        }

        // Check if line is JSON format (journald JSON) - auto-detect
        if (isJournaldJson(line)) {
            const jsonResult = parseJournaldJson(line);
            if (jsonResult) {
                return jsonResult;
            }
            // If JSON parsing fails, fall through to regular parsing
        }

        // Get custom parser config if available
        const config = this.config?.settings as unknown as HostSystemPluginConfig | undefined;
        const logFile = config?.logFiles?.find(f => f.type === logType);
        const customParserConfig = logFile?.customParserConfig;

        switch (logType) {
            case 'syslog':
                return SyslogParser.parseSyslogLine(line);
            case 'journald':
                // Try JSON format first, then fallback to text format
                if (isJournaldJson(line)) {
                    const jsonResult = parseJournaldJson(line);
                    if (jsonResult) {
                        return jsonResult;
                    }
                }
                return SyslogParser.parseJournaldLine(line);
            case 'auth':
                return AuthLogParser.parseAuthLine(line);
            case 'kern':
                return KernLogParser.parseKernLine(line);
            case 'daemon':
                return DaemonLogParser.parseDaemonLine(line);
            case 'mail':
                return MailLogParser.parseMailLine(line);
            case 'custom':
                if (customParserConfig) {
                    return CustomLogParser.parseCustomLine(line, customParserConfig);
                }
                // Fallback: try syslog format first, then raw message
                return SyslogParser.parseSyslogLine(line) || {
                    message: line.trim(),
                    level: 'info'
                };
            default:
                // Try syslog format first, fallback to raw message
                return SyslogParser.parseSyslogLine(line) || {
                    message: line.trim(),
                    level: 'info'
                };
        }
    }

    getColumns(logType: string): string[] {
        switch (logType) {
            case 'syslog':
            case 'journald':
                return ['timestamp', 'hostname', 'tag', 'level', 'message'];
            case 'auth':
                return ['timestamp', 'hostname', 'service', 'level', 'user', 'action', 'message'];
            case 'kern':
                return ['timestamp', 'hostname', 'level', 'component', 'message'];
            case 'daemon':
                return ['timestamp', 'hostname', 'service', 'level', 'pid', 'message'];
            case 'mail':
                return ['timestamp', 'hostname', 'service', 'level', 'action', 'ipAddress', 'queueId', 'message'];
            case 'custom':
            default:
                return ['timestamp', 'level', 'message'];
        }
    }

    validateConfig(config: unknown): boolean {
        if (!config || typeof config !== 'object') {
            return false;
        }

        const cfg = config as HostSystemPluginConfig;
        
        // Validate new structure (systemBaseFiles, autoDetectedFiles, customFiles)
        if (cfg.systemBaseFiles) {
            if (!Array.isArray(cfg.systemBaseFiles)) {
                return false;
            }
            for (const file of cfg.systemBaseFiles) {
                if (!file.path || typeof file.path !== 'string') {
                    return false;
                }
                if (!['syslog', 'journald', 'auth', 'kern', 'daemon', 'mail'].includes(file.type)) {
                    return false;
                }
                if (typeof file.enabled !== 'boolean') {
                    return false;
                }
            }
        }

        if (cfg.autoDetectedFiles) {
            if (!Array.isArray(cfg.autoDetectedFiles)) {
                return false;
            }
            for (const file of cfg.autoDetectedFiles) {
                if (!file.path || typeof file.path !== 'string') {
                    return false;
                }
                if (!['syslog', 'auth', 'kern', 'daemon', 'mail', 'custom'].includes(file.type)) {
                    return false;
                }
                if (typeof file.enabled !== 'boolean') {
                    return false;
                }
            }
        }

        if (cfg.customFiles) {
            if (!Array.isArray(cfg.customFiles)) {
                return false;
            }
            for (const file of cfg.customFiles) {
                if (!file.path || typeof file.path !== 'string') {
                    return false;
                }
                if (file.type !== 'custom') {
                    return false;
                }
                if (typeof file.enabled !== 'boolean') {
                    return false;
                }
                if (!file.customParserConfig || !file.customParserConfig.regex) {
                    return false; // Regex custom obligatoire
                }
            }
        }

        // Validate legacy logFiles array (for backward compatibility)
        if (cfg.logFiles) {
            if (!Array.isArray(cfg.logFiles)) {
                return false;
            }
            for (const logFile of cfg.logFiles) {
                if (!logFile.path || typeof logFile.path !== 'string') {
                    return false;
                }
                if (!['syslog', 'journald', 'auth', 'kern', 'daemon', 'mail', 'custom'].includes(logFile.type)) {
                    return false;
                }
                if (typeof logFile.enabled !== 'boolean') {
                    return false;
                }
            }
        }

        // Validate other fields
        if (typeof cfg.journaldEnabled !== 'boolean') {
            return false;
        }
        if (typeof cfg.follow !== 'boolean') {
            return false;
        }
        if (typeof cfg.maxLines !== 'number' || cfg.maxLines < 0) {
            return false;
        }

        // Validate excludeFilters if present
        if (cfg.excludeFilters) {
            if (typeof cfg.excludeFilters !== 'object') {
                return false;
            }
            if (cfg.excludeFilters.files !== undefined) {
                if (!Array.isArray(cfg.excludeFilters.files)) {
                    return false;
                }
                for (const pattern of cfg.excludeFilters.files) {
                    if (typeof pattern !== 'string') {
                        return false;
                    }
                }
            }
            if (cfg.excludeFilters.directories !== undefined) {
                if (!Array.isArray(cfg.excludeFilters.directories)) {
                    return false;
                }
                for (const pattern of cfg.excludeFilters.directories) {
                    if (typeof pattern !== 'string') {
                        return false;
                    }
                }
            }
            if (cfg.excludeFilters.paths !== undefined) {
                if (!Array.isArray(cfg.excludeFilters.paths)) {
                    return false;
                }
                for (const excludePath of cfg.excludeFilters.paths) {
                    if (typeof excludePath !== 'string') {
                        return false;
                    }
                }
            }
        }

        return true;
    }

    getDefaultFilePatterns(): string[] {
        // Use OS-specific patterns if OS is detected, otherwise use defaults
        if (this.osInfo) {
            return getDefaultFilePatterns(this.osInfo.type);
        }
        // Fallback to most common patterns
        return [
            'syslog*',
            'messages*',
            'auth.log*',
            'secure*',
            'kern.log*',
            'daemon.log*',
            'mail.log*',
            'maillog*',
            'mail.err*',
            'cron*',
            '*.log'
        ];
    }

    getDefaultBasePath(): string {
        return this.getLogBasePath();
    }

    /**
     * Normalize file path to get the base log file path
     * Removes rotation numbers (.1, .2, .20240101) and compression extensions (.gz, .bz2, .xz)
     * Example: access.log.1.gz -> access.log
     */
    private normalizeLogFilePath(filePath: string): string {
        return filePath
            .replace(/\.\d+(\.(gz|bz2|xz))?$/, '') // Remove .1, .2, etc. optionally followed by compression
            .replace(/\.\d{8}(\.(gz|bz2|xz))?$/, '') // Remove .20240101, etc. optionally followed by compression
            .replace(/\.(gz|bz2|xz)$/, ''); // Remove compression extension if still present
    }

    /**
     * Check if a file is a system base file (critical system log)
     */
    private isSystemBaseFile(filePath: string, logType: string): boolean {
        const normalizedPath = this.normalizeLogFilePath(filePath);
        const baseFilename = path.basename(normalizedPath).toLowerCase();
        
        // Fichiers système critiques selon OS
        const criticalFiles = [
            'syslog', 'messages', 'auth.log', 'secure', 
            'kern.log', 'daemon.log', 'mail.log', 'maillog'
        ];
        
        return criticalFiles.some(critical => baseFilename === critical || baseFilename.startsWith(critical));
    }

    /**
     * Classify a detected file into one of the three categories
     */
    private async classifyFile(
        fileInfo: LogFileInfo,
        systemBasePaths: string[]
    ): Promise<{
        category: 'systemBase' | 'autoDetected' | 'custom';
        validated: boolean;
        parserType?: string;
    }> {
        const normalizedPath = this.normalizeLogFilePath(fileInfo.path);
        const isSystemBase = systemBasePaths.includes(normalizedPath) || 
                            this.isSystemBaseFile(fileInfo.path, fileInfo.type);

        // Si c'est un fichier système de base
        if (isSystemBase) {
            // Valider avec le parser standard
            try {
                const sampleLines = await logReaderService.readLogFile(fileInfo.path, {
                    maxLines: 10,
                    fromLine: 0,
                    encoding: 'utf8',
                    readCompressed: false
                });

                if (sampleLines.length > 0) {
                    const lines = sampleLines.map(l => l.line).filter(l => l.trim().length > 0);
                    const parsed = this.parseLogLine(lines[0] || '', fileInfo.type);
                    
                    if (parsed && parsed.message) {
                        return {
                            category: 'systemBase',
                            validated: true,
                            parserType: fileInfo.type
                        };
                    }
                }
            } catch {
                // Validation failed, but still classify as system base
            }

            return {
                category: 'systemBase',
                validated: false,
                parserType: fileInfo.type
            };
        }

        // Sinon, essayer de détecter le format automatiquement
        try {
            const sampleLines = await logReaderService.readLogFile(fileInfo.path, {
                maxLines: 50,
                fromLine: 0,
                encoding: 'utf8',
                readCompressed: false
            });

            if (sampleLines.length > 0) {
                const lines = sampleLines.map(l => l.line).filter(l => l.trim().length > 0);
                const detectedFormat = detectLogFormatFromLines(lines);

                if (detectedFormat && detectedFormat.confidence >= 70) {
                    // Format détecté avec confiance suffisante
                    const isValidated = await validateDetectedFormat(fileInfo.path, detectedFormat, 100);
                    
                    return {
                        category: 'autoDetected',
                        validated: isValidated,
                        parserType: detectedFormat.parserType
                    };
                }
            }
        } catch {
            // Detection failed
        }

        // Par défaut, nécessite regex custom
        return {
            category: 'custom',
            validated: false
        };
    }

    /**
     * Classify scanned files into three categories
     */
    async classifyScannedFiles(
        scannedFiles: LogFileInfo[]
    ): Promise<{
        systemBaseFiles: Array<{
            path: string;
            type: 'syslog' | 'journald' | 'auth' | 'kern' | 'daemon' | 'mail';
            enabled: boolean;
            detected: boolean;
            validated: boolean;
            isSystemCritical: boolean;
        }>;
        autoDetectedFiles: Array<{
            path: string;
            type: 'syslog' | 'auth' | 'kern' | 'daemon' | 'mail' | 'custom';
            enabled: boolean;
            detected: boolean;
            validated: boolean;
            parserType: string;
        }>;
        customFiles: Array<{
            path: string;
            type: 'custom';
            enabled: boolean;
            customParserConfig: CustomParserConfig;
            detected: boolean;
        }>;
    }> {
        const systemBaseFiles: Array<{
            path: string;
            type: 'syslog' | 'journald' | 'auth' | 'kern' | 'daemon' | 'mail';
            enabled: boolean;
            detected: boolean;
            validated: boolean;
            isSystemCritical: boolean;
        }> = [];

        const autoDetectedFiles: Array<{
            path: string;
            type: 'syslog' | 'auth' | 'kern' | 'daemon' | 'mail' | 'custom';
            enabled: boolean;
            detected: boolean;
            validated: boolean;
            parserType: string;
        }> = [];

        const customFiles: Array<{
            path: string;
            type: 'custom';
            enabled: boolean;
            customParserConfig: CustomParserConfig;
            detected: boolean;
        }> = [];

        // Obtenir les chemins des fichiers système de base
        const systemBasePaths = (this.defaultLogFiles || []).map(f => this.normalizeLogFilePath(f.path));

        // Grouper les fichiers par nom de base (pour gérer rotation/compression)
        const filesByBase: Map<string, LogFileInfo[]> = new Map();
        for (const file of scannedFiles) {
            const basePath = this.normalizeLogFilePath(file.path);
            if (!filesByBase.has(basePath)) {
                filesByBase.set(basePath, []);
            }
            filesByBase.get(basePath)!.push(file);
        }

        // Classifier chaque groupe de fichiers
        for (const [basePath, files] of filesByBase.entries()) {
            // Utiliser le premier fichier (non compressé de préférence)
            const mainFile = files.find(f => !f.path.match(/\.(gz|bz2|xz)$/)) || files[0];
            
            const classification = await this.classifyFile(mainFile, systemBasePaths);
            const isSystemCritical = this.isSystemBaseFile(mainFile.path, mainFile.type);

            if (classification.category === 'systemBase') {
                systemBaseFiles.push({
                    path: basePath,
                    type: mainFile.type as 'syslog' | 'journald' | 'auth' | 'kern' | 'daemon' | 'mail',
                    enabled: systemBasePaths.includes(basePath), // Enable par défaut si fichier système
                    detected: true,
                    validated: classification.validated,
                    isSystemCritical
                });
            } else if (classification.category === 'autoDetected') {
                autoDetectedFiles.push({
                    path: basePath,
                    type: (classification.parserType || mainFile.type) as 'syslog' | 'auth' | 'kern' | 'daemon' | 'mail' | 'custom',
                    enabled: false,
                    detected: true,
                    validated: classification.validated,
                    parserType: classification.parserType || 'custom'
                });
            } else {
                // Nécessite regex custom - créer une config par défaut
                customFiles.push({
                    path: basePath,
                    type: 'custom',
                    enabled: false,
                    customParserConfig: {
                        regex: '' // Doit être défini par l'utilisateur
                    },
                    detected: true
                });
            }
        }

        return {
            systemBaseFiles,
            autoDetectedFiles,
            customFiles
        };
    }

    /**
     * Determine log type from file path
     * Auto-detection based on filename patterns
     */
    private determineLogType(filePath: string): string {
        const filename = path.basename(filePath).toLowerCase();
        
        // Remove rotation suffixes (.1, .2, .20240101, etc.) and compression (.gz) for matching
        const baseFilename = filename
            .replace(/\.\d+(\.gz|\.bz2|\.xz)?$/, '') // Remove .1, .2, etc.
            .replace(/\.\d{8}(\.gz|\.bz2|\.xz)?$/, '') // Remove .20240101, etc.
            .replace(/\.gz$/, '') // Remove .gz if still present
            .replace(/\.bz2$/, '') // Remove .bz2
            .replace(/\.xz$/, ''); // Remove .xz
        
        // auth patterns (check first to avoid false matches)
        if (baseFilename === 'auth.log' || baseFilename === 'secure' || 
            baseFilename.startsWith('auth') || baseFilename.includes('auth.log')) {
            return 'auth';
        }
        
        // syslog patterns
        if (baseFilename === 'syslog' || baseFilename === 'messages' || 
            baseFilename.includes('syslog') || baseFilename.includes('messages')) {
            return 'syslog';
        }
        
        // kernel patterns
        if (baseFilename === 'kern.log' || baseFilename.startsWith('kern') || 
            baseFilename.includes('kernel') || baseFilename === 'klog') {
            return 'kern';
        }
        
        // daemon patterns
        if (baseFilename === 'daemon.log' || baseFilename.startsWith('daemon')) {
            return 'daemon';
        }
        
        // mail patterns
        if (baseFilename === 'mail.log' || baseFilename === 'mail.err' || 
            baseFilename === 'mail.warn' || baseFilename.startsWith('mail')) {
            return 'mail';
        }
        
        // journald patterns
        if (baseFilename.includes('journal')) {
            return 'journald';
        }
        
        // Common application logs that can be treated as syslog
        const syslogLikePatterns = [
            'cron', 'boot', 'dpkg', 'apt', 'unattended-upgrades',
            'alternatives', 'faillog', 'lastlog', 'wtmp', 'btmp',
            'user.log', 'debug', 'notice', 'info', 'warning', 'err'
        ];
        
        for (const pattern of syslogLikePatterns) {
            if (baseFilename.includes(pattern)) {
                return 'syslog';
            }
        }
        
        // Default to custom for truly unknown types
        return 'custom';
    }

    /**
     * Detect logging services and get their configured log files
     * This method automatically detects journalctl, syslog-ng, and rsyslog
     * and extracts log file paths from their configurations
     */
    async detectLoggingServicesConfig(): Promise<{
        primaryService: DetectedLoggingService | null;
        allServices: DetectedLoggingService[];
        categorizedFiles: {
            systemBaseFiles: Array<{
                path: string;
                type: 'syslog' | 'journald' | 'auth' | 'kern' | 'daemon' | 'mail';
                enabled: boolean;
                detected: boolean;
                validated: boolean;
                isSystemCritical: boolean;
            }>;
            autoDetectedFiles: Array<{
                path: string;
                type: 'syslog' | 'auth' | 'kern' | 'daemon' | 'mail' | 'custom';
                enabled: boolean;
                detected: boolean;
                validated: boolean;
                parserType: string;
            }>;
        };
    }> {
        try {
            // Detect all logging services
            const allServices = await detectLoggingServices();
            const primaryService = await getPrimaryLoggingService();

            // Categorize detected log files
            const systemBaseFiles: Array<{
            path: string;
            type: 'syslog' | 'journald' | 'auth' | 'kern' | 'daemon' | 'mail';
            enabled: boolean;
            detected: boolean;
            validated: boolean;
            isSystemCritical: boolean;
        }> = [];

            const autoDetectedFiles: Array<{
                path: string;
                type: 'syslog' | 'auth' | 'kern' | 'daemon' | 'mail' | 'custom';
                enabled: boolean;
                detected: boolean;
                validated: boolean;
                parserType: string;
            }> = [];

            // Process log files from all detected services
            for (const service of allServices) {
                for (const logFile of service.logFiles) {
                    // Check if file exists (with timeout to avoid hanging)
                    const hostPath = logFile.path.startsWith('/var/log') && this.HOST_ROOT_PATH && this.HOST_ROOT_PATH !== '/host'
                        ? path.join(this.HOST_ROOT_PATH, logFile.path.substring(1))
                        : logFile.path;

                    let fileExists = false;
                    try {
                        // Quick check if file exists (non-blocking)
                        await fs.access(hostPath);
                        fileExists = true;
                    } catch {
                        try {
                            await fs.access(logFile.path);
                            fileExists = true;
                        } catch {
                            // File doesn't exist, skip it (don't block)
                            continue;
                        }
                    }
                    
                    // Skip if file doesn't exist
                    if (!fileExists) {
                        continue;
                    }

                    // Determine if it's a system base file
                    const isSystemBase = this.isSystemBaseFile(logFile.path, logFile.type);
                    const logType = logFile.type === 'journald' ? 'journald' as const :
                                   logFile.type === 'auth' ? 'auth' as const :
                                   logFile.type === 'kern' ? 'kern' as const :
                                   logFile.type === 'daemon' ? 'daemon' as const :
                                   logFile.type === 'mail' ? 'mail' as const :
                                   'syslog' as const;

                    if (isSystemBase) {
                        // Add to system base files
                        const existing = systemBaseFiles.find(f => f.path === logFile.path);
                        if (!existing) {
                            systemBaseFiles.push({
                                path: logFile.path,
                                type: logType,
                                enabled: true,
                                detected: true,
                                validated: logFile.source === 'config', // Config files are considered validated
                                isSystemCritical: true
                            });
                        }
                    } else {
                        // Add to auto-detected files
                        const existing = autoDetectedFiles.find(f => f.path === logFile.path);
                        if (!existing) {
                            // Map log file type to valid autoDetectedFiles type
                            // journald -> syslog, user/cron -> custom, others stay as-is
                            let mappedType: 'syslog' | 'auth' | 'kern' | 'daemon' | 'mail' | 'custom';
                            if (logFile.type === 'journald') {
                                mappedType = 'syslog';
                            } else if (logFile.type === 'user' || logFile.type === 'cron') {
                                mappedType = 'custom';
                            } else if (logFile.type === 'syslog' || logFile.type === 'auth' || 
                                      logFile.type === 'kern' || logFile.type === 'daemon' || 
                                      logFile.type === 'mail' || logFile.type === 'custom') {
                                mappedType = logFile.type;
                            } else {
                                // Fallback to custom for unknown types
                                mappedType = 'custom';
                            }
                            
                            autoDetectedFiles.push({
                                path: logFile.path,
                                type: mappedType,
                                enabled: true,
                                detected: true,
                                validated: logFile.source === 'config',
                                parserType: logFile.type
                            });
                        }
                    }
                }
            }

            return {
                primaryService,
                allServices,
                categorizedFiles: {
                    systemBaseFiles,
                    autoDetectedFiles
                }
            };
        } catch (error) {
            // If detection fails, return empty result instead of throwing
            console.warn('[HostSystemLogPlugin] Error in detectLoggingServicesConfig:', error instanceof Error ? error.message : error);
            return {
                primaryService: null,
                allServices: [],
                categorizedFiles: {
                    systemBaseFiles: [],
                    autoDetectedFiles: []
                }
            };
        }
    }
}
