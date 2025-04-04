<?php
require_once __DIR__ . '/ApacheParser.php';
require_once __DIR__ . '/Apache404Parser.php';
require_once __DIR__ . '/ApacheErrorParser.php';
require_once __DIR__ . '/NginxParser.php';
require_once __DIR__ . '/NginxProxyManagerParser.php';
require_once __DIR__ . '/SyslogParser.php';

class ParserFactory {
    private static $instances = [];
    private static $config;
    
    public static function setConfig($config) {
        self::$config = $config;
    }
    
    public static function log($message, $level = 'DEBUG') {
        // Vérification de base de la configuration
        if (!is_array(self::$config)) {
            error_log("[ERROR] Configuration non initialisée dans ParserFactory");
            return;
        }

        if (!isset(self::$config['debug']) || !is_array(self::$config['debug'])) {
            error_log("[ERROR] Configuration debug manquante ou invalide");
            return;
        }

        // Définir la hiérarchie des niveaux de log
        $logLevels = [
            'DEBUG' => 0,    // Le plus bas niveau, affiche tout
            'INFO' => 1,     // Informations générales
            'NOTICE' => 2,   // Notices importantes
            'WARNING' => 3,  // Avertissements
            'ERROR' => 4     // Erreurs
        ];
        
        // Si le debug est désactivé, on ne log que les erreurs
        if (!isset(self::$config['debug']['enabled']) || !self::$config['debug']['enabled']) {
            if ($level === 'ERROR') {
                error_log("[$level] $message");
            }
            return;
        }
        
        // Si le debug est activé, on log selon le niveau configuré
        $configLevel = isset(self::$config['debug']['log_level']) ? strtoupper(self::$config['debug']['log_level']) : 'ERROR';
        $currentLevel = strtoupper($level);
        
        if (isset($logLevels[$configLevel]) && isset($logLevels[$currentLevel])) {
            // Si le niveau actuel est supérieur ou égal au niveau configuré
            if ($logLevels[$currentLevel] >= $logLevels[$configLevel]) {
                error_log("[$level] $message");
            }
        }
    }
    
    public static function getParser($type) {
        if (!isset(self::$instances[$type])) {
            if (!is_array(self::$config)) {
                self::log("Configuration non initialisée", 'ERROR');
                throw new Exception("Configuration non initialisée");
            }

            $debug = isset(self::$config['debug']['enabled']) && self::$config['debug']['enabled'];
            
            try {
                switch ($type) {
                    case 'apache':
                        self::$instances[$type] = new ApacheParser($debug);
                        break;
                    case 'apache404':
                        self::$instances[$type] = new Apache404Parser($debug);
                        break;
                    case 'apache_error':
                        self::$instances[$type] = new ApacheErrorParser($debug);
                        break;
                    case 'nginx':
                        self::$instances[$type] = new NginxParser($debug);
                        break;
                    case 'npm':
                        self::$instances[$type] = new NginxProxyManagerParser($debug);
                        break;
                    case 'syslog':
                        self::$instances[$type] = new SyslogParser($debug);
                        break;
                    case 'raw':
                        self::$instances[$type] = new NginxProxyManagerParser($debug);
                        break;
                    default:
                        self::log("Type de parser inconnu: " . $type, 'ERROR');
                        throw new Exception("Type de parser inconnu: $type");
                }
                
                self::log("Parser créé avec succès pour le type: " . $type);
            } catch (Exception $e) {
                self::log("Erreur lors de la création du parser: " . $e->getMessage(), 'ERROR');
                throw $e;
            }
        }
        
        return self::$instances[$type];
    }
    
    private static function shouldSkipFile($filePath) {
        // Vérifier si le fichier est vide
        if (filesize($filePath) === 0) {
            self::log("Fichier vide ignoré: " . $filePath, 'DEBUG');
            return true;
        }

        // Vérifier les extensions à masquer depuis la config
        if (isset(self::$config['hidden_extensions']) && is_array(self::$config['hidden_extensions'])) {
            $extension = pathinfo($filePath, PATHINFO_EXTENSION);
            if (in_array($extension, self::$config['hidden_extensions'])) {
                self::log("Extension masquée ignorée: " . $extension, 'DEBUG');
                return true;
            }
        }

        // Vérifier les patterns de fichiers à masquer
        if (isset(self::$config['hidden_patterns']) && is_array(self::$config['hidden_patterns'])) {
            $basename = basename($filePath);
            foreach (self::$config['hidden_patterns'] as $pattern) {
                if (preg_match($pattern, $basename)) {
                    self::log("Pattern masqué ignoré: " . $basename, 'DEBUG');
                    return true;
                }
            }
        }

        return false;
    }

