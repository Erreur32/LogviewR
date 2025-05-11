<?php
require_once __DIR__ . '/BaseParser.php';

class SyslogParser extends BaseParser {
    private $syslogPattern;
    protected $debug = false;
    private $patterns;

    // Log levels configuration
    private $logLevels = [
        'emerg' => ['class' => 'error', 'priority' => 0],
        'alert' => ['class' => 'error', 'priority' => 1],
        'crit' => ['class' => 'error', 'priority' => 2],
        'error' => ['class' => 'error', 'priority' => 3],
        'warn' => ['class' => 'warning', 'priority' => 4],
        'warning' => ['class' => 'warning', 'priority' => 4],
        'notice' => ['class' => 'notice', 'priority' => 5],
        'info' => ['class' => 'info', 'priority' => 6],
        'debug' => ['class' => 'debug', 'priority' => 7]
    ];

    public function __construct() {
        parent::__construct();
        
        // Load configuration
        $config = require __DIR__ . '/../config/config.php';
        $this->debug = $config['debug']['enabled'] ?? false;
        
        // Load pattern from configuration
        $patterns_file = file_exists(__DIR__ . '/../config/log_patterns.user.php')
            ? __DIR__ . '/../config/log_patterns.user.php'
            : __DIR__ . '/../config/log_patterns.php';
        $patterns = require $patterns_file;
        $this->syslogPattern = $patterns['syslog']['pattern'];
        $this->columns = $patterns['syslog']['columns'];
        
        if ($this->debug) {
            $this->debugLog("=== SyslogParser initialized ===");
            $this->debugLog("Pattern: " . $this->syslogPattern);
            $this->debugLog("Columns: " . print_r($this->columns, true));
        }
    }

    protected function debugLog($message, $data = []) {
        if ($this->debug) {
            parent::debugLog($message, $data);
        }
    }

    public function parse($line, $type = 'access') {
        $line = trim($line);
        if (empty($line)) {
            return null;
        }

        $this->debugLog("Analyzing line", ['line' => $line]);

        if (!preg_match($this->syslogPattern, $line, $matches)) {
            $this->debugLog("Pattern does not match");
            return null;
        }

        // Extract components
        $date = $matches[1];
        $host = $matches[2];
        $process = $matches[3];
        $pid = $matches[4] ?? null;
        $message = $matches[5];

        // Detect log level
        $level = $this->detectLogLevel($message);
        $levelInfo = $this->logLevels[$level] ?? ['class' => 'info', 'priority' => 6];

        // Format badges
        $hostHash = substr(md5($host), 0, 1);
        $processHash = substr(md5($process), 0, 1);

        return [
            'date' => $this->formatDate($date),
            'host' => sprintf(
                '<span class="log-badge host" data-host-hash="%s">%s</span>',
                $hostHash,
                htmlspecialchars($host)
            ),
            'process' => sprintf(
                '<span class="log-badge process" data-process-hash="%s">%s</span>',
                $processHash,
                htmlspecialchars($process)
            ),
            'pid' => $pid ? sprintf(
                '<span class="log-badge pid">%s</span>',
                htmlspecialchars($pid)
            ) : '',
            'message' => sprintf(
                '<span class="log-badge message %s" data-priority="%d">%s</span>',
                $levelInfo['class'],
                $levelInfo['priority'],
                htmlspecialchars($message)
            )
        ];
    }

    protected function formatDate($dateStr) {
        try {
            $year = date('Y');
            $timestamp = strtotime("$dateStr $year");
            
            if ($timestamp === false) {
                return $dateStr;
            }

            // If date is in the future, it's probably from last year
            if ($timestamp > time()) {
                $timestamp = strtotime("$dateStr " . ($year - 1));
            }
            
            return sprintf(
                '<span class="syslog-badge date">%s %s</span>',
                date('d/m/Y', $timestamp),
                date('H:i:s', $timestamp)
            );
        } catch (Exception $e) {
            $this->debugLog("Date formatting error", ['error' => $e->getMessage()]);
            return $dateStr;
        }
    }

    private function detectLogLevel($message) {
        $message = strtolower($message);
        
        // Keywords to detect level
        $keywords = [
            'error' => ['error', 'failed', 'failure', 'fatal'],
            'warning' => ['warning', 'warn', 'could not', 'unable to'],
            'notice' => ['notice', 'note'],
            'info' => ['info', 'information'],
            'debug' => ['debug', 'trace']
        ];

        foreach ($keywords as $level => $terms) {
            foreach ($terms as $term) {
                if (strpos($message, $term) !== false) {
                    return $level;
                }
            }
        }

        return 'info';
    }
} 