/**
 * Error explanations and remediation for web server error logs (Apache, Nginx, NPM).
 * Maps common error message patterns to possible explanation and how to fix or verify.
 */

export interface ErrorExplanation {
    explanation: string;
    howToFix: string;
    possibleIntrusion?: boolean;
}

const PATTERNS: Array<{
    pattern: RegExp | ((message: string) => boolean);
    explanation: string;
    howToFix: string;
    possibleIntrusion?: boolean;
}> = [
    {
        pattern: /permission denied/i,
        explanation: 'The process does not have permission to access the file or directory.',
        howToFix: 'Check file/directory ownership and permissions. Ensure the web server user (e.g. www-data, nginx) can read the path.'
    },
    {
        pattern: /no such file or directory/i,
        explanation: 'A file or directory referenced in the config or request does not exist.',
        howToFix: 'Verify the path in your config. If the file was removed or moved, update the config or restore the file.'
    },
    {
        pattern: /connection refused/i,
        explanation: 'The server could not connect to an upstream service (e.g. PHP-FPM, backend).',
        howToFix: 'Ensure the upstream service is running and listening on the expected address/port.'
    },
    {
        pattern: /upstream timed out|timed out while reading/i,
        explanation: 'The upstream server did not respond in time.',
        howToFix: 'Increase proxy_read_timeout (Nginx) or timeout settings. Check if the backend is slow or overloaded.'
    },
    {
        pattern: /ssl certificate|certificate verify failed|ssl handshake/i,
        explanation: 'Problem with the SSL/TLS certificate or handshake.',
        howToFix: 'Check certificate path, expiry, and that the certificate matches the domain. Renew if expired.'
    },
    {
        pattern: /client intended to send too large body|request entity too large/i,
        explanation: 'The request body exceeds the allowed size.',
        howToFix: 'Increase client_max_body_size (Nginx) or LimitRequestBody (Apache) if large uploads are expected.'
    },
    {
        pattern: /upstream prematurely closed connection/i,
        explanation: 'The upstream server closed the connection before sending a full response.',
        howToFix: 'Check upstream service logs (e.g. PHP-FPM). Often due to timeout, crash, or resource limit.'
    },
    {
        pattern: /directory index of .* is forbidden/i,
        explanation: 'No index file found and directory listing is disabled.',
        howToFix: 'Add an index file (e.g. index.html) or enable directory listing if intended.'
    },
    {
        pattern: /access to .* has been denied|403 forbidden/i,
        explanation: 'Access to the resource is forbidden by configuration or permissions.',
        howToFix: 'Check Allow/Deny rules (Apache) or allow/deny directives (Nginx). Verify file permissions.',
        possibleIntrusion: true
    },
    {
        pattern: /authentication required|401 unauthorized/i,
        explanation: 'The resource requires authentication; credentials are missing or invalid.',
        howToFix: 'Provide valid credentials or check auth config. Repeated 401s from same IP may indicate probing.',
        possibleIntrusion: true
    },
    {
        pattern: /no live upstreams|upstream temporarily unavailable/i,
        explanation: 'No healthy upstream server is available.',
        howToFix: 'Ensure backend services are running and reachable. Check upstream health.'
    },
    {
        pattern: /could not build server_names_hash/i,
        explanation: 'Nginx could not build the server names hash (often too many server names).',
        howToFix: 'Increase server_names_hash_bucket_size in the http or server block.'
    },
    {
        pattern: /open\(\) .* failed .* too many open files/i,
        explanation: 'Process hit the limit on open file descriptors.',
        howToFix: 'Increase the limit (ulimit -n) or worker_rlimit_nofile (Nginx).'
    }
];

/**
 * Find an explanation for an error message (web plugins: Apache, Nginx, NPM).
 */
export function getErrorExplanation(message: string, _level?: string): ErrorExplanation | null {
    const msg = (message ?? '').trim();
    if (!msg) return null;

    for (const entry of PATTERNS) {
        const matches = typeof entry.pattern === 'function'
            ? entry.pattern(msg)
            : entry.pattern.test(msg);
        if (matches) {
            return {
                explanation: entry.explanation,
                howToFix: entry.howToFix,
                possibleIntrusion: entry.possibleIntrusion
            };
        }
    }
    return null;
}
