<?php
require_once __DIR__ . '/BaseParser.php';

/**
 * Parser for Apache Referer Logs
 * Format: "%t %v:%p %a %l %u %{Referer}i -> %V %U"
 */
class ApacheRefererParser extends BaseParser {
    
    protected $pattern;

    public function __construct() {
        parent::__construct();
        
        // Load pattern from configuration
        $patterns = require __DIR__ . '/../config/log_patterns.php';
        // Pattern adapté au format exact avec les espaces corrects
        $this->pattern = $patterns['apache-referer']['pattern'] ?? '/^\[([^\]]+)\] ([^:]+):(\d+) ([0-9.]+) ([^ ]+) ([^ ]+) ([^ ]+) -> ([^ ]+) ([^ ]+)$/';
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
        'port' => [
            'name' => 'Port',
            'class' => 'column-port'
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
        'target_host' => [
            'name' => 'Target Host',
            'class' => 'column-target-host'
        ],
        'referer' => [
            'name' => 'Referer',
            'class' => 'column-referer'
        ]
    ];

    /**
     * Parse a single line of the referer log
     * @param string $line The line to parse
     * @param string $type The type of log (default: 'referer')
     * @return array|null Parsed data or null if parsing fails
     */
    public function parse($line, $type = 'referer') {
        if (!preg_match($this->pattern, $line, $matches)) {
            return null;
        }

        // Extraire les composants
        $timestamp = $matches[1];
        $vhost = $matches[2];
        $port = $matches[3];
        $ip = $matches[4];  // Maintenant capturé correctement avec [0-9.]+
        $ident = $matches[5];
        $user = $matches[6];
        $request_uri = $matches[9];        
        $target_host = $matches[8];
        $referer = $matches[7];

        // Construire l'URL complète du referer si ce n'est pas "-"
        if ($referer !== '-') {
            // Si le referer ne commence pas par http:// ou https://, on ajoute http://
            if (!preg_match('/^https?:\/\//', $referer)) {
                $referer = 'http://' . $referer;
            }
        }

        // Construire le résultat avec les badges formatés
        $result = [
            'date' => parent::formatDate($timestamp),
            'vhost' => parent::formatHostBadge($vhost),
            'port' => sprintf('<span class="log-badge port">%s</span>', htmlspecialchars($port)),
            'ip' => parent::formatIpBadge($ip),
            'ident' => $ident === '-' ? '' : htmlspecialchars($ident),
            'user' => parent::formatUserBadge($user),
            'request' => parent::formatRequestBadge('GET', $request_uri),            
            'target_host' => parent::formatHostBadge($target_host),
            'referer' => parent::formatRefererBadge($referer)
        ];

        // Appliquer les filtres si activés
        if ($this->filtersEnabled && $this->shouldFilter($result)) {
            return ['filtered' => true, 'reason' => 'filter_match'];
        }

        return $result;
    }

    /**
     * Returns the column definition
     * @param string $type The log type (always 'referer' for Apache referer logs)
     * @return array The column definition
     */
    public function getColumns($type = 'referer') {
        return $this->columns;
    }

    public function getType() {
        return 'apache-referer';
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