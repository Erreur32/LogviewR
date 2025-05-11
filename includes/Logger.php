<?php
/**
 * Logger class for handling debug logs
 */
class Logger {
    private static $instance = null;
    private $logFile;
    private $enabled;
    private $logFormat;
    private $logLevel;
    private $timestampFormat;
    private $maxLogSize;
    private $rotateLogs;
    private $maxFiles;

    private function __construct() {
        // Load configuration with error handling
        try {
            // Check for user config first
            $configFile = __DIR__ . '/../config/config.user.php';
            if (!file_exists($configFile)) {
            $configFile = __DIR__ . '/../config/config.php';
            }
            
            if (!file_exists($configFile)) {
                throw new Exception("Le fichier de configuration n'existe pas: $configFile");
            }
            
            $config = require $configFile;
            if (!is_array($config)) {
                throw new Exception('Configuration invalide: le fichier de configuration doit retourner un tableau');
            }
            
            // Set default values if not present in config
            $this->enabled = $config['debug']['enabled'] ?? false;
            $this->logFormat = $config['debug']['log_format'] ?? '[%timestamp%] [%level%] %message%';
            $this->logLevel = $config['debug']['log_level'] ?? 'DEBUG';
            $this->timestampFormat = $config['debug']['timestamp_format'] ?? 'd-M-Y H:i:s T';
            $this->maxLogSize = $this->parseSize($config['debug']['max_log_size'] ?? '10M');
            $this->rotateLogs = $config['debug']['rotate_logs'] ?? true;
            $this->maxFiles = $config['debug']['max_files'] ?? 5;
            
            // Set timezone from config or use default
            $timezone = $config['timezone'] ?? 'Europe/Paris';
            if (!in_array($timezone, timezone_identifiers_list())) {
                $timezone = 'Europe/Paris';
            }
            date_default_timezone_set($timezone);
            
            // Use log file path from config or fallback to default
            $this->logFile = $config['debug']['log_file'] ?? dirname(__DIR__) . DIRECTORY_SEPARATOR . 'logs' . DIRECTORY_SEPARATOR . 'debug.log';
            
            // Create log directory if it doesn't exist
            $logDir = dirname($this->logFile);
            if (!is_dir($logDir)) {
                if (!mkdir($logDir, 0755, true)) {
                    throw new Exception("Impossible de créer le répertoire de logs: $logDir");
                }
            }
            
            // Log initialization
            $this->log("Logger initialisé avec succès", 'DEBUG');
            $this->log("Fuseau horaire: " . date_default_timezone_get(), 'DEBUG');
            $this->log("Fichier de log: " . $this->logFile, 'DEBUG');
            
        } catch (Exception $e) {
            // Fallback to default values if config loading fails
            $this->enabled = false;
            $this->logFormat = '[%timestamp%] [%level%] %message%';
            $this->logLevel = 'DEBUG';
            $this->timestampFormat = 'd-M-Y H:i:s T';
            $this->maxLogSize = 10 * 1024 * 1024; // 10MB
            $this->rotateLogs = true;
            $this->maxFiles = 5;
            date_default_timezone_set('Europe/Paris');
            $this->logFile = __DIR__ . '/../logs/debug.log';
            
            error_log("Erreur d'initialisation du Logger: " . $e->getMessage());
        }
    }

    /**
     * Convert size string to bytes
     * @param string $size Size string (e.g., "10M", "1G")
     * @return int Size in bytes
     */
    private function parseSize($size) {
        $unit = strtolower(substr($size, -1));
        $value = (int)substr($size, 0, -1);
        
        switch ($unit) {
            case 'g':
                return $value * 1024 * 1024 * 1024;
            case 'm':
                return $value * 1024 * 1024;
            case 'k':
                return $value * 1024;
            default:
                return (int)$size;
        }
    }

    /**
     * Rotate log files if needed
     */
    private function rotateLogsIfNeeded() {
        if (!$this->rotateLogs || !file_exists($this->logFile)) {
            return;
        }

        $size = filesize($this->logFile);
        if ($size >= $this->maxLogSize) {
            // Rotate existing files
            for ($i = $this->maxFiles - 1; $i > 0; $i--) {
                $oldFile = $this->logFile . '.' . $i;
                $newFile = $this->logFile . '.' . ($i + 1);
                if (file_exists($oldFile)) {
                    rename($oldFile, $newFile);
                }
            }

            // Move current log to .1
            rename($this->logFile, $this->logFile . '.1');

            // Create new empty log file
            touch($this->logFile);
            chmod($this->logFile, 0644);

            $this->log("Log file rotated due to size limit", 'INFO');
        }
    }

    public static function getInstance() {
        if (self::$instance === null) {
            self::$instance = new Logger();
        }
        return self::$instance;
    }

    public function log($message, $level = 'INFO') {
        if (!$this->enabled || $this->enabled === 'false' || $this->enabled === 0) {
            return;
        }

        // Check log rotation before writing
        $this->rotateLogsIfNeeded();

        $allowedLevels = ['DEBUG', 'INFO', 'WARNING', 'ERROR'];
        if (!in_array($level, $allowedLevels)) {
            $level = 'INFO';
        }

        $logLevels = [
            'DEBUG' => 0,
            'INFO' => 1,
            'WARNING' => 2,
            'ERROR' => 3
        ];
        
        $currentLevel = $logLevels[$level];
        $minLevel = $logLevels[$this->logLevel];
        
        if ($currentLevel < $minLevel) {
            return;
        }

        $timestamp = date($this->timestampFormat);
        $formattedMessage = str_replace(
            ['%timestamp%', '%level%', '%message%'],
            [$timestamp, $level, $message],
            $this->logFormat
        );

        try {
            if (file_put_contents($this->logFile, $formattedMessage . PHP_EOL, FILE_APPEND) === false) {
                error_log("Failed to write to debug log file: " . $this->logFile);
            }
        } catch (Exception $e) {
            error_log("Error writing to debug log: " . $e->getMessage());
        }
    }

    public function debug($message) {
        $this->log($message, 'DEBUG');
    }

    public function info($message) {
        $this->log($message, 'INFO');
    }

    public function warning($message) {
        $this->log($message, 'WARNING');
    }

    public function error($message) {
        $this->log($message, 'ERROR');
    }

    public function clear() {
        if (file_exists($this->logFile)) {
            file_put_contents($this->logFile, '');
            $this->log("Log file cleared", 'INFO');
        }
    }
} 