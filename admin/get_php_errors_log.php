<?php
// Endpoint sécurisé pour afficher les 100 dernières lignes de php_errors.log
session_start();
if (!isset($_SESSION['admin_logged_in']) || $_SESSION['admin_logged_in'] !== true) {
    http_response_code(403);
    exit('Non autorisé');
}
$php_log = dirname(__DIR__) . '/logs/php_errors.log';
if (file_exists($php_log) && is_readable($php_log)) {
    $lines = array_slice(file($php_log), -100);
    echo htmlspecialchars(implode('', $lines));
} else {
    echo "Le fichier php_errors.log n'existe pas ou n'est pas lisible.";
} 