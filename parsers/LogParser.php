<?php
require_once __DIR__ . '/BaseParser.php';

/**
 * LogParser - Parser centralisé pour tous les types de logs
 * 
 * Ce parser unique gère tous les types de logs en utilisant les configurations
 * définies dans config/log_patterns.php
 */
class LogParser extends BaseParser {
    private $patterns;
    private $debugMode;
    private $excludePatterns;
    
    /**
     * Constructeur
     * 
     * @param bool $debug Mode debug activé ou non
     */
    public function __construct($debug = false) {
        $this->debugMode = $debug;
        $this->patterns = require __DIR__ . '/../config/log_patterns.php';
        $this->excludePatterns = $this->patterns['filters']['exclude'] ?? [];
        
        // Initialiser les colonnes à partir des patterns
        $this->initializeColumns();
        
        if ($this->debugMode) {
            error_log("=== LogParser initialized ===");
            error_log("Debug mode: " . ($this->debugMode ? "enabled" : "disabled"));
        }
    }
    
    /**
     * Initialise les colonnes à partir des patterns
     */
    private function initializeColumns() {
        foreach ($this->patterns as $mainType => $subTypes) {
            if (is_array($subTypes)) {
                foreach ($subTypes as $subType => $config) {
                    if (isset($config['columns'])) {
                        $type = $mainType . '_' . $subType;
                        $this->columns[$type] = $config['columns'];
                    }
                }
            }
        }
    }
    
    /**
     * Parse une ligne de log selon son type
     * 
     * @param string $line Ligne de log à parser
     * @param string $type Type de log (apache_access, apache_error, etc.)
     * @return array|null Résultat du parsing ou null si échec
     */
    public function parse($line, $type = null) {
        $line = trim($line);
        if (empty($line)) {
            return null;
        }
        
        // Si le type n'est pas spécifié, essayer de le détecter
        if ($type === null) {
            $type = $this->detectLogType($line);
            if ($this->debugMode) {
                error_log("Detected log type: " . $type);
            }
        }
        
        // Extraire le type principal et le sous-type
        $parts = explode('_', $type);
        $mainType = $parts[0];
        $subType = $parts[1] ?? 'access';
        
        if ($this->debugMode) {
            error_log("=== Start of parsing ===");
            error_log("Line: " . $line);
            error_log("Type: " . $type);
            error_log("Main type: " . $mainType);
            error_log("Sub type: " . $subType);
        }
        
        // Vérifier si le type existe dans la configuration
        if (!isset($this->patterns[$mainType][$subType])) {
            if ($this->debugMode) {
                error_log("Type not found in configuration: " . $type);
            }
            return null;
        }
        
        $config = $this->patterns[$mainType][$subType];
        $pattern = $config['pattern'];
        $columns = $config['columns'];
        
        if ($this->debugMode) {
            error_log("Using pattern: " . $pattern);
        }
        
        // Essayer de parser avec le pattern
        if (preg_match($pattern, $line, $matches)) {
            if ($this->debugMode) {
                error_log("Pattern matched successfully");
                error_log("Matches: " . print_r($matches, true));
            }
            
            // Appliquer les filtres d'exclusion si nécessaire
            if ($this->shouldExclude($matches, $mainType, $subType)) {
                if ($this->debugMode) {
                    error_log("Line excluded by filter");
                }
                return null;
            }
            
            // Formater les données selon le type
            $result = $this->formatData($matches, $mainType, $subType);
            
            if ($this->debugMode) {
                error_log("Formatted result: " . print_r($result, true));
            }
            
            return $result;
        } else {
            if ($this->debugMode) {
                error_log("Pattern did not match");
            }
            
            // Essayer un pattern alternatif si disponible
            if (isset($config['alt_pattern'])) {
                $altPattern = $config['alt_pattern'];
                if (preg_match($altPattern, $line, $matches)) {
                    if ($this->debugMode) {
                        error_log("Alternative pattern matched");
                        error_log("Matches: " . print_r($matches, true));
                    }
                    
                    $result = $this->formatData($matches, $mainType, $subType, true);
                    
                    if ($this->debugMode) {
                        error_log("Formatted result (alternative): " . print_r($result, true));
                    }
                    
                    return $result;
                }
            }
        }
        
        return null;
    }
    
