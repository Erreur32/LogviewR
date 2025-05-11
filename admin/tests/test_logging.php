<?php
// Charger la configuration
require_once __DIR__ . '/includes/Logger.php';

// Créer une instance du logger
$logger = Logger::getInstance();

// Tester différents niveaux de log
$logger->debug("Test de log DEBUG");
$logger->info("Test de log INFO");
$logger->warning("Test de log WARNING");
$logger->error("Test de log ERROR");

echo "Logs écrits avec succès. Vérifiez le fichier debug.log"; 