<?php
/**
 * Global configuration for LogviewR
 * This file loads and manages all configuration settings
 */

// Load configuration - Use default if custom config doesn't exist
$configFile = file_exists(__DIR__ . '/../config/config.php') 
    ? __DIR__ . '/../config/config.php'
    : __DIR__ . '/../config/default_config.php';
$config = require_once $configFile;

// Load patterns - Use default if custom patterns don't exist
$patternsFile = file_exists(__DIR__ . '/../config/log_patterns.php')
    ? __DIR__ . '/../config/log_patterns.php'
    : __DIR__ . '/../config/default_log_patterns.php';
$patterns = require_once $patternsFile;

// Set timezone
date_default_timezone_set($config['timezone'] ?? 'Europe/Paris');

// Define constants
define('LOGVIEWR_VERSION', '1.4.1');
define('LOGVIEWR_ROOT', dirname(__DIR__));
define('LOGVIEWR_ADMIN', LOGVIEWR_ROOT . '/admin');
define('LOGVIEWR_INCLUDES', LOGVIEWR_ROOT . '/includes');
define('LOGVIEWR_CONFIG', LOGVIEWR_ROOT . '/config');
define('LOGVIEWR_PARSERS', LOGVIEWR_ROOT . '/parsers');

// Error reporting
error_reporting(E_ALL);
ini_set('display_errors', 1);
ini_set('log_errors', 1);
ini_set('error_log', LOGVIEWR_ROOT . '/logs/php_errors.log');

// Session configuration - Must be set before session_start()
if (session_status() === PHP_SESSION_NONE) {
    ini_set('session.cookie_httponly', 1);
    ini_set('session.use_only_cookies', 1);
    ini_set('session.cookie_secure', isset($_SERVER['HTTPS']));
}

// Start session if not already started
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

// Return merged configuration
return [
    'config' => $config,
    'patterns' => $patterns
]; 