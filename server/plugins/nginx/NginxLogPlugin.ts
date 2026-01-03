/**
 * Nginx Log Plugin
 * 
 * Plugin for reading Nginx access and error logs
 */

import { BasePlugin } from '../base/BasePlugin.js';
import { NginxParser } from './NginxParser.js';
import type { LogSourcePlugin, LogFileInfo, ParsedLogEntry } from '../base/LogSourcePluginInterface.js';
import type { PluginStats } from '../base/PluginInterface.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface NginxPluginConfig {
    basePath: string;
    accessLogPattern: string;
    errorLogPattern: string;
    enabled: boolean;
    follow: boolean;
    maxLines: number;
    excludeFilters?: {
        files?: string[];
        directories?: string[];
        paths?: string[];
    };
}

export class NginxLogPlugin extends BasePlugin implements LogSourcePlugin {
    constructor() {
        super('nginx', 'Nginx Logs', '0.1.5');
    }

    async getStats(): Promise<PluginStats> {
        // Nginx plugin doesn't provide device/network stats
        return {};
    }

    async testConnection(): Promise<boolean> {
        try {
            const config = this.config?.settings as NginxPluginConfig | undefined;
            const basePath = config?.basePath || this.getDefaultBasePath();
            
            // Convert to Docker path if needed
            const actualBasePath = this.convertToDockerPath(basePath);
            
            // Test if base path exists and is readable
            await fs.access(actualBasePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Check if a file or directory should be excluded based on configured filters
     */
    private shouldExclude(filePath: string, entryName: string, isDirectory: boolean): boolean {
        const config = this.config?.settings as NginxPluginConfig | undefined;
        const excludeFilters = config?.excludeFilters;
        
        if (!excludeFilters) {
            return false;
        }
        
        // Check full path exclusions
        if (excludeFilters.paths && excludeFilters.paths.length > 0) {
            for (const excludePath of excludeFilters.paths) {
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
        
        // Check directory exclusions
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
            // Convert basePath to Docker path if needed (handles /var/log/nginx, etc.)
            const actualBasePath = this.convertToDockerPath(basePath);
            
            // Convert glob patterns to regex patterns
            const regexPatterns = patterns.map(p => {
                const regexStr = p
                    .replace(/\./g, '\\.')
                    .replace(/\*\*/g, '.*')
                    .replace(/\*/g, '[^/]*')
                    .replace(/\?/g, '.');
                return new RegExp(`^${regexStr}$`);
            });

            const scanDirectory = async (dir: string): Promise<void> => {
                try {
                    const entries = await fs.readdir(dir, { withFileTypes: true });
                    
                    for (const entry of entries) {
                        const fullPath = path.join(dir, entry.name);
                        
                        // Check exclusion filters first
                        if (this.shouldExclude(fullPath, entry.name, entry.isDirectory())) {
                            continue;
                        }
                        
                        if (entry.name === 'node_modules') {
                            continue;
                        }
                        
                        if (entry.isDirectory()) {
                            await scanDirectory(fullPath);
                        } else if (entry.isFile()) {
                            const matches = regexPatterns.some(regex => regex.test(entry.name));
                            
                            if (matches) {
                                try {
                                    const stats = await fs.stat(fullPath);
                                    const logType = this.determineLogType(fullPath);
                                    
                                    results.push({
                                        path: fullPath,
                                        type: logType,
                                        size: stats.size,
                                        modified: stats.mtime
                                    });
                                } catch {
                                    // Skip files we can't access
                                }
                            }
                        }
                    }
                } catch {
                    // Skip directories we can't access
                }
            };

            await scanDirectory(actualBasePath);
        } catch (error) {
            console.error(`[NginxLogPlugin] Error scanning files:`, error);
        }
        
        return results;
    }

    parseLogLine(line: string, logType: string): ParsedLogEntry | null {
        if (!line || line.trim().length === 0) {
            return null;
        }

        switch (logType) {
            case 'access':
                return NginxParser.parseAccessLine(line);
            case 'error':
                return NginxParser.parseErrorLine(line);
            default:
                // Try access format first, then error
                return NginxParser.parseAccessLine(line) || NginxParser.parseErrorLine(line);
        }
    }

    getColumns(logType: string): string[] {
        switch (logType) {
            case 'access':
                return ['timestamp', 'ip', 'method', 'url', 'status', 'size', 'referer', 'userAgent', 'upstream'];
            case 'error':
                return ['timestamp', 'level', 'pid', 'tid', 'message'];
            default:
                return ['timestamp', 'level', 'message'];
        }
    }

    validateConfig(config: unknown): boolean {
        if (!config || typeof config !== 'object') {
            return false;
        }

        const cfg = config as NginxPluginConfig;
        
        if (typeof cfg.basePath !== 'string' || cfg.basePath.length === 0) {
            return false;
        }
        if (typeof cfg.accessLogPattern !== 'string') {
            return false;
        }
        if (typeof cfg.errorLogPattern !== 'string') {
            return false;
        }
        if (typeof cfg.enabled !== 'boolean') {
            return false;
        }
        if (typeof cfg.follow !== 'boolean') {
            return false;
        }
        if (typeof cfg.maxLines !== 'number' || cfg.maxLines < 0) {
            return false;
        }

        return true;
    }

    getDefaultFilePatterns(): string[] {
        return ['access*.log', 'error*.log'];
    }

    getDefaultBasePath(): string {
        return '/var/log/nginx';
    }

    /**
     * Determine log type from file path
     */
    private determineLogType(filePath: string): string {
        const filename = path.basename(filePath).toLowerCase();
        
        if (filename.includes('access')) {
            return 'access';
        }
        if (filename.includes('error')) {
            return 'error';
        }
        
        return 'access'; // Default to access
    }
}
