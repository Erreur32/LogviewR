<?php
// Démarrer le tampon de sortie
ob_start();

error_reporting(E_ALL);
ini_set('display_errors', 0);  // Désactiver l'affichage des erreurs
ini_set('log_errors', 1);      // Activer la journalisation des erreurs

// Définir le gestionnaire d'erreurs personnalisé
function customErrorHandler($errno, $errstr, $errfile, $errline) {
    // Journaliser l'erreur
    error_log("Error [$errno]: $errstr in $errfile on line $errline");
    
    // Si le debug est activé, on laisse PHP gérer l'erreur
    global $config;
    if (isset($config['debug']['enabled']) && $config['debug']['enabled']) {
        return false;
    }
    
    return true; // Sinon on empêche l'exécution du gestionnaire d'erreurs PHP interne
}
set_error_handler('customErrorHandler');

/**
 * Main script for log analysis
 * Handles file reading, parsing, and response formatting
 */

// Charger la configuration
$config_file = file_exists(__DIR__ . '/config/config.user.php') 
    ? __DIR__ . '/config/config.user.php'
    : __DIR__ . '/config/config.php';

$patterns_file = file_exists(__DIR__ . '/config/log_patterns.user.php')
    ? __DIR__ . '/config/log_patterns.user.php'
    : __DIR__ . '/config/log_patterns.php';

require_once $config_file;
require_once $patterns_file;
require_once __DIR__ . '/includes/config.php';
 
if (!file_exists($config_file)) {
    die('Erreur: Fichier de configuration manquant (config.php)');
}

if (!file_exists($patterns_file)) {
    die('Erreur: Fichier de patterns manquant (log_patterns.php)');
}

try {
    $config = require $config_file;
    $patterns = require $patterns_file;
    
    if (!is_array($config)) {
        throw new Exception('Invalid configuration: config.php must return an array');
    }
    
    if (!is_array($patterns)) {
        throw new Exception('Invalid configuration: log_patterns.php must return an array');
    }

 
} catch (Exception $e) {
    die(json_encode(['error' => 'Error loading configuration: ' . $e->getMessage()]));
}

// Vérifier que la configuration de debug existe
if (!isset($config['debug']) || !is_array($config['debug'])) {
    $config['debug'] = ['enabled' => false];
}

// Vérifier que debug.enabled existe
if (!isset($config['debug']['enabled'])) {
    $config['debug']['enabled'] = false;
}

// Load configuration
$adminConfig = require __DIR__ . '/config/admin.php';

// Set max execution time from admin config
if (isset($adminConfig['admin']['max_execution_time'])) {
    ini_set('max_execution_time', $adminConfig['admin']['max_execution_time']);
}

// Include and configure ParserFactory
require_once __DIR__ . '/parsers/ParserFactory.php';
ParserFactory::init();  // Initialize factory
ParserFactory::setConfig($config);  // Set config

header('Content-Type: application/json');

// Start execution timer
$start_time = microtime(true);

// Validate input parameters
if (!isset($_POST['logfile']) || empty($_POST['logfile'])) {
    die(json_encode(['error' => 'No file specified']));
}

$logfile = $_POST['logfile'];

// Validate file path
if (!file_exists($logfile)) {
    die(json_encode(['error' => "File $logfile does not exist"]));
}

if (!is_readable($logfile)) {
    die(json_encode(['error' => "File $logfile is not readable"]));
}

// Initialize parser
try {
    $logType = ParserFactory::detectLogType($logfile);
    if (!$logType) {
        throw new Exception("Could not detect log type for file: " . $logfile);
    }
    
    $parser = ParserFactory::getParser($logType);
    if (!$parser) {
        throw new Exception("Could not create parser for log type: " . $logType);
    }
    
    if ($config['debug']['enabled']) {
        error_log("[DEBUG] Detected log type: " . $logType);
        error_log("[DEBUG] Created parser: " . get_class($parser));
    }
} catch (Exception $e) {
    throw new Exception("Could not initialize parser: " . $e->getMessage());
}

/**
 * Format file size with appropriate units
 */
function formatFileSize($size) {
    $units = ['B', 'KB', 'MB', 'GB', 'TB'];
    $i = 0;
    while ($size >= 1024 && $i < count($units) - 1) {
        $size /= 1024;
        $i++;
    }
    return [
        'value' => round($size, 1),
        'unit' => $units[$i]
    ];
}

