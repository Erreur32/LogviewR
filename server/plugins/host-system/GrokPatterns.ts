/**
 * Grok Patterns Library
 * 
 * Provides Grok-like pattern matching for log parsing without external dependencies.
 * Patterns are converted to JavaScript regex for efficient matching.
 * 
 * Based on RFC 3164 (BSD syslog) and RFC 5424 (Syslog Protocol)
 */

/**
 * Grok pattern definitions
 * These patterns follow Grok syntax but are converted to JavaScript regex
 */
export const GrokPatterns = {
    // Timestamp patterns
    SYSLOGTIMESTAMP: '%{MONTH:month} +%{MONTHDAY:day} +%{TIME:time}',
    ISO8601: '%{TIMESTAMP_ISO8601:timestamp}',
    
    // Hostname patterns
    HOSTNAME: '%{HOSTNAME:hostname}',
    IPORHOST: '(?:%{IP:ip}|%{HOSTNAME:hostname})',
    
    // Program patterns
    PROGRAM: '%{PROG:program}',
    PID: '(?:\\[%{POSINT:pid}\\])?',
    
    // Syslog patterns
    SYSLOGBASE: '%{SYSLOGTIMESTAMP:timestamp} %{IPORHOST:hostname} %{PROGRAM:program}%{PID:pid}: %{GREEDYDATA:message}',
    SYSLOG_WITH_PRIORITY: '<%{POSINT:priority}>%{SYSLOGTIMESTAMP:timestamp} %{IPORHOST:hostname} %{PROGRAM:program}%{PID:pid}: %{GREEDYDATA:message}',
    
    // IP patterns
    IPV4: '%{IPV4:ipv4}',
    IPV6: '(?:\\[%{IPV6:ipv6}\\]|%{IPV6:ipv6})',
    IP: '(?:%{IPV4:ipv4}|%{IPV6:ipv6})',
    
    // User patterns
    USERNAME: '%{USER:user}',
    
    // Priority patterns
    PRIORITY: '<%{POSINT:priority}>',
};

/**
 * Base pattern definitions (converted to regex)
 */
const BasePatterns: Record<string, string> = {
    // Month: Jan, Feb, Mar, etc.
    MONTH: '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)',
    
    // Month day: 1-31
    MONTHDAY: '(\\d{1,2})',
    
    // Time: HH:MM:SS
    TIME: '(\\d{2}:\\d{2}:\\d{2})',
    
    // Hostname: alphanumeric, dots, hyphens
    HOSTNAME: '([\\w\\-\\.]+)',
    
    // IPv4: 192.168.1.1
    IPV4: '(\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3})',
    
    // IPv6: 2001:db8::1 or [2001:db8::1]
    IPV6: '([0-9a-fA-F:]+(?:::[0-9a-fA-F:]*)?)',
    
    // Program: alphanumeric, dots, slashes, hyphens
    PROG: '([\\w\\-\\.\\/]+)',
    
    // Positive integer
    POSINT: '(\\d+)',
    
    // Username: starts with letter/underscore, alphanumeric, hyphens
    USER: '([a-z_][a-z0-9_\\-]*)',
    
    // ISO 8601 timestamp: 2025-01-15T10:30:45Z or 2025-01-15T10:30:45+01:00
    TIMESTAMP_ISO8601: '(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:Z|[+-]\\d{2}:\\d{2})?)',
    
    // Greedy data: matches everything
    GREEDYDATA: '(.*)',
};

/**
 * Convert a Grok pattern to JavaScript regex
 * Handles nested patterns and named groups
 * 
 * @param pattern Grok pattern string (e.g., '%{MONTH:month}')
 * @returns JavaScript RegExp object
 */
