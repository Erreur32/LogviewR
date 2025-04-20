<?php
require_once __DIR__ . '/BaseParser.php';

/**
 * ParserFactory class - Factory for creating log parsers
 * 
 * This class is responsible for detecting log types and creating appropriate parser instances.
 * It uses configuration from log_patterns.php to determine the correct parser for each log type.
 */
class ParserFactory {
    private static $instances = [];
    private static $config;
    private static $patterns;
    private static $parserMap = [
        'apache-access' => 'ApacheAccessParser',
        'apache-error' => 'ApacheErrorParser',
        'apache-404' => 'Apache404Parser',
        'apache-referer' => 'ApacheRefererParser',
        'npm-proxy-host-access' => 'NPMProxyHostParser',
        'npm-proxy-host-error' => 'NPMProxyHostParser',
        'npm-default-host-access' => 'NPMDefaultHostParser',
        'npm-default-host-error' => 'NPMDefaultHostParser',
        'npm-dead-host-access' => 'NPMDeadHostParser',
        'npm-dead-host-error' => 'NPMDeadHostParser',
        'npm-fallback-access' => 'NPMFallbackParser',
        'npm-fallback-error' => 'NPMFallbackParser',
        'syslog' => 'SyslogParser',
        'auth-log' => 'SyslogParser',
        'raw' => 'RawParser'
    ];
    private static $debug = false;

    /**
     * Initialize the factory with configuration
     */
    public static function init() {
        // Load configuration
        self::$config = require __DIR__ . '/../config/config.php';
        self::$debug = self::$config['debug']['enabled'] ?? false;
        
        // Load patterns
        self::$patterns = require __DIR__ . '/../config/log_patterns.php';
    }

    /**
     * Set configuration (for backward compatibility)
     * 
     * @param array $config Configuration array
     */
    public static function setConfig($config) {
        self::$config = $config;
        self::$debug = $config['debug']['enabled'] ?? false;
        // Also load patterns if not already loaded
        if (!self::$patterns) {
            self::$patterns = require __DIR__ . '/../config/log_patterns.php';
        }
    }

    /**
     * Detect the type of log file based on its path and name
     * 
     * @param string $filePath Full path to the log file or log type
     * @return string|null The detected log type or null if not recognized
     */
    public static function detectLogType($filePath) {
        if (self::$debug) {
            error_log("[INFO] ParserFactory: Detecting log type for file: " . $filePath);
        }

        // Si le type est déjà connu (ex: "apache-error"), on le retourne directement
        if (isset(self::$parserMap[$filePath])) {
            if (self::$debug) {
                error_log("[INFO] ParserFactory: Using provided log type: " . $filePath);
            }
            return $filePath;
        }

        $filename = basename($filePath);
        $dirname = dirname($filePath);
        
        // Check for Syslog first
        if (strpos($dirname, '/var/log') !== false) {
            if (preg_match('/syslog(\.\d+)?$/', $filename)) {
                if (self::$debug) {
                    error_log("[INFO] ParserFactory: Detected Syslog from path: " . $filePath);
                }
                return 'syslog';
            } elseif (preg_match('/auth\.log(\.\d+)?$/', $filename)) {
                if (self::$debug) {
                    error_log("[INFO] ParserFactory: Detected Auth log from path: " . $filePath);
                }
                return 'auth-log';
            }
        }
        
        // Check for Apache logs
        if (strpos($dirname, '/var/log/apache2') !== false || strpos($dirname, '/var/log/httpd') !== false) {
            // Apache access logs with domain names
            if (preg_match('/access\.([a-zA-Z0-9.-]+)\.log(\.\d+)?$/', $filename)) {
                if (self::$debug) {
                    error_log("[INFO] ParserFactory: Detected Apache access log with domain from path: " . $filePath);
                }
                return 'apache-access';
            }
            // Standard Apache access logs
            elseif (preg_match('/access\.log(\.\d+)?$/', $filename)) {
                if (self::$debug) {
                    error_log("[INFO] ParserFactory: Detected Apache access log from path: " . $filePath);
                }
                return 'apache-access';
            }
            // Error logs
            elseif (preg_match('/error\.log(\.\d+)?$/', $filename)) {
                if (self::$debug) {
                    error_log("[INFO] ParserFactory: Detected Apache error log from path: " . $filePath);
                }
                return 'apache-error';
            }
            // 404 logs
            elseif (preg_match('/404_only\.log(\.\d+)?$/', $filename)) {
                if (self::$debug) {
                    error_log("[INFO] ParserFactory: Detected Apache 404 log from path: " . $filePath);
                }
                return 'apache-404';
            }
            // Referer logs
            elseif (preg_match('/referer\.log(\.\d+)?$/', $filename)) {
                if (self::$debug) {
                    error_log("[INFO] ParserFactory: Detected Apache referer log from path: " . $filePath);
                }
                return 'apache-referer';
            }
        }

        // Check for Nginx/NPM logs
        if (strpos($dirname, '/var/log/nginx') !== false || strpos($dirname, '/var/log/npm') !== false) {
            // NPM Proxy Host logs
            if (preg_match('/proxy-host-(\d+)_(access|error)\.log(\.\d+)?$/', $filename, $matches)) {
                if (self::$debug) {
                    error_log("[INFO] ParserFactory: Detected NPM Proxy Host " . $matches[2] . " log from path: " . $filePath);
                }
                return 'npm-proxy-host-' . $matches[2];
            }
            // NPM Default Host logs
            elseif (preg_match('/default-host_(access|error)\.log(\.\d+)?$/', $filename, $matches)) {
                if (self::$debug) {
                    error_log("[INFO] ParserFactory: Detected NPM Default Host " . $matches[1] . " log from path: " . $filePath);
                }
                return 'npm-default-host-' . $matches[1];
            }
            // NPM Dead Host logs
            elseif (preg_match('/dead-host-(\d+)_(access|error)\.log(\.\d+)?$/', $filename, $matches)) {
                if (self::$debug) {
                    error_log("[INFO] ParserFactory: Detected NPM Dead Host " . $matches[2] . " log from path: " . $filePath);
                }
                return 'npm-dead-host-' . $matches[2];
            }
            // NPM Fallback logs
            elseif (preg_match('/fallback_(access|error)\.log(\.\d+)?$/', $filename, $matches)) {
                if (self::$debug) {
                    error_log("[INFO] ParserFactory: Detected NPM Fallback " . $matches[1] . " log from path: " . $filePath);
                }
                return 'npm-fallback-' . $matches[1];
            }
            // Standard Nginx logs
            elseif (preg_match('/access\.log(\.\d+)?$/', $filename)) {
                if (self::$debug) {
                    error_log("[INFO] ParserFactory: Detected Nginx access log from path: " . $filePath);
                }
                return 'nginx-access';
            }
            elseif (preg_match('/error\.log(\.\d+)?$/', $filename)) {
                if (self::$debug) {
                    error_log("[INFO] ParserFactory: Detected Nginx error log from path: " . $filePath);
                }
                return 'nginx-error';
            }
        }

        // Only use RawParser for truly unknown files
        if (self::$debug) {
            error_log("[WARNING] ParserFactory: No specific parser found for file: " . $filePath);
        }
        return 'raw';
    }

