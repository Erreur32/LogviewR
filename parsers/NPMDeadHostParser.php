<?php
require_once __DIR__ . '/BaseNPMParser.php';

/**
 * Parser for NPM dead-host logs
 * Handles both access and error logs
 */
class NPMDeadHostParser extends BaseNPMParser {
    protected $pattern;
    protected $currentType = 'access';
    protected $patterns;

    public function __construct() {
        parent::__construct();
        
        // Initialiser ParserFactory si ce n'est pas déjà fait
        ParserFactory::init();
        
        // Utiliser les patterns de ParserFactory
        $this->patterns = ParserFactory::getPatterns();
        
        // Initialize columns for access logs by default
        $this->columns = $this->patterns['npm']['dead_host_access']['columns'] ?? [];
        
        if ($this->debug) {
            error_log("[DEBUG] NPMDeadHostParser: Patterns loaded: " . print_r(array_keys($this->patterns['npm']), true));
            error_log("[DEBUG] NPMDeadHostParser: Columns initialized: " . print_r($this->columns, true));
        }
    }

    public function setType($type) {
        $this->currentType = $type;
        // Update columns based on type
        $this->columns = $this->patterns['npm']['dead_host_' . $type]['columns'] ?? $this->columns;
    }

    public function parse($line, $type = 'access') {
        $line = trim($line);
        if (empty($line)) {
            return null;
        }

        // Get the appropriate pattern based on current type
        $patternKey = 'dead_host_' . $this->currentType;
        if (!isset($this->patterns['npm'][$patternKey]['pattern'])) {
            if ($this->debug) {
                error_log("[DEBUG] NPMDeadHostParser: Pattern not found for type: " . $type);
                error_log("[DEBUG] NPMDeadHostParser: Available patterns: " . print_r(array_keys($this->patterns['npm']), true));
            }
            return null;
        }

        $pattern = $this->patterns['npm'][$patternKey]['pattern'];
        
        // Try to match the line with our pattern
        if (!preg_match($pattern, $line, $matches)) {
            if ($this->debug) {
                error_log("[DEBUG] NPMDeadHostParser: Line does not match pattern");
                error_log("[DEBUG] NPMDeadHostParser: Line: " . $line);
                error_log("[DEBUG] NPMDeadHostParser: Pattern: " . $pattern);
            }
            return null;
        }

        $result = $this->currentType === 'access' 
            ? $this->parseAccessLog($matches)
            : $this->parseErrorLog($matches, $line);

        // Apply filters if enabled
        if ($result && !isset($result['filtered']) && $this->shouldFilter($result)) {
            if ($this->debug) {
                error_log("[DEBUG] NPMDeadHostParser: Entry filtered");
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
        // Format date
        $date = parent::formatDate($matches[1]);

        // Format error level
        $level = $this->formatErrorLevel($matches[2] ?? '-');

        // Format PID and TID
        $pid = $matches[3] ?? '-';
        $tid = $matches[4] ?? '-';
        $connection = $matches[5] ?? '-';

        // Format message and other components
        $message = $matches[6] ?? '-';
        $client = $matches[7] ?? '-';
        $server = $matches[8] ?? '-';
        $request = $matches[9] ?? '-';
        $host = $matches[10] ?? '-';

        return [
            'date' => $date,
            'level' => $level,
            'pid' => sprintf('<span class="npm-badge process">PID:%s</span>', htmlspecialchars($pid)),
            'tid' => sprintf('<span class="npm-badge thread">TID:%s</span>', htmlspecialchars($tid)),
            'connection' => sprintf('<span class="npm-badge connection">#%s</span>', htmlspecialchars($connection)),
            'message' => htmlspecialchars($message),
            'client' => parent::formatIpBadge($client),
            'server' => parent::formatHostBadge($server),
            'request' => $this->formatRequestBadge('GET', $request),
            'host' => parent::formatHostBadge($host)
        ];
    }

    public function getType() {
        return 'dead_host_' . $this->currentType;
    }

    /**
     * Get the columns configuration for the current type
     * @param string $type The log type (access, error)
     * @return array The columns configuration
     */
    public function getColumns($type = 'access') {
        // If type is provided, use it, otherwise use currentType
        $actualType = $type ?: $this->currentType;
        return $this->patterns['npm']['dead_host_' . $actualType]['columns'] ?? [];
    }

    /**
     * Format a value with a default badge style
     * @param string $value The value to format
     * @param string $class The CSS class to apply
     * @return string The formatted badge
     */
    protected function formatDefaultBadge($value, $class) {
        return sprintf(
            '<span class="npm-badge %s">%s</span>',
            htmlspecialchars($class),
            htmlspecialchars($value)
        );
    }

    protected function formatMethodBadge($method) {
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

    protected function formatRequestBadge($method, $path) {
        // Format method badge
        $methodClass = strtolower($method);
        $methodBadge = "<span class='npm-badge method-{$methodClass}'>{$method}</span>";
        
        // Format path badge
        $pathBadge = "<span class='npm-badge request'>{$path}</span>";
        
        return $methodBadge . ' ' . $pathBadge;
    }

    protected function formatErrorLevel($level) {
        return sprintf(
            '<span class="npm-badge level-%s">%s</span>',
            strtolower($level),
            htmlspecialchars($level)
        );
    }

    /**
     * Get the pattern used by this parser
     * @return string The pattern
     */
    public function getPattern() {
        $patternKey = 'dead_host_' . $this->currentType;
        return $this->patterns['npm'][$patternKey]['pattern'] ?? '';
    }
} 