    /**
     * Détecte le type de log à partir d'une ligne
     * 
     * @param string $line Ligne de log
     * @return string Type de log détecté
     */
    public function detectLogType($line) {
        // Parcourir tous les patterns pour trouver une correspondance
        foreach ($this->patterns as $mainType => $subTypes) {
            if (is_array($subTypes)) {
                foreach ($subTypes as $subType => $config) {
                    if (isset($config['pattern']) && preg_match($config['pattern'], $line)) {
                        return $mainType . '_' . $subType;
                    }
                }
            }
        }
        
        // Par défaut, essayer de détecter par le contenu
        if (strpos($line, '[error]') !== false || strpos($line, '[warn]') !== false) {
            return 'apache_error';
        } else if (strpos($line, 'referer') !== false) {
            return 'apache_referer';
        } else if (strpos($line, '404') !== false) {
            return 'apache404';
        }
        
        // Par défaut, considérer comme un log d'accès Apache
        return 'apache_access';
    }
    
    /**
     * Vérifie si une ligne doit être exclue selon les filtres
     * 
     * @param array $matches Résultats du matching regex
     * @param string $mainType Type principal
     * @param string $subType Sous-type
     * @return bool True si la ligne doit être exclue
     */
    private function shouldExclude($matches, $mainType, $subType) {
        // Extraire les informations pertinentes selon le type
        $ip = null;
        $request = null;
        $userAgent = null;
        $user = null;
        $referer = null;
        
        // Mapper les indices selon le type
        switch ($mainType . '_' . $subType) {
            case 'apache_access':
                $ip = $matches[3] ?? null;
                $request = $matches[7] ?? null;
                $userAgent = $matches[11] ?? null;
                $user = $matches[5] ?? null;
                $referer = $matches[10] ?? null;
                break;
            case 'apache_error':
                $ip = $matches[6] ?? null;
                break;
            case 'apache_referer':
                $ip = $matches[3] ?? null;
                $user = $matches[4] ?? null;
                $referer = $matches[6] ?? null;
                break;
            case 'nginx_access':
                $ip = $matches[1] ?? null;
                $request = $matches[3] ?? null;
                $userAgent = $matches[7] ?? null;
                break;
            case 'nginx_error':
                $ip = $matches[6] ?? null;
                break;
            case 'syslog':
                $ip = $matches[1] ?? null;
                $request = $matches[3] ?? null;
                $userAgent = $matches[7] ?? null;
                break;
            case 'npm-proxy-host-access':
            case 'npm-default-host-access':
            case 'npm-dead-host-access':
            case 'npm-fallback-access':
                $ip = $matches[7] ?? null; // Client IP
                $request = $matches[6] ?? null; // Request
                $userAgent = $matches[11] ?? null; // User Agent
                break;
            case 'npm-proxy-host-error':
            case 'npm-default-host-error':
            case 'npm-dead-host-error':
            case 'npm-fallback-error':
                $ip = $matches[6] ?? null; // Client IP
                break;
        }
        
        // Vérifier les filtres d'exclusion
        if (isset($this->excludePatterns['ips']) && $ip) {
            foreach ($this->excludePatterns['ips'] as $pattern) {
                $cleanIp = trim(preg_replace('/:\d+$/', '', $ip));
                if (preg_match($pattern, $cleanIp)) {
                    return true;
                }
            }
        }
        
        if (isset($this->excludePatterns['requests']) && $request) {
            foreach ($this->excludePatterns['requests'] as $pattern) {
                if (preg_match($pattern, $request)) {
                    return true;
                }
            }
        }
        
        if (isset($this->excludePatterns['user_agents']) && $userAgent) {
            foreach ($this->excludePatterns['user_agents'] as $pattern) {
                if (preg_match($pattern, $userAgent)) {
                    return true;
                }
            }
        }
        
        if (isset($this->excludePatterns['users']) && $user) {
            foreach ($this->excludePatterns['users'] as $pattern) {
                if (preg_match($pattern, $user)) {
                    return true;
                }
            }
        }
        
        // Vérifier les filtres d'exclusion pour les referers
        if (isset($this->excludePatterns['referers']) && $referer) {
            foreach ($this->excludePatterns['referers'] as $pattern) {
                if (preg_match($pattern, $referer)) {
                    return true;
                }
            }
        }
        
        return false;
    }
    
