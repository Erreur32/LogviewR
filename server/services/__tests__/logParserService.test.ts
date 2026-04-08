/**
 * Tests for LogParserService
 *
 * Tests the integration of custom regex patterns in log parsing.
 * Uses Node.js built-in test runner (node:test + node:assert) — zero dependencies.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Set env before any module imports that read it
process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

import { PluginConfigRepository } from '../../database/models/PluginConfig.js';
import { initializeDatabase, getDatabase, closeDatabase } from '../../database/connection.js';
import { CustomLogParser } from '../../plugins/host-system/CustomLogParser.js';

// ── Helpers (same logic as in logParserService) ─────────────────────────────

function normalizeLogFilePath(filePath: string): string {
    return filePath
        .replace(/\.\d+(\.(gz|bz2|xz))?$/, '')
        .replace(/\.\d{8}(\.(gz|bz2|xz))?$/, '')
        .replace(/\.(gz|bz2|xz)$/, '');
}

function getCustomRegexConfig(pluginId: string, filePath: string): { regex: string; logType: string } | null {
    try {
        const dbConfig = PluginConfigRepository.findByPluginId(pluginId);
        if (!dbConfig || !dbConfig.settings) return null;

        const customRegex = (dbConfig.settings as any).customRegex;
        if (!customRegex || typeof customRegex !== 'object') return null;

        if (customRegex[filePath]) {
            return { regex: customRegex[filePath].regex, logType: customRegex[filePath].logType || 'custom' };
        }

        const baseFilePath = normalizeLogFilePath(filePath);
        if (baseFilePath !== filePath && customRegex[baseFilePath]) {
            return { regex: customRegex[baseFilePath].regex, logType: customRegex[baseFilePath].logType || 'custom' };
        }

        return null;
    } catch {
        return null;
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('LogParserService - Custom Regex Integration', () => {
    beforeEach(() => {
        closeDatabase();
        process.env.DATABASE_PATH = ':memory:';
        initializeDatabase();
        const db = getDatabase();
        db.prepare('DELETE FROM plugin_configs').run();
    });

    afterEach(() => {
        closeDatabase();
    });

    describe('normalizeLogFilePath', () => {
        it('should normalize rotated files', () => {
            assert.equal(normalizeLogFilePath('access.log.1'), 'access.log');
            assert.equal(normalizeLogFilePath('access.log.2'), 'access.log');
            assert.equal(normalizeLogFilePath('access.log.20240101'), 'access.log');
        });

        it('should normalize compressed files', () => {
            assert.equal(normalizeLogFilePath('access.log.gz'), 'access.log');
            assert.equal(normalizeLogFilePath('access.log.bz2'), 'access.log');
            assert.equal(normalizeLogFilePath('access.log.xz'), 'access.log');
        });

        it('should normalize rotated and compressed files', () => {
            assert.equal(normalizeLogFilePath('access.log.1.gz'), 'access.log');
            assert.equal(normalizeLogFilePath('access.log.2.bz2'), 'access.log');
            assert.equal(normalizeLogFilePath('access.log.20240101.gz'), 'access.log');
        });

        it('should not modify files without rotation or compression', () => {
            assert.equal(normalizeLogFilePath('access.log'), 'access.log');
            assert.equal(normalizeLogFilePath('error.log'), 'error.log');
        });
    });

    describe('getCustomRegexConfig', () => {
        it('should return null when no config exists', () => {
            const result = getCustomRegexConfig('test-plugin', '/var/log/test.log');
            assert.equal(result, null);
        });

        it('should return regex config for exact file path match', () => {
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
            assert.notEqual(result, null);
            assert.equal(result?.regex, '^(\\d{4}-\\d{2}-\\d{2}) (.*)$');
            assert.equal(result?.logType, 'custom');
        });

        it('should return regex config for normalized file path', () => {
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

            const result1 = getCustomRegexConfig('test-plugin', '/var/log/test.log.1');
            assert.notEqual(result1, null);
            assert.equal(result1?.regex, '^(\\d{4}-\\d{2}-\\d{2}) (.*)$');

            const result2 = getCustomRegexConfig('test-plugin', '/var/log/test.log.gz');
            assert.notEqual(result2, null);

            const result3 = getCustomRegexConfig('test-plugin', '/var/log/test.log.1.gz');
            assert.notEqual(result3, null);
        });

        it('should return null when regex not found for file', () => {
            PluginConfigRepository.upsert({
                pluginId: 'test-plugin',
                enabled: true,
                settings: {
                    customRegex: {
                        '/var/log/other.log': { regex: '^test$', logType: 'custom' }
                    }
                }
            });

            const result = getCustomRegexConfig('test-plugin', '/var/log/test.log');
            assert.equal(result, null);
        });
    });

    describe('CustomLogParser integration', () => {
        it('should parse log line with custom regex', () => {
            const config = {
                regex: '^(\\d{4}-\\d{2}-\\d{2}) (.*)$',
                groups: { timestamp: 1, message: 2 }
            };

            const result = CustomLogParser.parseCustomLine('2024-01-15 Test message', config);
            assert.notEqual(result, null);
            assert.equal(result?.message, 'Test message');
        });

        it('should return fallback when regex does not match', () => {
            const config = { regex: '^\\d+ (.*)$' };

            const result = CustomLogParser.parseCustomLine('Invalid format', config);
            assert.notEqual(result, null);
            assert.equal(result?.message, 'Invalid format');
        });

        it('should handle invalid regex gracefully', () => {
            const originalError = console.error;
            console.error = () => {};

            const config = { regex: '[invalid' };
            const result = CustomLogParser.parseCustomLine('Test line', config);
            assert.notEqual(result, null);
            assert.equal(result?.message, 'Test line');

            console.error = originalError;
        });

        it('should extract groups correctly', () => {
            const config = {
                regex: '^(\\d{4}-\\d{2}-\\d{2}) (ERROR|INFO|WARN) (.*)$',
                groups: { timestamp: 1, level: 2, message: 3 },
                levelMapping: { 'ERROR': 'error', 'INFO': 'info', 'WARN': 'warning' }
            };

            const result = CustomLogParser.parseCustomLine('2024-01-15 ERROR Something went wrong', config);
            assert.notEqual(result, null);
            assert.equal(result?.level, 'error');
            assert.equal(result?.message, 'Something went wrong');
        });
    });
});
