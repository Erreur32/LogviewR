/**
 * Tests for suspiciousActivityDetector.
 *
 * Uses a fake LogSourcePlugin whose parseLogLine reads synthetic "ip|status|url"
 * lines, so the detector logic is tested independently of any real log format.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { LogSourcePlugin, ParsedLogEntry } from '../../plugins/base/LogSourcePluginInterface.js';
import { analyzeSuspiciousActivity } from '../suspiciousActivityDetector.js';

function makeLine(ip: string, status: number, url: string): string {
    return `${ip}|${status}|${url}`;
}

function lines(...raw: string[]): Array<{ line: string }> {
    return raw.map((line) => ({ line }));
}

function makeFakePlugin(): LogSourcePlugin {
    return {
        parseLogLine: (line: string): ParsedLogEntry | null => {
            const [ip, status, url] = line.split('|');
            if (!ip || !status || !url) return null;
            return { message: line, ip, status: Number.parseInt(status, 10), url };
        }
    } as unknown as LogSourcePlugin;
}

const BASE_CONFIG = {
    suspiciousDetect403: true,
    suspiciousDetectInjection: true,
    suspiciousDetectBruteforce: true,
    suspiciousBruteforceThreshold: 5,
    maxTopErrors: 10
};

describe('analyzeSuspiciousActivity', () => {
    const plugin = makeFakePlugin();

    it('flags a 403 response', () => {
        const findings = analyzeSuspiciousActivity(lines(makeLine('1.2.3.4', 403, '/private')), plugin, 'access', BASE_CONFIG);
        assert.ok(findings.some((f) => f.category === 'access-denied-403'));
    });

    it('flags a 401 response', () => {
        const findings = analyzeSuspiciousActivity(lines(makeLine('1.2.3.4', 401, '/admin')), plugin, 'access', BASE_CONFIG);
        assert.ok(findings.some((f) => f.category === 'auth-required-401'));
    });

    it('flags an XSS payload in the URL', () => {
        const findings = analyzeSuspiciousActivity(
            lines(makeLine('1.2.3.4', 200, '/search?q=<script>alert(1)</script>')),
            plugin,
            'access',
            BASE_CONFIG
        );
        assert.ok(findings.some((f) => f.category === 'injection:xss'));
    });

    it('flags a SQLi payload in the URL', () => {
        const findings = analyzeSuspiciousActivity(
            lines(makeLine('1.2.3.4', 200, '/products?id=1 UNION SELECT * FROM users')),
            plugin,
            'access',
            BASE_CONFIG
        );
        assert.ok(findings.some((f) => f.category === 'injection:sqli'));
    });

    it('flags a path traversal payload in the URL', () => {
        const findings = analyzeSuspiciousActivity(
            lines(makeLine('1.2.3.4', 200, '/download?file=../../etc/passwd')),
            plugin,
            'access',
            BASE_CONFIG
        );
        assert.ok(findings.some((f) => f.category === 'injection:path-traversal'));
    });

    it('does not flag a clean 200 request', () => {
        const findings = analyzeSuspiciousActivity(lines(makeLine('1.2.3.4', 200, '/index.html')), plugin, 'access', BASE_CONFIG);
        assert.deepEqual(findings, []);
    });

    it('flags bruteforce when an IP reaches the threshold', () => {
        const raw = Array.from({ length: 5 }, () => makeLine('9.9.9.9', 401, '/login'));
        const findings = analyzeSuspiciousActivity(lines(...raw), plugin, 'access', BASE_CONFIG);
        const bf = findings.find((f) => f.category === 'bruteforce');
        assert.ok(bf);
        assert.equal(bf!.count, 5);
        assert.match(bf!.sample, /9\.9\.9\.9/);
    });

    it('does not flag bruteforce below the threshold', () => {
        const raw = Array.from({ length: 4 }, () => makeLine('9.9.9.9', 401, '/login'));
        const findings = analyzeSuspiciousActivity(lines(...raw), plugin, 'access', BASE_CONFIG);
        assert.ok(!findings.some((f) => f.category === 'bruteforce'));
    });

    it('each toggle disables its own category independently', () => {
        const raw = [makeLine('1.1.1.1', 403, '/private'), makeLine('2.2.2.2', 200, '/search?q=<script>x</script>')];
        const config = { ...BASE_CONFIG, suspiciousDetect403: false };
        const findings = analyzeSuspiciousActivity(lines(...raw), plugin, 'access', config);
        assert.ok(!findings.some((f) => f.category === 'access-denied-403'));
        assert.ok(findings.some((f) => f.category === 'injection:xss'));
    });

    it('returns nothing when all three toggles are off', () => {
        const raw = [makeLine('1.1.1.1', 403, '/private')];
        const config = {
            ...BASE_CONFIG,
            suspiciousDetect403: false,
            suspiciousDetectInjection: false,
            suspiciousDetectBruteforce: false
        };
        const findings = analyzeSuspiciousActivity(lines(...raw), plugin, 'access', config);
        assert.deepEqual(findings, []);
    });
});
