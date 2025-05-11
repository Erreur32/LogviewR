<?php
require_once __DIR__ . '/BaseNPMParser.php';

/**
 * NPM Let's Encrypt Parser
 * Handles parsing of Let's Encrypt request logs from Nginx Proxy Manager
 */
class NPMLetsEncryptParser extends BaseNPMParser {
    public function __construct() {
        parent::__construct();
        // Load patterns and columns from configuration
        $patterns_file = file_exists(__DIR__ . '/../config/log_patterns.user.php')
            ? __DIR__ . '/../config/log_patterns.user.php'
            : __DIR__ . '/../config/log_patterns.php';
        $this->patterns = require $patterns_file;

        // Initialize columns for access logs by default
        $this->columns = $this->patterns['npm']['letsencrypt_access']['columns'] ?? [];
    }

    /**
     * Parse a single line of Let's Encrypt log
     * Format: [17/Mar/2025:15:34:01 +0100] 200 - GET http test.myoueb.fr "/.well-known/acme-challenge/T8hl0NbNcxiKtBoSkTX_4VWd80YJFkeRlQjubkzlfQ4" [Client 172.69.23.110] [Length 87] [Gzip -] "Mozilla/5.0 (compatible; Let's Encrypt validation server; +https://www.letsencrypt.org)" "-"
     *
     * @param string $line The log line to parse
     * @return array|null Parsed data or null if parsing failed
     */
    public function parse($line) {
        $pattern = $this->getPattern('letsencrypt_requests_access');
        if (preg_match($pattern, $line, $matches)) {
            return [
                'date' => $this->formatDateBadge($matches[1]),
                'status' => $this->formatStatusBadge($matches[2]),
                'method' => $this->formatMethodBadge($matches[3]),
                'protocol' => $this->formatProtocolBadge($matches[4]),
                'host' => $this->formatHostBadge($matches[5]),
                'request' => $this->formatRequestBadge($matches[6]),
                'client_ip' => $this->formatIPBadge($matches[7]),
                'length' => $this->formatLengthBadge($matches[8]),
                'gzip' => $this->formatGzipBadge($matches[9]),
                'user_agent' => $this->formatUserAgentBadge($matches[10]),
                'referer' => $this->formatRefererBadge($matches[11])
            ];
        }
        return null;
    }
    
    /**
     * Extract client IP from [Client X.X.X.X] format
     *
     * @param string $clientString
     * @return string
     */
    private function extractClientIP($clientString) {
        return trim($clientString);
    }
    
    /**
     * Parse the length value
     *
     * @param string $length
     * @return string
     */
    private function parseLength($length) {
        return trim($length);
    }
    
    /**
     * Parse the date from NPM format to timestamp
     *
     * @param string $date
     * @return int
     */
    private function parseDate($date) {
        // Remove brackets if present
        $date = trim($date, '[]');
        // Parse the date using the NPM format
        $timestamp = strtotime($date);
        return $timestamp;
    }

    /**
     * Format method badge
     * @param string $method
     * @return string
     */
    protected function formatMethodBadge($method) {
        $method = strtoupper($method);
        return sprintf(
            '<span class="npm-badge method-%s">%s</span>',
            strtolower($method),
            htmlspecialchars($method)
        );
    }

    /**
     * Format protocol badge
     * @param string $protocol
     * @return string
     */
    protected function formatProtocolBadge($protocol) {
        return sprintf(
            '<span class="npm-badge protocol-%s">%s</span>',
            strtolower($protocol),
            htmlspecialchars($protocol)
        );
    }

    /**
     * Format gzip badge
     * @param string $gzip
     * @return string
     */
    protected function formatGzipBadge($gzip) {
        $class = $gzip === '-' ? 'disabled' : 'enabled';
        return sprintf(
            '<span class="npm-badge gzip-%s">%s</span>',
            $class,
            htmlspecialchars($gzip)
        );
    }

    /**
     * Format request badge with method and path
     * @param string $method
     * @param string $path
     * @return string
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
     * Get the type of parser
     * @return string
     */
    public function getType() {
        return 'letsencrypt_requests_access';
    }
} 