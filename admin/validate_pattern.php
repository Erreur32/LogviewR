<?php
session_start();

// Vérifier que l'utilisateur est connecté
if (!isset($_SESSION['admin_logged_in']) || $_SESSION['admin_logged_in'] !== true) {
    http_response_code(403);
    exit(json_encode(['success' => false, 'message' => 'Non autorisé']));
}

// Inclure PatternManager
require_once __DIR__ . '/../includes/PatternManager.php';

// Vérifier si un pattern a été envoyé
if (!isset($_POST['pattern'])) {
    http_response_code(400);
    exit(json_encode(['success' => false, 'message' => 'Pattern manquant']));
}

// Initialiser le gestionnaire de patterns
$patternManager = new PatternManager();

// Valider le pattern
$result = $patternManager->validatePattern($_POST['pattern']);

// Retourner le résultat
header('Content-Type: application/json');
echo json_encode($result); 