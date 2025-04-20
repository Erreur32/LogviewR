<?php
require_once __DIR__ . '/BaseNPMParser.php';

/**
 * Parser for NPM default-host logs
 * Handles both access and error logs
 */
class NPMDefaultHostParser extends BaseNPMParser {
    protected $pattern;
    protected $debug = false;
    protected $currentType = 'access';
    protected $patterns;
    protected $excludedIps = [];
    protected $excludedRequests = [];
    protected $excludedUserAgents = [];
    protected $excludedUsers = [];

    public function __construct($debug = null) {
        parent::__construct();
        
        // Load configuration
        $config = require __DIR__ . '/../config/config.php';
        $this->debug = $config['debug']['enabled'] ?? false;
        
        // Load patterns and columns from configuration
        $this->patterns = require __DIR__ . '/../config/log_patterns.php';
        
        if ($this->debug) {
            $this->debugLog("Patterns loaded", [
                'available_patterns' => array_keys($this->patterns),
                'default_host_access' => isset($this->patterns['npm-default-host-access']) ? 'exists' : 'missing',
                'default_host_error' => isset($this->patterns['npm-default-host-error']) ? 'exists' : 'missing'
            ]);
        }
        
        // Initialize columns for access logs by default
        $this->columns = $this->patterns['npm-default-host-access']['columns'] ?? [];
        
        if ($this->debug) {
            $this->debugLog("Columns initialized", [
                'columns' => $this->columns
            ]);
        }
        
        // Load exclusion filters
        if (isset($this->patterns['filters']['exclude'])) {
            $this->excludedIps = $this->patterns['filters']['exclude']['ips'] ?? [];
            $this->excludedRequests = $this->patterns['filters']['exclude']['requests'] ?? [];
            $this->excludedUserAgents = $this->patterns['filters']['exclude']['user_agents'] ?? [];
            $this->excludedUsers = $this->patterns['filters']['exclude']['users'] ?? [];
        }
        
        if ($this->debug) {
            $this->debugLog("=== NPMDefaultHostParser initialized ===");
        }
    }

    public function setType($type) {
        $this->currentType = $type;
        // Update columns based on type
        $patternKey = 'npm-default-host-' . $type;
        if (isset($this->patterns[$patternKey])) {
            $this->columns = $this->patterns[$patternKey]['columns'];
        } else {
            $this->debugLog("Pattern not found for type", [
                'type' => $type,
                'pattern_key' => $patternKey,
                'available_patterns' => array_keys($this->patterns)
            ]);
        }
        
        if ($this->debug) {
            $this->debugLog("Columns updated for type", [
                'type' => $type,
                'pattern_key' => $patternKey,
                'columns' => $this->columns
            ]);
        }
    }

    protected function debugLog($message, $data = []) {
        if ($this->debug) {
            parent::debugLog($message, $data);
        }
    }

    public function parse($line, $type = null) {
        $line = trim($line);
        if (empty($line)) {
            return null;
        }

        // Use current type if no type specified
        $type = $type ?? $this->currentType;
        
        if ($this->debug) {
            $this->debugLog("Parsing line", [
                'line' => $line,
                'type' => $type,
                'current_type' => $this->currentType
            ]);
        }

        $pattern = $this->patterns['npm-default-host-' . $type]['pattern'];
        
        // Try to match the line with our pattern
        if (!preg_match($pattern, $line, $matches)) {
            if ($this->debug) {
                $this->debugLog("Line does not match pattern", [
                    'line' => $line,
                    'pattern' => $pattern
                ]);
            }
            return null;
        }

        if ($this->debug) {
            $this->debugLog("Matches found", ['matches' => $matches]);
        }

        return $type === 'access' 
            ? $this->parseAccessLog($matches)
            : $this->parseErrorLog($matches, $line);
    }

    protected function parseAccessLog($matches) {
        if ($this->debug) {
            $this->debugLog("Parsing access log", [
                'matches' => $matches,
                'current_columns' => $this->columns
            ]);
        }

        // Format each field with appropriate badges
        $clientIp = $this->formatIpBadge($matches[1] ?? '-');
        $date = $this->formatDate($matches[2] ?? '-');
        
        // Parse request line (METHOD PATH PROTOCOL)
        $requestLine = $matches[3] ?? '-';
        $requestParts = explode(' ', $requestLine);
        $method = $requestParts[0] ?? '-';
        $path = $requestParts[1] ?? '-';
        $protocol = $requestParts[2] ?? '-';
        
        $request = $this->formatRequestBadge($method, $path);
        $status = $this->formatStatusCode($matches[4] ?? '-');
        $size = $this->formatSize($matches[5] ?? '-');
        $referer = $this->formatRefererBadge($matches[6] ?? '-');
        $userAgent = $this->formatUserAgentBadge($matches[7] ?? '-');

        $result = [
            'client_ip' => $clientIp,
            'date' => $date,
            'request' => $request,
            'status' => $status,
            'size' => $size,
            'referer' => $referer,
            'user_agent' => $userAgent
        ];

        if ($this->debug) {
            $this->debugLog("Access log parsed", [
                'result' => $result,
                'expected_columns' => array_keys($this->columns)
            ]);
        }

        return $result;
    }

