<?php
require_once __DIR__ . '/BaseParser.php';

class ApacheErrorParser extends BaseParser {
    private $errorLogPattern;
    private $debugLogPattern;
    protected $debug = false;

    public function __construct() {
        parent::__construct();
        
        // Load configuration
        $config = require __DIR__ . '/../config/config.php';
        $this->debug = $config['debug']['enabled'] ?? false;
        
        // Load patterns from configuration
        $patterns = require __DIR__ . '/../config/log_patterns.php';
        
        // Use patterns from configuration
        $this->errorLogPattern = $patterns['apache']['error']['pattern'];
        $this->debugLogPattern = '/^\[([^\]]+)\]\s+\[([^:]+):([^\]]+)\]\s+\[pid\s+(\d+):tid\s+(\d+)\]\s+\[client\s+([^:\]]+)(?::\d+)?\]\s+(.*?)(?:\s*,\s*referer:\s*([^\]]+))?$/';
        
        // Define columns with sorting and width properties
        $this->columns = [
            'timestamp' => [
                'name' => 'Date',
                'class' => 'column-date'        
            ],
            'module' => [
                'name' => 'Module',
                'class' => 'column-module'
            ],
            'level' => [
                'name' => 'Level',
                'class' => 'column-level'

            ],
            'process' => [
                'name' => 'Process',
                'class' => 'column-process'
               
            ],
            'client' => [
                'name' => 'Client',
                'class' => 'column-client'
            ],
            'message' => [
                'name' => 'Message',
                'class' => 'column-message'
            ]
        ];
        
        if ($this->debug) {
            $this->debugLog("ApacheErrorParser initialized");
            $this->debugLog("Error Pattern: " . $this->errorLogPattern);
            $this->debugLog("Debug Pattern: " . $this->debugLogPattern);
            $this->debugLog("Columns: " . print_r($this->columns, true));
        }
    }

    protected function debugLog($message, $data = []) {
        if ($this->debug) {
            parent::debugLog($message, $data);
        }
    }

    public function parse($line, $type = 'error') {
        $line = trim($line);
        if (empty($line)) {
            return null;
        }

        // Try debug pattern first (more specific)
        if (preg_match($this->debugLogPattern, $line, $matches)) {
            if ($this->debug) {
                $this->debugLog("Matched debug pattern", ['matches' => $matches]);
            }
            return $this->parseDebugLog($matches);
        }
        
        // Then try error pattern
        if (preg_match($this->errorLogPattern, $line, $matches)) {
            if ($this->debug) {
                $this->debugLog("Matched error pattern", ['matches' => $matches]);
            }
            return $this->parseSystemLog($matches);
        }

        if ($this->debug) {
            $this->debugLog("Line did not match any pattern", ['line' => $line]);
        }
        return null;
    }

    private function parseDebugLog($matches) {
        $timestamp = $matches[1] ?? '-';
        $module = $matches[2] ?? '-';
        $level = trim($matches[3] ?? '-');
        $pid = $matches[4] ?? '-';
        $tid = $matches[5] ?? '-';
        $client = $matches[6] ?? '-';  // IP sans le port maintenant
        $message = $matches[7] ?? '-';
        $referer = isset($matches[8]) ? $matches[8] : '';

        $result = $this->formatLogEntry($timestamp, $module, $level, $pid, $tid, $client, $message, $referer);

        // Appliquer les filtres si activés
        if ($this->filtersEnabled && $this->shouldFilter($result)) {
            return ['filtered' => true, 'reason' => 'filter_match'];
        }

        return $result;
    }

    private function parseSystemLog($matches) {
        $timestamp = $matches[1] ?? '-';
        $module = $matches[2] ?? '-';
        $level = trim($matches[3] ?? '-');
        $pid = $matches[4] ?? '-';
        $tid = $matches[5] ?? '-';
        // Extraire l'IP sans le port si présent
        $client = isset($matches[6]) ? preg_replace('/:\d+$/', '', $matches[6]) : '-';
        $message = isset($matches[7]) ? $matches[7] : '-';

        $result = $this->formatLogEntry($timestamp, $module, $level, $pid, $tid, $client, $message, '');

        // Appliquer les filtres si activés
        if ($this->filtersEnabled && $this->shouldFilter($result)) {
            return ['filtered' => true, 'reason' => 'filter_match'];
        }

        return $result;
    }