    /**
     * Get the appropriate parser for a log file
     * 
     * @param string $filePath Full path to the log file
     * @return BaseParser The appropriate parser instance
     * @throws Exception If no parser is found for the log type
     */
    public static function getParser($filePath) {
        $filename = basename($filePath);
        
        // Essayer de détecter le type de log
        $logType = self::detectLogType($filePath);
        
        // Si aucun parser n'est trouvé
        if (!isset(self::$parserMap[$logType])) {
            // Vérifier si c'est un fichier texte
            $finfo = finfo_open(FILEINFO_MIME_TYPE);
            $mime_type = finfo_file($finfo, $filePath);
            finfo_close($finfo);
            
            // Si c'est un fichier texte, utiliser le RawParser
            if (strpos($mime_type, 'text/') === 0) {
                if (self::$debug) {
                    error_log("[INFO] ParserFactory: Using RawParser for unrecognized text file: " . $filePath);
                }
                require_once __DIR__ . '/RawParser.php';
                return new RawParser();
            }
        }
        
        // Si un parser spécifique est trouvé, l'utiliser
        if (isset(self::$parserMap[$logType])) {
            $parserClass = self::$parserMap[$logType];
            $parserFile = __DIR__ . '/' . $parserClass . '.php';
            
            if (file_exists($parserFile)) {
                require_once $parserFile;
                $parser = new $parserClass();
                
                // Set the type for NPM parsers
                if (strpos($logType, 'npm-') === 0) {
                    $type = substr($logType, strrpos($logType, '-') + 1);
                    $parser->setType($type);
                }
                
                return $parser;
            }
        }
        
        // En dernier recours, utiliser le RawParser
        if (self::$debug) {
            error_log("[INFO] ParserFactory: Falling back to RawParser for: " . $filePath);
        }
        require_once __DIR__ . '/RawParser.php';
        return new RawParser();
    }

    /**
     * Log a message with optional level
     * 
     * @param string $message The message to log
     * @param string $level The log level (default: 'INFO')
     */
    private static function log($message, $level = 'INFO') {
        if (isset(self::$config['debug']) && self::$config['debug']) {
            error_log("[$level] ParserFactory: $message");
        }
    }

    public static function getColumns($type, $subtype = null) {
        $parser = self::getParser($type);
        return $parser->getColumns($subtype);
    }
} 