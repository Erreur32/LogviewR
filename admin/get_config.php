<?php
session_start();

// Vérifier que l'utilisateur est connecté
if (!isset($_SESSION['admin_logged_in']) || $_SESSION['admin_logged_in'] !== true) {
    http_response_code(403);
    exit('Accès non autorisé');
}

// Charger la configuration
$config_file = __DIR__ . '/../config/config.php';
$patterns_file = __DIR__ . '/../config/log_patterns.php';

$config = [];
$patterns = [];

if (file_exists($config_file)) {
    $config = require $config_file;
}

if (file_exists($patterns_file)) {
    $patterns = require $patterns_file;
}

// Retourner la configuration au format JSON
header('Content-Type: application/json');
echo json_encode([
    'config' => $config,
    'patterns' => $patterns
]); 