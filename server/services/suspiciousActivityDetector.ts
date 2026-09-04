/**
 * Suspicious activity detector — scans already-loaded access log lines for
 * 403/401 responses, injection-pattern URLs, and per-IP bruteforce patterns.
 *
 * Runs as an independent full pass over `logLines` (not just the error/warn-tagged
 * subset used by countErrorsByBucket/aggregateUniqueErrors), because a malicious
 * payload can appear on a line with a 200 status that the error-counting pass skips.
 */

import type { LogSourcePlugin } from '../plugins/base/LogSourcePluginInterface.js';
import type { ErrorAnalysisConfig } from '../config/errorAnalysisConfig.js';
import { INJECTION_PATTERNS } from '../utils/attackPatterns.js';

export interface SuspiciousFinding {
    category: string;
    count: number;
    sample: string;
}

type SuspiciousDetectorConfig = Pick<
    ErrorAnalysisConfig,
    | 'suspiciousDetect403'
    | 'suspiciousDetectInjection'
    | 'suspiciousDetectBruteforce'
    | 'suspiciousBruteforceThreshold'
    | 'maxTopErrors'
>;

interface AggregatedFinding {
    count: number;
    sample: string;
}

const MAX_SAMPLE_LENGTH = 200;

export function analyzeSuspiciousActivity(
    logLines: Array<{ line: string }>,
    plugin: LogSourcePlugin,
    logType: string,
    config: SuspiciousDetectorConfig
): SuspiciousFinding[] {
    if (!config.suspiciousDetect403 && !config.suspiciousDetectInjection && !config.suspiciousDetectBruteforce) {
        return [];
    }

    const buckets = new Map<string, AggregatedFinding>();
    const ipAttemptCounts = new Map<string, number>();

    const record = (category: string, sample: string): void => {
        const existing = buckets.get(category);
        if (existing) {
            existing.count++;
        } else {
            buckets.set(category, { count: 1, sample: sample.slice(0, MAX_SAMPLE_LENGTH) });
        }
    };

    for (const logLine of logLines) {
        let entry;
        try {
            entry = plugin.parseLogLine(logLine.line, logType);
        } catch {
            continue;
        }
        if (!entry) continue;

        const status = typeof entry.status === 'number' ? entry.status : undefined;
        const url = typeof entry.url === 'string' ? entry.url : undefined;
        const ip = typeof entry.ip === 'string' ? entry.ip : undefined;

        if (config.suspiciousDetect403 && (status === 403 || status === 401)) {
            record(status === 403 ? 'access-denied-403' : 'auth-required-401', url ?? logLine.line.trim());
        }

        if (config.suspiciousDetectInjection && url) {
            const match = INJECTION_PATTERNS.find(({ pattern }) => pattern.test(url));
            if (match) {
                record(`injection:${match.category}`, url);
            }
        }

        if (config.suspiciousDetectBruteforce && ip && (status === 401 || status === 403)) {
            ipAttemptCounts.set(ip, (ipAttemptCounts.get(ip) ?? 0) + 1);
        }
    }

    const findings: SuspiciousFinding[] = [...buckets.entries()].map(([category, { count, sample }]) => ({
        category,
        count,
        sample
    }));

    if (config.suspiciousDetectBruteforce) {
        for (const [ip, attempts] of ipAttemptCounts) {
            if (attempts >= config.suspiciousBruteforceThreshold) {
                findings.push({
                    category: 'bruteforce',
                    count: attempts,
                    sample: `IP ${ip} : ${attempts} tentatives 401/403`
                });
            }
        }
    }

    return findings.sort((a, b) => b.count - a.count).slice(0, config.maxTopErrors);
}
