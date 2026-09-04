/**
 * Categorized URL patterns used to flag suspicious/attack-like access log requests.
 * Promoted from the dead-code prototype in plugins/analysis/AnalysisService.ts —
 * this module is the canonical source for injection pattern matching.
 */

export interface InjectionPattern {
    category: string;
    pattern: RegExp;
}

export const INJECTION_PATTERNS: InjectionPattern[] = [
    { category: 'path-traversal', pattern: /\.\./ },
    { category: 'xss', pattern: /<script/i },
    { category: 'sqli', pattern: /union.*select/i },
    { category: 'code-injection', pattern: /eval\(/i },
    { category: 'command-injection', pattern: /\.php\?.*cmd=/i },
    { category: 'sensitive-file', pattern: /\.env/i },
    { category: 'admin-probe', pattern: /wp-admin/i },
    { category: 'admin-probe', pattern: /phpmyadmin/i }
];
