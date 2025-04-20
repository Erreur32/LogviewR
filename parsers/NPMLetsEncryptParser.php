<?php

/**
 * NPM Let's Encrypt Parser
 * Handles parsing of Let's Encrypt request logs from Nginx Proxy Manager
 */
class NPMLetsEncryptParser extends BaseNPMParser {
    
    /**
     * Parse a single line of Let's Encrypt log
     * Format: [17/Mar/2025:15:34:01 +0100] 200 - GET http test.myoueb.fr "/.well-known/acme-challenge/T8hl0NbNcxiKtBoSkTX_4VWd80YJFkeRlQjubkzlfQ4" [Client 172.69.23.110] [Length 87] [Gzip -] "Mozilla/5.0 (compatible; Let's Encrypt validation server; +https://www.letsencrypt.org)" "-"
     *
     * @param string $line The log line to parse
     * @return array|false Parsed data or false if parsing failed
     */
    public function parse($line) {
        // Get the pattern from log_patterns.php
        $pattern = $this->getPattern('npm-letsencrypt-requests_access');
        
        if (preg_match($pattern, $line, $matches)) {
            return array(
                'date' => $this->parseDate($matches[1]),
                'status' => $matches[2],
                'method' => $matches[3],
                'protocol' => $matches[4],
                'host' => $matches[5],
                'request' => $matches[6],
                'client_ip' => $this->extractClientIP($matches[7]),
                'length' => $this->parseLength($matches[8]),
                'gzip' => $matches[9],
                'user_agent' => $matches[10],
                'referer' => $matches[11]
            );
        }
        
        return false;
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
} 