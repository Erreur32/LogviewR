<?php
// Définition du chemin racine
define('LOGVIEWR_ROOT', dirname(__DIR__));

// Vérification simple de la session admin
session_start();
if (!isset($_SESSION['admin_logged_in']) || $_SESSION['admin_logged_in'] !== true) {
    header('Location: login.php');
    exit;
}

// Chargement des configurations
$config = require_once LOGVIEWR_ROOT . '/config/config.php';
$log_patterns = require_once LOGVIEWR_ROOT . '/config/log_patterns.php';

// Initialisation des variables de test
$testResults = [
    'system' => [
        'php_version' => [
            'success' => version_compare(PHP_VERSION, '7.4.0', '>='),
            'message' => 'PHP ' . PHP_VERSION,
            'required' => '7.4.0 ou supérieur'
        ],
        'extensions' => [
            'success' => extension_loaded('json') && extension_loaded('session'),
            'message' => 'Extensions PHP requises',
            'details' => [
                'json' => extension_loaded('json'),
                'session' => extension_loaded('session')
            ]
        ]
    ],
    'paths' => []
];

// Test des chemins critiques
$criticalPaths = [
    'logs' => LOGVIEWR_ROOT . '/logs',
    'config' => LOGVIEWR_ROOT . '/config',
    'parsers' => LOGVIEWR_ROOT . '/parsers'
];

foreach ($criticalPaths as $name => $path) {
    $testResults['paths'][$name] = [
        'exists' => file_exists($path),
        'readable' => is_readable($path),
        'writable' => is_writable($path),
        'path' => $path
    ];
}

// Test des patterns de logs
$testResults['patterns'] = [];
$patterns_to_test = [
    'apache_access' => $log_patterns['apache']['access']['pattern'] ?? null,
    'apache_error' => $log_patterns['apache']['error']['pattern'] ?? null,
    'nginx_access' => $log_patterns['nginx']['access']['pattern'] ?? null,
    'nginx_error' => $log_patterns['nginx']['error']['pattern'] ?? null
];

foreach ($patterns_to_test as $type => $pattern) {
    if ($pattern) {
        try {
            $isValid = @preg_match($pattern, '') !== false;
            $testResults['patterns'][$type] = [
                'success' => $isValid,
                'pattern' => $pattern,
                'error' => $isValid ? null : preg_last_error_msg()
            ];
        } catch (Exception $e) {
            $testResults['patterns'][$type] = [
                'success' => false,
                'pattern' => $pattern,
                'error' => $e->getMessage()
            ];
        }
    }
}

// Test de la configuration
$debug_log_file = LOGVIEWR_ROOT . '/logs/debug.log';
$testResults['config'] = [
    'debug' => [
        'enabled' => $config['debug']['enabled'] ?? false,
        'log_file' => $debug_log_file,
        'writable' => is_writable(dirname($debug_log_file)) // Vérifie si le dossier est accessible en écriture
    ],
    'paths' => [
        'apache' => [
            'path' => $config['paths']['apache_logs'] ?? null,
            'exists' => file_exists($config['paths']['apache_logs'] ?? ''),
            'readable' => is_readable($config['paths']['apache_logs'] ?? '')
        ],
        'nginx' => [
            'path' => $config['paths']['nginx_logs'] ?? null,
            'exists' => file_exists($config['paths']['nginx_logs'] ?? ''),
            'readable' => is_readable($config['paths']['nginx_logs'] ?? '')
        ]
    ]
];

// Charger le template de test
require_once __DIR__ . '/test_template.php'; 