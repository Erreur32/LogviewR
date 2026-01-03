/**
 * Nginx Proxy Manager (NPM) Log Plugin
 * 
 * Plugin for reading NPM access and error logs
 */

import { BasePlugin } from '../base/BasePlugin.js';
import { NpmParser } from './NpmParser.js';
import type { LogSourcePlugin, LogFileInfo, ParsedLogEntry } from '../base/LogSourcePluginInterface.js';
import type { PluginStats } from '../base/PluginInterface.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface NpmPluginConfig {
    basePath: string;
    accessLogPattern: string;
    enabled: boolean;
    follow: boolean;
    maxLines: number;
    excludeFilters?: {
        files?: string[];
        directories?: string[];
        paths?: string[];
    };
}

export class NpmLogPlugin extends BasePlugin implements LogSourcePlugin {
    constructor() {
        super('npm', 'Nginx Proxy Manager Logs', '0.1.5');
    }

    async getStats(): Promise<PluginStats> {
        // NPM plugin doesn't provide device/network stats
        return {};
    }

    async testConnection(): Promise<boolean> {
        try {
            const config = this.config?.settings as NpmPluginConfig | undefined;
            const basePath = config?.basePath || this.getDefaultBasePath();
            
            // Test if base path exists and is readable
            await fs.access(basePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Check if a file or directory should be excluded based on configured filters
     */
    private shouldExclude(filePath: string, entryName: string, isDirectory: boolean): boolean {
        const config = this.config?.settings as NpmPluginConfig | undefined;
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

            await scanDirectory(basePath);
        } catch (error) {
            console.error(`[NpmLogPlugin] Error scanning files:`, error);
        }
        
        return results;
    }

    parseLogLine(line: string, logType: string): ParsedLogEntry | null {
        if (!line || line.trim().length === 0) {
            return null;
        }

        switch (logType) {
            case 'access':
                return NpmParser.parseAccessLine(line);
            case 'error':
                return NpmParser.parseErrorLine(line);
            default:
                // Try access format first, then error
                return NpmParser.parseAccessLine(line) || NpmParser.parseErrorLine(line);
        }
    }

    getColumns(logType: string): string[] {
        switch (logType) {
            case 'access':
                // Include all possible columns (cache, upstreamStatus, gzip may be present in NPM formats)
                return ['timestamp', 'ip', 'method', 'url', 'status', 'size', 'referer', 'userAgent', 'host', 'upstream', 'responseTime', 'cache', 'upstreamStatus', 'gzip'];
            case 'error':
                return ['timestamp', 'level', 'message'];
            default:
                return ['timestamp', 'level', 'message'];
        }
    }

    validateConfig(config: unknown): boolean {
        if (!config || typeof config !== 'object') {
            return false;
        }

        const cfg = config as NpmPluginConfig;
        
        if (typeof cfg.basePath !== 'string' || cfg.basePath.length === 0) {
            return false;
        }
        if (typeof cfg.accessLogPattern !== 'string') {
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
        return [
            'proxy-host-*_access.log*',
            'proxy-host-*_error.log*',
            'default-host_access.log*',
            'default-host_error.log*',
            'fallback_access.log*',
            'fallback_error.log*',
            'dead-host-*_access.log*',
            'dead-host-*_error.log*',
            'letsencrypt-requests_access.log*',
            'letsencrypt-requests_error.log*',
            '*.access.log*',
            '*.error.log*'
        ];
    }

    getDefaultBasePath(): string {
        // Try common NPM log paths
        const possiblePaths = [
            '/var/log/npm',
            '/data/logs',
            '/app/data/logs',
            '/npm/data/logs'
        ];
        
        // Return the first path that exists (will be checked at runtime)
        // Default to /var/log/npm as it's the most common location
        return '/var/log/npm';
    }

    /**
     * Determine log type from file path
     */
    private determineLogType(filePath: string): string {
        const filename = path.basename(filePath).toLowerCase();
        
        if (filename.includes('access') || filename.includes('proxy-host')) {
            return 'access';
        }
        if (filename.includes('error')) {
            return 'error';
        }
        
        return 'access'; // Default to access
    }
}
