<?php
/**
 * Global configuration for LogviewR
 * This file loads and manages all configuration settings
 */

// Load main configuration
$config = require_once __DIR__ . '/../config/config.php';

// Set timezone
date_default_timezone_set($config['timezone'] ?? 'Europe/Paris');

// Define constants
define('LOGVIEWR_VERSION', '1.0.0');
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

// Session configuration
ini_set('session.cookie_httponly', 1);
ini_set('session.use_only_cookies', 1);
ini_set('session.cookie_secure', isset($_SERVER['HTTPS'])); 