<?php
header('Content-Type: application/json');

// Load configuration
$config = require_once __DIR__ . '/../config/config.php';
$debug = isset($config['debug']) && $config['debug']['enabled'] === true;

// Check session and admin rights
session_start();
if (!isset($_SESSION['admin_logged_in']) || $_SESSION['admin_logged_in'] !== true) {
    echo json_encode([
        'success' => false,
        'message' => 'Non autorisé'
    ]);
    exit;
}

// Get and clean path
if (!isset($_POST['path'])) {
    echo json_encode([
        'success' => false,
        'message' => 'Chemin non spécifié'
    ]);
    exit;
}

$path = $_POST['path'];

// Debug logging
if ($debug) {
    error_log("[DEBUG] Checking path: " . $path);
}

// Fonction pour vérifier si un chemin est valide et accessible
function checkPath($path) {
    // Vérifier si le chemin est vide
    if (empty($path)) {
        return [
            'exists' => false,
            'readable' => false,
            'message' => 'Le chemin ne peut pas être vide'
        ];
    }

    // Vérifier si le chemin existe
    if (!file_exists($path)) {
        return [
            'exists' => false,
            'readable' => false,
            'message' => 'Le dossier n\'existe pas'
        ];
    }

    // Vérifier si c'est un dossier
    if (!is_dir($path)) {
        return [
            'exists' => true,
            'readable' => false,
            'message' => 'Le chemin spécifié n\'est pas un dossier'
        ];
    }

    // Vérifier les permissions de lecture
    if (!is_readable($path)) {
        return [
            'exists' => true,
            'readable' => false,
            'message' => 'Le dossier n\'est pas accessible en lecture'
        ];
    }

    // Vérifier si le dossier contient des fichiers de logs
    $hasLogFiles = false;
    $files = scandir($path);
    foreach ($files as $file) {
        if ($file === '.' || $file === '..') continue;
        if (is_file($path . '/' . $file) && (
            strpos($file, '.log') !== false ||
            strpos($file, '.access') !== false ||
            strpos($file, '.error') !== false
        )) {
            $hasLogFiles = true;
            break;
        }
    }

    if (!$hasLogFiles) {
        return [
            'exists' => true,
            'readable' => true,
            'message' => 'Aucun fichier de log trouvé dans ce dossier'
        ];
    }

    return [
        'exists' => true,
        'readable' => true,
        'message' => 'Chemin valide et accessible'
    ];
}

// Vérifier le chemin
$result = checkPath($path);

// Envoyer la réponse
echo json_encode($result); 