    private function formatLogEntry($timestamp, $module, $level, $pid, $tid, $client, $message, $referer) {
        // Format the date for both display and sorting
        $formattedDate = parent::formatDate($timestamp);
        $dateForSort = strtotime(preg_replace('/\.\d+/', '', $timestamp));
        $formattedTimestamp = sprintf(
            '<span class="sortable-date" data-sort-value="%d">%s</span>',
            $dateForSort,
            $formattedDate
        );

        // Format error level with standardized badge and color classes
        $level = trim(strtolower($level));
        $levelClass = $this->getErrorLevelClass($level);
        $formattedLevel = sprintf(
            '<span class="log-badge level-%s" data-level="%s">%s</span>',
            $levelClass,
            htmlspecialchars($level),
            ucfirst(htmlspecialchars($level))
        );

        // Format module with badge
        $formattedModule = sprintf(
            '<span class="log-badge module">%s</span>',
            htmlspecialchars($module)
        );

        // Format process info with badge - only show PID
        $formattedProcess = sprintf(
            '<span class="log-badge process">PID:%s</span>',
            htmlspecialchars($pid)
        );

        // Utiliser le formatage commun pour l'IP client
        $formattedClient = $client !== '-' ? parent::formatIpBadge($client) : '-';

        // Formater le message avec troncature et tooltip
        $fullMessage = htmlspecialchars($message);
        if (!empty($referer)) {
            $fullMessage .= ' ' . parent::formatRefererBadge($referer);
        }
        $formattedMessage = $this->truncateMessage($fullMessage);

        return [
            'timestamp' => $formattedTimestamp,
            'module' => $formattedModule,
            'level' => $formattedLevel,
            'process' => $formattedProcess,
            'client' => $formattedClient,
            'message' => $formattedMessage
        ];
    }

    /**
     * Truncate message and add tooltip for full content
     * @param string $message The message to truncate
     * @param int $length Maximum length before truncation
     * @return string Truncated message with tooltip
     */
    private function truncateMessage($message, $length = 100) {
        $plainMessage = strip_tags($message);
        if (mb_strlen($plainMessage) <= $length) {
            return $message;
        }

        $truncated = mb_substr($plainMessage, 0, $length);
        return sprintf(
            '<span class="truncated-message" title="%s">%s...</span>',
            htmlspecialchars($plainMessage),
            htmlspecialchars($truncated)
        );
    }

    private function getErrorLevelClass($level) {
        switch ($level) {
            case 'emerg':
            case 'alert':
            case 'crit':
            case 'error':
            case 'err':
                return 'error';
            case 'warn':
            case 'warning':
                return 'warning';
            case 'notice':
                return 'notice';
            case 'info':
                return 'info';
            case 'debug':
                return 'debug';
            default:
                return 'default';
        }
    }

    public function getColumns($subtype = 'error') {
        return $this->columns;
    }

    public function getType() {
        return 'apache-error';
    }

    protected function formatDate($dateStr) {
        // Format: "Day Mon DD HH:MM:SS.UUUUUU YYYY"
        $timestamp = strtotime(preg_replace('/\.\d+/', '', $dateStr));
        if ($timestamp === false) {
            return $dateStr;
        }

        return date('Y-m-d H:i:s', $timestamp);
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

        // Check IP filters (client field contains IP)
        if (!empty($filters['ips']) && isset($data['client'])) {
            $clientIp = strip_tags($data['client']);
            foreach ($filters['ips'] as $pattern) {
                if (preg_match($pattern, $clientIp)) {
                    return true;
                }
            }
        }

        // Check message content filters
        if (!empty($filters['content']) && isset($data['message'])) {
            $message = strip_tags($data['message']);
            foreach ($filters['content'] as $pattern) {
                if (preg_match($pattern, $message)) {
                    return true;
                }
            }
        }

        // Check module filters
        if (!empty($filters['modules']) && isset($data['module'])) {
            $module = strip_tags($data['module']);
            foreach ($filters['modules'] as $pattern) {
                if (preg_match($pattern, $module)) {
                    return true;
                }
            }
        }

        // Check level filters
        if (!empty($filters['levels']) && isset($data['level'])) {
            $level = strip_tags($data['level']);
            foreach ($filters['levels'] as $pattern) {
                if (preg_match($pattern, $level)) {
                    return true;
                }
            }
        }

        return false;
    }
} 