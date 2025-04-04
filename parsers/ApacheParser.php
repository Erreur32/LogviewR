<?php
require_once __DIR__ . '/BaseParser.php';

class ApacheParser extends BaseParser {
    private $accessLogPattern = '/^(\S+)(?::(\d+))?\s+(\S+)\s+(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+"([^"]*)"\s+(\d{3})\s+(\d+|\-)(?:\s+"([^"]*)")?(?:\s+"([^"]*)")?/';
    private $errorLogPattern = '/^\[(.*?)\]\s*\[php:(error|notice|warning|debug)\]\s*\[pid\s+(\d+):tid\s+(\d+)\]\s*\[client\s+(\S+)\]\s*(.*)$/';
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
                'date' => ['name' => 'Date', 'class' => 'column-date'],
                'host' => ['name' => 'Host', 'class' => 'column-host'],
                'ip' => ['name' => 'IP', 'class' => 'column-ip'],
                'user' => ['name' => 'User', 'class' => 'column-user'],
                'request' => ['name' => 'Requête', 'class' => 'column-request'],
                'status' => ['name' => 'Code', 'class' => 'column-status'],
                'size' => ['name' => 'Taille', 'class' => 'column-size'],
                'referer' => ['name' => 'Referer', 'class' => 'column-referer'],
                'user_agent' => ['name' => 'User-Agent', 'class' => 'column-useragent']
            ],
            'error' => [
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

        // Détecter automatiquement le type de log si non spécifié
        if ($type === 'access') {
            // Si la ligne commence par [ et contient [php:error] ou [php:notice], c'est un log d'erreur
            if (preg_match('/^\[.*?\]\s*\[php:(error|notice|warning|debug)\]/', $line)) {
                $type = 'error';
            }
        }

        $this->debugLog("Type de log détecté", ['type' => $type, 'line' => $line]);
        return $type === 'access' ? $this->parseAccessLog($line) : $this->parseErrorLog($line);
    }

    private function parseAccessLog($line) {
        $this->debugLog("Analyse de la ligne", ['line' => $line]);

        if (!preg_match($this->accessLogPattern, $line, $matches)) {
            $this->debugLog("Pattern ne correspond pas");
            return null;
        }

        // Extraire les composants pour les filtres
        $host = $matches[1] ?? '-';
        $ip = $matches[3] ?? '-';
        $user = $matches[4] ?? '-';
        $request = $matches[7] ?? '-';
        $userAgent = $matches[11] ?? '-';

        // Formater les badges avec des valeurs par défaut si nécessaire
        $hostHash = $host !== '-' ? substr(md5($host), 0, 1) : '0';
        $ipHash = $ip !== '-' ? substr(md5($ip), 0, 1) : '0';
        $userHash = $user !== '-' ? substr(md5($user), 0, 1) : '0';

        // Formater le host avec ou sans port
        $port = isset($matches[2]) && $matches[2] ? ':' . $matches[2] : '';
        $hostDisplay = $host !== '-' ? rtrim($host . $port, ':') : '-';

        // Préparer la requête formatée
        $requestParts = explode(' ', $request);
        $method = $requestParts[0] ?? '-';
        $path = $requestParts[1] ?? '-';
        $protocol = $requestParts[2] ?? '-';

        // Appliquer les filtres d'exclusion avant le formatage HTML
        $filtered = false;
        $filterReason = '';

        // Filtre IP
        if (isset($this->excludePatterns['ips'])) {
            foreach ($this->excludePatterns['ips'] as $pattern) {
                $cleanIp = trim(preg_replace('/:\d+$/', '', $ip));
                $cleanPattern = str_replace('\\\\', '\\', trim($pattern, '/'));
                if (@preg_match('/' . $cleanPattern . '/', $cleanIp)) {
                    $filtered = true;
                    $filterReason = 'IP exclue: ' . $cleanIp;
                    break;
                }
            }
        }

        // Filtre requêtes
        if (!$filtered && isset($this->excludePatterns['requests'])) {
            foreach ($this->excludePatterns['requests'] as $pattern) {
                $cleanPattern = str_replace('\\\\', '\\', trim($pattern, '/'));
                if (@preg_match('/' . $cleanPattern . '/', $path)) {
                    $filtered = true;
                    $filterReason = 'Requête exclue: ' . $path;
                    break;
                }
            }
        }

        // Filtre user-agents
        if (!$filtered && isset($this->excludePatterns['user_agents'])) {
            foreach ($this->excludePatterns['user_agents'] as $pattern) {
                $cleanPattern = str_replace('\\\\', '\\', trim($pattern, '/'));
                if (@preg_match('/' . $cleanPattern . '/', $userAgent)) {
                    $filtered = true;
                    $filterReason = 'User-Agent exclu: ' . $userAgent;
                    break;
                }
            }
        }

        // Filtre utilisateurs (seulement si l'utilisateur n'est pas '-')
        if (!$filtered && isset($this->excludePatterns['users']) && $user !== '-') {
            foreach ($this->excludePatterns['users'] as $pattern) {
                $cleanPattern = str_replace('\\\\', '\\', trim($pattern, '/'));
                if (@preg_match('/' . $cleanPattern . '/', $user)) {
                    $filtered = true;
                    $filterReason = 'Utilisateur exclu: ' . $user;
                    break;
                }
            }
        }

        // Préparer le résultat formaté
        $result = [
            'date' => $this->formatDate($matches[6]),
            'host' => sprintf(
                '<span class="log-badge host%s" data-host-hash="%s">%s</span>',
                $host === '-' ? ' host-empty' : '',
                $hostHash,
                htmlspecialchars($hostDisplay)
            ),
            'ip' => sprintf(
                '<span class="log-badge ip%s" data-ip-hash="%s">%s</span>',
                $ip === '-' ? ' ip-empty' : '',
                $ipHash,
                htmlspecialchars($ip)
            ),
            'user' => sprintf(
                '<span class="log-badge user%s" data-user="%s" data-user-hash="%s">%s</span>',
                $user === '-' ? ' user-empty' : '',
                $this->getUserClass($user),
                $userHash,
                htmlspecialchars($user)
            ),
            'request' => sprintf(
                '<div class="apache-request-container"><span class="apache-badge method %s">%s</span>&nbsp;&nbsp;<span class="path">%s</span></div>',
                strtolower($method),
                htmlspecialchars($method),
                htmlspecialchars($path)
            ),
            'status' => $this->formatStatusBadge($matches[8]),
            'size' => $this->formatSize($matches[9]),
            'referer' => htmlspecialchars($matches[10] ?? '-'),
            'user_agent' => htmlspecialchars($userAgent)
        ];

        if ($filtered) {
            $result['filtered'] = true;
            $result['reason'] = $filterReason;
        }

        return $result;
    }

    private function parseRequest($requestStr) {
        if (!preg_match('/^(\S+)\s+(\S+)(?:\s+(\S+))?$/', $requestStr, $parts)) {
            return null;
        }

        $method = $parts[1] ?? '-';
        $url = $parts[2] ?? '-';
        $protocol = $parts[3] ?? '-';

        return sprintf(
            '<div class="apache-request-container"><span class="apache-badge method %s">%s</span><span class="path">%s</span></div>',
            strtolower($method),
            htmlspecialchars($method),
            htmlspecialchars($url)
        );
    }

    private function parseErrorLog($line) {
        // Pour les logs d'erreur, on retourne simplement le message brut
        return [
            'message' => htmlspecialchars($line)
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

    private function getUserClass($user) {
        $specialUsers = [
            'root' => 'root',
            'admin' => 'admin',
            'www-data' => 'www-data',
            '-' => 'anonymous',
            'erreur32' => 'erreur32'
        ];
        
        return $specialUsers[$user] ?? 'user';
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

    protected function formatStatusBadge($status) {
        $statusClass = '';
        if ($status >= 500) {
            $statusClass = 'server_error';
        } elseif ($status >= 400) {
            $statusClass = 'client_error';
        } elseif ($status >= 300) {
            $statusClass = 'redirect';
        } elseif ($status >= 200) {
            $statusClass = 'success';
        } elseif ($status >= 100) {
            $statusClass = 'info';
        }

        return sprintf(
            '<span class="status-badge status-%s" data-status="%d">%d</span>',
            $statusClass,
            $status,
            $status
        );
    }

    public function getColumns($subtype = 'access') {
        return $this->columns[$subtype] ?? [];
    }

    public function getType() {
        return 'apache';
    }
} 