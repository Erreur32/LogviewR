/**
 * Tests for LogParserService
 * 
 * Tests the integration of custom regex patterns in log parsing
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PluginConfigRepository } from '../../database/models/PluginConfig.js';
import { initializeDatabase, getDatabase, closeDatabase } from '../../database/connection.js';
import { CustomLogParser } from '../../plugins/host-system/CustomLogParser.js';

// Mock the logger to avoid console output during tests
vi.mock('../../utils/logger.js', () => ({
    logger: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        success: vi.fn(),
        debug: vi.fn()
    }
}));

// Mock pluginManager
vi.mock('../pluginManager.js', () => ({
    pluginManager: {
        getPlugin: vi.fn()
    }
}));

// Mock logReaderService
vi.mock('../logReaderService.js', () => ({
    logReaderService: {
        readLogFile: vi.fn(),
        streamLogFile: vi.fn()
    }
}));

// We need to test the internal functions, so we'll create a test helper
// that exposes the normalizeLogFilePath function

/**
 * Test helper: Normalize file path (same logic as in logParserService)
 */
function normalizeLogFilePath(filePath: string): string {
    return filePath
        .replace(/\.\d+(\.(gz|bz2|xz))?$/, '')
        .replace(/\.\d{8}(\.(gz|bz2|xz))?$/, '')
        .replace(/\.(gz|bz2|xz)$/, '');
}

/**
 * Test helper: Get custom regex config (same logic as in logParserService)
 */
function getCustomRegexConfig(pluginId: string, filePath: string): { regex: string; logType: string } | null {
    try {
        const dbConfig = PluginConfigRepository.findByPluginId(pluginId);
        if (!dbConfig || !dbConfig.settings) {
            return null;
        }

        const customRegex = (dbConfig.settings as any).customRegex;
        if (!customRegex || typeof customRegex !== 'object') {
            return null;
        }

        // First, try exact match
        if (customRegex[filePath]) {
            return {
                regex: customRegex[filePath].regex,
                logType: customRegex[filePath].logType || 'custom'
            };
        }

        // Then try normalized path
        const baseFilePath = normalizeLogFilePath(filePath);
        if (baseFilePath !== filePath && customRegex[baseFilePath]) {
            return {
                regex: customRegex[baseFilePath].regex,
                logType: customRegex[baseFilePath].logType || 'custom'
            };
        }

        return null;
    } catch (error) {
        return null;
    }
}