    /**
     * Formate les données selon le type de log
     * 
     * @param array $matches Résultats du matching regex
     * @param string $mainType Type principal
     * @param string $subType Sous-type
     * @param bool $isAltPattern Si on utilise un pattern alternatif
     * @return array Données formatées
     */
    private function formatData($matches, $mainType, $subType, $isAltPattern = false) {
        $result = [];
        
        // Extraire le type complet
        $type = $mainType . '_' . $subType;
        
        // Récupérer les colonnes pour ce type
        $columns = $this->columns[$type] ?? [];
        
        if ($this->debugMode) {
            error_log("Formatting data for type: " . $type);
            error_log("Columns: " . print_r($columns, true));
        }
        
        // Formater les données selon le type
        switch ($type) {
            case 'apache_access':
                $result = [
                    'ip' => $this->formatIp($matches[3] ?? '-'),
                    'date' => $this->formatDate($matches[4] ?? '-'),
                    'user' => $this->formatUser($matches[5] ?? '-'),
                    'request' => $this->formatRequest($matches[7] ?? '-'),
                    'status' => $this->formatStatusCode($matches[8] ?? '-'),
                    'size' => $this->formatSize($matches[9] ?? '-'),
                    'referer' => $this->formatReferer($matches[10] ?? '-'),
                    'user_agent' => htmlspecialchars($matches[11] ?? '-')
                ];
                break;
            case 'npm-proxy-host-access':
            case 'npm-default-host-access':
            case 'npm-dead-host-access':
            case 'npm-fallback-access':
                $result = [
                    'date' => $this->formatDate($matches[1] ?? '-'),
                    'status_in' => $this->formatStatusCode($matches[2] ?? '-'),
                    'status_out' => $this->formatStatusCode($matches[3] ?? '-'),
                    'method' => $this->formatMethodBadge($matches[4] ?? '-'),
                    'protocol' => $this->formatProtocolBadge($matches[5] ?? '-'),
                    'host' => $this->formatHostBadge($matches[6] ?? '-'),
                    'request' => $this->formatRequestBadge($matches[7] ?? '-', $matches[8] ?? '-'),
                    'client_ip' => $this->formatIpBadge($matches[9] ?? '-'),
                    'length' => $this->formatSize($matches[10] ?? '-'),
                    'gzip' => $this->formatGzipBadge($matches[11] ?? '-'),
                    'sent_to' => $this->formatIpBadge($matches[12] ?? '-'),
                    'user_agent' => $this->formatUserAgentBadge($matches[13] ?? '-'),
                    'referer' => $this->formatRefererBadge($matches[14] ?? '-')
                ];
                break;
            case 'npm-proxy-host-error':
            case 'npm-default-host-error':
            case 'npm-dead-host-error':
            case 'npm-fallback-error':
                $result = [
                    'date' => $this->formatDate($matches[1] ?? '-'),
                    'level' => $this->formatErrorLevel($matches[2] ?? '-'),
                    'process' => $this->formatPid($matches[3] ?? '-'),
                    'connection' => $this->formatTid($matches[4] ?? '-'),
                    'message' => htmlspecialchars($matches[5] ?? '-'),
                    'client' => $this->formatIpBadge($matches[6] ?? '-'),
                    'server' => $this->formatIpBadge($matches[7] ?? '-'),
                    'request' => $this->formatRequestBadge($matches[8] ?? '-', ''),
                    'host' => $this->formatHostBadge($matches[9] ?? '-')
                ];
                break;
            case 'apache_error':
                $result['date'] = $this->formatDate($matches[1]);
                $result['module'] = htmlspecialchars($matches[2]);
                $result['level'] = $this->formatErrorLevel($matches[3]);
                $result['pid'] = isset($matches[4]) ? $this->formatPid($matches[4]) : '';
                $result['tid'] = isset($matches[5]) ? $this->formatTid($matches[5]) : '';
                $result['client'] = isset($matches[6]) ? $this->formatClient($matches[6]) : '';
                $result['message'] = htmlspecialchars($matches[7]);
                break;
            case 'apache_referer':
                $result['date'] = $this->formatDate($matches[5]);
                $result['host'] = $this->formatHost($matches[1]);
                $result['ip'] = $this->formatIp($matches[3]);
                $result['identd'] = htmlspecialchars($matches[2] ?? '-');
                $result['user'] = $this->formatUser($matches[4]);
                $result['referer'] = $this->formatReferer($matches[6]);
                $result['server'] = htmlspecialchars($matches[7] ?? '-');
                $result['path'] = htmlspecialchars($matches[8] ?? '-');
                break;
            case 'apache404':
                $result['date'] = $this->formatDate($matches[5]);
                $result['host'] = $this->formatHost($matches[1], $matches[2] ?? null);
                $result['ip'] = $this->formatIp($matches[3]);
                $result['user'] = $this->formatUser($matches[4]);
                $result['request'] = $this->formatRequest($matches[6]);
                $result['size'] = $this->formatSize($matches[7]);
                $result['referer'] = $this->formatReferer($matches[8] ?? '-');
                $result['user_agent'] = htmlspecialchars($matches[9] ?? '-');
                break;
        }
        
        return $result;
    }
    
