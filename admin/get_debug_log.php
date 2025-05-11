<?php
session_start();

// Check session and admin rights
if (!isset($_SESSION['admin_logged_in']) || $_SESSION['admin_logged_in'] !== true) {
    http_response_code(403);
    die("Accès non autorisé");
}

// Charger la configuration
$config = require_once __DIR__ . '/../config/config.php';

// Set headers for text response
header('Content-Type: text/html; charset=UTF-8');

// Get requested log level (default to 'all')
$level = isset($_GET['level']) ? strtolower($_GET['level']) : 'all';

// Validate log level
$validLevels = ['all', 'error', 'warning', 'info', 'debug'];
if (!in_array($level, $validLevels)) {
    http_response_code(400);
    die("Niveau de log invalide");
}

// Get debug log file path from config (robust fallback)
$logFile = null;
if (is_array($config) && isset($config['debug']) && is_array($config['debug']) && isset($config['debug']['log_file'])) {
    $logFile = $config['debug']['log_file'];
} else {
    // Fallback: chemin par défaut
    $logFile = dirname(__DIR__) . '/logs/debug.log';
}

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
    
    // Extraire le niveau de log
    preg_match('/\[(ERROR|WARNING|INFO|DEBUG)\]/', $line, $matches);
    $lineLevel = isset($matches[1]) ? $matches[1] : '';
    
    // Si level est 'all' ou correspond au niveau de la ligne
    if ($level === 'all' || strcasecmp($level, $lineLevel) === 0) {
        // Formater la ligne avec la classe appropriée
        $formattedLine = '<div class="log-line" data-level="' . htmlspecialchars($lineLevel) . '">';
        $formattedLine .= htmlspecialchars($line);
        $formattedLine .= '</div>';
        $filteredLines[] = $formattedLine;
    }
}

// Output filtered content (most recent first)
echo implode("\n", array_reverse($filteredLines)); 