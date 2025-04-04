<?php
require_once __DIR__ . '/BaseParser.php';

class NginxParser extends BaseParser {
    private $accessLogPattern = '/^(\S+) - (\S+) \[([^\]]+)\] "([^"]*)" (\d{3}) (\d+) "([^"]*)" "([^"]*)"(?: (\d+\.\d+))?$/';
    private $errorLogPattern = '/^(\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2}) \[([^\]]+)\] (\d+)#(\d+): \*(\d+) (.*)$/';
    private $debug = false;

    // Configuration des patterns d'exclusion
    private $excludePatterns = [];
    private $patterns;

    // Configuration des codes HTTP
    private $httpCodes = [
        'success' => [200, 201, 204],
        'redirect' => [301, 302, 303, 307, 308],
        'client_error' => [400, 401, 403, 404, 405],
        'server_error' => [500, 501, 502, 503, 504]
    ];

    // Configuration des niveaux d'erreur
    private $errorLevels = [
        'emerg' => ['class' => 'error', 'priority' => 0],
        'alert' => ['class' => 'error', 'priority' => 1],
        'crit' => ['class' => 'error', 'priority' => 2],
        'error' => ['class' => 'error', 'priority' => 3],
        'warn' => ['class' => 'warning', 'priority' => 4],
        'notice' => ['class' => 'notice', 'priority' => 5],
        'info' => ['class' => 'info', 'priority' => 6],
        'debug' => ['class' => 'debug', 'priority' => 7]
    ];

