<?php
session_start();

// Vérifier que l'utilisateur est connecté
if (!isset($_SESSION['admin_logged_in']) || $_SESSION['admin_logged_in'] !== true) {
    http_response_code(403);
    exit('Accès non autorisé');
}

// Inclure PatternManager
require_once __DIR__ . '/../includes/PatternManager.php';

// Charger la configuration
$config_file = __DIR__ . '/../config/config.user.php';

$config = [];

// Charger config.user.php ou config.php si .user n'existe pas
if (file_exists($config_file)) {
    $config = require $config_file;
} else {
    $config = require __DIR__ . '/../config/config.php';
}

// Initialiser le gestionnaire de patterns
$patternManager = new PatternManager();
$patterns = $patternManager->getAllPatterns();

// Retourner la configuration au format JSON
header('Content-Type: application/json');
echo json_encode([
    'config' => $config,
    'patterns' => $patterns
]); 