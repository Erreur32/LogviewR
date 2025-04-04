<?php
error_reporting(E_ALL);
ini_set('display_errors', 1);

echo "<h1>Test de configuration</h1>";

// Test du chargement de config.php
echo "<h2>Test de config.php</h2>";
try {
    $config = require __DIR__ . '/config/config.php';
    echo "<p>✅ config.php chargé avec succès</p>";
    echo "<pre>";
    print_r($config);
    echo "</pre>";
} catch (Exception $e) {
    echo "<p>❌ Erreur lors du chargement de config.php: " . $e->getMessage() . "</p>";
}

// Test du chargement de log_patterns.php
echo "<h2>Test de log_patterns.php</h2>";
try {
    $patterns = require __DIR__ . '/config/log_patterns.php';
    echo "<p>✅ log_patterns.php chargé avec succès</p>";
    echo "<pre>";
    print_r($patterns);
    echo "</pre>";
} catch (Exception $e) {
    echo "<p>❌ Erreur lors du chargement de log_patterns.php: " . $e->getMessage() . "</p>";
}

// Test du chargement de ParserFactory.php
echo "<h2>Test de ParserFactory.php</h2>";
try {
    require_once __DIR__ . '/parsers/ParserFactory.php';
    echo "<p>✅ ParserFactory.php chargé avec succès</p>";
} catch (Exception $e) {
    echo "<p>❌ Erreur lors du chargement de ParserFactory.php: " . $e->getMessage() . "</p>";
}

// Test du chargement de BaseParser.php
echo "<h2>Test de BaseParser.php</h2>";
try {
    require_once __DIR__ . '/parsers/BaseParser.php';
    echo "<p>✅ BaseParser.php chargé avec succès</p>";
} catch (Exception $e) {
    echo "<p>❌ Erreur lors du chargement de BaseParser.php: " . $e->getMessage() . "</p>";
}

// Test du chargement de ApacheParser.php
echo "<h2>Test de ApacheParser.php</h2>";
try {
    require_once __DIR__ . '/parsers/ApacheParser.php';
    echo "<p>✅ ApacheParser.php chargé avec succès</p>";
} catch (Exception $e) {
    echo "<p>❌ Erreur lors du chargement de ApacheParser.php: " . $e->getMessage() . "</p>";
}

// Test de l'initialisation de ParserFactory
echo "<h2>Test de l'initialisation de ParserFactory</h2>";
try {
    ParserFactory::setConfig($config);
    echo "<p>✅ ParserFactory initialisé avec succès</p>";
} catch (Exception $e) {
    echo "<p>❌ Erreur lors de l'initialisation de ParserFactory: " . $e->getMessage() . "</p>";
}
?> 