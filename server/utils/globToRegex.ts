/**
 * Convert a glob pattern to a regex string with proper escaping.
 *
 * Escapes ALL regex-special characters (not just dots), then converts
 * glob operators: ** → .*, * → [^/]*, ? → .
 *
 * Returns the regex body string (without anchors) so callers can
 * wrap it with ^...$ and append optional suffixes (e.g. rotation/compression).
 */
export function globToRegexStr(pattern: string): string {
    // 1. Stash ** (double-star) before escaping so it's not affected by step 3
    let s = pattern.replaceAll('**', '\x00');
    // 2. Escape all regex-special characters except * and ? (glob operators)
    s = s.replaceAll(/[.+^${}()|[\]\\]/g, '\\$&');
    // 3. Convert remaining single * (glob wildcard)
    s = s.replaceAll('*', '[^/]*');
    // 4. Restore ** as .* (match anything including /)
    s = s.replaceAll('\x00', '.*');
    // 5. Convert ? (single-char wildcard)
    s = s.replaceAll('?', '.');
    return s;
}

/**
 * Compile a glob pattern into an anchored RegExp (^pattern$).
 */
export function globToRegex(pattern: string): RegExp {
    return new RegExp(`^${globToRegexStr(pattern)}$`);
}

/**
 * Compile a glob pattern for log files, allowing optional rotation
 * suffixes (.1, .2, .gz, .bz2, .xz) after .log extensions.
 */
export function globToLogRegex(pattern: string): RegExp {
    let s = globToRegexStr(pattern);
    if (s.endsWith('\\.log')) {
        s += '(?:\\.\\d+)?(?:\\.(?:gz|bz2|xz))?';
    }
    return new RegExp(`^${s}$`);
}
