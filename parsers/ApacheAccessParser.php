<?php
require_once __DIR__ . '/BaseParser.php';

/**
 * Parser for Apache access logs
 * Format: %v:%p %a %l %u %t \"%r\" %>s %O \"%{Referer}i\" \"%{User-Agent}i\"
 * Example: example.com:80 192.168.1.1 - john [01/Feb/2020:12:00:00 +0100] "GET /index.html HTTP/1.1" 200 1234 "http://example.com" "Mozilla/5.0"
 */
class ApacheAccessParser extends BaseParser {
    protected $pattern;
    protected $debug = false;
    private $patterns;
    private $excludedIps = [];
    private $excludedRequests = [];
    private $excludedUserAgents = [];
    private $excludedUsers = [];

    // HTTP status code classifications
    private $httpCodes = [
        'success' => [200, 201, 204],
        'redirect' => [301, 302, 303, 307, 308],
        'client_error' => [400, 401, 403, 404, 405],
        'server_error' => [500, 501, 502, 503, 504]
    ];

    public function __construct() {
        parent::__construct();
        
        // Load configuration
        $config = require __DIR__ . '/../config/config.php';
        $this->debug = $config['debug']['enabled'] ?? false;
        
        // Load pattern and columns from configuration
        $patterns = require __DIR__ . '/../config/log_patterns.php';
        $this->pattern = $patterns['apache']['access']['pattern'];
        
        // Initialize columns using the protected property from BaseParser
        $this->columns = $patterns['apache']['access']['columns'];
        
        if ($this->debug) {
            $this->debugLog("=== ApacheAccessParser initialized ===");
            $this->debugLog("Pattern: " . $this->pattern);
            $this->debugLog("Columns: " . print_r($this->columns, true));
        }
    }

    protected function debugLog($message, $data = []) {
        if ($this->debug) {
            parent::debugLog($message, $data);
        }
    }

    /**
     * Parse HTTP request string into method and path
     * @param string $request The raw request string (e.g. "GET /index.html HTTP/1.1")
     * @return array Array containing [method, path]
     */
    private function parseRequest($request) {
        if ($request === '-' || empty($request)) {
            return ['-', '-'];
        }
        
        // Split request into parts
        $parts = explode(' ', $request);
        if (count($parts) >= 2) {
            return [$parts[0], $parts[1]];  // method, path
        }
        
        return ['-', '-'];  // Default if parsing fails
    }

    /**
     * Parse a single line of Apache access log
     * Uses the pattern from log_patterns.php to extract data
     * Lets BaseParser handle all badge formatting
     */
    public function parse($line, $type = 'access') {
        $line = trim($line);
        if (empty($line)) {
            return null;
        }

        // Try to match the line with our pattern
        if (!preg_match($this->pattern, $line, $matches)) {
            if ($this->debug) {
                error_log("=== Apache Access Parser Debug ===");
                error_log("Raw line: " . $line);
                error_log("Pattern used: " . $this->pattern);
                error_log("Line does not match pattern");
            }
            return null;
        }

        if ($this->debug) {
            error_log("Matches: " . print_r($matches, true));
        }

        // Extract data according to pattern groups
        $data = [
            'host' => $matches[1] . ':' . $matches[2],  // virtual host:port
            'ip' => $matches[3],  // client IP address
            'identity' => $matches[4],  // RFC 1413 identity
            'user' => $matches[5],  // authenticated user
            'date' => $matches[6],  // timestamp
            'request' => $matches[7], // full request
            'status' => $matches[8], // status code
            'size' => $matches[9],   // size
            'referer' => $matches[10], // referer
            'user_agent' => $matches[11], // user agent
            'raw' => $line
        ];

        // Debug log
        if ($this->debug) {
            error_log("=== Apache Access Parser Debug ===");
            error_log("Raw line: " . $line);
            error_log("IP from matches: " . ($matches[3] ?? 'NOT FOUND'));
            error_log("User from matches: " . ($matches[5] ?? 'NOT FOUND'));
            error_log("Pattern used: " . $this->pattern);
            error_log("All matches: " . print_r($matches, true));
        }

        // Check if line should be filtered
        if ($this->filtersEnabled && $this->shouldFilter($data)) {
            if ($this->debug) {
                error_log("Line filtered by rules");
            }
            return null;
        }

        // Parse request into method and path
        list($method, $path) = $this->parseRequest($data['request']);

        $result = [
            'date' => parent::formatDate($data['date']),
            'host' => parent::formatHostBadge($data['host']),
            'ip' => parent::formatIpBadge($data['ip']),
            'user' => parent::formatUserBadge($data['user']),
            'request' => parent::formatRequestBadge($method, $path),
            'status' => parent::formatStatusBadge($data['status']),
            'size' => parent::formatSize($data['size']),
            'referer' => parent::formatRefererBadge($data['referer']),
            'user_agent' => parent::formatUserAgentBadge($data['user_agent']),
            'raw' => $data['raw']
        ];

        if ($this->debug) {
            error_log("Final result: " . print_r($result, true));
        }

        return $result;
    }

    /**
     * Returns the column definition
     * @param string $type The log type (always 'access' for Apache access logs)
     * @return array The column definition
     */
    public function getColumns($type = 'access') {
        return $this->columns;
    }

    public function getType() {
        return 'apache-access';
    }
} 