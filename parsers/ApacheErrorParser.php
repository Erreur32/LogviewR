<?php
require_once __DIR__ . '/BaseParser.php';

class ApacheErrorParser extends BaseParser {
    private $errorLogPattern = '/^\[([A-Za-z]{3} [A-Za-z]{3}\s+\d{1,2} \d{2}:\d{2}:\d{2}(?:\.\d+)? \d{4})\] \[([^:]+):([^\]]+)\] \[pid (\d+)(?::tid (\d+))?\] (?:\[client ([^\]]+)\] )?\[([^\]]+)\] (.+?)(?:, referer: (.+))?$/';
    private $apacheSystemPattern = '/^\[([A-Za-z]{3} [A-Za-z]{3}\s+\d{1,2} \d{2}:\d{2}:\d{2}(?:\.\d+)? \d{4})\] \[([^:]+):([^\]]+)\] \[pid (\d+)(?::tid (\d+))?\] (?:AH\d+): (.+?)$/';
    private $datePattern = '/^\[([A-Za-z]{3} [A-Za-z]{3}\s+\d{1,2} \d{2}:\d{2}:\d{2}(?:\.\d+)? \d{4})\]/';
    private $debugMode = true;  // Activer le mode debug temporairement

    public function __construct() {
        $this->columns = [
            'error' => [
                'date' => ['name' => 'Date', 'class' => 'column-date'],
                'module' => ['name' => 'Module', 'class' => 'column-module'],
                'level' => ['name' => 'Niveau', 'class' => 'column-level'],
                'process' => ['name' => 'Process', 'class' => 'column-process'],
                'ip' => ['name' => 'IP', 'class' => 'column-ip'],
                'message' => ['name' => 'Message', 'class' => 'column-message'],
                'referer' => ['name' => 'Referer', 'class' => 'column-referer']
            ]
        ];
    }

    public function parse($line, $type = null) {
        // Décoder les caractères UTF-8
        $line = utf8_decode(trim($line));
        if (empty($line)) {
            return null;
        }

        // Ignorer les lignes de debug
        if (strpos($line, '[DEBUG]') !== false) {
            return null;
        }

        if ($this->debugMode) {
            error_log("Tentative de parsing de la ligne: " . $line);
        }

        // Essayer d'abord de parser avec le pattern système Apache
        $parsed = $this->parseApacheSystemLog($line);
        if ($parsed !== null) {
            if ($this->debugMode) {
                error_log("Parsing réussi avec pattern système: " . print_r($parsed, true));
            }
            return $parsed;
        }

        // Ensuite essayer avec le pattern PHP
        $parsed = $this->parseErrorLog($line);
        if ($parsed !== null) {
            if ($this->debugMode) {
                error_log("Parsing réussi avec pattern PHP: " . print_r($parsed, true));
            }
            return $parsed;
        }

        if ($this->debugMode) {
            error_log("Échec du parsing avec tous les patterns");
        }

        // Si le parsing a échoué, extraire au moins la date et afficher la ligne brute
        if (preg_match($this->datePattern, $line, $dateMatch)) {
            if ($this->debugMode) {
                error_log("Pattern de date trouvé: " . print_r($dateMatch, true));
            }
            $rawDate = $dateMatch[1];
            $formattedDate = $this->formatDate($rawDate);
            
            // Enlever la date du début de la ligne pour le message
            $rawMessage = trim(substr($line, strlen($dateMatch[0])));
            
            $result = [
                'date' => $formattedDate,
                'module' => '<span class="apache-badge module">unknown</span>',
                'level' => '<span class="apache-badge level warning">raw</span>',
                'process' => '<span class="process-info">-</span>',
                'ip' => '<span class="apache-badge ip-empty">-</span>',
                'message' => '<span class="raw-message">' . htmlspecialchars($rawMessage) . '</span>',
                'referer' => '-'
            ];

            if ($this->debugMode) {
                error_log("Résultat du parsing brut: " . print_r($result, true));
            }

            return $result;
        }

        if ($this->debugMode) {
            error_log("Échec du parsing avec le pattern de date");
        }

        return null;
    }

