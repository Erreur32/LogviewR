<?php
require_once __DIR__ . '/Logger.php';

function debug($message, $level = 'DEBUG') {
    Logger::getInstance()->log($message, $level);
}

// Fonction helper pour les erreurs
function logError($message) {
    debug($message, 'ERROR');
}

// Fonction helper pour les avertissements
function logWarning($message) {
    debug($message, 'WARNING');
}

// Fonction pour nettoyer le fichier de log
function clearDebugLog() {
    Logger::getInstance()->clear();
} 