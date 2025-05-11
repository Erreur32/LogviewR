<?php
require_once __DIR__ . '/../../includes/debug.php';

// Test des différents niveaux de log
debug("Test du système de log - Message DEBUG");
logWarning("Test du système de log - Message WARNING");
logError("Test du système de log - Message ERROR");

echo "Tests de log effectués. Vérifiez le fichier logs/debug.log"; 