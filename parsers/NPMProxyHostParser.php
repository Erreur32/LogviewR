<?php
require_once __DIR__ . '/BaseNPMParser.php';

/**
 * NPMProxyHostParser - Parser for NPM proxy host logs
 * 
 * This parser handles both access and error logs for NPM proxy hosts.
 */
class NPMProxyHostParser extends BaseNPMParser {
    protected $pattern;
    protected $currentType = 'access';
    protected $patterns;
    protected $parserType = 'npm_proxy';

    /**
     * Constructor
     */
    public function __construct() {
        parent::__construct();
        
        // Initialiser ParserFactory si ce n'est pas déjà fait
        ParserFactory::init();
        
        // Utiliser les patterns de ParserFactory
        $this->patterns = ParserFactory::getPatterns();
        
        // Initialize columns for access logs by default
        $this->columns = $this->patterns['npm']['proxy_host_access']['columns'] ?? [];
        
        if ($this->debug) {
            error_log("[DEBUG] NPMProxyHostParser: Patterns loaded: " . print_r(array_keys($this->patterns['npm']), true));
            error_log("[DEBUG] NPMProxyHostParser: Columns initialized: " . print_r($this->columns, true));
        }
    }

    /**
     * Load patterns from configuration
     */
    protected function loadPatterns() {
        $patterns_file = file_exists(__DIR__ . '/../config/log_patterns.user.php')
            ? __DIR__ . '/../config/log_patterns.user.php'
            : __DIR__ . '/../config/log_patterns.php';
        $this->patterns = require $patterns_file;

        if ($this->debug) {
            $this->debugLog("Patterns loaded", [
                'npm_patterns' => array_keys($this->patterns['npm'] ?? [])
            ]);
        }

        // Initialize columns for access logs by default
        $this->initializeColumns('access');
    }

    /**
     * Initialize columns for the specified type
     */
    protected function initializeColumns($type) {
        $patternKey = 'proxy_host_' . $type;
        if (isset($this->patterns['npm'][$patternKey]['columns'])) {
            $this->columns = $this->patterns['npm'][$patternKey]['columns'];
            if ($this->debug) {
                $this->debugLog("Columns initialized", [
                    'type' => $type,
                    'columns' => array_keys($this->columns)
                ]);
            }
        }
    }

    /**
     * Set the type of log being parsed
     * 
     * @param string $type Type of log (access or error)
     */
    public function setType($type) {
        $this->currentType = $type;
        $patternKey = 'proxy_host_' . $type;
        
        if ($this->debug) {
            $this->debugLog("Setting type", [
                'type' => $type,
                'pattern_key' => $patternKey
            ]);
        }

        // Update columns based on type
        $this->getColumns($type);
    }

    /**
     * Get the type prefix for this parser
     */
    public function getType() {
        return 'npm-proxy-host';
    }

    /**
     * Get the pattern used by this parser
     * @return string The pattern
     */
    public function getPattern() {
        $patternKey = 'proxy_host_' . $this->currentType;
        return $this->patterns['npm'][$patternKey]['pattern'] ?? '';
    }

    /**
     * Get columns configuration
     * 
     * @param string $type Type of log (access or error)
     * @return array Columns configuration
     */
    public function getColumns($type = 'access') {
        $this->currentType = $type;
        $patternKey = 'proxy_host_' . $type;
        
        if (isset($this->patterns['npm'][$patternKey]['columns'])) {
            $this->columns = $this->patterns['npm'][$patternKey]['columns'];
            if ($this->debug) {
                $this->debugLog("Columns loaded for type", [
                    'type' => $type,
                    'pattern_key' => $patternKey,
                    'columns' => $this->columns
                ]);
            }
            return $this->columns;
        }
        
        if ($this->debug) {
            $this->debugLog("No columns found for type", [
                'type' => $type,
                'pattern_key' => $patternKey,
                'available_patterns' => array_keys($this->patterns['npm'])
            ]);
        }
        return [];
    }

    /**
     * Format a default badge with custom class
     * 
     * @param string $value The value to display
     * @param string $class Additional CSS class
     * @return string Formatted badge HTML
     */
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

    /**
     * Parse a line from the log file
     */
    public function parse($line, $type = 'access') {
        $line = trim($line);
        if (empty($line)) {
            return null;
        }

        $this->currentType = $type;
        $patternKey = 'proxy_host_' . $type;
        
        // Get the appropriate pattern based on current type
        if (!isset($this->patterns['npm'][$patternKey]['pattern'])) {
            if ($this->debug) {
                error_log("[DEBUG] NPMProxyHostParser: Pattern not found for type: " . $type);
                error_log("[DEBUG] NPMProxyHostParser: Available patterns: " . print_r(array_keys($this->patterns['npm']), true));
            }
            return null;
        }

        $pattern = $this->patterns['npm'][$patternKey]['pattern'];
        
        // Try to match the line with our pattern
        if (!preg_match($pattern, $line, $matches)) {
            if ($this->debug) {
                error_log("[DEBUG] NPMProxyHostParser: Line does not match pattern");
                error_log("[DEBUG] NPMProxyHostParser: Line: " . $line);
                error_log("[DEBUG] NPMProxyHostParser: Pattern: " . $pattern);
            }
            return null;
        }

        $result = $type === 'access' 
            ? $this->parseAccessLog($matches)
            : $this->parseErrorLog($matches);

        // Apply filters if enabled
        if ($result && !isset($result['filtered']) && $this->shouldFilter($result)) {
            if ($this->debug) {
                error_log("[DEBUG] NPMProxyHostParser: Entry filtered");
            }
            return ['filtered' => true, 'reason' => 'filter_match'];
        }

        return $result;
    }

    /**
     * Parse an access log line
     */
    protected function parseAccessLog($matches) {
        if (!is_array($matches) || count($matches) < 16) {
            $this->debugLog("Invalid matches array for access log", [
                'matches_count' => count($matches)
            ]);
            return null;
        }

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

        $result = [
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

        return $result;
    }

    /**
     * Parse an error log line
     */
    protected function parseErrorLog($matches) {
        if (!is_array($matches) || count($matches) < 10) {
            $this->debugLog("Invalid matches array for error log", [
                'matches_count' => count($matches)
            ]);
            return null;
        }

        // Store raw values for filtering
        $rawData = [
            'ip' => $matches[7] ?? '-',
            'request' => $matches[9] ?? '-',
            'message' => $matches[6] ?? '-'
        ];

        $result = [
            'date' => $this->formatDate($matches[1] ?? '-'),
            'level' => $this->formatErrorLevel($matches[2] ?? '-'),
            'pid' => sprintf('<span class="npm-badge process">PID:%s</span>', htmlspecialchars($matches[3] ?? '-')),
            'tid' => sprintf('<span class="npm-badge thread">TID:%s</span>', htmlspecialchars($matches[4] ?? '-')),
            'connection' => sprintf('<span class="npm-badge connection">#%s</span>', htmlspecialchars($matches[5] ?? '-')),
            'message' => htmlspecialchars($matches[6] ?? '-'),
            'client' => $this->formatIpBadge($matches[7] ?? '-'),
            'server' => $this->formatHostBadge($matches[8] ?? '-'),
            'request' => $this->formatRequestBadge('GET', $matches[9] ?? '-'),
            'host' => $this->formatHostBadge($matches[10] ?? '-'),
            // Raw data for filtering
            'raw' => $rawData
        ];

        return $result;
    }
} 