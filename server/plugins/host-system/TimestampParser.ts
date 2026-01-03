/**
 * Timestamp Parser
 * 
 * Reusable timestamp parser supporting multiple formats:
 * - Syslog format: Jan 15 10:30:45
 * - ISO 8601: 2025-01-15T10:30:45Z
 * - RFC3339: 2025-01-15T10:30:45+01:00
 * - Unix timestamp: 1705312245
 * 
 * Automatically detects year by comparing with system date
 */

/**
 * Parse a timestamp string to Date object
 * Supports multiple formats with automatic detection
 * 
 * @param timestamp Timestamp string to parse
 * @returns Date object, or current date if parsing fails
 */
export function parseTimestamp(timestamp: string): Date {
    if (!timestamp || timestamp.trim().length === 0) {
        return new Date();
    }

    // Try ISO 8601 / RFC3339 format first: 2025-01-15T10:30:45Z or 2025-01-15T10:30:45+01:00
    const iso8601Match = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})?$/);
    if (iso8601Match) {
        const [, year, month, day, hour, minute, second, millisecond, timezone] = iso8601Match;
        const date = new Date(
            parseInt(year, 10),
            parseInt(month, 10) - 1, // Month is 0-indexed
            parseInt(day, 10),
            parseInt(hour, 10),
            parseInt(minute, 10),
            parseInt(second, 10),
            millisecond ? parseInt(millisecond.substring(0, 3), 10) : 0
        );
        
        // Handle timezone offset
        if (timezone && timezone !== 'Z') {
            const offsetMatch = timezone.match(/([+-])(\d{2}):(\d{2})/);
            if (offsetMatch) {
                const [, sign, offsetHours, offsetMinutes] = offsetMatch;
                const offsetMs = (parseInt(offsetHours, 10) * 60 + parseInt(offsetMinutes, 10)) * 60 * 1000;
                if (sign === '-') {
                    date.setTime(date.getTime() + offsetMs);
                } else {
                    date.setTime(date.getTime() - offsetMs);
                }
            }
        }
        
        return date;
    }

    // Try Unix timestamp: 1705312245 or 1705312245.123
    const unixTimestampMatch = timestamp.match(/^(\d+)(?:\.(\d+))?$/);
    if (unixTimestampMatch) {
        const [, seconds, milliseconds] = unixTimestampMatch;
        const timestampMs = parseInt(seconds, 10) * 1000 + (milliseconds ? parseInt(milliseconds.substring(0, 3), 10) : 0);
        return new Date(timestampMs);
    }

    // Try Syslog format: Jan 15 10:30:45 or Jan 01 12:00:00
    const syslogMatch = timestamp.match(/(\w+)\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})/);
    if (syslogMatch) {
        const [, monthStr, day, hour, minute, second] = syslogMatch;
        const monthMap: Record<string, number> = {
            'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
            'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
        };
        
        const monthIndex = monthMap[monthStr] ?? 0;
        const now = new Date();
        const currentYear = now.getFullYear();
        
        // Create date with current year
        const date = new Date(
            currentYear,
            monthIndex,
            parseInt(day, 10),
            parseInt(hour, 10),
            parseInt(minute, 10),
            parseInt(second, 10)
        );
        
        // If the parsed date is more than 6 months in the future, assume it's last year
        // This handles year rollover for syslog timestamps without year
        const sixMonthsFromNow = new Date(now.getTime() + 6 * 30 * 24 * 60 * 60 * 1000);
        if (date > sixMonthsFromNow) {
            date.setFullYear(currentYear - 1);
        }
        
        return date;
    }

    // Fallback: try to parse as standard Date string
    const fallbackDate = new Date(timestamp);
    if (!isNaN(fallbackDate.getTime())) {
        return fallbackDate;
    }

    // Last resort: return current date
    return new Date();
}

/**
 * Format a Date object to ISO 8601 string
 * 
 * @param date Date object to format
 * @returns ISO 8601 formatted string (e.g., "2025-01-15T10:30:45Z")
 */
export function formatTimestamp(date: Date): string {
    return date.toISOString();
}

/**
 * Format a Date object to Syslog format string
 * 
 * @param date Date object to format
 * @returns Syslog formatted string (e.g., "Jan 15 10:30:45")
 */
export function formatSyslogTimestamp(date: Date): string {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    const month = monthNames[date.getMonth()];
    const day = date.getDate().toString().padStart(2, ' ');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    
    return `${month} ${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Detect timestamp format from a string
 * 
 * @param timestamp Timestamp string to analyze
 * @returns Format name ('iso8601', 'unix', 'syslog', 'unknown')
 */
export function detectTimestampFormat(timestamp: string): 'iso8601' | 'unix' | 'syslog' | 'unknown' {
    if (!timestamp || timestamp.trim().length === 0) {
        return 'unknown';
    }

    // Check ISO 8601 / RFC3339
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(timestamp)) {
        return 'iso8601';
    }

    // Check Unix timestamp
    if (/^\d+(?:\.\d+)?$/.test(timestamp)) {
        return 'unix';
    }

    // Check Syslog format
    if (/^\w+\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}/.test(timestamp)) {
        return 'syslog';
    }

    return 'unknown';
}