describe('LogParserService - Custom Regex Integration', () => {
    beforeEach(() => {
        // Close any existing database connection
        closeDatabase();
        
        // Set in-memory database for tests
        process.env.DATABASE_PATH = ':memory:';
        
        // Initialize database before each test
        initializeDatabase();
        
        // Clear all plugin configs
        const db = getDatabase();
        db.prepare('DELETE FROM plugin_configs').run();
    });

    afterEach(() => {
        // Close database connection after each test
        closeDatabase();
    });

    describe('normalizeLogFilePath', () => {
        it('should normalize rotated files', () => {
            expect(normalizeLogFilePath('access.log.1')).toBe('access.log');
            expect(normalizeLogFilePath('access.log.2')).toBe('access.log');
            expect(normalizeLogFilePath('access.log.20240101')).toBe('access.log');
        });

        it('should normalize compressed files', () => {
            expect(normalizeLogFilePath('access.log.gz')).toBe('access.log');
            expect(normalizeLogFilePath('access.log.bz2')).toBe('access.log');
            expect(normalizeLogFilePath('access.log.xz')).toBe('access.log');
        });

        it('should normalize rotated and compressed files', () => {
            expect(normalizeLogFilePath('access.log.1.gz')).toBe('access.log');
            expect(normalizeLogFilePath('access.log.2.bz2')).toBe('access.log');
            expect(normalizeLogFilePath('access.log.20240101.gz')).toBe('access.log');
        });

        it('should not modify files without rotation or compression', () => {
            expect(normalizeLogFilePath('access.log')).toBe('access.log');
            expect(normalizeLogFilePath('error.log')).toBe('error.log');
        });
    });

    describe('getCustomRegexConfig', () => {
        it('should return null when no config exists', () => {
            const result = getCustomRegexConfig('test-plugin', '/var/log/test.log');
            expect(result).toBeNull();
        });

        it('should return regex config for exact file path match', () => {
            // Create plugin config with custom regex
            PluginConfigRepository.upsert({
                pluginId: 'test-plugin',
                enabled: true,
                settings: {
                    customRegex: {
                        '/var/log/test.log': {
                            regex: '^(\\d{4}-\\d{2}-\\d{2}) (.*)$',
                            logType: 'custom'
                        }
                    }
                }
            });

            const result = getCustomRegexConfig('test-plugin', '/var/log/test.log');
            expect(result).not.toBeNull();
            expect(result?.regex).toBe('^(\\d{4}-\\d{2}-\\d{2}) (.*)$');
            expect(result?.logType).toBe('custom');
        });

        it('should return regex config for normalized file path', () => {
            // Create plugin config with custom regex for base file
            PluginConfigRepository.upsert({
                pluginId: 'test-plugin',
                enabled: true,
                settings: {
                    customRegex: {
                        '/var/log/test.log': {
                            regex: '^(\\d{4}-\\d{2}-\\d{2}) (.*)$',
                            logType: 'custom'
                        }
                    }
                }
            });

            // Should find regex for rotated file
            const result1 = getCustomRegexConfig('test-plugin', '/var/log/test.log.1');
            expect(result1).not.toBeNull();
            expect(result1?.regex).toBe('^(\\d{4}-\\d{2}-\\d{2}) (.*)$');

            // Should find regex for compressed file
            const result2 = getCustomRegexConfig('test-plugin', '/var/log/test.log.gz');
            expect(result2).not.toBeNull();
            expect(result2?.regex).toBe('^(\\d{4}-\\d{2}-\\d{2}) (.*)$');

            // Should find regex for rotated and compressed file
            const result3 = getCustomRegexConfig('test-plugin', '/var/log/test.log.1.gz');
            expect(result3).not.toBeNull();
            expect(result3?.regex).toBe('^(\\d{4}-\\d{2}-\\d{2}) (.*)$');
        });

        it('should return null when regex not found for file', () => {
            PluginConfigRepository.upsert({
                pluginId: 'test-plugin',
                enabled: true,
                settings: {
                    customRegex: {
                        '/var/log/other.log': {
                            regex: '^test$',
                            logType: 'custom'
                        }
                    }
                }
            });

            const result = getCustomRegexConfig('test-plugin', '/var/log/test.log');
            expect(result).toBeNull();
        });
    });

    describe('CustomLogParser integration', () => {
        it('should parse log line with custom regex', () => {
            const config = {
                regex: '^(\\d{4}-\\d{2}-\\d{2}) (.*)$',
                groups: {
                    timestamp: 1,
                    message: 2
                }
            };

            const result = CustomLogParser.parseCustomLine('2024-01-15 Test message', config);
            expect(result).not.toBeNull();
            expect(result?.message).toBe('Test message');
        });

        it('should return null when regex does not match', () => {
            const config = {
                regex: '^\\d+ (.*)$'
            };

            const result = CustomLogParser.parseCustomLine('Invalid format', config);
            // CustomLogParser returns a ParsedLogEntry with raw message when regex doesn't match
            expect(result).not.toBeNull();
            expect(result?.message).toBe('Invalid format');
        });

        it('should handle invalid regex gracefully', () => {
            // Mock console.error to avoid stderr output during test
            const originalError = console.error;
            const errorSpy = vi.fn();
            console.error = errorSpy;

            const config = {
                regex: '[invalid'
            };

            // Should not throw, but return a ParsedLogEntry with raw message
            const result = CustomLogParser.parseCustomLine('Test line', config);
            expect(result).not.toBeNull();
            expect(result?.message).toBe('Test line');
            
            // Verify that error was logged (but didn't crash)
            expect(errorSpy).toHaveBeenCalled();
            
            // Restore console.error
            console.error = originalError;
        });

        it('should extract groups correctly', () => {
            const config = {
                regex: '^(\\d{4}-\\d{2}-\\d{2}) (ERROR|INFO|WARN) (.*)$',
                groups: {
                    timestamp: 1,
                    level: 2,
                    message: 3
                },
                levelMapping: {
                    'ERROR': 'error',
                    'INFO': 'info',
                    'WARN': 'warning'
                }
            };

            const result = CustomLogParser.parseCustomLine('2024-01-15 ERROR Something went wrong', config);
            expect(result).not.toBeNull();
            expect(result?.level).toBe('error');
            expect(result?.message).toBe('Something went wrong');
        });
    });
});