    protected function parseErrorLog($matches, $line) {
        if ($this->debug) {
            $this->debugLog("Parsing error log", [
                'matches' => $matches,
                'line' => $line
            ]);
        }
        
        // Format each field with appropriate badges
        $date = $this->formatDate($matches[1] ?? '-');
        $level = $this->formatErrorLevel($matches[2] ?? '-');
        $message = htmlspecialchars($matches[3] ?? '-');
        $error = $this->formatErrorBadge($matches[4] ?? '-');
        $clientIp = $this->formatIpBadge($matches[5] ?? '-');
        $request = $this->formatRequestBadge($matches[6] ?? '-', $matches[7] ?? '-');
        $host = $this->formatHostBadge($matches[8] ?? '-');

        $result = [
            'date' => $date,
            'level' => $level,
            'message' => $message,
            'error' => $error,
            'client_ip' => $clientIp,
            'request' => $request,
            'host' => $host
        ];

        if ($this->debug) {
            $this->debugLog("Error log parsed", [
                'result' => $result
            ]);
        }

        return $result;
    }

    protected function formatErrorBadge($error) {
        // Return default badge if error is null
        if ($error === null) {
            return '<span class="badge badge-danger">-</span>';
        }
        
        return sprintf(
            '<span class="badge badge-danger">%s</span>',
            htmlspecialchars($error)
        );
    }

    protected function formatErrorLevel($level) {
        // Return default badge if level is null
        if ($level === null) {
            return '<span class="badge badge-warning">-</span>';
        }
        
        $class = strtolower($level);
        return sprintf(
            '<span class="badge badge-%s">%s</span>',
            $class,
            htmlspecialchars($level)
        );
    }

    protected function formatHostBadge($host) {
        // Return default badge if host is null
        if ($host === null) {
            return '<span class="badge badge-info">-</span>';
        }
        
        return sprintf(
            '<span class="badge badge-info">%s</span>',
            htmlspecialchars($host)
        );
    }

    protected function formatMethodBadge($method) {
        // Return default badge if method is null
        if ($method === null) {
            return '<span class="npm-badge method-unknown">-</span>';
        }
        
        $method = strtoupper($method);
        return sprintf(
            '<span class="npm-badge method-%s">%s</span>',
            strtolower($method),
            htmlspecialchars($method)
        );
    }

    protected function formatProtocolBadge($protocol) {
        return sprintf(
            '<span class="npm-badge protocol-%s">%s</span>',
            strtolower($protocol),
            htmlspecialchars($protocol)
        );
    }

    protected function formatGzipBadge($gzip) {
        $class = $gzip === '-' ? 'disabled' : 'enabled';
        return sprintf(
            '<span class="npm-badge gzip-%s">%s</span>',
            $class,
            htmlspecialchars($gzip)
        );
    }

    /**
     * Format a request badge
     * 
     * @param string $method HTTP method
     * @param string $path Request path
     * @return string Formatted badge
     */
    protected function formatRequestBadge($method, $path) {
        // Split request into method and path if needed
        if (strpos($method, ' ') !== false) {
            list($method, $path) = explode(' ', $method, 2);
        }
        
        return sprintf(
            '<span class="npm-badge method-%s">%s</span> <span class="npm-badge path">%s</span>',
            strtolower($method),
            htmlspecialchars($method),
            htmlspecialchars($path)
        );
    }

    public function getType() {
        return 'npm-default-host-' . $this->currentType;
    }

    public function getColumns($type = 'access') {
        $patternKey = 'npm-default-host-' . $type;
        $columns = $this->patterns[$patternKey]['columns'] ?? [];
        
        if ($this->debug) {
            $this->debugLog("Getting columns", [
                'current_type' => $this->currentType,
                'requested_type' => $type,
                'pattern_key' => $patternKey,
                'columns' => $columns
            ]);
        }
        return $columns;
    }

    protected function formatErrorCode($code) {
        return sprintf(
            '<span class="badge badge-danger">%s</span>',
            htmlspecialchars($code)
        );
    }

    public function format($matches) {
        if (!is_array($matches)) {
            return null;
        }

        // Format each field with appropriate badges
        $clientIp = $this->formatIpBadge($matches[1] ?? '-');
        $date = $this->formatDate($matches[2] ?? '-');
        $request = $this->formatRequestBadge($matches[3] ?? '-', $matches[4] ?? '-');
        $status = $this->formatStatusBadge($matches[5] ?? '-');
        $size = $this->formatSize($matches[6] ?? '-');
        $referer = $this->formatRefererBadge($matches[7] ?? '-');
        $userAgent = $this->formatUserAgentBadge($matches[8] ?? '-');

        return [
            'client_ip' => $clientIp,
            'date' => $date,
            'request' => $request,
            'status' => $status,
            'size' => $size,
            'referer' => $referer,
            'user_agent' => $userAgent
        ];
    }
} 