export function grokToRegex(pattern: string): RegExp {
    let regexStr = pattern;
    
    // Replace all Grok patterns with their regex equivalents
    // Handle nested patterns by processing from most specific to least specific
    const patternOrder = [
        'TIMESTAMP_ISO8601',
        'SYSLOGTIMESTAMP',
        'IPV6',
        'IPV4',
        'IP',
        'IPORHOST',
        'GREEDYDATA',
        'MONTHDAY',
        'MONTH',
        'TIME',
        'HOSTNAME',
        'PROG',
        'PROGRAM',
        'POSINT',
        'PID',
        'USER',
        'USERNAME',
        'PRIORITY',
    ];
    
    // First, expand composite patterns
    regexStr = expandCompositePatterns(regexStr);
    
    // Then replace base patterns
    for (const patternName of patternOrder) {
        const basePattern = BasePatterns[patternName];
        if (basePattern) {
            // Replace %{PATTERN:name} with regex and capture group name
            const grokPattern = `%{${patternName}:(\\w+)}`;
            const regex = new RegExp(grokPattern, 'g');
            regexStr = regexStr.replace(regex, basePattern);
            
            // Also handle patterns without capture names: %{PATTERN}
            const grokPatternNoName = `%{${patternName}}`;
            const regexNoName = new RegExp(grokPatternNoName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
            regexStr = regexStr.replace(regexNoName, basePattern);
        }
    }
    
    // Handle special characters that need escaping
    // Replace spaces with \s+, but avoid creating \s++ (space already followed by +)
    // First, replace patterns like " +" (space followed by +) with a temporary marker
    // This handles Grok patterns like " +" which mean "one or more spaces"
    regexStr = regexStr.replace(/\s+\+/g, '__SPACE_PLUS__');
    // Then replace remaining spaces with \s+
    regexStr = regexStr.replace(/\s+/g, '\\s+');
    // Finally, replace the temporary marker with \s+
    regexStr = regexStr.replace(/__SPACE_PLUS__/g, '\\s+');
    
    // Create regex with start/end anchors
    return new RegExp(`^${regexStr}$`);
}

/**
 * Expand composite patterns (patterns that reference other patterns)
 */
function expandCompositePatterns(pattern: string): string {
    let changed = true;
    let iterations = 0;
    const maxIterations = 10; // Prevent infinite loops
    
    while (changed && iterations < maxIterations) {
        changed = false;
        iterations++;
        
        const before = pattern;
        
        // Expand SYSLOGTIMESTAMP (preserve original name for timestamp reconstruction)
        pattern = pattern.replace(
            /%{SYSLOGTIMESTAMP:(\w+)}/g,
            (match, name) => {
                changed = true;
                return `%{MONTH:${name}_month} +%{MONTHDAY:${name}_day} +%{TIME:${name}_time}`;
            }
        );
        
        // Expand IPORHOST
        pattern = pattern.replace(
            /%{IPORHOST:(\w+)}/g,
            (match, name) => {
                changed = true;
                return `(?:%{IP:${name}_ip}|%{HOSTNAME:${name}_hostname})`;
            }
        );
        
        // Expand IP
        pattern = pattern.replace(
            /%{IP:(\w+)}/g,
            (match, name) => {
                changed = true;
                return `(?:%{IPV4:${name}_ipv4}|%{IPV6:${name}_ipv6})`;
            }
        );
        
        // Expand IPV6 with brackets (avoid double expansion)
        if (!pattern.includes('%{IPV6:')) {
            // This is handled by base pattern replacement
        }
        
        // Expand PID
        pattern = pattern.replace(
            /%{PID:(\w+)}/g,
            (match, name) => {
                changed = true;
                return `(?:\\[%{POSINT:${name}}\\])?`;
            }
        );
        
        // Expand PROGRAM
        pattern = pattern.replace(
            /%{PROGRAM:(\w+)}/g,
            (match, name) => {
                changed = true;
                return `%{PROG:${name}}`;
            }
        );
        
        // Expand USERNAME
        pattern = pattern.replace(
            /%{USERNAME:(\w+)}/g,
            (match, name) => {
                changed = true;
                return `%{USER:${name}}`;
            }
        );
        
        // Expand PRIORITY
        pattern = pattern.replace(
            /%{PRIORITY:(\w+)}/g,
            (match, name) => {
                changed = true;
                return `<%{POSINT:${name}}>`;
            }
        );
        
        if (pattern === before) {
            changed = false;
        }
    }
    
    return pattern;
}

/**
 * Parse a log line using a Grok pattern and extract named groups
 * 
 * @param line Log line to parse
 * @param pattern Grok pattern string
 * @returns Object with extracted fields, or null if no match
 */
export function parseGrokPattern(line: string, pattern: string): Record<string, string> | null {
    // First, extract group names from the original pattern before expansion
    const groupNames = extractGroupNames(pattern);
    
    // Convert pattern to regex
    const regex = grokToRegex(pattern);
    const match = line.match(regex);
    
    if (!match) {
        return null;
    }
    
    // Build result object with extracted groups
    const result: Record<string, string> = {};
    
    // Match groups (index 0 is full match, so start at 1)
    // Note: After expansion, we may have more groups than names, so we map them carefully
    let groupIndex = 1;
    for (const groupName of groupNames) {
        if (groupIndex < match.length && match[groupIndex]) {
            result[groupName] = match[groupIndex];
            groupIndex++;
        }
    }
    
    // Handle composite patterns that may have multiple groups per name
    // For example, SYSLOGTIMESTAMP expands to month, day, time
    if (pattern.includes('SYSLOGTIMESTAMP')) {
        // Try to reconstruct timestamp from components
        if (result.month && result.day && result.time) {
            result.timestamp = `${result.month} ${result.day} ${result.time}`;
        }
    }
    
    return result;
}

/**
 * Extract group names from a Grok pattern
 * 
 * @param pattern Grok pattern string
 * @returns Array of group names in order
 */
function extractGroupNames(pattern: string): string[] {
    const groupNames: string[] = [];
    
    // Extract names from patterns like %{PATTERN:name}
    const groupRegex = /%\{[^:}]+:(\w+)\}/g;
    let match;
    
    while ((match = groupRegex.exec(pattern)) !== null) {
        groupNames.push(match[1]);
    }
    
    return groupNames;
}

/**
 * Helper function to build a syslog pattern with optional priority
 * 
 * @param withPriority Include priority field
 * @returns Grok pattern string
 */
export function buildSyslogPattern(withPriority: boolean = false): string {
    if (withPriority) {
        return GrokPatterns.SYSLOG_WITH_PRIORITY;
    }
    return GrokPatterns.SYSLOGBASE;
}