/**
 * Analyze a single log line using the global parser instance
 */
function analyzeLine($line) {
    global $parser;
    
    $line = trim($line);
    if (empty($line)) {
        return ['status' => 'skipped', 'reason' => 'empty'];
    }

    try {
        $result = $parser->parse($line);
        
        if ($result === null) {
            return ['status' => 'unreadable', 'reason' => 'invalid_format'];
        }
        
        if (isset($result['filtered']) && $result['filtered'] === true) {
            return ['status' => 'filtered', 'reason' => $result['reason'] ?? 'filter_match'];
        }
        
        return ['status' => 'valid', 'data' => $result];
    } catch (Exception $e) {
        return ['status' => 'unreadable', 'reason' => 'parser_error'];
    }
}

try {
    // Initialize statistics
    $stats = [
        'total_lines' => 0,
        'valid_lines' => 0,
        'skipped_lines' => 0,
        'unreadable_lines' => 0,
        'filtered_lines' => 0,
        'reasons' => []
    ];

    // Process file with buffered reading for better performance
    $buffer = [];
    $lineCount = 0;
    $maxLines = $config['app']['max_lines_per_request'];
    $handle = fopen($logfile, "r");

    if (!$handle) {
        throw new Exception("Cannot open file: " . $logfile);
    }

    // Read by 8KB blocks for better performance
    $blockSize = 8192;
    $remainder = '';
    
    while (!feof($handle) && $lineCount < $maxLines) {
        $chunk = $remainder . fread($handle, $blockSize);
        $lines = explode("\n", $chunk);
        
        // Keep the last incomplete chunk for next iteration
        $remainder = end($lines);
        array_pop($lines);
        
        foreach ($lines as $line) {
            if (empty(trim($line))) {
                $stats['skipped_lines']++;
                continue;
            }
            
            $stats['total_lines']++;
            
            // Parse the line
            $result = $parser->parse($line);
            
            if ($result === null) {
                $stats['unreadable_lines']++;
                continue;
            }
            
            // Check if line is filtered
            if (isset($result['filtered']) && $result['filtered'] === true) {
                $stats['filtered_lines']++;
                $reason = $result['reason'] ?? 'filter_match';
                $stats['reasons'][$reason] = ($stats['reasons'][$reason] ?? 0) + 1;
                continue;  // Skip filtered lines
            }
            
            // Only add valid lines to the buffer
            $stats['valid_lines']++;
            $buffer[] = $result;
            $lineCount++;
        }
    }
    
    fclose($handle);

    // Prepare response
    $filesize = filesize($logfile);
    $mtime = filemtime($logfile);
    
    $fileInfo = [
        'size' => formatFileSize($filesize),
        'mtime' => [
            'timestamp' => $mtime,
            'formatted' => date($config['date_formats']['display'], $mtime)
        ]
    ];

    $response = [
        'success' => true,
        'type' => $parser->getType(),
        'columns' => $parser->getColumns(),
        'lines' => $buffer,
        'stats' => $stats,
        'file_info' => $fileInfo,
        'execution_time' => round((microtime(true) - $start_time) * 1000, 2)
    ];

    // Debug log for columns
    if ($config['debug']['enabled']) {
        error_log("[DEBUG] Response columns: " . print_r($parser->getColumns(), true));
        error_log("[DEBUG] Response stats: " . print_r($stats, true));
    }

    // Nettoyer le tampon de sortie
    if (ob_get_length()) {
        ob_clean();
    }
    
    // Encoder et envoyer la réponse
    echo json_encode($response, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

} catch (Exception $e) {
    // Nettoyer le tampon de sortie en cas d'erreur
    if (ob_get_length()) {
        ob_clean();
    }
    
    // Encoder et envoyer l'erreur
    $errorResponse = [
        'error' => "Error processing file: " . $e->getMessage()
    ];
    
    if ($config['debug']['enabled']) {
        $errorResponse['debug'] = [
            'file' => $e->getFile(),
            'line' => $e->getLine(),
            'trace' => $e->getTraceAsString()
        ];
    }
    
    echo json_encode($errorResponse);
}

// Terminer le script
exit;
?>
