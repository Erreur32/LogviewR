/**
 * Safe regex validation — prevents ReDoS from user-controlled patterns
 */

import safeRegex from 'safe-regex2';

const MAX_REGEX_LENGTH = 500;

/**
 * Validate a user-provided regex string for safety before compiling.
 * Returns the compiled RegExp or throws with a user-friendly message.
 */
export function compileSafeRegex(pattern: string, flags?: string): RegExp {
    const trimmed = pattern.trim();

    if (trimmed.length > MAX_REGEX_LENGTH) {
        throw new Error(`Regex too long (max ${MAX_REGEX_LENGTH} chars)`);
    }

    if (!safeRegex(trimmed)) {
        throw new Error('Regex rejected: potential catastrophic backtracking (ReDoS)');
    }

    // Intentional: user-configured regex for log parsing, validated by safe-regex2 above
    return new RegExp(trimmed, flags); // CodeQL[js/regex-injection] — safe-regex2 validated
}
