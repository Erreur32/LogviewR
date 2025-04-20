<?php
require_once __DIR__ . '/BaseNPMParser.php';

/**
 * Parser for NPM dead-host logs
 * Handles both access and error logs
 */
class NPMDeadHostParser extends BaseNPMParser {
    protected $pattern;
    protected $currentType = 'access';
    protected $patterns;
    protected $excludedIps = [];
    protected $excludedRequests = [];
    protected $excludedUserAgents = [];
    protected $excludedUsers = [];

    public function __construct() {
        parent::__construct();
        
        // Load configuration
        $config = require __DIR__ . '/../config/config.php';
        
        // Load patterns and columns from configuration
        $this->patterns = require __DIR__ . '/../config/log_patterns.php';
        
        // Initialize columns for access logs by default
        $this->columns = $this->patterns['npm-dead-host-access']['columns'];
        
        // Load exclusion filters
        if (isset($this->patterns['filters']['exclude'])) {
            $this->excludedIps = $this->patterns['filters']['exclude']['ips'] ?? [];
            $this->excludedRequests = $this->patterns['filters']['exclude']['requests'] ?? [];
            $this->excludedUserAgents = $this->patterns['filters']['exclude']['user_agents'] ?? [];
            $this->excludedUsers = $this->patterns['filters']['exclude']['users'] ?? [];
        }
    }

    public function setType($type) {
        $this->currentType = $type;
        // Update columns based on type
        $this->columns = $this->patterns['npm-dead-host-' . $type]['columns'] ?? $this->columns;
    }

    public function parse($line, $type = 'access') {
        $line = trim($line);
        if (empty($line)) {
            return null;
        }

        // Add debug logging
        $this->debugLog("Current type", ['type' => $this->currentType]);
        $this->debugLog("Input line", ['line' => $line]);

        // Get the appropriate pattern based on current type
        $pattern = $this->patterns['npm-dead-host-' . $this->currentType]['pattern'];
        $this->debugLog("Using pattern", ['pattern' => $pattern]);
        
        // Try to match the line with our pattern
        if (!preg_match($pattern, $line, $matches)) {
            $this->debugLog("No match found for line");
            return null;
        }

        $this->debugLog("Matches found", ['matches' => $matches]);

        return $this->currentType === 'access' 
            ? $this->parseAccessLog($matches)
            : $this->parseErrorLog($matches, $line);
    }

    protected function parseAccessLog($matches) {
        // Séparer la requête en méthode et chemin
        $request = $matches[6] ?? '-';
        $requestParts = explode(' ', trim($request), 2);
        $requestMethod = $requestParts[0] ?? $matches[3] ?? '-';  // Utiliser la méthode du log si disponible
        $requestPath = $requestParts[1] ?? '-';

        return [
            'date' => parent::formatDate($matches[1]),
            'status' => parent::formatStatusBadge($matches[2]),
            'method' => $this->formatMethodBadge($requestMethod),
            'protocol' => $this->formatProtocolBadge($matches[4] ?? '-'),
            'host' => parent::formatHostBadge($matches[5] ?? '-'),
            'request' => $this->formatRequestBadge($requestMethod, $requestPath),
            'client_ip' => parent::formatIpBadge($matches[7] ?? '-'),
            'length' => parent::formatSize($matches[8] ?? '0'),
            'gzip' => $this->formatGzipBadge($matches[9] ?? '-'),
            'user_agent' => isset($matches[10]) ? parent::formatUserAgentBadge($matches[10]) : '-',
            'referer' => isset($matches[11]) ? parent::formatRefererBadge($matches[11]) : '-'
        ];
    }

    protected function parseErrorLog($matches, $line) {
        // Format date
        $date = parent::formatDate($matches[1]);

        // Format error level
        $level = $this->formatErrorLevel($matches[2] ?? '-');

        // Format process ID
        $pid = isset($matches[3]) ? sprintf(
            '<span class="npm-badge process">PID:%s</span>',
            htmlspecialchars($matches[3])
        ) : '-';

        // Format connection ID
        $connection = isset($matches[4]) ? sprintf(
            '<span class="npm-badge connection">#%s</span>',
            htmlspecialchars($matches[4])
        ) : '-';

        // Format message
        $message = htmlspecialchars($matches[5] ?? '-');

        // Format client and server
        $client = isset($matches[6]) ? parent::formatIpBadge($matches[6]) : '-';
        $server = isset($matches[7]) ? parent::formatIpBadge($matches[7]) : '-';

        // Format request and host
        $request = isset($matches[8]) ? sprintf(
            '<span class="npm-badge request">%s</span>',
            htmlspecialchars($matches[8])
        ) : '-';
        $host = isset($matches[9]) ? parent::formatHostBadge($matches[9]) : '-';

        return [
            'date' => $date,
            'level' => $level,
            'process' => $pid,
            'connection' => $connection,
            'message' => $message,
            'client' => $client,
            'server' => $server,
            'request' => $request,
            'host' => $host
        ];
    }

    public function getType() {
        return 'npm-dead-host-' . $this->currentType;
    }

    /**
     * Get the columns configuration for the current type
     * @param string $type The log type (access, error)
     * @return array The columns configuration
     */
    public function getColumns($type = 'access') {
        // If type is provided, use it, otherwise use currentType
        $actualType = $type ?: $this->currentType;
        return $this->patterns['npm-dead-host-' . $actualType]['columns'] ?? [];
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

    protected function formatRequestBadge($method, $path) {
        // Format method badge
        $methodClass = strtolower($method);
        $methodBadge = "<span class='npm-badge method-{$methodClass}'>{$method}</span>";
        
        // Format path badge
        $pathBadge = "<span class='npm-badge request'>{$path}</span>";
        
        return $methodBadge . ' ' . $pathBadge;
    }

    protected function formatErrorLevel($level) {
        $level = strtoupper($level);
        return sprintf(
            '<span class="npm-badge level-%s">%s</span>',
            strtolower($level),
            htmlspecialchars($level)
        );
    }
} 