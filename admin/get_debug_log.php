<?php
session_start();

// Check session and admin rights
if (!isset($_SESSION['admin_logged_in']) || $_SESSION['admin_logged_in'] !== true) {
    http_response_code(403);
    die("Accès non autorisé");
}

// Load configuration
require_once '../config/config.php';

// Set headers for text response
header('Content-Type: text/plain');

// Get requested log level (default to 'all')
$level = isset($_GET['level']) ? $_GET['level'] : 'all';

// Validate log level
$validLevels = ['all', 'error', 'warning', 'info', 'debug'];
if (!in_array($level, $validLevels)) {
    http_response_code(400);
    die("Niveau de log invalide");
}

// Get debug log file path from config
$logFile = isset($config['debug_log_file']) ? $config['debug_log_file'] : dirname(__DIR__) . '/logs/debug.log';

// Check if file exists and is readable
if (!file_exists($logFile)) {
    http_response_code(404);
    die("Fichier de log introuvable");
}

if (!is_readable($logFile)) {
    http_response_code(500);
    die("Impossible de lire le fichier de log");
}

// Read and filter log content
$content = file_get_contents($logFile);
$lines = explode("\n", $content);
$filteredLines = [];

foreach ($lines as $line) {
    if (empty(trim($line))) continue;
    
    // If level is 'all', include everything
    if ($level === 'all') {
        $filteredLines[] = $line;
        continue;
    }
    
    // Check if line contains the specified level
    if (stripos($line, "[$level]") !== false) {
        $filteredLines[] = $line;
    }
}

// Output filtered content (most recent first)
echo implode("\n", array_reverse($filteredLines)); 