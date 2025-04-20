<?php
require_once __DIR__ . '/BaseParser.php';

/**
 * Parser for Apache 404 logs
 */
class Apache404Parser extends BaseParser {
    protected $pattern;
    protected $debug = false;
    protected $patterns;

    public function __construct() {
        parent::__construct();
        
        // Load configuration
        $config = require __DIR__ . '/../config/config.php';
        $this->debug = $config['debug']['enabled'] ?? false;
        
        // Load patterns
        $this->patterns = require __DIR__ . '/../config/log_patterns.php';
        
        // Use apache-404 instead of apache.404_only
        if (!isset($this->patterns['apache-404'])) {
            throw new Exception("Configuration for apache-404 not found in log_patterns.php");
        }
        
        $this->pattern = $this->patterns['apache-404']['pattern'];
        $this->columns = $this->patterns['apache-404']['columns'];
        
        $this->debugLog("Initialized with pattern", ['pattern' => $this->pattern]);
        $this->debugLog("Columns configuration", ['columns' => $this->columns]);
    }

    /**
     * Parse a log line
     * @param string $line The log line to parse
     * @param string $type Not used for 404 logs
     * @return array|null Parsed and formatted data or null if parsing fails
     */
    public function parse($line, $type = null) {
        $line = trim($line);
        if (empty($line)) {
            return null;
        }

        $this->debugLog("Parsing 404 log line", ['line' => $line]);

        if (!preg_match($this->pattern, $line, $matches)) {
            $this->debugLog("Line does not match pattern");
            return null;
        }

        // Extract raw data for filtering
        $rawData = [
            'host' => $matches[1],
            'ip' => $matches[3],
            'real_ip' => $matches[4],
            'date' => $matches[5],
            'request' => $matches[6],
            'size' => $matches[7],
            'referer' => $matches[8] ?? '-',
            'user_agent' => $matches[9] ?? '-'
        ];

        // Apply filters before formatting
        if ($this->filtersEnabled && $this->shouldFilter($rawData)) {
            $this->debugLog("Line filtered", ['data' => $rawData]);
            return null;
        }

        // Format each field with appropriate badges
        $host = parent::formatHostBadge($rawData['host']);
        $ip = parent::formatIpBadge($rawData['ip']);
        $realIp = parent::formatIpBadge($rawData['real_ip']);
        $date = $this->formatDate($rawData['date']);
        
        // Split request into method and path
        $requestParts = explode(' ', $rawData['request'], 2);
        $method = $requestParts[0] ?? '';
        $path = $requestParts[1] ?? '';
        $request = $this->formatRequestBadge($method, $path);
        
        $size = $this->formatSize($rawData['size']);
        $referer = $this->formatReferer($rawData['referer']);
        $userAgent = $this->formatUserAgentBadge($rawData['user_agent']);

        return [
            'host' => $host,
            'ip' => $ip,
            'real_ip' => $realIp,
            'date' => $date,
            'request' => $request,
            'size' => $size,
            'referer' => $referer,
            'user_agent' => $userAgent
        ];
    }

    /**
     * Format a request badge with method and path
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

    protected function getUserClass($user) {
        if ($user === '-') return 'anonymous';
        if (preg_match('/^[0-9]+$/', $user)) return 'numeric';
        return 'named';
    }

    private function formatReferer($referer) {
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

    private function formatUserAgent($userAgent) {
        if ($userAgent === '-' || empty($userAgent)) {
            return '<span class="user-agent-badge empty">-</span>';
        }

        // Detect bot/crawler
        $isBot = preg_match('/(bot|crawler|spider|googlebot|bingbot|yahoo|duckduckbot)/i', $userAgent);
        
        return sprintf(
            '<span class="user-agent-badge%s" title="%s">%s</span>',
            $isBot ? ' bot' : '',
            htmlspecialchars($userAgent),
            htmlspecialchars($this->truncateUserAgent($userAgent))
        );
    }

    private function truncateUserAgent($userAgent, $length = 50) {
        if (strlen($userAgent) <= $length) {
            return $userAgent;
        }
        return substr($userAgent, 0, $length) . '...';
    }

    /**
     * Get columns configuration
     * @param string $type Not used for 404 logs as there is only one type
     * @return array Columns configuration
     */
    public function getColumns($type = 'access') {
        $this->debugLog("Getting columns", ['columns' => $this->columns]);
        return $this->columns;
    }

    protected function debugLog($message, $data = []) {
        if ($this->debug) {
            parent::debugLog($message, $data);
        }
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
            $ip = $data['ip'];
            foreach ($this->exclusionPatterns['ips'] as $pattern) {
                if (preg_match($pattern, $ip)) {
                    $this->debugLog("IP filtered", ['ip' => $ip, 'pattern' => $pattern]);
                    return true;
                }
            }
        }

        // Check request filters
        if (!empty($this->exclusionPatterns['requests'])) {
            $request = $data['request'];
            foreach ($this->exclusionPatterns['requests'] as $pattern) {
                if (preg_match($pattern, $request)) {
                    $this->debugLog("Request filtered", ['request' => $request, 'pattern' => $pattern]);
                    return true;
                }
            }
        }

        // Check user agent filters
        if (!empty($this->exclusionPatterns['user_agents'])) {
            $userAgent = $data['user_agent'];
            foreach ($this->exclusionPatterns['user_agents'] as $pattern) {
                if (preg_match($pattern, $userAgent)) {
                    $this->debugLog("User agent filtered", ['user_agent' => $userAgent, 'pattern' => $pattern]);
                    return true;
                }
            }
        }

        // Check referer filters
        if (!empty($this->exclusionPatterns['referers'])) {
            $referer = $data['referer'];
            foreach ($this->exclusionPatterns['referers'] as $pattern) {
                if (preg_match($pattern, $referer)) {
                    $this->debugLog("Referer filtered", ['referer' => $referer, 'pattern' => $pattern]);
                    return true;
                }
            }
        }

        return false;
    }
} 