    public static function detectLogType($filePath) {
        self::log("Début de la détection du type de log pour le fichier: " . $filePath);
        
        // Vérifier si le fichier existe
        if (!file_exists($filePath)) {
            self::log("Le fichier n'existe pas: " . $filePath, 'ERROR');
            throw new Exception("Le fichier n'existe pas: $filePath");
        }

        // Vérifier si le fichier doit être ignoré
        if (self::shouldSkipFile($filePath)) {
            self::log("Fichier ignoré selon les critères: " . $filePath, 'INFO');
            return null;
        }
        
        // Lire les premières lignes du fichier pour analyse
        $handle = fopen($filePath, "r");
        if (!$handle) {
            self::log("Impossible d'ouvrir le fichier: " . $filePath, 'ERROR');
            throw new Exception("Impossible d'ouvrir le fichier: $filePath");
        }
        
        $firstLine = fgets($handle);
        fclose($handle);
        
        if ($firstLine === false) {
            self::log("Fichier vide ou illisible: " . $filePath, 'ERROR');
            return null;
        }

        self::log("Première ligne du fichier: " . substr($firstLine, 0, 150));
        
        // Détection par le nom du fichier d'abord
        $basename = basename($filePath);
        self::log("Analyse du nom du fichier: " . $basename);
        
        // Détection des logs système spécifiques
        if (preg_match('/^(syslog|auth\.log|kern\.log|daemon\.log|debug|messages|cron\.log)$/', $basename)) {
            self::log("Type détecté: syslog (par nom de fichier système)");
            return ['type' => 'syslog', 'subtype' => 'syslog'];
        }
        
        // Détection des logs Apache et Nginx par nom
        if (preg_match('/^error\.log/', $basename)) {
            self::log("Type détecté: apache_error (par nom de fichier)");
            return ['type' => 'apache_error', 'subtype' => 'error'];
        }
        
        if (preg_match('/^access\.log/', $basename)) {
            self::log("Type détecté: apache (par nom de fichier)");
            return ['type' => 'apache', 'subtype' => 'access'];
        }
        
        if (preg_match('/^nginx.*\.error\.log/', $basename)) {
            self::log("Type détecté: nginx (par nom de fichier)");
            return ['type' => 'nginx', 'subtype' => 'error'];
        }
        
        if (preg_match('/^nginx.*\.access\.log/', $basename)) {
            self::log("Type détecté: nginx (par nom de fichier)");
            return ['type' => 'nginx', 'subtype' => 'access'];
        }
        
        // Vérifier si c'est un log NPM
        if (isset(self::$config['nginx']['use_npm']) && self::$config['nginx']['use_npm'] && 
            (strpos($basename, 'proxy-host') !== false || strpos($filePath, 'proxy_host') !== false)) {
            self::log("Type détecté: npm (par nom de fichier)");
            return ['type' => 'npm', 'subtype' => strpos($basename, 'error') !== false ? 'error' : 'access'];
        }
        
        // Si le nom de fichier ne correspond pas, analyser le contenu
        if (empty($firstLine)) {
            self::log("Fichier vide: " . $filePath, 'WARNING');
            return ['type' => 'raw', 'subtype' => null];
        }
        
        // Syslog pattern
        if (preg_match('/^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+([^:]+):/', $firstLine)) {
            self::log("Type détecté: syslog (par contenu)");
            return ['type' => 'syslog', 'subtype' => 'syslog'];
        }
        
        // Apache error log pattern
        if (preg_match('/^\[([A-Za-z]{3} [A-Za-z]{3}\s+\d{1,2} \d{2}:\d{2}:\d{2}(?:\.\d+)? \d{4})\] \[([^:]+):([^\]]+)\]/', $firstLine)) {
            self::log("Type détecté: apache_error (par contenu)");
            return ['type' => 'apache_error', 'subtype' => 'error'];
        }
        
        // Apache access log pattern
        if (preg_match('/^(\S+) (\S+) (\S+) (\S+) \[([^\]]+)\] "/', $firstLine)) {
            self::log("Type détecté: apache (par contenu)");
            return ['type' => 'apache', 'subtype' => 'access'];
        }
        
        // Nginx error log pattern
        if (preg_match('/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} \[/', $firstLine)) {
            self::log("Type détecté: nginx (par contenu)");
            return ['type' => 'nginx', 'subtype' => 'error'];
        }
        
        // Nginx access log pattern
        if (preg_match('/^(\S+) - \S+ \[([^\]]+)\] "/', $firstLine)) {
            self::log("Type détecté: nginx (par contenu)");
            return ['type' => 'nginx', 'subtype' => 'access'];
        }
        
        // Si aucun type n'est détecté, vérifier le chemin du fichier
        if (strpos($filePath, '/var/log/apache') !== false) {
            self::log("Type détecté: apache (par chemin)");
            return ['type' => 'apache', 'subtype' => 'access'];
        }
        
        if (strpos($filePath, '/var/log/nginx') !== false) {
            self::log("Type détecté: nginx (par chemin)");
            return ['type' => 'nginx', 'subtype' => 'access'];
        }
        
        // Par défaut, utiliser le mode brut
        self::log("Aucun type détecté, utilisation du mode brut", 'WARNING');
        return ['type' => 'raw', 'subtype' => null];
    }
    
    public static function getColumns($type, $subtype = null) {
        $parser = self::getParser($type);
        return $parser->getColumns($subtype);
    }
} 