    private function parseErrorLog($line) {
        if (!preg_match($this->errorLogPattern, $line, $matches)) {
            return null;
        }

        if ($this->debugMode) {
            error_log("Matches trouvés: " . print_r($matches, true));
        }

        // Extraire le module et le niveau
        $module = $matches[2];
        $level = $matches[3];

        // Formater le niveau avec un badge
        $levelClass = strtolower($level);
        $formattedLevel = sprintf(
            '<span class="apache-badge level %s">%s</span>',
            $levelClass,
            htmlspecialchars($level)
        );

        // Formater le module avec un badge
        $formattedModule = sprintf(
            '<span class="apache-badge module">%s</span>',
            htmlspecialchars($module)
        );

        // Gérer l'IP client si présente
        $ip = isset($matches[6]) ? explode(':', $matches[6])[0] : '-';

        // Formater l'IP avec un badge
        $formattedIp = sprintf(
            '<span class="apache-badge ip%s" data-ip-hash="%d">%s</span>',
            $ip === '-' ? ' ip-empty' : '',
            $ip !== '-' ? abs(crc32($ip) % 10) : 0,
            htmlspecialchars($ip)
        );

        // Gérer le message en fonction du mode debug
        $messageIndex = isset($matches[7]) ? 8 : 7;
        $refererIndex = isset($matches[7]) ? 9 : 8;
        $message = isset($matches[$messageIndex]) ? $matches[$messageIndex] : '';
        $referer = isset($matches[$refererIndex]) ? $matches[$refererIndex] : '-';

        if ($this->debugMode) {
            error_log("Indices utilisés - message: $messageIndex, referer: $refererIndex");
            error_log("Message extrait: $message");
            error_log("Referer extrait: $referer");
        }

        // Formater la date
        $date = $this->formatDate($matches[1]);

        // Gérer le TID optionnel
        $tid = isset($matches[5]) ? $matches[5] : $matches[4];

        $result = [
            'date' => $date,
            'module' => $formattedModule,
            'level' => $formattedLevel,
            'process' => sprintf('<span class="process-info">PID:%s TID:%s</span>', $matches[4], $tid),
            'ip' => $formattedIp,
            'message' => htmlspecialchars($message),
            'referer' => htmlspecialchars($referer)
        ];

        if ($this->debugMode) {
            error_log("Résultat final: " . print_r($result, true));
        }

        return $result;
    }

    private function parseApacheSystemLog($line) {
        if (!preg_match($this->apacheSystemPattern, $line, $matches)) {
            return null;
        }

        if ($this->debugMode) {
            error_log("Matches système trouvés: " . print_r($matches, true));
        }

        // Extraire le module et le niveau
        $module = $matches[2];
        $level = $matches[3];

        // Formater le niveau avec un badge
        $levelClass = strtolower($level);
        $formattedLevel = sprintf(
            '<span class="apache-badge level %s">%s</span>',
            $levelClass,
            htmlspecialchars($level)
        );

        // Formater le module avec un badge
        $formattedModule = sprintf(
            '<span class="apache-badge module">%s</span>',
            htmlspecialchars($module)
        );

        // Formater la date
        $date = $this->formatDate($matches[1]);

        // Gérer le TID optionnel
        $tid = isset($matches[5]) ? $matches[5] : $matches[4];

        $result = [
            'date' => $date,
            'module' => $formattedModule,
            'level' => $formattedLevel,
            'process' => sprintf('<span class="process-info">PID:%s TID:%s</span>', $matches[4], $tid),
            'ip' => '<span class="apache-badge ip-empty">-</span>',
            'message' => htmlspecialchars($matches[6]),
            'referer' => '-'
        ];

        if ($this->debugMode) {
            error_log("Résultat système final: " . print_r($result, true));
        }

        return $result;
    }

    protected function formatDate($dateStr) {
        // Format: "Day Mon DD HH:MM:SS.UUUUUU YYYY"
        $timestamp = strtotime(preg_replace('/\.\d+/', '', $dateStr));
        if ($timestamp === false) {
            return $dateStr;
        }

        return sprintf(
            '<span class="apache-badge date">%s %s</span>',
            date('d/m/Y', $timestamp),
            date('H:i:s', $timestamp)
        );
    }
} 