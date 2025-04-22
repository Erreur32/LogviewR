<?php
require_once __DIR__ . '/BaseParser.php';

/**
 * Parser for Apache Access Logs
 * Format: "%t %h %a %l %u %v \"%r\" %>s %O \"%{Referer}i\" \"%{User-Agent}i\""
 */
class ApacheAccessParser extends BaseParser {
    
    protected $pattern;

    public function __construct() {
        parent::__construct();
        
        // Load pattern from configuration
        $patterns = require __DIR__ . '/../config/log_patterns.php';
        $this->pattern = $patterns['apache']['access']['pattern'] ?? '/^\[([^\]]+)\] (\S+) (\S+) (\S+) (\S+) (\S+) "([^"]*)" (\d{3}) (\d+) "([^"]*)" "([^"]*)"$/';
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
            return null;
        }

        // Extraire les composants
        $timestamp = $matches[1];
        $host = $matches[2];
        $real_ip = $matches[3];
        $ident = $matches[4];
        $user = $matches[5];
        $vhost = $matches[6];
        $request = $matches[7];
        $status = $matches[8];
        $size = $matches[9];
        $referer = $matches[10];
        $user_agent = $matches[11];

        // Parse request into method and path
        list($method, $path) = $this->parseRequest($request);

        // Formater la date
        $date = $this->formatDate($timestamp);

        // Construire le résultat avec les badges formatés
        $result = [
            'date' => $date,
            'host' => $this->formatHostBadge($host),
            'real_ip' => $this->formatIpBadge($real_ip),
            'ident' => $ident === '-' ? '' : $ident,
            'user' => $this->formatUserBadge($user),
            'vhost' => $this->formatHostBadge($vhost),
            'request' => $this->formatRequestBadge($method, $path),
            'status' => $this->formatStatusBadge($status),
            'size' => $this->formatSize($size),
            'referer' => $this->formatRefererBadge($referer),
            'user_agent' => $this->formatUserAgentBadge($user_agent)
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

    public function getType() {
        return 'apache-access';
    }
} 