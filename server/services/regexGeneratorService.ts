/**
 * Regex Generator Service
 * 
 * Service for automatically generating regex patterns from log lines
 */

/**
 * Generate a regex pattern from a log line by detecting common patterns
 * 
 * @param logLine - The log line to analyze
 * @returns Object containing the generated regex, group names, and test results
 */
export function generateRegexFromLogLine(logLine: string): {
    regex: string;
    groups: string[];
    testResult: Record<string, string>;
} {
    if (!logLine || logLine.trim().length === 0) {
        throw new Error('Log line cannot be empty');
    }

    // Patterns to detect
    const patterns = {
        // IPv4 address
        ipv4: /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
        // IPv6 address (simplified)
        ipv6: /^[0-9a-fA-F:]+(::[0-9a-fA-F:]*)?$/,
        // HTTP methods
        httpMethod: /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|TRACE|CONNECT)$/i,
        // HTTP status codes
        statusCode: /^\d{3}$/,
        // Timestamp patterns
        timestampBrackets: /^\[[^\]]+\]$/, // [01/Jan/2024:12:00:00 +0000]
        timestampISO: /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/, // ISO format
        timestampCommon: /^\d{2}\/\w+\/\d{4}:\d{2}:\d{2}:\d{2}/, // Common log format
        // Numbers
        number: /^\d+$/,
        // URLs/paths
        url: /^\/[^\s"]*/,
        // Quoted strings
        quotedString: /^"[^"]*"$/,
        // Bracketed content
        bracketed: /^\[[^\]]+\]$/,
    };

    // Split the line into tokens (preserving quotes and brackets)
    const tokens: Array<{ value: string; type: string; groupName?: string }> = [];
    let currentToken = '';
    let inQuotes = false;
    let inBrackets = false;
    let quoteChar = '';

    for (let i = 0; i < logLine.length; i++) {
        const char = logLine[i];
        const prevChar = i > 0 ? logLine[i - 1] : '';
        const nextChar = i < logLine.length - 1 ? logLine[i + 1] : '';

        // Handle quotes
        if ((char === '"' || char === "'") && prevChar !== '\\') {
            if (inQuotes && char === quoteChar) {
                // End of quoted string
                currentToken += char;
                tokens.push({ value: currentToken, type: 'quoted' });
                currentToken = '';
                inQuotes = false;
                quoteChar = '';
                continue;
            } else if (!inQuotes) {
                // Start of quoted string
                if (currentToken.trim()) {
                    tokens.push({ value: currentToken.trim(), type: 'text' });
                    currentToken = '';
                }
                inQuotes = true;
                quoteChar = char;
                currentToken = char;
                continue;
            }
        }

        // Handle brackets
        if (char === '[' && !inQuotes && prevChar !== '\\') {
            if (currentToken.trim()) {
                tokens.push({ value: currentToken.trim(), type: 'text' });
                currentToken = '';
            }
            inBrackets = true;
            currentToken = char;
            continue;
        }
        if (char === ']' && inBrackets && !inQuotes && prevChar !== '\\') {
            currentToken += char;
            tokens.push({ value: currentToken, type: 'bracketed' });
            currentToken = '';
            inBrackets = false;
            continue;
        }

        // Handle whitespace (only outside quotes and brackets)
        if ((char === ' ' || char === '\t') && !inQuotes && !inBrackets) {
            if (currentToken.trim()) {
                tokens.push({ value: currentToken.trim(), type: 'text' });
                currentToken = '';
            }
            continue;
        }

        currentToken += char;
    }

    // Add remaining token
    if (currentToken.trim()) {
        tokens.push({ value: currentToken.trim(), type: inQuotes ? 'quoted' : inBrackets ? 'bracketed' : 'text' });
    }

    // Analyze tokens and assign group names
    const regexParts: string[] = [];
    const groupNames: string[] = [];
    const groupNameCounts: Record<string, number> = {}; // Track usage count for each group name
    let groupIndex = 0;

    // Helper function to get unique group name
    const getUniqueGroupName = (baseName: string): string => {
        if (!groupNameCounts[baseName]) {
            groupNameCounts[baseName] = 1;
            return baseName;
        }
        // Increment and return with suffix
        groupNameCounts[baseName]++;
        return `${baseName}${groupNameCounts[baseName] - 1}`;
    };

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const prevToken = i > 0 ? tokens[i - 1] : null;
        const nextToken = i < tokens.length - 1 ? tokens[i + 1] : null;

        let pattern = '';
        let baseGroupName = '';

        // Detect patterns
        if (token.type === 'bracketed') {
            // Timestamp in brackets
            baseGroupName = 'timestamp';
            pattern = `\\[([^\\]]+)\\]`;
        } else if (token.type === 'quoted') {
            // Quoted string - could be request, user-agent, referer
            const content = token.value.slice(1, -1); // Remove quotes
            
            // Check if it looks like an HTTP request
            if (content.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|TRACE|CONNECT)\s+/i)) {
                baseGroupName = 'request';
                pattern = `"([^"]+)"`;
            } else if (prevToken?.value === 'referer' || prevToken?.value === 'referrer' || 
                       (i > 0 && tokens[i - 2]?.value === 'referer')) {
                baseGroupName = 'referer';
                pattern = `"([^"]*)"`;
            } else if (content.includes('Mozilla') || content.includes('Chrome') || 
                      content.includes('Safari') || content.includes('Firefox') ||
                      content.includes('curl') || content.includes('wget')) {
                baseGroupName = 'userAgent';
                pattern = `"([^"]*)"`;
            } else {
                baseGroupName = 'quoted';
                pattern = `"([^"]*)"`;
            }
        } else if (patterns.ipv4.test(token.value)) {
            baseGroupName = 'ip';
            pattern = `([\\d\\.]+)`;
        } else if (patterns.ipv6.test(token.value)) {
            baseGroupName = 'ip';
            pattern = `([\\da-fA-F:]+)`;
        } else if (patterns.httpMethod.test(token.value)) {
            baseGroupName = 'method';
            pattern = `(${token.value})`;
        } else if (patterns.statusCode.test(token.value) && parseInt(token.value) >= 100 && parseInt(token.value) < 600) {
            baseGroupName = 'status';
            pattern = `(\\d{3})`;
        } else if (patterns.number.test(token.value)) {
            // Could be size, port, or other number
            if (prevToken?.groupName === 'status' || nextToken?.groupName === 'status') {
                baseGroupName = 'size';
                pattern = `(\\d+)`;
            } else if (prevToken?.value.includes(':') || token.value.length <= 5) {
                baseGroupName = 'number';
                pattern = `(\\d+)`;
            } else {
                baseGroupName = 'size';
                pattern = `(\\d+)`;
            }
        } else if (token.value.startsWith('/') || token.value.startsWith('http')) {
            baseGroupName = 'url';
            pattern = `([^\\s"]+)`;
        } else if (token.value === '-') {
            // Placeholder - don't capture
            pattern = `-`;
        } else {
            // Generic text
            baseGroupName = `field${groupIndex++}`;
            pattern = `([^\\s"]+)`;
        }

        // Add to regex
        if (baseGroupName) {
            // Get unique group name
            const groupName = getUniqueGroupName(baseGroupName);
            regexParts.push(`(?<${groupName}>${pattern})`);
            if (!groupNames.includes(groupName)) {
                groupNames.push(groupName);
            }
            // Store group name in token for reference
            token.groupName = groupName;
        } else {
            // Escape special regex characters
            regexParts.push(token.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        }

        // Add space between tokens (most log formats use spaces as separators)
        if (i < tokens.length - 1) {
            regexParts.push('\\s+');
        }
    }

    const regex = `^${regexParts.join('')}$`;

    // Test the regex
    let testResult: Record<string, string> = {};
    try {
        const regexObj = new RegExp(regex);
        const match = logLine.match(regexObj);
        if (match && match.groups) {
            testResult = match.groups;
        }
    } catch (err) {
        // Regex might be invalid, but we'll return it anyway
        console.warn('[RegexGenerator] Failed to test generated regex:', err);
    }

    return {
        regex,
        groups: groupNames,
        testResult
    };
}
