<?php
require_once __DIR__ . '/BaseParser.php';

/**
 * Parser for Apache 404 Logs
 * Format: "%t %v %{Host}i %h %l %u \"%r\" %>s %b \"%{Referer}i\" \"%{User-Agent}i\" \"%{X-Forwarded-For}i\""
 */
class Apache404Parser extends BaseParser {
    
    protected $pattern;

    public function __construct() {
        parent::__construct();
        
        // Load pattern from configuration
        $patterns = require __DIR__ . '/../config/log_patterns.php';
        $this->pattern = $patterns['apache-404']['pattern'] ?? '/^\[([^\]]+)\] ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) "([^"]+)" (\d{3}) ([^ ]+) "([^"]*)" "([^"]*)" "([^"]*)"$/';
    }
    
    protected $columns = [
        'date' => [
            'name' => 'Date',
            'class' => 'column-date'
        ],
        'vhost' => [
            'name' => 'Virtual Host',
            'class' => 'column-vhost'
        ],
        'host_header' => [
            'name' => 'Host Header',
            'class' => 'column-host'
        ],
        'ip' => [
            'name' => 'IP',
            'class' => 'column-ip'
        ],
        'ident' => [
            'name' => 'Ident',
            'class' => 'column-ident'
        ],
        'user' => [
            'name' => 'User',
            'class' => 'column-user'
        ],
        'request' => [
            'name' => 'Request',
            'class' => 'column-request'
        ],
        'status' => [
            'name' => 'Status',
            'class' => 'column-status'
        ],
        'size' => [
            'name' => 'Size',
            'class' => 'column-size'
        ],
        'referer' => [
            'name' => 'Referer',
            'class' => 'column-referer'
        ],
        'user_agent' => [
            'name' => 'User-Agent',
            'class' => 'column-user-agent'
        ],
        'forwarded_for' => [
            'name' => 'X-Forwarded-For',
            'class' => 'column-forwarded-for'
        ]
    ];

    /**
     * Parse a single line of the 404 log
     * @param string $line The line to parse
     * @param string $type The type of log (default: '404')
     * @return array|null Parsed data or null if parsing fails
     */
    public function parse($line, $type = '404') {
        if (!preg_match($this->pattern, $line, $matches)) {
            return null;
        }

        // Extraire les composants
        $timestamp = $matches[1];
        $vhost = $matches[2];
        $host_header = $matches[3];
        $ip = $matches[4];
        $ident = $matches[5];
        $user = $matches[6];
        $request = $matches[7];
        $status = $matches[8];
        $size = $matches[9];
        $referer = $matches[10];
        $user_agent = $matches[11];
        $forwarded_for = $matches[12];

        // Parse request into method and path
        list($method, $path) = $this->parseRequest($request);

        // Construire le résultat avec les badges formatés
        $result = [
            'date' => parent::formatDate($timestamp),
            'vhost' => parent::formatHostBadge($vhost),
            'host_header' => parent::formatHostBadge($host_header),
            'ip' => parent::formatIpBadge($ip),
            'ident' => $ident === '-' ? '' : $ident,
            'user' => parent::formatUserBadge($user),
            'request' => parent::formatRequestBadge($method, $path),
            'status' => parent::formatStatusBadge($status),
            'size' => parent::formatSize($size),
            'referer' => parent::formatRefererBadge($referer),
            'user_agent' => parent::formatUserAgentBadge($user_agent),
            'forwarded_for' => parent::formatIpBadge($forwarded_for)
        ];

        // Appliquer les filtres si activés
        if ($this->filtersEnabled && $this->shouldFilter($result)) {
            return ['filtered' => true, 'reason' => 'filter_match'];
    }

        return $result;
        }

    /**
     * Parse HTTP request string into method and path
     */
    protected function parseRequest($request) {
        if (empty($request) || $request === '-') {
            return ['-', '-'];
        }

        $parts = explode(' ', $request);
        if (count($parts) >= 2) {
            return [$parts[0], $parts[1]];
        }
        
        return ['-', '-'];
    }

    /**
     * Returns the column definition
     * @param string $type The log type (always '404' for Apache 404 logs)
     * @return array The column definition
     */
    public function getColumns($type = '404') {
        return $this->columns;
    }

    public function getType() {
        return 'apache-404';
    }

    /**
     * Check if a log line should be filtered based on exclusion patterns
     * @param array $data The parsed log data
     * @return bool True if the line should be filtered
     */
    protected function shouldFilter($data) {
        if (!$this->filtersEnabled) {
            return false;
        }

        // Load filters from configuration
        $patterns = require __DIR__ . '/../config/log_patterns.php';
        $filters = $patterns['filters']['exclude'] ?? [];

        // Check IP filters
        if (!empty($filters['ips']) && isset($data['ip'])) {
            foreach ($filters['ips'] as $pattern) {
                if (preg_match($pattern, strip_tags($data['ip']))) {
                    return true;
                }
            }
        }

        // Check request filters
        if (!empty($filters['requests']) && isset($data['request'])) {
            foreach ($filters['requests'] as $pattern) {
                if (preg_match($pattern, strip_tags($data['request']))) {
                    return true;
                }
            }
        }

        // Check user agent filters
        if (!empty($filters['user_agents']) && isset($data['user_agent'])) {
            foreach ($filters['user_agents'] as $pattern) {
                if (preg_match($pattern, strip_tags($data['user_agent']))) {
                    return true;
                }
            }
        }

        // Check referer filters
        if (!empty($filters['referers']) && isset($data['referer'])) {
            foreach ($filters['referers'] as $pattern) {
                if (preg_match($pattern, strip_tags($data['referer']))) {
                    return true;
                }
            }
        }

        return false;
    }
} 