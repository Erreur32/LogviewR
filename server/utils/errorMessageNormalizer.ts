/**
 * Error message normalization for deduplication.
 *
 * Produces a fingerprint key that groups structurally identical log messages
 * differing only by variable data (IP, PID, timestamp, ids...). The key is
 * used for grouping only — the message shown to the user is always the
 * original raw text (see errorSummaryService.ts), so pattern-matching in
 * errorExplanations.ts keeps working unchanged.
 */

const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6_PATTERN = /\b(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}\b/g;
const UUID_PATTERN = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;
const ISO_TIMESTAMP_PATTERN = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g;
const TIME_PATTERN = /\b\d{1,2}:\d{2}:\d{2}\b/g;
/** Long hex/decimal tokens (pid, tid, session id, unix timestamp...). Checked before short numbers. */
const LONG_ID_PATTERN = /\b[0-9a-fA-F]{6,}\b/g;
const NUMBER_PATTERN = /\b\d+\b/g;

/**
 * Normalize a log message into a grouping key: variable segments (IPs,
 * timestamps, ids, numbers) are replaced by generic placeholders so that two
 * occurrences of the same underlying problem collapse into one entry.
 */
export function normalizeErrorMessage(message: string): string {
    return message
        .replace(ISO_TIMESTAMP_PATTERN, '<TS>')
        .replace(TIME_PATTERN, '<TIME>')
        .replace(IPV6_PATTERN, '<IP>')
        .replace(IPV4_PATTERN, '<IP>')
        .replace(UUID_PATTERN, '<UUID>')
        .replace(LONG_ID_PATTERN, '<ID>')
        .replace(NUMBER_PATTERN, '<N>')
        .replace(/\s+/g, ' ')
        .trim();
}
