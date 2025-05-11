<?php
require_once __DIR__ . '/BaseParser.php';

/**
 * Parser for Apache Access Logs
 * Format: "%t %h %a %l %u %v \"%r\" %>s %O \"%{Referer}i\" \"%{User-Agent}i\""
 */
class ApacheAccessParser extends BaseParser {
    
    protected $pattern;
    protected $parserType = 'apache_access';

    public function __construct() {
        parent::__construct();
        $this->loadPattern();
    }

    /**
     * Load pattern from configuration
     */
    protected function loadPattern() {
        $patterns_file = file_exists(__DIR__ . '/../config/log_patterns.user.php')
            ? __DIR__ . '/../config/log_patterns.user.php'
            : __DIR__ . '/../config/log_patterns.php';
        $patterns = require $patterns_file;
        $this->pattern = $patterns['apache']['access']['pattern'] ?? 
            '/^\[([^\]]+)\] (\S+) (\S+) (\S+) (\S+) (\S+) "([^"]*)" (\d{3}) (\d+) "([^"]*)" "([^"]*)"$/';
        
        if ($this->debug) {
            $this->debugLog("Pattern loaded", ['pattern' => $this->pattern]);
        }
    }

    protected $columns = [
        'date' => [
            'name' => 'Date',
            'class' => 'column-date',
            'width' => '160px',
            'sortable' => true
        ],
        'host' => [
            'name' => 'Client Host',
            'class' => 'column-host',
            'width' => '140px',
            'sortable' => true
        ],
        'real_ip' => [
            'name' => 'Real IP',
            'class' => 'column-real-ip',
            'width' => '120px',
            'sortable' => true
        ],
        'ident' => [
            'name' => 'Ident',
            'class' => 'column-ident',
            'width' => '80px',
            'sortable' => true
        ],
        'user' => [
            'name' => 'User',
            'class' => 'column-user',
            'width' => '100px',
            'sortable' => true
        ],
        'vhost' => [
            'name' => 'Virtual Host',
            'class' => 'column-vhost',
            'width' => '140px',
            'sortable' => true
        ],
        'request' => [
            'name' => 'Request',
            'class' => 'column-request',
            'width' => '200px',
            'sortable' => true
        ],
        'status' => [
            'name' => 'Status',
            'class' => 'column-status',
            'width' => '80px',
            'sortable' => true
        ],
        'size' => [
            'name' => 'Size',
            'class' => 'column-size',
            'width' => '80px',
            'sortable' => true
        ],
        'referer' => [
            'name' => 'Referer',
            'class' => 'column-referer',
            'width' => '180px',
            'sortable' => true
        ],
        'user_agent' => [
            'name' => 'User-Agent',
            'class' => 'column-user-agent',
            'width' => 'auto',
            'sortable' => true
        ]
    ];

    /**
     * Parse a single line of the access log
     * @param string $line The line to parse
     * @param string $type The type of log (default: 'access')
     * @return array|null Parsed data or null if parsing fails
     */
    public function parse($line, $type = 'access') {
        if (!preg_match($this->pattern, $line, $matches)) {
            if ($this->debug) {
                $this->debugLog("Line does not match pattern", ['line' => $line]);
            }
            return null;
        }

        // Store raw values for filtering
        $rawData = [
            'ip' => $matches[3], // real_ip
            'request' => $matches[7],
            'user_agent' => $matches[11],
            'user' => $matches[5],
            'referer' => $matches[10],
            'host' => $matches[2],
            'status' => $matches[8],
            'method' => explode(' ', $matches[7])[0] ?? '-',
            'path' => explode(' ', $matches[7])[1] ?? '-'
        ];

        // Build result with formatted badges
        $result = [
            'date' => $this->formatDate($matches[1]),
            'host' => $this->formatHostBadge($matches[2]),
            'real_ip' => $this->formatIpBadge($matches[3]),
            'ident' => $matches[4] === '-' ? '' : $matches[4],
            'user' => $this->formatUserBadge($matches[5]),
            'vhost' => $this->formatHostBadge($matches[6]),
            'request' => $this->formatRequestBadge(...$this->parseRequest($matches[7])),
            'status' => $this->formatStatusBadge($matches[8]),
            'size' => $this->formatSize($matches[9]),
            'referer' => $this->formatRefererBadge($matches[10]),
            'user_agent' => $this->formatUserAgentBadge($matches[11]),
            // Raw data for filtering
            'raw' => $rawData
        ];

        // Apply filters if enabled
        if ($this->shouldFilter($result)) {
            if ($this->debug) {
                $this->debugLog("Line filtered", [
                    'line' => $line,
                    'raw_data' => $rawData
                ]);
            }
            return ['filtered' => true, 'reason' => 'filter_match'];
        }

        return $result;
    }