    public function __construct($debug = false) {
        $this->debug = $debug;
        // Charger les patterns depuis la configuration
        $patterns_file = __DIR__ . '/../config/log_patterns.php';
        
        if (file_exists($patterns_file)) {
            $this->patterns = require $patterns_file;
            
            // Initialiser les patterns d'exclusion depuis la configuration
            if (isset($this->patterns['filters']['exclude'])) {
                $this->excludePatterns = $this->patterns['filters']['exclude'];
                $this->debugLog("Filtres d'exclusion chargés", ['patterns' => $this->excludePatterns]);
            } else {
                $this->debugLog("Aucun filtre d'exclusion trouvé dans la configuration");
            }
        } else {
            $this->debugLog("Fichier de patterns non trouvé: $patterns_file");
            $this->patterns = [];
            $this->excludePatterns = [];
        }
        
        $this->columns = [
            'access' => [
                'ip' => ['name' => 'IP', 'class' => 'column-ip'],
                'date' => ['name' => 'Date', 'class' => 'column-date'],
                'request' => ['name' => 'Requête', 'class' => 'column-request'],
                'status' => ['name' => 'Code', 'class' => 'column-status'],
                'size' => ['name' => 'Taille', 'class' => 'column-size'],
                'referer' => ['name' => 'Referer', 'class' => 'column-referer'],
                'user_agent' => ['name' => 'User-Agent', 'class' => 'column-useragent']
            ],
            'error' => [
                'date' => ['name' => 'Date', 'class' => 'column-date'],
                'level' => ['name' => 'Niveau', 'class' => 'column-level'],
                'pid' => ['name' => 'PID', 'class' => 'column-pid'],
                'message' => ['name' => 'Message', 'class' => 'column-message']
            ]
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

        $this->debugLog("Analyse de la ligne", ['line' => $line, 'type' => $type]);

        return $type === 'access' ? $this->parseAccessLog($line) : $this->parseErrorLog($line);
    }

    private function parseAccessLog($line) {
        if (!preg_match($this->accessLogPattern, $line, $matches)) {
            return null;
        }

        // Extraire les composants pour les filtres
        $ip = $matches[1];
        $request = $matches[4];
        $userAgent = $matches[8] ?? '-';

        $this->debugLog("Composants extraits", [
            'ip' => $ip,
            'request' => $request,
            'userAgent' => $userAgent
        ]);

        // Appliquer les filtres d'exclusion
        if (isset($this->excludePatterns['ips'])) {
            $this->debugLog("Filtres IP disponibles", ['patterns' => $this->excludePatterns['ips']]);
            foreach ($this->excludePatterns['ips'] as $pattern) {
                $this->debugLog("Test du pattern IP", ['pattern' => $pattern, 'ip' => $ip]);
                // Nettoyer l'IP des éventuels ports
                $cleanIp = preg_replace('/:\d+$/', '', $ip);
                if (preg_match($pattern, $cleanIp)) {
                    $this->debugLog("IP exclue", ['pattern' => $pattern, 'ip' => $cleanIp]);
                    return ['filtered' => true, 'reason' => 'IP exclue: ' . $cleanIp];
                }
            }
        } else {
            $this->debugLog("Aucun filtre IP trouvé");
        }

        if (isset($this->excludePatterns['requests'])) {
            $this->debugLog("Filtres de requêtes disponibles", ['patterns' => $this->excludePatterns['requests']]);
            foreach ($this->excludePatterns['requests'] as $pattern) {
                if (preg_match($pattern, $request)) {
                    $this->debugLog("Requête exclue", ['pattern' => $pattern, 'request' => $request]);
                    return ['filtered' => true, 'reason' => 'Requête exclue: ' . $request];
                }
            }
        } else {
            $this->debugLog("Aucun filtre de requêtes trouvé");
        }

        if (isset($this->excludePatterns['user_agents'])) {
            $this->debugLog("Filtres de user-agents disponibles", ['patterns' => $this->excludePatterns['user_agents']]);
            foreach ($this->excludePatterns['user_agents'] as $pattern) {
                if (preg_match($pattern, $userAgent)) {
                    $this->debugLog("User-Agent exclu", ['pattern' => $pattern, 'user_agent' => $userAgent]);
                    return ['filtered' => true, 'reason' => 'User-Agent exclu: ' . $userAgent];
                }
            }
        } else {
            $this->debugLog("Aucun filtre de user-agents trouvé");
        }

        return [
            'ip' => sprintf(
                '<span class="log-badge ip" data-ip-hash="%s">%s</span>',
                substr(md5($ip), 0, 1),
                htmlspecialchars($ip)
            ),
            'date' => $this->formatDate($matches[2]),
            'request' => $this->parseRequest($request),
            'status' => $this->formatStatusBadge($matches[5]),
            'size' => $this->formatSize($matches[6]),
            'referer' => htmlspecialchars($matches[7] ?? '-'),
            'user_agent' => htmlspecialchars($userAgent)
        ];
    }

    private function parseErrorLog($line) {
        if (!preg_match($this->errorLogPattern, $line, $matches)) {
            $this->debugLog("Pattern error ne correspond pas");
            return null;
        }

        $level = strtolower($matches[2]);
        $levelInfo = $this->errorLevels[$level] ?? ['class' => 'info', 'priority' => 6];

        return [
            'date' => $this->formatDate($matches[1]),
            'level' => sprintf(
                '<span class="nginx-badge level %s">%s</span>',
                $levelInfo['class'],
                strtoupper($level)
            ),
            'pid' => sprintf(
                '<span class="log-badge pid">%s</span>',
                htmlspecialchars($matches[3])
            ),
            'tid' => sprintf(
                '<span class="log-badge tid">%s</span>',
                htmlspecialchars($matches[4])
            ),
            'cid' => sprintf(
                '<span class="log-badge cid">%s</span>',
                htmlspecialchars($matches[5])
            ),
            'message' => sprintf(
                '<span class="log-badge message %s" data-priority="%d">%s</span>',
                $levelInfo['class'],
                $levelInfo['priority'],
                htmlspecialchars($matches[6])
            )
        ];
    }

    private function parseRequest($requestStr) {
        if (!preg_match('/^(\S+)\s+(\S+)(?:\s+(\S+))?$/', $requestStr, $parts)) {
            return null;
        }

        $method = $parts[1] ?? '-';
        $url = $parts[2] ?? '-';
        $protocol = $parts[3] ?? '-';

        return [
            'method' => $method,
            'url' => $url,
            'protocol' => $protocol,
            'html' => sprintf(
                '<div class="nginx-request-container"><span class="nginx-badge method %s">%s</span><span class="path">%s</span></div>',
                strtolower($method),
                htmlspecialchars($method),
                htmlspecialchars($url)
            )
        ];
    }

    protected function formatSize($size) {
        if ($size == '-' || $size == '0') {
            return '<span class="log-badge size"><span class="number">-</span></span>';
        }
        
        $units = ['B', 'KB', 'MB', 'GB'];
        $size = intval($size);
        $i = 0;
        
        while ($size >= 1024 && $i < count($units) - 1) {
            $size /= 1024;
            $i++;
        }
        
        return sprintf(
            '<span class="log-badge size"><span class="number">%.1f</span><span class="unit">%s</span></span>',
            $size,
            $units[$i]
        );
    }

    private function getStatusClass($status) {
        $status = intval($status);
        
        foreach ($this->httpCodes as $type => $codes) {
            if (in_array($status, $codes)) {
                return $type;
            }
        }
        
        return 'unknown';
    }

    private function formatStatusBadge($status) {
        $status = intval($status);
        
        foreach ($this->httpCodes as $type => $codes) {
            if (in_array($status, $codes)) {
                return sprintf(
                    '<span class="nginx-badge status %s">%s</span>',
                    $type,
                    $status
                );
            }
        }
        
        return sprintf(
            '<span class="nginx-badge status unknown">%s</span>',
            $status
        );
    }
} 