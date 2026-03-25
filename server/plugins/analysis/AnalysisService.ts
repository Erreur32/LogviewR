/**
 * Analysis Service
 * 
 * Service for analyzing log entries to detect common issues
 * Basic implementation - fine-grained analysis will be added later
 */

import type { ParsedLogEntry } from '../base/LogSourcePluginInterface.js';

export interface AnalysisResult {
    type: 'error' | 'attack' | 'performance' | 'warning';
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
    details?: Record<string, unknown>;
    timestamp: Date;
}

function parsedTimestamp(entry: ParsedLogEntry): Date {
    const t = entry.timestamp;
    if (t instanceof Date) return t;
    if (typeof t === 'string' || typeof t === 'number') return new Date(t);
    return new Date();
}

function numericStatus(entry: ParsedLogEntry): number | undefined {
    const s = entry.status;
    if (typeof s === 'number' && !Number.isNaN(s)) return s;
    if (typeof s === 'string') {
        const n = parseInt(s, 10);
        return Number.isNaN(n) ? undefined : n;
    }
    return undefined;
}

export class AnalysisService {
    /**
     * Analyze a log entry for common issues
     * Basic implementation - will be enhanced later
     */
    analyzeLogEntry(entry: ParsedLogEntry): AnalysisResult | null {
        const status = numericStatus(entry);
        // Basic error detection (5xx status codes)
        if (status !== undefined && status >= 500) {
            return {
                type: 'error',
                severity: status >= 500 ? 'high' : 'medium',
                message: `Erreur serveur détectée: ${status}`,
                details: {
                    status,
                    url: entry.url,
                    ip: entry.ip
                },
                timestamp: parsedTimestamp(entry)
            };
        }

        // Basic attack pattern detection (common attack patterns)
        const urlStr = typeof entry.url === 'string' ? entry.url : entry.url != null ? String(entry.url) : '';
        if (urlStr) {
            const suspiciousPatterns = [
                /\.\./, // Path traversal
                /<script/i, // XSS attempts
                /union.*select/i, // SQL injection
                /eval\(/i, // Code injection
                /\.php\?.*cmd=/i, // Command injection
                /\.env/i, // Environment file access
                /wp-admin/i, // WordPress admin access
                /phpmyadmin/i // phpMyAdmin access
            ];

            for (const pattern of suspiciousPatterns) {
                if (pattern.test(urlStr)) {
                    return {
                        type: 'attack',
                        severity: 'high',
                        message: `Tentative d'attaque potentielle détectée`,
                        details: {
                            pattern: pattern.toString(),
                            url: entry.url,
                            ip: entry.ip,
                            userAgent: entry.userAgent
                        },
                        timestamp: parsedTimestamp(entry)
                    };
                }
            }
        }

        // Basic timeout detection (if response time is available)
        const rt = (entry as { responseTime?: unknown }).responseTime;
        const responseMs = typeof rt === 'number' ? rt : typeof rt === 'string' ? parseFloat(rt) : NaN;
        if (!Number.isNaN(responseMs) && responseMs > 5000) {
            return {
                type: 'performance',
                severity: 'medium',
                message: `Temps de réponse élevé: ${responseMs}ms`,
                details: {
                    responseTime: responseMs,
                    url: entry.url,
                    ip: entry.ip
                },
                timestamp: parsedTimestamp(entry)
            };
        }

        return null;
    }

    /**
     * Analyze multiple log entries and return aggregated results
     */
    analyzeLogEntries(entries: ParsedLogEntry[]): AnalysisResult[] {
        const results: AnalysisResult[] = [];
        
        for (const entry of entries) {
            const result = this.analyzeLogEntry(entry);
            if (result) {
                results.push(result);
            }
        }

        return results;
    }
}
