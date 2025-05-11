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
        $patterns_file = file_exists(__DIR__ . '/../config/log_patterns.user.php')
            ? __DIR__ . '/../config/log_patterns.user.php'
            : __DIR__ . '/../config/log_patterns.php';
        $patterns = require $patterns_file;
        $this->pattern = $patterns['apache-404']['pattern'] ?? '/^\[([^\]]+)\] ([^\s]+) ([^\s]+) ([\d\.]+) (\S+) (\S+) "([^"]+)" (\d{3}) (\d+) "([^"]*)" "([^"]*)" "([^"]*)"$/';
 
        if ($this->debug) {
            $this->debugLog("Pattern loaded", ['pattern' => $this->pattern]);
        }
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
     * Parse a line of log
     * @param string $line The line to parse
     * @return array|null The parsed data or null if parsing failed
     */
    public function parse($line) {
        if (!preg_match($this->pattern, $line, $matches)) {
            return null;
        }

        // Extract components from matches
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

        // Format the result using parent methods
        $result = [
            'date' => $this->formatDate($timestamp),
            'vhost' => $this->formatHostBadge($vhost),
            'host_header' => $this->formatHostBadge($host_header),
            'ip' => $this->formatIpBadge($ip),
            'ident' => $ident === '-' ? '' : $ident,
            'user' => $this->formatUserBadge($user),
            'request' => $this->formatRequestBadge($method, $path),
            'status' => $this->formatStatusBadge($status),
            'size' => $this->formatSize($size),
            'referer' => $this->formatRefererBadge($referer),
            'user_agent' => $this->formatUserAgentBadge($user_agent),
            'forwarded_for' => $this->formatIpBadge($forwarded_for)
        ];

        // Apply filters if enabled
        if ($this->shouldFilter($result)) {
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
     * Get the pattern used by this parser
     * @return string The pattern
     */
    public function getPattern() {
        return $this->pattern;
    }
} 