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
                'default_host_access' => isset($this->patterns['npm']['default_host_access']) ? 'exists' : 'missing',
                'default_host_error' => isset($this->patterns['npm']['default_host_error']) ? 'exists' : 'missing'
            ]);
        }
        
        // Initialize columns for access logs by default
        $this->columns = $this->patterns['npm']['default_host_access']['columns'] ?? [];
        
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
        $patternKey = 'default_host_' . $type;
        if (isset($this->patterns['npm'][$patternKey])) {
            $this->columns = $this->patterns['npm'][$patternKey]['columns'];
            if ($this->debug) {
                $this->debugLog("Columns updated successfully", [
                    'type' => $type,
                    'pattern_key' => $patternKey,
                    'columns' => $this->columns
                ]);
            }
        } else {
            if ($this->debug) {
                $this->debugLog("Pattern not found for type", [
                    'type' => $type,
                    'pattern_key' => $patternKey,
                    'available_patterns' => array_keys($this->patterns['npm'])
                ]);
            }
        }
    }

    protected function debugLog($message, $data = []) {
        if ($this->debug) {
            parent::debugLog($message, $data);
        }
    }

    public function parse($line, $type = 'access') {
        $line = trim($line);
        if (empty($line)) {
            return null;
        }

        $this->currentType = $type;
        $patternKey = 'default_host_' . $type;

        // Get pattern from configuration
        if (!isset($this->patterns['npm'][$patternKey]['pattern'])) {
            if ($this->debug) {
                $this->debugLog("Pattern not found", [
                    'type' => $type,
                    'pattern_key' => $patternKey,
                    'available_patterns' => array_keys($this->patterns['npm'])
                ]);
            }
            return null;
        }

        $pattern = $this->patterns['npm'][$patternKey]['pattern'];
        
        if (!preg_match($pattern, $line, $matches)) {
            if ($this->debug) {
                $this->debugLog("Pattern match failed", [
                    'line' => $line,
                    'pattern' => $pattern
                ]);
            }
            return null;
        }

        return $type === 'access' ? $this->parseAccessLog($matches) : $this->parseErrorLog($matches, $line);
    }

    protected function parseAccessLog($matches) {
        if (!is_array($matches) || count($matches) < 8) {
            if ($this->debug) {
                $this->debugLog("Invalid matches array", [
                    'matches' => $matches
                ]);
            }
            return null;
        }

        // Format client IP with badge
        $clientIp = $this->formatIpBadge($matches[1] ?? '-');

        // Format date
        $date = $this->formatDate($matches[2] ?? '-');

        // Parse request line (METHOD PATH PROTOCOL)
        $request = $matches[3] ?? '-';
        $requestParts = explode(' ', $request, 3);
        $method = $requestParts[0] ?? '-';
        $path = $requestParts[1] ?? '-';
        $protocol = $requestParts[2] ?? '-';

        // Format request with method badge
        $formattedRequest = sprintf(
            '<span class="npm-badge method-%s">%s</span> <span class="npm-badge path">%s</span>',
            strtolower($method),
            htmlspecialchars($method),
            htmlspecialchars($path)
        );

        // Format status code with badge
        $status = $this->formatStatusBadge($matches[4] ?? '-');

        // Format size
        $size = $this->formatSize($matches[5] ?? '0');

        // Format referer with badge
        $referer = $this->formatRefererBadge($matches[6] ?? '-');

        // Format user agent with badge
        $userAgent = $this->formatUserAgentBadge($matches[7] ?? '-');

        return [
            'client_ip' => $clientIp,
            'date' => $date,
            'request' => $formattedRequest,
            'status' => $status,
            'size' => $size,
            'referer' => $referer,
            'user_agent' => $userAgent
        ];
    }

    protected function parseErrorLog($matches, $line) {
        if (!is_array($matches) || count($matches) < 11) {
            if ($this->debug) {
                $this->debugLog("Invalid matches array for error log", [
                    'matches' => $matches,
                    'line' => $line
                ]);
            }
            return null;
        }

        // Format date
        $date = $this->formatDate($matches[1] ?? '-');

        // Format error level
        $level = $this->formatErrorLevel($matches[2] ?? '-');

        // Format process ID and thread ID
        $pid = isset($matches[3]) ? sprintf(
            '<span class="npm-badge process">PID:%s</span>',
            htmlspecialchars($matches[3])
        ) : '-';

        $tid = isset($matches[4]) ? sprintf(
            '<span class="npm-badge thread">TID:%s</span>',
            htmlspecialchars($matches[4])
        ) : '-';

        // Format connection ID
        $connection = isset($matches[5]) ? sprintf(
            '<span class="npm-badge connection">#%s</span>',
            htmlspecialchars($matches[5])
        ) : '-';

        // Format message and error code
        $message = htmlspecialchars($matches[6] ?? '-');
        $errorCode = isset($matches[7]) ? sprintf(
            '<span class="npm-badge error">%s</span>',
            htmlspecialchars($matches[7])
        ) : '-';

        // Format client IP
        $clientIp = isset($matches[8]) ? $this->formatIpBadge($matches[8]) : '-';

        // Format server
        $server = isset($matches[9]) ? sprintf(
            '<span class="npm-badge server">%s</span>',
            htmlspecialchars($matches[9])
        ) : '-';

        // Format request
        $request = isset($matches[10]) ? $this->formatRequestBadge('GET', $matches[10]) : '-';

        // Format host
        $host = isset($matches[11]) ? $this->formatHostBadge($matches[11]) : '-';

        return [
            'date' => $date,
            'level' => $level,
            'pid' => $pid,
            'tid' => $tid,
            'connection' => $connection,
            'message' => $message,
            'error_code' => $errorCode,
            'client_ip' => $clientIp,
            'server' => $server,
            'request' => $request,
            'host' => $host
        ];
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
        return 'default_host_' . $this->currentType;
    }

    public function getColumns($type = null) {
        $type = $type ?? $this->currentType;
        $patternKey = 'default_host_' . $type;
        
        if (isset($this->patterns['npm'][$patternKey])) {
            $columns = $this->patterns['npm'][$patternKey]['columns'];
        } else {
            $columns = [];
            if ($this->debug) {
                $this->debugLog("Pattern not found for columns", [
                    'type' => $type,
                    'pattern_key' => $patternKey,
                    'available_patterns' => array_keys($this->patterns['npm'])
                ]);
            }
        }
        
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