<?php
session_start();

// Activer l'affichage des erreurs pour le débogage
error_reporting(E_ALL);
ini_set('display_errors', 1);

// Vérifier que l'utilisateur est connecté
if (!isset($_SESSION['admin_logged_in']) || $_SESSION['admin_logged_in'] !== true) {
    error_log("[ERROR] Tentative d'accès non autorisé à clear_debug_log.php");
    http_response_code(403);
    die(json_encode(['success' => false, 'message' => 'Accès non autorisé']));
}

// Définir l'en-tête de réponse JSON
header('Content-Type: application/json');

try {
    // Chemin du fichier de log
    $debug_log = dirname(__DIR__) . '/logs/debug.log';
    $log_dir = dirname($debug_log);

    error_log("[INFO] Tentative de nettoyage du fichier: $debug_log");

    // Créer le dossier s'il n'existe pas
    if (!is_dir($log_dir)) {
        if (!mkdir($log_dir, 0755, true)) {
            throw new Exception("Impossible de créer le dossier des logs");
        }
    }

    // Créer ou vider le fichier
    if (file_put_contents($debug_log, '') === false) {
        throw new Exception("Impossible de vider le fichier de log");
    }

    // Succès
    error_log("[SUCCESS] Fichier vidé avec succès: $debug_log");
    echo json_encode([
        'success' => true,
        'message' => 'Fichier de log réinitialisé avec succès',
        'path' => $debug_log
    ]);

} catch (Exception $e) {
    error_log("[ERROR] " . $e->getMessage());
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => $e->getMessage(),
        'details' => [
            'file_exists' => file_exists($debug_log),
            'is_writable' => is_writable($debug_log),
            'dir_exists' => is_dir($log_dir),
            'dir_writable' => is_writable($log_dir)
        ]
    ]);
}