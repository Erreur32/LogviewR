/**
 * Apache Log Plugin
 * 
 * Plugin for reading Apache access and error logs
 */

import { BasePlugin } from '../base/BasePlugin.js';
import { ApacheParser } from './ApacheParser.js';
import type { LogSourcePlugin, LogFileInfo, ParsedLogEntry } from '../base/LogSourcePluginInterface.js';
import type { PluginStats } from '../base/PluginInterface.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface ApachePluginConfig {
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

export class ApacheLogPlugin extends BasePlugin implements LogSourcePlugin {
    constructor() {
        super('apache', 'Apache Logs', '0.1.4');
    }

    async getStats(): Promise<PluginStats> {
        // Apache plugin doesn't provide device/network stats
        return {};
    }

    async testConnection(): Promise<boolean> {
        const config = this.config?.settings as ApachePluginConfig | undefined;
        const basePath = config?.basePath || this.getDefaultBasePath();
        const actualBasePath = this.resolveDockerPathSync(basePath);
        try {
            await fs.access(actualBasePath);
            return true;
        } catch (err: unknown) {
            const code = err && typeof err === 'object' && 'code' in err ? (err as NodeJS.ErrnoException).code : 'unknown';
            console.warn(
                `[Plugin:apache] testConnection failed. Path checked: ${actualBasePath} (from basePath: ${basePath}). Error: ${code}. ` +
                `To verify in container run: docker exec <container> ls -la ${actualBasePath}`
            );
            return false;
        }
    }

    /**
     * Check if a file or directory should be excluded based on configured filters
     */
    private shouldExclude(filePath: string, entryName: string, isDirectory: boolean): boolean {
        const config = this.config?.settings as ApachePluginConfig | undefined;
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
        const actualBasePath = this.resolveDockerPathSync(basePath);
        try {
            // Convert glob patterns to regex; allow optional rotation (.1, .2) and compression (.gz, .bz2, .xz) after .log
            const regexPatterns = patterns.map(p => {
                let regexStr = p
                    .replace(/\./g, '\\.')
                    .replace(/\*\*/g, '.*')
                    .replace(/\*/g, '[^/]*')
                    .replace(/\?/g, '.');
                if (regexStr.endsWith('\\.log')) {
                    regexStr = regexStr + '(?:\\.\\d+)?(?:\\.(?:gz|bz2|xz))?';
                }
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
            console.error(
                `[ApacheLogPlugin] Error scanning files at ${actualBasePath} (basePath: ${basePath}). ` +
                `Verify access in container: docker exec <container> ls -la ${actualBasePath}`,
                error
            );
        }
        
        return results;
    }

    parseLogLine(line: string, logType: string): ParsedLogEntry | null {
        if (!line || line.trim().length === 0) {
            return null;
        }

        switch (logType) {
            case 'access':
                return ApacheParser.parseAccessLine(line);
            case 'error':
                return ApacheParser.parseErrorLine(line);
            default:
                // Try access format first, then error
                return ApacheParser.parseAccessLine(line) || ApacheParser.parseErrorLine(line);
        }
    }

    getColumns(logType: string): string[] {
        switch (logType) {
            case 'access':
                // Include vhost and port if they might be present (detected dynamically in parser)
                return ['timestamp', 'vhost', 'port', 'ip', 'method', 'url', 'status', 'size', 'referer', 'userAgent'];
            case 'error':
                return ['timestamp', 'level', 'module', 'clientIp', 'message'];
            default:
                return ['timestamp', 'level', 'message'];
        }
    }

    validateConfig(config: unknown): boolean {
        if (!config || typeof config !== 'object') {
            return false;
        }

        const cfg = config as ApachePluginConfig;
        
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
        return ['access*.log', 'access*.log.gz', 'error*.log', 'error*.log.gz'];
    }

    getDefaultBasePath(): string {
        return '/var/log/apache2';
    }

    /**
     * Determine log type from file path
     * Handles both regular and compressed files (.gz, .bz2, .xz)
     */
    private determineLogType(filePath: string): string {
        // Remove compression extensions to check base filename
        const filename = path.basename(filePath)
            .toLowerCase()
            .replace(/\.(gz|bz2|xz)$/, '');
        
        if (filename.includes('access')) {
            return 'access';
        }
        if (filename.includes('error')) {
            return 'error';
        }
        
        return 'access'; // Default to access
    }
}
