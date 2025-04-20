<?php
require_once 'config/config.php';
require_once 'parsers/ParserFactory.php';

// Define constants if not already defined
if (!defined('LOGS_DIR')) {
    define('LOGS_DIR', '/var/log');
}
if (!defined('MAX_LINES')) {
    define('MAX_LINES', $config['app']['max_lines_per_request'] ?? 20000);
}

// Enable error reporting for debugging
if (isset($config['debug']) && $config['debug']['enabled']) {
    error_reporting(E_ALL);
    ini_set('display_errors', 0);
    ini_set('log_errors', 1);
}

// Security checks
session_start();
$debug = isset($config['debug']) && $config['debug']['enabled'] === true;

// Authentication check
if (!isset($_SESSION['authenticated']) || $_SESSION['authenticated'] !== true) {
    if ($debug) error_log("[DEBUG] Unauthorized access attempt");
    header('HTTP/1.1 403 Forbidden');
    die(json_encode(['success' => false, 'error' => 'Unauthorized access']));
}

// CSRF protection
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!isset($_POST['csrf_token']) || $_POST['csrf_token'] !== $_SESSION['csrf_token']) {
        if ($debug) error_log("[DEBUG] Invalid CSRF token");
        header('HTTP/1.1 403 Forbidden');
        die(json_encode(['success' => false, 'error' => 'Invalid CSRF token']));
    }
}

// Rate limiting
$last_access = isset($_SESSION['last_view_access']) ? $_SESSION['last_view_access'] : 0;
if (time() - $last_access < $config['rate_limit'] ?? 1) {
    if ($debug) error_log("[DEBUG] Rate limit exceeded");
    header('HTTP/1.1 429 Too Many Requests');
    die(json_encode(['success' => false, 'error' => 'Too many requests']));
}
$_SESSION['last_view_access'] = time();

// User-Agent check
$user_agent = $_SERVER['HTTP_USER_AGENT'] ?? '';
$blocked_agents = $config['security']['blocked_agents'] ?? ['curl', 'wget', 'python', 'perl', 'ruby', 'php', 'nikto', 'sqlmap', 'nmap'];
foreach ($blocked_agents as $agent) {
    if (stripos($user_agent, $agent) !== false) {
        if ($debug) error_log("[DEBUG] Blocked user agent detected: $agent");
        header('HTTP/1.1 403 Forbidden');
        die(json_encode(['success' => false, 'error' => 'Unauthorized user agent']));
    }
}

// Get parameters
$logFile = $_GET['file'] ?? '';
$filter = $_GET['filter'] ?? '';
$level = $_GET['level'] ?? '';

// File path security check
$logFile = realpath($logFile);
if (!$logFile) {
    if ($debug) error_log("[DEBUG] Invalid log file path: $logFile");
    die(json_encode(['success' => false, 'error' => 'Invalid file path']));
}

// Check if file is in one of the allowed log directories
$allowed = false;
foreach ($config['paths'] as $path) {
    if (strpos($logFile, $path) === 0) {
        $allowed = true;
        break;
    }
}

if (!$allowed) {
    if ($debug) error_log("[DEBUG] Unauthorized log file path: $logFile");
    die(json_encode(['success' => false, 'error' => 'Unauthorized path']));
}

// File size check
if (filesize($logFile) > ($config['max_file_size'] ?? 10485760)) { // 10MB default
    if ($debug) error_log("[DEBUG] File too large: $logFile");
    header('HTTP/1.1 413 Request Entity Too Large');
    die(json_encode(['success' => false, 'error' => 'File too large']));
}

// MIME type check
$finfo = finfo_open(FILEINFO_MIME_TYPE);
$mime_type = finfo_file($finfo, $logFile);
finfo_close($finfo);

$allowed_types = $config['allowed_mime_types'] ?? ['text/plain', 'application/x-log'];
if (!in_array($mime_type, $allowed_types)) {
    if ($debug) error_log("[DEBUG] Invalid file type: $mime_type");
    header('HTTP/1.1 415 Unsupported Media Type');
    die(json_encode(['success' => false, 'error' => 'Invalid file type']));
}

// Initialize parser and detect log type
$logType = ParserFactory::detectLogType($logFile);
if ($config['debug']['enabled']) {
    error_log("[DEBUG] Detected log type: " . $logType);
    error_log("[DEBUG] Log file path: " . $logFile);
}

$parser = ParserFactory::getParser($logType);
if ($config['debug']['enabled']) {
    error_log("[DEBUG] Created parser: " . get_class($parser));
    error_log("[DEBUG] Parser pattern: " . $parser->getPattern());
}

// Get columns configuration
$columns = $parser->getColumns();
if ($config['debug']['enabled']) {
    error_log("[DEBUG] Columns configuration: " . print_r($columns, true));
}

// Read and parse logs
$logs = [];
$filteredCount = 0;
$totalLines = 0;
$parsedLines = 0;
$failedLines = 0;

if (file_exists($logFile)) {
    if ($config['debug']['enabled']) {
        error_log("[DEBUG] Starting to read log file");
    }
    
    $handle = fopen($logFile, 'r');
    if ($handle) {
        $lineCount = 0;
        while (($line = fgets($handle)) !== false && $lineCount < MAX_LINES) {
            $totalLines++;
            $parsedLine = $parser->parse($line);
            
            if ($config['debug']['enabled'] && $totalLines <= 5) {
                error_log("[DEBUG] Processing line " . $totalLines . ": " . trim($line));
                error_log("[DEBUG] Parsed result: " . ($parsedLine ? json_encode($parsedLine) : "null"));
            }
            
            if ($parsedLine) {
                $parsedLines++;
                // Apply filters
                if ($logType === 'syslog') {
                    // For system logs, filter only by level
                    if ($level && isset($parsedLine['level']) && $parsedLine['level'] !== $level) {
                        continue;
                    }
                } else {
                    // For other log types (Apache, Nginx, NPM)
                    if (isset($parsedLine['filtered']) && $parsedLine['filtered'] === true) {
                        $filteredCount++;
                        if ($debug) {
                            error_log("[DEBUG] Filtered line: " . json_encode($parsedLine));
                        }
                        continue;
                    }
                    
                    // Apply additional filters if needed
                    if ($filter && !preg_match('/' . preg_quote($filter, '/') . '/i', $line)) {
                        if ($debug) {
                            error_log("[DEBUG] Line filtered by search pattern: " . $line);
                        }
                        continue;
                    }
                    if ($level && isset($parsedLine['level']) && $parsedLine['level'] !== $level) {
                        if ($debug) {
                            error_log("[DEBUG] Line filtered by level: " . $parsedLine['level']);
                        }
                        continue;
                    }
                }
                $logs[] = $parsedLine;
                $lineCount++;
            }
        }
        fclose($handle);
    }
}

// Display logs
header('Content-Type: application/json');

// Prepare response data
$response = [
    'success' => true,
    'type' => $logType,
    'columns' => $columns,
    'logs' => $logs,
    'count' => count($logs),
    'filtered_count' => $filteredCount
];

// Encode with error handling
$json = json_encode($response, JSON_PARTIAL_OUTPUT_ON_ERROR);
if ($json === false) {
    error_log("JSON encode error: " . json_last_error_msg());
    echo json_encode([
        'success' => false,
        'error' => 'Failed to encode response'
    ]);
} else {
    echo $json;
} 