    /**
     * Formate une date
     * 
     * @param string $dateStr Date à formater
     * @return string Date formatée
     */
    protected function formatDate($dateStr) {
        // Format: "Day Mon DD HH:MM:SS.UUUUUU YYYY" ou "YYYY/MM/DD HH:MM:SS"
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
    
    /**
     * Formate un hôte
     * 
     * @param string $host Hôte
     * @param string|null $port Port
     * @return string Hôte formaté
     */
    private function formatHost($host, $port = null) {
        $hostname = $port ? sprintf('%s:%s', $host, $port) : $host;
        return sprintf(
            '<span class="host-badge" data-host-hash="%d">%s</span>',
            abs(crc32($host) % 10),
            htmlspecialchars($hostname)
        );
    }
    
    /**
     * Formate une adresse IP
     * 
     * @param string $ip IP
     * @return string IP formatée
     */
    private function formatIp($ip) {
        return sprintf(
            '<span class="ip-badge%s" data-ip-hash="%d">%s</span>',
            $ip === '-' ? ' ip-empty' : '',
            $ip !== '-' ? abs(crc32($ip) % 10) : 0,
            htmlspecialchars($ip)
        );
    }
    
    /**
     * Formate un utilisateur
     * 
     * @param string $user Utilisateur
     * @return string Utilisateur formaté
     */
    private function formatUser($user) {
        $userClass = $this->getUserClass($user);
        return sprintf(
            '<span class="apache-badge user" data-user="%s">%s</span>',
            htmlspecialchars($userClass),
            htmlspecialchars($user)
        );
    }
    
    /**
     * Formate une requête
     * 
     * @param string $request Requête
     * @return string Requête formatée
     */
    private function formatRequest($request) {
        if (!preg_match('/^(\S+)\s+(\S+)(?:\s+(\S+))?$/', $request, $parts)) {
            return htmlspecialchars($request);
        }
        
        $method = $parts[1] ?? '-';
        $url = $parts[2] ?? '-';
        
        return sprintf(
            '<div class="request-container"><span class="badge method %s">%s</span><span class="path">%s</span></div>',
            strtolower($method),
            htmlspecialchars($method),
            htmlspecialchars($url)
        );
    }
    
    /**
     * Formate un code de statut
     * 
     * @param string $code Code
     * @return string Code formaté
     */
    private function formatStatusCode($code) {
        $code = intval($code);
        $class = '';
        
        if ($code >= 500) {
            $class = 'server_error';
        } elseif ($code >= 400) {
            $class = 'client_error';
        } elseif ($code >= 300) {
            $class = 'redirect';
        } elseif ($code >= 200) {
            $class = 'success';
        } elseif ($code >= 100) {
            $class = 'info';
        }
        
        return sprintf(
            '<span class="status-badge status-%s" data-status="%d">%d</span>',
            $class,
            $code,
            $code
        );
    }
    
    /**
     * Formate une taille
     * 
     * @param string $size Taille
     * @return string Taille formatée
     */
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
    
    /**
     * Formate un referer
     * 
     * @param string $referer Referer
     * @return string Referer formaté
     */
    private function formatReferer($referer) {
        return htmlspecialchars($referer);
    }
    
    /**
     * Formate un niveau d'erreur
     * 
     * @param string $level Niveau
     * @return string Niveau formaté
     */
    private function formatErrorLevel($level) {
        $levelClass = $this->getErrorLevelClass($level);
        return sprintf(
            '<span class="badge level %s">%s</span>',
            $levelClass,
            htmlspecialchars($level)
        );
    }
    
    /**
     * Formate un PID
     * 
     * @param string $pid PID
     * @return string PID formaté
     */
    private function formatPid($pid) {
        return sprintf(
            '<span class="pid-badge">PID: %s</span>',
            htmlspecialchars($pid)
        );
    }
    
    /**
     * Formate un TID
     * 
     * @param string $tid TID
     * @return string TID formaté
     */
    private function formatTid($tid) {
        return sprintf(
            '<span class="tid-badge">TID: %s</span>',
            htmlspecialchars($tid)
        );
    }
    
    /**
     * Formate un client
     * 
     * @param string $client Client
     * @return string Client formaté
     */
    private function formatClient($client) {
        return sprintf(
            '<span class="client-badge">%s</span>',
            htmlspecialchars($client)
        );
    }
    
    /**
     * Obtient la classe d'un utilisateur
     * 
     * @param string $user Utilisateur
     * @return string Classe
     */
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
    
    /**
     * Obtient la classe d'un niveau d'erreur
     * 
     * @param string $level Niveau
     * @return string Classe
     */
    private function getErrorLevelClass($level) {
        $level = strtoupper($level);
        switch ($level) {
            case 'EMERG':
            case 'ALERT':
            case 'CRIT':
            case 'ERROR':
                return 'error';
            case 'WARN':
            case 'WARNING':
                return 'warning';
            case 'NOTICE':
            case 'INFO':
                return 'info';
            case 'DEBUG':
                return 'debug';
            default:
                return 'default';
        }
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
        return sprintf(
            '<span class="npm-request">%s %s</span>',
            htmlspecialchars($method),
            htmlspecialchars($path)
        );
    }

    protected function formatHostBadge($host) {
        return sprintf(
            '<span class="npm-badge host">%s</span>',
            htmlspecialchars($host)
        );
    }

    protected function formatIpBadge($ip) {
        return sprintf(
            '<span class="npm-badge ip">%s</span>',
            htmlspecialchars($ip)
        );
    }

    protected function formatUserAgentBadge($userAgent) {
        return sprintf(
            '<span class="npm-badge user-agent">%s</span>',
            htmlspecialchars($userAgent)
        );
    }

    protected function formatRefererBadge($referer) {
        return sprintf(
            '<span class="npm-badge referer">%s</span>',
            htmlspecialchars($referer)
        );
    }
} 