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

// Load configuration files
$config_file = __DIR__ . '/config/config.php';
$patterns_file = __DIR__ . '/config/log_patterns.php';

// Validate configuration files
if (!file_exists($config_file)) {
    die(json_encode(['error' => 'Missing configuration file: config.php']));
}

if (!file_exists($patterns_file)) {
    die(json_encode(['error' => 'Missing patterns file: log_patterns.php']));
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

// Configure execution environment
if (isset($config['app']['max_execution_time'])) {
    ini_set('max_execution_time', $config['app']['max_execution_time']);
}

// Include and configure ParserFactory
require_once __DIR__ . '/parsers/ParserFactory.php';
ParserFactory::init();  // Initialize first
ParserFactory::setConfig($config);  // Then set config

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

// Create parser instance
try {
    $logType = ParserFactory::detectLogType($logfile);
    if ($config['debug']['enabled']) {
        error_log("[DEBUG] Detected log type: " . $logType);
    }
    
    $parser = ParserFactory::getParser($logType);
    if ($config['debug']['enabled']) {
        error_log("[DEBUG] Created parser: " . get_class($parser));
    }
    
    // Handle filters
    $filtersEnabled = isset($_POST['filters_enabled']) ? $_POST['filters_enabled'] === '1' : true;
    if (method_exists($parser, 'setFiltersEnabled')) {
        $parser->setFiltersEnabled($filtersEnabled);
    }

    if ($config['debug']['enabled']) {
        error_log("[DEBUG] Filters enabled: " . ($filtersEnabled ? 'true' : 'false'));
    }
} catch (Exception $e) {
    error_log("ERROR - Parser creation failed: " . $e->getMessage());
    die(json_encode(['error' => 'Error creating parser: ' . $e->getMessage()]));
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

    // Process file
    $buffer = [];
    $lineCount = 0;
    $maxLines = $config['app']['max_lines_per_request'];
    $handle = fopen($logfile, "r");

    if (!$handle) {
        throw new Exception("Cannot open file: " . $logfile);
    }

    while (!feof($handle) && $lineCount < $maxLines) {
        $line = fgets($handle);
        if ($line === false) {
            if (!feof($handle)) {
                continue;
            }
            break;
        }

        $stats['total_lines']++;
        $lineCount++;
        
        try {
            $result = analyzeLine($line);
        } catch (Exception $e) {
            if ($config['debug']['enabled']) {
                error_log("[DEBUG] Error analyzing line: " . $e->getMessage());
            }
            $result = ['status' => 'unreadable', 'reason' => 'parser_error'];
        }
        
        switch ($result['status']) {
            case 'valid':
                if (isset($result['data'])) {
                    $buffer[] = $result['data'];
                    $stats['valid_lines']++;
                }
                break;
            case 'filtered':
                $stats['filtered_lines']++;
                break;
            case 'skipped':
                $stats['skipped_lines']++;
                break;
            case 'unreadable':
                $stats['unreadable_lines']++;
                break;
        }

        if (isset($result['reason'])) {
            $stats['reasons'][$result['reason']] = ($stats['reasons'][$result['reason']] ?? 0) + 1;
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
        'type' => $logType,
        'columns' => $parser->getColumns(),
        'lines' => array_values($buffer),
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
