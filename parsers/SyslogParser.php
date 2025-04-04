<?php
require_once __DIR__ . '/BaseParser.php';

class SyslogParser extends BaseParser {
    private $syslogPattern = '/^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+(\S+)(?:\[(\d+)\])?:\s+(.*)$/';
    private $debug = false;
    private $patterns;

    // Configuration des niveaux de log
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

    public function __construct($debug = false) {
        $this->debug = $debug;
        // Charger les patterns depuis la configuration
        $this->patterns = require __DIR__ . '/../config/log_patterns.php';
        
        $this->columns = [
            'date' => ['name' => 'Date', 'class' => 'column-date'],
            'host' => ['name' => 'Host', 'class' => 'column-host'],
            'process' => ['name' => 'Process', 'class' => 'column-process'],
            'pid' => ['name' => 'PID', 'class' => 'column-pid'],
            'message' => ['name' => 'Message', 'class' => 'column-message']
        ];
    }

    private function debugLog($message, $data = []) {
        if (!$this->debug) return;
        error_log(sprintf("[DEBUG] %s: %s", $message, json_encode($data)));
    }

    public function parse($line, $type = 'access') {
        $line = trim($line);
        if (empty($line)) {
            return null;
        }

        $this->debugLog("Analyse de la ligne", ['line' => $line]);

        if (!preg_match($this->syslogPattern, $line, $matches)) {
            $this->debugLog("Pattern ne correspond pas");
            return null;
        }

        // Extraire les composants
        $date = $matches[1];
        $host = $matches[2];
        $process = $matches[3];
        $pid = $matches[4] ?? null;
        $message = $matches[5];

        // Détecter le niveau de log
        $level = $this->detectLogLevel($message);
        $levelInfo = $this->logLevels[$level] ?? ['class' => 'info', 'priority' => 6];

        // Formater les badges
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

            // Si la date est dans le futur, c'est probablement de l'année dernière
            if ($timestamp > time()) {
                $timestamp = strtotime("$dateStr " . ($year - 1));
            }
            
            return sprintf(
                '<span class="syslog-badge date">%s %s</span>',
                date('d/m/Y', $timestamp),
                date('H:i:s', $timestamp)
            );
        } catch (Exception $e) {
            $this->debugLog("Erreur de formatage de date", ['error' => $e->getMessage()]);
            return $dateStr;
        }
    }

    private function detectLogLevel($message) {
        $message = strtolower($message);
        
        // Mots-clés pour détecter le niveau
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