    /**
     * Parse HTTP request string into method and path
     * @param string $request The raw request string
     * @return array [method, path]
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
     * Enhanced referer badge with clickable links and truncation
     * @param string $referer The referer URL
     * @param int $length Maximum length before truncation
     * @return string Formatted HTML badge with clickable link
     */
    protected function formatRefererBadge($referer, $length = 50) {
        if ($referer === '-' || empty($referer)) {
            return '<span class="log-badge referer referer-empty">-</span>';
        }

        // Ensure the referer is properly escaped for security
        $escapedReferer = htmlspecialchars($referer, ENT_QUOTES);
        
        // Tronquer le texte affiché si nécessaire
        $displayText = $escapedReferer;
        if (mb_strlen($displayText) > $length) {
            $displayText = mb_substr($displayText, 0, $length) . '...';
        }
        
        return sprintf(
            '<span class="log-badge referer" title="%s"><a href="%s" target="_blank" rel="noopener noreferrer">%s</a></span>',
            $escapedReferer, // Tooltip avec l'URL complète
            $escapedReferer, // URL complète pour le lien
            $displayText    // Texte tronqué pour l'affichage
        );
    }

    /**
     * Returns the column definition
     * @param string $type The log type (always 'access' for Apache access logs)
     * @return array The column definition
     */
    public function getColumns($type = 'access') {
        return $this->columns;
    }

    /**
     * Get the pattern used by this parser
     * @return string The pattern
     */
    public function getPattern() {
        return $this->pattern;
    }

    public function getType() {
        return 'apache-access';
    }

    /**
     * Check if a log line should be filtered based on exclusion patterns
     * @param array $data The parsed log data
     * @return bool True if the line should be filtered
     */
    protected function shouldFilter($data) {
        if (!$this->filtersEnabled) {
            if ($this->debug) {
                $this->debugLog("Filters disabled", ['data' => $data]);
            }
            return false;
        }

        // Load filters from configuration
        $patterns = require __DIR__ . '/../config/config.user.php';
        $filters = $patterns['filters']['exclude'] ?? [];

        if ($this->debug) {
            $this->debugLog("Checking filters", [
                'filters_enabled' => $this->filtersEnabled,
                'available_filters' => array_keys($filters),
                'raw_data' => $data['raw'] ?? [],
                'host' => $data['raw']['host'] ?? 'unknown'
            ]);
        }

        // Check IP filters using raw data
        if (!empty($filters['ips']) && isset($data['raw']['ip'])) {
            $ip = $data['raw']['ip'];
            foreach ($filters['ips'] as $pattern) {
                if (preg_match($pattern, $ip)) {
                    if ($this->debug) {
                        $this->debugLog("IP filter match", [
                            'ip' => $ip,
                            'pattern' => $pattern,
                            'host' => $data['raw']['host'] ?? 'unknown',
                            'file' => basename($data['raw']['host'] ?? 'unknown')
                        ]);
                    }
                    return true;
                }
            }
        }

        // Check request filters
        if (!empty($filters['requests']) && isset($data['raw']['request'])) {
            $request = $data['raw']['request'];
            foreach ($filters['requests'] as $pattern) {
                if (preg_match($pattern, $request)) {
                    if ($this->debug) {
                        $this->debugLog("Request filter match", [
                            'request' => $request,
                            'pattern' => $pattern,
                            'host' => $data['raw']['host'] ?? 'unknown',
                            'file' => basename($data['raw']['host'] ?? 'unknown')
                        ]);
                    }
                    return true;
                }
            }
        }

        // Check user agent filters
        if (!empty($filters['user_agents']) && isset($data['raw']['user_agent'])) {
            $userAgent = $data['raw']['user_agent'];
            foreach ($filters['user_agents'] as $pattern) {
                if (preg_match($pattern, $userAgent)) {
                    if ($this->debug) {
                        $this->debugLog("User-Agent filter match", [
                            'user_agent' => $userAgent,
                            'pattern' => $pattern,
                            'host' => $data['raw']['host'] ?? 'unknown',
                            'file' => basename($data['raw']['host'] ?? 'unknown')
                        ]);
                    }
                    return true;
                }
            }
        }

        // Check user filters
        if (!empty($filters['users']) && isset($data['raw']['user'])) {
            $user = $data['raw']['user'];
            foreach ($filters['users'] as $pattern) {
                if (preg_match($pattern, $user)) {
                    if ($this->debug) {
                        $this->debugLog("User filter match", [
                            'user' => $user,
                            'pattern' => $pattern,
                            'host' => $data['raw']['host'] ?? 'unknown',
                            'file' => basename($data['raw']['host'] ?? 'unknown')
                        ]);
                    }
                    return true;
                }
            }
        }

        // Check referer filters
        if (!empty($filters['referers']) && isset($data['raw']['referer'])) {
            $referer = $data['raw']['referer'];
            foreach ($filters['referers'] as $pattern) {
                if (preg_match($pattern, $referer)) {
                    if ($this->debug) {
                        $this->debugLog("Referer filter match", [
                            'referer' => $referer,
                            'pattern' => $pattern,
                            'host' => $data['raw']['host'] ?? 'unknown',
                            'file' => basename($data['raw']['host'] ?? 'unknown')
                        ]);
                    }
                    return true;
                }
            }
        }

        if ($this->debug) {
            $this->debugLog("No filter match", [
                'data' => $data['raw'] ?? [],
                'host' => $data['raw']['host'] ?? 'unknown'
            ]);
        }

        return false;
    }
} 