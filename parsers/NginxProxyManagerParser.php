<?php
require_once __DIR__ . '/BaseParser.php';

class NginxProxyManagerParser extends BaseParser {
    private $debug = false;
    private $patterns;
    private $excludedIps = [];
    private $excludedRequests = [];
    private $excludedUserAgents = [];
    private $excludedUsers = [];

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
        $this->patterns = require __DIR__ . '/../config/log_patterns.php';
        
        // Charger les filtres d'exclusion
        if (isset($this->patterns['filters']['exclude'])) {
            $this->excludedIps = $this->patterns['filters']['exclude']['ips'] ?? [];
            $this->excludedRequests = $this->patterns['exclude']['requests'] ?? [];
            $this->excludedUserAgents = $this->patterns['filters']['exclude']['user_agents'] ?? [];
            $this->excludedUsers = $this->patterns['filters']['exclude']['users'] ?? [];
        }
        
        $this->columns = [
            'default_host_access' => [
                'date' => ['name' => 'Date', 'class' => 'column-date', 'order' => 1],
                'ip' => ['name' => 'IP', 'class' => 'column-ip', 'order' => 2],
                'method' => ['name' => 'Méthode', 'class' => 'column-method', 'order' => 3],
                'path' => ['name' => 'Chemin', 'class' => 'column-path', 'order' => 4],
                'protocol' => ['name' => 'Protocole', 'class' => 'column-protocol', 'order' => 5],
                'status' => ['name' => 'Code', 'class' => 'column-status', 'order' => 6],
                'size' => ['name' => 'Taille', 'class' => 'column-size', 'order' => 7],
                'referer' => ['name' => 'Referer', 'class' => 'column-referer', 'order' => 8],
                'user_agent' => ['name' => 'User-Agent', 'class' => 'column-useragent', 'order' => 9]
            ],
            'default_host_error' => [
                'date' => ['name' => 'Date', 'class' => 'column-date', 'order' => 1],
                'level' => ['name' => 'Niveau', 'class' => 'column-level', 'order' => 2],
                'pid' => ['name' => 'PID', 'class' => 'column-pid', 'order' => 3],
                'connection' => ['name' => 'Connexion', 'class' => 'column-connection', 'order' => 4],
                'client' => ['name' => 'Client', 'class' => 'column-client', 'order' => 5],
                'server' => ['name' => 'Server', 'class' => 'column-server', 'order' => 6],
                'request' => ['name' => 'Request', 'class' => 'column-request', 'order' => 7],
                'host' => ['name' => 'Host', 'class' => 'column-host', 'order' => 8],
                'upstream' => ['name' => 'Upstream', 'class' => 'column-upstream', 'order' => 9]
            ],
            'dead_host_access' => [
                'date' => ['name' => 'Date', 'class' => 'column-date', 'order' => 1],
                'status' => ['name' => 'Code', 'class' => 'column-status', 'order' => 2],
                'method' => ['name' => 'Méthode', 'class' => 'column-method', 'order' => 3],
                'protocol' => ['name' => 'Protocole', 'class' => 'column-protocol', 'order' => 4],
                'host' => ['name' => 'Hôte', 'class' => 'column-host', 'order' => 5],
                'request' => ['name' => 'Requête', 'class' => 'column-request', 'order' => 6],
                'client' => ['name' => 'Client', 'class' => 'column-client', 'order' => 7],
                'length' => ['name' => 'Taille', 'class' => 'column-length', 'order' => 8],
                'gzip' => ['name' => 'Gzip', 'class' => 'column-gzip', 'order' => 9],
                'user_agent' => ['name' => 'User-Agent', 'class' => 'column-useragent', 'order' => 10],
                'referer' => ['name' => 'Referer', 'class' => 'column-referer', 'order' => 11]
            ],
            'dead_host_error' => [
                'date' => ['name' => 'Date', 'class' => 'column-date', 'order' => 1],
                'level' => ['name' => 'Niveau', 'class' => 'column-level', 'order' => 2],
                'pid' => ['name' => 'PID', 'class' => 'column-pid', 'order' => 3],
                'connection' => ['name' => 'Connexion', 'class' => 'column-connection', 'order' => 4],
                'client' => ['name' => 'Client', 'class' => 'column-client', 'order' => 5],
                'server' => ['name' => 'Server', 'class' => 'column-server', 'order' => 6],
                'request' => ['name' => 'Request', 'class' => 'column-request', 'order' => 7],
                'host' => ['name' => 'Host', 'class' => 'column-host', 'order' => 8],
                'upstream' => ['name' => 'Upstream', 'class' => 'column-upstream', 'order' => 9]
            ],
            'fallback_access' => [
                'date' => ['name' => 'Date', 'class' => 'column-date', 'order' => 1],
                'ip' => ['name' => 'IP', 'class' => 'column-ip', 'order' => 2],
                'method' => ['name' => 'Méthode', 'class' => 'column-method', 'order' => 3],
                'path' => ['name' => 'Chemin', 'class' => 'column-path', 'order' => 4],
                'protocol' => ['name' => 'Protocole', 'class' => 'column-protocol', 'order' => 5],
                'status' => ['name' => 'Code', 'class' => 'column-status', 'order' => 6],
                'size' => ['name' => 'Taille', 'class' => 'column-size', 'order' => 7],
                'referer' => ['name' => 'Referer', 'class' => 'column-referer', 'order' => 8],
                'user_agent' => ['name' => 'User-Agent', 'class' => 'column-useragent', 'order' => 9]
            ],
            'fallback_error' => [
                'date' => ['name' => 'Date', 'class' => 'column-date', 'order' => 1],
                'level' => ['name' => 'Niveau', 'class' => 'column-level', 'order' => 2],
                'pid' => ['name' => 'PID', 'class' => 'column-pid', 'order' => 3],
                'connection' => ['name' => 'Connexion', 'class' => 'column-connection', 'order' => 4],
                'client' => ['name' => 'Client', 'class' => 'column-client', 'order' => 5],
                'server' => ['name' => 'Server', 'class' => 'column-server', 'order' => 6],
                'request' => ['name' => 'Request', 'class' => 'column-request', 'order' => 7],
                'host' => ['name' => 'Host', 'class' => 'column-host', 'order' => 8],
                'upstream' => ['name' => 'Upstream', 'class' => 'column-upstream', 'order' => 9]
            ],
            'proxy_host_access' => [
                'date' => ['name' => 'Date', 'class' => 'column-date', 'order' => 1],
                'status' => ['name' => 'Code', 'class' => 'column-status', 'order' => 2],
                'method' => ['name' => 'Méthode', 'class' => 'column-method', 'order' => 3],
                'protocol' => ['name' => 'Protocole', 'class' => 'column-protocol', 'order' => 4],
                'url' => ['name' => 'URL', 'class' => 'column-url', 'order' => 5],
                'host' => ['name' => 'Hôte', 'class' => 'column-host', 'order' => 6],
                'client' => ['name' => 'Client', 'class' => 'column-client', 'order' => 7],
                'length' => ['name' => 'Longueur', 'class' => 'column-length', 'order' => 8],
                'gzip' => ['name' => 'Gzip', 'class' => 'column-gzip', 'order' => 9],
                'user_agent' => ['name' => 'User-Agent', 'class' => 'column-useragent', 'order' => 10],
                'referer' => ['name' => 'Referer', 'class' => 'column-referer', 'order' => 11],
                'sent_to' => ['name' => 'Envoyé à', 'class' => 'column-sent-to', 'order' => 12]
            ],
            'proxy_host_error' => [
                'date' => ['name' => 'Date', 'class' => 'column-date', 'order' => 1],
                'level' => ['name' => 'Niveau', 'class' => 'column-level', 'order' => 2],
                'pid' => ['name' => 'PID', 'class' => 'column-pid', 'order' => 3],
                'connection' => ['name' => 'Connexion', 'class' => 'column-connection', 'order' => 4],
                'client' => ['name' => 'Client', 'class' => 'column-client', 'order' => 5],
                'server' => ['name' => 'Server', 'class' => 'column-server', 'order' => 6],
                'request' => ['name' => 'Request', 'class' => 'column-request', 'order' => 7],
                'host' => ['name' => 'Host', 'class' => 'column-host', 'order' => 8],
                'upstream' => ['name' => 'Upstream', 'class' => 'column-upstream', 'order' => 9]
            ]
        ];
    }

    private function debugLog($message, $data = []) {
        if (!$this->debug) return;
        error_log(sprintf("[DEBUG] %s: %s", $message, json_encode($data)));
    }

    public function parse($line, $type = 'access', $subtype = 'default') {
        $line = trim($line);
        if (empty($line)) {
            return null;
        }

        $this->debugLog("Analyse de la ligne", ['line' => $line, 'type' => $type, 'subtype' => $subtype]);

        // Si le type est 'raw', retourner la ligne brute
        if ($type === 'raw') {
            return ['raw' => $line];
        }

        // Déterminer le type de log et le pattern à utiliser
        $logType = $type;
        if ($type === 'access' && $subtype !== 'default') {
            $logType = $subtype . '_' . $type;
        }

        // Vérifier si le pattern existe
        if (!isset($this->patterns['npm'][$logType])) {
            $this->debugLog("Pattern non trouvé", ['type' => $logType]);
            return null;
        }

        $pattern = $this->patterns['npm'][$logType]['pattern'];
        $columns = $this->patterns['npm'][$logType]['columns'];

        // Appliquer le pattern
        if (!preg_match($pattern, $line, $matches)) {
            $this->debugLog("Pattern ne correspond pas", ['pattern' => $pattern, 'line' => $line]);
            return null;
        }

        // Debug des matches
        $this->debugLog("Matches trouvés", ['matches' => $matches]);

        // Construire le résultat
        $result = [];
        foreach ($columns as $index => $columnName) {
            if (isset($matches[$index + 1])) {
                $value = $matches[$index + 1];
                
                // Debug de chaque colonne
                $this->debugLog("Traitement colonne", [
                    'index' => $index,
                    'columnName' => $columnName,
                    'value' => $value
                ]);
                
                // Pour les logs d'accès, construire la requête complète
                if ($columnName === 'request' && isset($matches[3], $matches[4], $matches[5])) {
                    $value = sprintf('%s %s %s', $matches[3], $matches[4], $matches[5]);
                }
                
                $result[$columnName] = $this->formatValue($columnName, $value);
            } else {
                $result[$columnName] = '-';
            }
        }

        return $result;
    }

    private function shouldExclude($matches, $columns) {
        // Vérifier si l'exclusion des IPs est activée
        $config = require __DIR__ . '/../config/config.php';
        $enableIpExclusion = $config['app']['enable_ip_exclusion'] ?? true;

        if ($enableIpExclusion) {
            // Vérifier les IPs exclues
            if (isset($columns[5]) && $columns[5] === 'Client') {
                $clientIp = $matches[6] ?? '';
                foreach ($this->excludedIps as $pattern) {
                    if (preg_match($pattern, $clientIp)) {
                        return true;
                    }
                }
            }
        }

        // Vérifier les requêtes exclues
        if (isset($columns[4]) && $columns[4] === 'URL') {
            $url = $matches[5] ?? '';
            foreach ($this->excludedRequests as $pattern) {
                if (preg_match($pattern, $url)) {
                    return true;
                }
            }
        }

        // Vérifier les user-agents exclus
        if (isset($columns[9]) && $columns[9] === 'User-Agent') {
            $userAgent = $matches[10] ?? '';
            foreach ($this->excludedUserAgents as $pattern) {
                if (preg_match($pattern, $userAgent)) {
                    return true;
                }
            }
        }

        return false;
    }

    private function formatValue($columnName, $value) {
        switch ($columnName) {
            case 'date':
                $timestamp = strtotime(str_replace('/', '-', $value));
                return sprintf(
                    '<span class="date-badge" data-hour="%s">%s</span>',
                    date('H', $timestamp),
                    date('d/m/Y H:i:s', $timestamp)
                );
            case 'status':
                $class = 'success';
                if ($value >= 400) {
                    $class = $value >= 500 ? 'error' : 'warning';
                }
                return sprintf(
                    '<span class="npm-badge status %s">%s</span>',
                    $class,
                    htmlspecialchars($value)
                );
            case 'method':
                return sprintf(
                    '<span class="npm-badge method %s">%s</span>',
                    strtolower($value),
                    htmlspecialchars($value)
                );
            case 'request':
                if ($value === '[object Object]' || empty($value)) {
                    return '-';
                }
                $parts = explode(' ', $value);
                return sprintf(
                    '<div class="request-container"><span class="npm-badge method %s">%s</span><span class="url">%s</span><span class="protocol">%s</span></div>',
                    strtolower($parts[0]),
                    htmlspecialchars($parts[0]),
                    htmlspecialchars($parts[1]),
                    htmlspecialchars($parts[2])
                );
            case 'size':
                if ($value === '-') return '-';
                $size = intval($value);
                $unit = 'B';
                if ($size >= 1024) {
                    $size = round($size / 1024, 1);
                    $unit = 'KB';
                }
                if ($size >= 1024) {
                    $size = round($size / 1024, 1);
                    $unit = 'MB';
                }
                return sprintf(
                    '<span class="log-badge size"><span class="number">%s</span><span class="unit">%s</span></span>',
                    $size,
                    $unit
                );
            case 'client':
            case 'ip':
                return sprintf(
                    '<span class="log-badge client" data-ip-hash="%s">%s</span>',
                    substr(md5($value), 0, 1),
                    htmlspecialchars($value)
                );
            case 'user_agent':
                return sprintf(
                    '<span class="log-badge user-agent">%s</span>',
                    htmlspecialchars($value)
                );
            case 'referer':
                if (empty($value) || $value === '-') {
                    return '-';
                }
                return sprintf(
                    '<span class="log-badge referer">%s</span>',
                    htmlspecialchars($value)
                );
            default:
                return htmlspecialchars($value);
        }
    }

    public function categorizeLogFile($file) {
        $basename = basename($file);
        
        // Exclure les fichiers de position
        if (strpos($basename, '_last_pos') !== false || 
            $basename === 'error_last_pos' || 
            $basename === 'access_last_pos') {
            return null;
        }
        
        // Catégoriser les logs
        if (preg_match('/^(access\.log|error\.log|404_only\.log|other_vhosts_access\.log)/', $basename)) {
            return 'priority';
        } elseif (strpos($basename, 'proxy-host') !== false) {
            return 'proxy_host';
        } elseif (strpos($basename, 'dead-host') !== false) {
            return 'dead_host';
        } elseif (strpos($basename, 'fallback') !== false) {
            return 'fallback';
        } elseif (strpos($basename, 'default-host') !== false) {
            return 'default_host';
        } else {
            return 'other';
        }
    }

    public function getLogsByCategory($directory) {
        $all_logs = [];
        if (is_dir($directory)) {
            $items = scandir($directory);
            foreach ($items as $item) {
                if ($item === '.' || $item === '..') continue;
                
                // Exclure les fichiers de position de logs
                if (strpos($item, '_last_pos') !== false) continue;
                
                $path = $directory . '/' . $item;
                if (is_file($path)) {
                    $all_logs[] = $path;
                }
            }
        }

        $default_host_logs = [];
        $dead_host_logs = [];
        $proxy_host_logs = [];
        $fallback_logs = [];
        $other_logs = [];

        foreach ($all_logs as $log) {
            $basename = basename($log);
            
            // Ignorer les fichiers vides
            if (filesize($log) === 0) continue;
            
            // Ignorer les extensions exclues
            $extension = pathinfo($log, PATHINFO_EXTENSION);
            if (in_array($extension, ['gz', 'zip', 'bz2', 'old', 'bak'])) continue;
            
            // Ignorer les fichiers de rotation numérotés sauf .1
            if (preg_match('/\.log\.[2-9]$/', $basename)) continue;
            
            // Catégoriser les logs
            if (strpos($basename, 'default-host') !== false) {
                $default_host_logs[] = $log;
            } elseif (strpos($basename, 'dead-host') !== false) {
                $dead_host_logs[] = $log;
            } elseif (strpos($basename, 'proxy-host') !== false) {
                $proxy_host_logs[] = $log;
            } elseif (strpos($basename, 'fallback') !== false) {
                $fallback_logs[] = $log;
            } else {
                $other_logs[] = $log;
            }
        }

        // Trier les logs dans chaque catégorie
        sort($default_host_logs);
        sort($dead_host_logs);
        sort($proxy_host_logs);
        sort($fallback_logs);
        sort($other_logs);

        return [
            'default' => $default_host_logs,
            'dead' => $dead_host_logs,
            'proxy' => $proxy_host_logs,
            'fallback' => $fallback_logs,
            'other' => $other_logs
        ];
    }

    public function getLogType($file) {
        $basename = strtolower(basename($file));
        
        if (strpos($basename, 'error') !== false) {
            if (strpos($basename, 'dead-host') !== false) {
                return 'dead_host_error';
            } elseif (strpos($basename, 'fallback') !== false) {
                return 'fallback_error';
            } elseif (strpos($basename, 'default-host') !== false) {
                return 'default_host_error';
            } elseif (strpos($basename, 'proxy-host') !== false) {
                return 'proxy_host_error';
            } else {
                return 'error';
            }
        } else {
            if (strpos($basename, 'dead-host') !== false) {
                return 'dead_host_access';
            } elseif (strpos($basename, 'fallback') !== false) {
                return 'fallback_access';
            } elseif (strpos($basename, 'default-host') !== false) {
                return 'default_host_access';
            } elseif (strpos($basename, 'proxy-host') !== false) {
                return 'proxy_host_access';
            } else {
                return 'access';
            }
        }
    }
} 