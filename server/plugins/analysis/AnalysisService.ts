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

export class AnalysisService {
    /**
     * Analyze a log entry for common issues
     * Basic implementation - will be enhanced later
     */
    analyzeLogEntry(entry: ParsedLogEntry): AnalysisResult | null {
        // Basic error detection (5xx status codes)
        if (entry.status && entry.status >= 500) {
            return {
                type: 'error',
                severity: entry.status >= 500 ? 'high' : 'medium',
                message: `Erreur serveur détectée: ${entry.status}`,
                details: {
                    status: entry.status,
                    url: entry.url,
                    ip: entry.ip
                },
                timestamp: entry.timestamp || new Date()
            };
        }

        // Basic attack pattern detection (common attack patterns)
        if (entry.url) {
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
                if (pattern.test(entry.url)) {
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
                        timestamp: entry.timestamp || new Date()
                    };
                }
            }
        }

        // Basic timeout detection (if response time is available)
        if ((entry as any).responseTime && (entry as any).responseTime > 5000) {
            return {
                type: 'performance',
                severity: 'medium',
                message: `Temps de réponse élevé: ${(entry as any).responseTime}ms`,
                details: {
                    responseTime: (entry as any).responseTime,
                    url: entry.url,
                    ip: entry.ip
                },
                timestamp: entry.timestamp || new Date()
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
