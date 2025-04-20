<?php
require_once __DIR__ . '/BaseParser.php';

/**
 * Parser for Apache referer logs
 */
class ApacheRefererParser extends BaseParser {
    protected $pattern;
    protected $patterns;
    protected $exclusionPatterns;
    protected $debug = false;  // Initialisation par défaut

    public function __construct() {
        parent::__construct();
        
        // Load configuration
        $config = require __DIR__ . '/../config/config.php';
        $this->debug = $config['debug']['enabled'] ?? false;
        
        // Load patterns
        $this->patterns = require __DIR__ . '/../config/log_patterns.php';
        
        // Use apache-referer instead of apache.referer
        if (!isset($this->patterns['apache-referer'])) {
            throw new Exception("Configuration for apache-referer not found in log_patterns.php");
        }
        
        $this->pattern = $this->patterns['apache-referer']['pattern'];
        $this->columns = $this->patterns['apache-referer']['columns'];
        
        // Load exclusion patterns
        $this->exclusionPatterns = $this->patterns['filters']['exclude'];
        
        if ($this->debug) {
            error_log("[DEBUG] ApacheRefererParser initialized with pattern: " . $this->pattern);
        }
    }

    /**
     * Parse a log line
     * @param string $line The log line to parse
     * @param string $type Not used for referer logs
     * @return array|null Parsed and formatted data or null if parsing fails
     */
    public function parse($line, $type = null) {
        $line = trim($line);
        if (empty($line)) {
            return null;
        }

        $this->debugLog("Parsing referer log line", ['line' => $line]);

        // Format: host:port ip - - [date] - -> target_host path
        if (!preg_match('/^([^:]+):(\d+)\s+([^\s]+)\s+-\s+-\s+\[([^\]]+)\]\s+-\s+->\s+([^\s]+)\s+([^\s]+)$/', $line, $matches)) {
            $this->debugLog("Line does not match pattern", ['line' => $line]);
            return null;
        }

        $this->debugLog("Line matches pattern", ['matches' => $matches]);

        // Extract data
        $host = $matches[1] . ':' . $matches[2];
        $ip = $matches[3];
        $date = $matches[4];
        $targetHost = $matches[5];
        $path = $matches[6];

        // Format request as "GET path HTTP/1.1"
        $request = "GET " . $path . " HTTP/1.1";

        // Format referer as "http://target_host/path"
        $referer = "http://" . $targetHost . $path;

        // Create raw data for filtering
        $rawData = [
            'host' => $host,
            'ip' => $ip,
            'date' => $date,
            'request' => $request,
            'referer' => $referer
        ];

        // Apply filters before formatting
        if ($this->filtersEnabled && $this->shouldFilter($rawData)) {
            $this->debugLog("Line filtered", ['data' => $rawData]);
            return null;
        }

        // Format each field with appropriate badges
        $hostBadge = parent::formatHostBadge($host);
        $ipBadge = parent::formatIpBadge($ip);
        $dateBadge = parent::formatDate($date);
        $requestBadge = parent::formatRequestBadge("GET", $path);
        $refererBadge = parent::formatRefererBadge($referer);

        return [
            'host' => $hostBadge,
            'ip' => $ipBadge,
            'date' => $dateBadge,
            'request' => $requestBadge,
            'referer' => $refererBadge
        ];
    }

    /**
     * Format a request badge
     * @param string $method HTTP method
     * @param string $path Request path
     * @return string Formatted badge HTML
     */
    protected function formatRequestBadge($method, $path) {
        return sprintf(
            '<span class="badge badge-%s">%s</span> <span class="badge badge-light">%s</span>',
            strtolower($method),
            htmlspecialchars($method),
            htmlspecialchars($path)
        );
    }

    /**
     * Format a referer badge
     * @param string $referer The referer URL
     * @return string Formatted badge HTML
     */
    protected function formatRefererBadge($referer) {
        if ($referer === '-' || empty($referer)) {
            return '<span class="referer-badge empty">-</span>';
        }

        // Check if it's a valid URL
        if (filter_var($referer, FILTER_VALIDATE_URL)) {
            $parsedUrl = parse_url($referer);
            $displayUrl = $parsedUrl['host'] . (isset($parsedUrl['path']) ? $parsedUrl['path'] : '');
            return sprintf(
                '<a href="%s" class="referer-badge" target="_blank" rel="noopener noreferrer">%s</a>',
                htmlspecialchars($referer),
                htmlspecialchars($displayUrl)
            );
        }

        return sprintf('<span class="referer-badge">%s</span>', htmlspecialchars($referer));
    }

    /**
     * Get columns configuration
     * @param string $type Not used for referer logs as there is only one type
     * @return array Columns configuration
     */
    public function getColumns($type = 'access') {
        return $this->columns;
    }

    /**
     * Get the current pattern used by the parser
     * @return string The pattern
     */
    public function getPattern() {
        return $this->pattern;
    }

    /**
     * Check if a log line should be filtered based on exclusion patterns
     * @param array $data The parsed log data
     * @return bool True if the line should be filtered
     */
    public function shouldFilter($data) {
        if (!$this->filtersEnabled) {
            return false;
        }

        $this->debugLog("Checking filters", ['data' => $data]);

        // Check IP filters
        if (!empty($this->exclusionPatterns['ips'])) {
            foreach ($this->exclusionPatterns['ips'] as $pattern) {
                if (preg_match($pattern, $data['ip'])) {
                    $this->debugLog("IP filtered", ['ip' => $data['ip'], 'pattern' => $pattern]);
                    return true;
                }
            }
        }

        // Check request filters
        if (!empty($this->exclusionPatterns['requests'])) {
            foreach ($this->exclusionPatterns['requests'] as $pattern) {
                if (preg_match($pattern, $data['request'])) {
                    $this->debugLog("Request filtered", ['request' => $data['request'], 'pattern' => $pattern]);
                    return true;
                }
            }
        }

        // Check referer filters
        if (!empty($this->exclusionPatterns['referers'])) {
            foreach ($this->exclusionPatterns['referers'] as $pattern) {
                if (preg_match($pattern, $data['referer'])) {
                    $this->debugLog("Referer filtered", ['referer' => $data['referer'], 'pattern' => $pattern]);
                    return true;
                }
            }
        }

        return false;
    }
} 