<?php
require_once __DIR__ . '/../includes/debug.php';
require_once __DIR__ . '/../includes/LogLoader.php';

debug("=== DÉBUT CHARGEMENT DES LOGS ===");

// Vérifier le type de log demandé
$type = $_GET['type'] ?? '';
debug("Type de log demandé: $type");

if (empty($type)) {
    debug("❌ Erreur: Type de log non spécifié");
    die(json_encode(['error' => 'Type de log non spécifié']));
}

// Charger la configuration
$config = require_once __DIR__ . '/../config/config.php';
debug("Configuration chargée");

// Initialiser le chargeur de logs
$loader = new LogLoader($config);
debug("LogLoader initialisé");

// Charger les logs
$logs = $loader->loadLogs($type);
debug("Nombre de logs trouvés: " . count($logs));

// Envoyer la réponse
echo json_encode([
    'success' => true,
    'logs' => $logs
]);

debug("=== FIN CHARGEMENT DES LOGS ==="); 