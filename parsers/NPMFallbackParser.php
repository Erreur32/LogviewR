<?php
require_once __DIR__ . '/BaseNPMParser.php';

/**
 * Parser for NPM fallback logs
 * Handles both access and error logs
 */
class NPMFallbackParser extends BaseNPMParser {
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
        $this->columns = $this->patterns['npm']['fallback_access']['columns'] ?? [];
        
        if ($this->debug) {
            error_log("[DEBUG] NPMFallbackParser: Patterns loaded: " . print_r(array_keys($this->patterns['npm']), true));
            error_log("[DEBUG] NPMFallbackParser: Columns initialized: " . print_r($this->columns, true));
        }
    }

    public function setType($type) {
        $this->currentType = $type;
        // Update columns based on type
        $patternKey = 'fallback_' . $type;
        if (isset($this->patterns['npm'][$patternKey]['columns'])) {
            $this->columns = $this->patterns['npm'][$patternKey]['columns'];
            if ($this->debug) {
                error_log("[DEBUG] NPMFallbackParser: Columns updated for type: " . $type);
            }
        }
    }

    public function parse($line, $type = 'access') {
        $line = trim($line);
        if (empty($line)) {
            return null;
        }

        $this->currentType = $type;
        $patternKey = 'fallback_' . $type;

        // Get the appropriate pattern based on current type
        if (!isset($this->patterns['npm'][$patternKey]['pattern'])) {
            if ($this->debug) {
                error_log("[DEBUG] NPMFallbackParser: Pattern not found for type: " . $type);
                error_log("[DEBUG] NPMFallbackParser: Available patterns: " . print_r(array_keys($this->patterns['npm']), true));
            }
            return null;
        }

        $pattern = $this->patterns['npm'][$patternKey]['pattern'];
        
        // Try to match the line with our pattern
        if (!preg_match($pattern, $line, $matches)) {
            if ($this->debug) {
                error_log("[DEBUG] NPMFallbackParser: Line does not match pattern");
                error_log("[DEBUG] NPMFallbackParser: Line: " . $line);
                error_log("[DEBUG] NPMFallbackParser: Pattern: " . $pattern);
            }
            return null;
        }

        $result = $type === 'access' 
            ? $this->parseAccessLog($matches)
            : $this->parseErrorLog($matches, $line);

        // Apply filters if enabled
        if ($result && !isset($result['filtered']) && $this->shouldFilter($result)) {
            if ($this->debug) {
                error_log("[DEBUG] NPMFallbackParser: Entry filtered");
            }
            return ['filtered' => true, 'reason' => 'filter_match'];
        }

        return $result;
    }

    /**
     * Parse access log line
     * @param array $matches Matches from regex
     * @return array Parsed data
     */
    protected function parseAccessLog($matches) {
        // Format date
        $date = parent::formatDate($matches[1]);

        // Format status badges
        $status = parent::formatStatusBadge($matches[2]);
        $statusIn = $this->formatDefaultBadge($matches[3] ?? '-', 'status-in');

        // Format method and protocol
        $method = $this->formatMethodBadge($matches[4] ?? '-');
        $protocol = $this->formatProtocolBadge($matches[5] ?? '-');

        // Format host and request
        $host = parent::formatHostBadge($matches[6] ?? '-');
        $request = $this->formatRequestBadge($matches[4] ?? '-', $matches[6] ?? '-');

        // Format client IP and length
        $clientIp = parent::formatIpBadge($matches[7] ?? '-');
        $length = parent::formatSize($matches[8] ?? '0');

        // Format gzip
        $gzip = $this->formatGzipBadge($matches[9] ?? '-');

        // Format user agent and referer
        $userAgent = isset($matches[10]) ? parent::formatUserAgentBadge($matches[10]) : '-';
        $referer = isset($matches[11]) ? parent::formatRefererBadge($matches[11]) : '-';

        return [
            'date' => $date,
            'status' => $status,
            'status_in' => $statusIn,
            'method' => $method,
            'protocol' => $protocol,
            'host' => $host,
            'request' => $request,
            'client_ip' => $clientIp,
            'length' => $length,
            'gzip' => $gzip,
            'user_agent' => $userAgent,
            'referer' => $referer
        ];
    }

    /**
     * Parse error log line
     * @param array $matches Matches from regex
     * @param string $line Original log line
     * @return array Parsed data
     */
    protected function parseErrorLog($matches, $line) {
        // Format date
        $date = parent::formatDate($matches[1]);

        // Format error level
        $level = $this->formatErrorLevel($matches[2]);

        // Format process ID
        $pid = isset($matches[3]) ? sprintf(
            '<span class="npm-badge process">PID:%s</span>',
            htmlspecialchars($matches[3])
        ) : '-';

        // Format thread ID
        $tid = isset($matches[4]) ? sprintf(
            '<span class="npm-badge thread">TID:%s</span>',
            htmlspecialchars($matches[4])
        ) : '-';

        // Format message
        $message = htmlspecialchars($matches[5] ?? '-');

        return [
            'date' => $date,
            'level' => $level,
            'pid' => $pid,
            'tid' => $tid,
            'message' => $message
        ];
    }

    protected function formatErrorLevel($level) {
        $level = strtoupper($level);
        return sprintf(
            '<span class="npm-badge level-%s">%s</span>',
            strtolower($level),
            htmlspecialchars($level)
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

    /**
     * Format the request badge with method and path
     * @param string $method The HTTP method
     * @param string $path The request path
     * @return string HTML formatted badge
     */
    protected function formatRequestBadge($method, $path) {
        // Format method badge
        $methodClass = strtolower($method);
        $methodBadge = "<span class='npm-badge method-{$methodClass}'>{$method}</span>";
        
        // Format path badge
        $pathBadge = "<span class='npm-badge request'>{$path}</span>";
        
        return $methodBadge . ' ' . $pathBadge;
    }

    /**
     * Format a default badge for any value
     * @param string $value The value to format
     * @param string $class The CSS class to use
     * @return string HTML formatted badge
     */
    protected function formatDefaultBadge($value, $class) {
        return sprintf(
            '<span class="npm-badge %s">%s</span>',
            htmlspecialchars($class),
            htmlspecialchars($value)
        );
    }

    public function getType() {
        return 'npm-fallback';
    }

    /**
     * Get the pattern used by this parser
     * @return string The pattern
     */
    public function getPattern() {
        $patternKey = 'fallback_' . $this->currentType;
        return $this->patterns['npm'][$patternKey]['pattern'] ?? '';
    }

    /**
     * Get the columns configuration for the current type
     * @param string $type The log type (access, error)
     * @return array The columns configuration
     */
    public function getColumns($type = 'access') {
        // If type is provided, use it, otherwise use currentType
        $actualType = $type ?: $this->currentType;
        $patternKey = 'fallback_' . $actualType;
        
        if (isset($this->patterns['npm'][$patternKey]['columns'])) {
            $columns = $this->patterns['npm'][$patternKey]['columns'];
            if ($this->debug) {
                error_log("[DEBUG] NPMFallbackParser: Getting columns for type: " . $actualType);
            }
            return $columns;
        }
        
        if ($this->debug) {
            error_log("[DEBUG] NPMFallbackParser: No columns found for type: " . $actualType);
        }
        return [];
    }
} 