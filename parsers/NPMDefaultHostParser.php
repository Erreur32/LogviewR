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

    public function __construct($debug = null) {
        parent::__construct();
        
        // Load configuration
        $config = require __DIR__ . '/../config/config.php';
        $this->debug = $config['debug']['enabled'] ?? false;
        
        // Initialiser ParserFactory si ce n'est pas déjà fait
        ParserFactory::init();
        
        // Utiliser les patterns de ParserFactory
        $this->patterns = ParserFactory::getPatterns();
        
        // Initialize columns for access logs by default
        $this->columns = $this->patterns['npm']['default_host_access']['columns'] ?? [];
        
        if ($this->debug) {
            error_log("[DEBUG] NPMDefaultHostParser: Patterns loaded: " . print_r(array_keys($this->patterns['npm']), true));
            error_log("[DEBUG] NPMDefaultHostParser: Columns initialized: " . print_r($this->columns, true));
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
                error_log("[DEBUG] NPMDefaultHostParser: Pattern not found for type: " . $type);
                error_log("[DEBUG] NPMDefaultHostParser: Available patterns: " . print_r(array_keys($this->patterns['npm']), true));
            }
            return null;
        }

        $pattern = $this->patterns['npm'][$patternKey]['pattern'];
        
        if (!preg_match($pattern, $line, $matches)) {
            if ($this->debug) {
                error_log("[DEBUG] NPMDefaultHostParser: Line does not match pattern");
                error_log("[DEBUG] NPMDefaultHostParser: Line: " . $line);
                error_log("[DEBUG] NPMDefaultHostParser: Pattern: " . $pattern);
            }
            return null;
        }

        $result = $type === 'access' ? $this->parseAccessLog($matches) : $this->parseErrorLog($matches, $line);

        // Apply filters if enabled
        if ($result && !isset($result['filtered']) && $this->shouldFilter($result)) {
            if ($this->debug) {
                error_log("[DEBUG] NPMDefaultHostParser: Entry filtered");
            }
            return ['filtered' => true, 'reason' => 'filter_match'];
        }

        return $result;
    }

    protected function parseAccessLog($matches) {
        // Store raw values for filtering
        $rawData = [
            'ip' => $matches[7] ?? '-',
            'request' => $matches[6] ?? '-',
            'user_agent' => $matches[10] ?? '-',
            'host' => $matches[6] ?? '-',
            'status' => $matches[2] ?? '-',
            'method' => $matches[4] ?? '-',
            'protocol' => $matches[5] ?? '-',
            'referer' => $matches[11] ?? '-'
        ];

        // Check if this entry should be filtered
        if ($this->shouldFilter(['raw' => $rawData])) {
            if ($this->debug) {
                $this->debugLog("Entry filtered", ['raw_data' => $rawData]);
            }
            return ['filtered' => true, 'reason' => 'filter_match'];
        }

        return [
            'date' => parent::formatDate($matches[1]),
            'status' => parent::formatStatusBadge($matches[2]),
            'status_in' => $this->formatDefaultBadge($matches[3] ?? '-', 'status-in'),
            'method' => $this->formatMethodBadge($matches[4] ?? '-'),
            'protocol' => $this->formatProtocolBadge($matches[5] ?? '-'),
            'host' => parent::formatHostBadge($matches[6] ?? '-'),
            'request' => $this->formatRequestBadge($matches[4] ?? '-', $matches[6] ?? '-'),
            'client_ip' => parent::formatIpBadge($matches[7] ?? '-'),
            'length' => parent::formatSize($matches[8] ?? '0'),
            'gzip' => $this->formatGzipBadge($matches[9] ?? '-'),
            'user_agent' => parent::formatUserAgentBadge($matches[10] ?? '-'),
            'referer' => parent::formatRefererBadge($matches[11] ?? '-'),
            // Raw data for filtering
            'raw' => $rawData
        ];
    }

    protected function parseErrorLog($matches, $line) {
        if (!is_array($matches) || count($matches) < 12) {
            if ($this->debug) {
                $this->debugLog("Invalid matches array for error log", [
                    'matches' => $matches,
                    'line' => $line,
                    'count' => count($matches)
                ]);
            }
            return null;
        }

        // Format date
        $date = $this->formatDate($matches[1] ?? '-');

        // Format error level
        $level = $this->formatErrorLevel($matches[2] ?? '-');

        // Format PID and TID
        $pid = sprintf('<span class="npm-badge process">PID:%s</span>', htmlspecialchars($matches[3] ?? '-'));
        $tid = sprintf('<span class="npm-badge thread">TID:%s</span>', htmlspecialchars($matches[4] ?? '-'));
        
        // Format connection ID
        $connection = sprintf('<span class="npm-badge connection">#%s</span>', htmlspecialchars($matches[5] ?? '-'));

        // Format message and error details
        $message = htmlspecialchars($matches[6] ?? '-');
        $errorDetails = htmlspecialchars($matches[7] . ' ' . $matches[8] ?? '-');

        // Format client, server, request and host
        $client = $this->formatIpBadge($matches[9] ?? '-');
        $server = $this->formatHostBadge($matches[10] ?? '-');
        $request = $this->formatRequestBadge('GET', $matches[11] ?? '-');
        $host = $this->formatHostBadge($matches[12] ?? '-');

        return [
            'date' => $date,
            'level' => $level,
            'pid' => $pid,
            'tid' => $tid,
            'connection' => $connection,
            'message' => $message,
            'error_details' => $errorDetails,
            'client' => $client,
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

    /**
     * Get the pattern used by this parser
     * @return string The pattern
     */
    public function getPattern() {
        $patternKey = 'default_host_' . $this->currentType;
        return $this->patterns['npm'][$patternKey]['pattern'] ?? '';
    }

    public function getType() {
        return 'npm-default-host';
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

    protected function formatDefaultBadge($value, $class = '') {
        if (empty($value) || $value === '-') {
            return sprintf('<span class="npm-badge %s empty">-</span>', $class);
        }
        return sprintf(
            '<span class="npm-badge %s">%s</span>',
            $class,
            htmlspecialchars($value)
        );
    }
} 