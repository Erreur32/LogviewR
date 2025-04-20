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
        $this->debugLogPattern = '/^\[([^\]]+)\]\s+\[([^:]+):([^\]]+)\]\s+\[pid\s+(\d+):tid\s+(\d+)\]\s+\[client\s+([^\]]+)\]\s+(.*?)(?:\s*,\s*referer:\s*([^\]]+))?$/';
        
        $this->columns = $patterns['apache']['error']['columns'];
        
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
        $client = $matches[6] ?? '-';
        $message = $matches[7] ?? '-';
        $referer = isset($matches[8]) ? sprintf(' <span class="apache-error-badge referer">%s</span>', htmlspecialchars($matches[8])) : '';

        return $this->formatLogEntry($timestamp, $module, $level, $pid, $tid, $client, $message . $referer);
    }

    private function parseSystemLog($matches) {
        $timestamp = $matches[1] ?? '-';
        $module = $matches[2] ?? '-';
        $level = trim($matches[3] ?? '-');
        $pid = $matches[4] ?? '-';
        $tid = $matches[5] ?? '-';
        $client = isset($matches[6]) ? $matches[6] : '-';
        $message = isset($matches[7]) ? $matches[7] : '-';

        return $this->formatLogEntry($timestamp, $module, $level, $pid, $tid, $client, $message);
    }

    private function formatLogEntry($timestamp, $module, $level, $pid, $tid, $client, $message) {
        // Format error level with badge
        $errorLevelClass = $this->getErrorLevelClass($level);
        $formattedLevel = sprintf(
            '<span class="apache-error-badge level-%s">%s</span>',
            $errorLevelClass,
            htmlspecialchars(trim($level))
        );

        // Format module with badge
        $formattedModule = sprintf(
            '<span class="apache-error-badge module">%s</span>',
            htmlspecialchars($module)
        );

        // Format process info with badge
        $formattedProcess = sprintf(
            '<span class="apache-error-badge process"><span class="pid">PID:%s</span><span class="tid">TID:%s</span></span>',
            htmlspecialchars($pid),
            htmlspecialchars($tid)
        );

        // Format client IP with badge (if present)
        $formattedClient = $client !== '-' ? sprintf(
            '<span class="apache-error-badge client">%s</span>',
            htmlspecialchars($client)
        ) : '-';

        return [
            'timestamp' => parent::formatDate($timestamp),
            'module' => $formattedModule,
            'level' => $formattedLevel,
            'process' => $formattedProcess,
            'client' => $formattedClient,
            'message' => htmlspecialchars($message)
        ];
    }

    private function getErrorLevelClass($level) {
        $level = strtolower(trim($level));
        switch ($level) {
            case 'emerg':
            case 'alert':
            case 'crit':
            case 'error':
                return 'danger';
            case 'warn':
            case 'warning':
                return 'warning';
            case 'notice':
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
} 