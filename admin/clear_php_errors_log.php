<?php
// Endpoint sécurisé pour vider php_errors.log
session_start();
header('Content-Type: application/json');
if (!isset($_SESSION['admin_logged_in']) || $_SESSION['admin_logged_in'] !== true) {
    http_response_code(403);
    echo json_encode(['success' => false, 'message' => 'Non autorisé']);
    exit;
}
$php_log = dirname(__DIR__) . '/logs/php_errors.log';
if (file_exists($php_log) && is_writable($php_log)) {
    file_put_contents($php_log, '');
    echo json_encode(['success' => true, 'message' => 'php_errors.log vidé avec succès']);
} else {
    echo json_encode(['success' => false, 'message' => "Impossible de vider php_errors.log (droit d'écriture ou fichier manquant)"]);
} 