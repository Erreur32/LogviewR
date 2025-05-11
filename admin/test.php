<?php
// Vérification simple de la session admin
session_start();
if (!isset($_SESSION['admin_logged_in']) || $_SESSION['admin_logged_in'] !== true) {
    header('Location: login.php');
    exit;
}

// Vérification de la configuration
if (!file_exists('../config/log_patterns.php') || !file_exists('../config/config.php')) {
    die("❌ Erreur : Fichiers de configuration manquants");
}

// Chargement des dépendances
require_once '../parsers/BaseParser.php';
require_once '../parsers/ApacheAccessParser.php';
require_once '../config/log_patterns.php';
require_once '../config/config.php';

/**
 * Test the parsing of a log line
 * @param BaseParser $parser The parser instance
 * @param string $line The log line to parse
 * @param string $type The type of log
 * @return array The test result
 */
function testParsing($parser, $line, $type) {
    try {
        $result = $parser->parse($line, $type);
        return [
            'success' => true,
            'result' => $result
        ];
    } catch (Exception $e) {
        return [
            'success' => false,
            'error' => $e->getMessage()
        ];
    }
}

/**
 * Test if a regex pattern is valid
 * @param string $pattern The regex pattern to test
 * @return array The test result
 */
function testRegex($pattern) {
    try {
        if (@preg_match($pattern, '') === false) {
            throw new Exception(preg_last_error_msg());
        }
        return [
            'success' => true,
            'pattern' => $pattern
        ];
    } catch (Exception $e) {
        return [
            'success' => false,
            'pattern' => $pattern,
            'error' => $e->getMessage()
        ];
    }
}

/**
 * Test directory permissions
 * @param string $path The directory path to test
 * @return array The test result
 */
function testDirectoryPermissions($path) {
    $result = [
        'path' => $path,
        'exists' => false,
        'readable' => false,
        'error' => null
    ];

    if (!file_exists($path)) {
        $result['error'] = "Le dossier n'existe pas";
        return $result;
    }

    $result['exists'] = true;

    if (!is_readable($path)) {
        $result['error'] = "Le dossier n'est pas lisible";
        return $result;
    }

    $result['readable'] = true;
    return $result;
}

// Initialisation des variables de test
$parser = null;
$allParsersLoaded = false;
$allRegexValid = true;
$allPathsAccessible = true;
$allExtensionsLoaded = true;

// Test des parsers
try {
    $parser = new ApacheAccessParser();
$allParsersLoaded = true;
        } catch (Exception $e) {
            $allParsersLoaded = false;
}

// Cas de test pour les parsers
        $testCases = [
    'access' => [
        'description' => 'Apache Access Log',
                'type' => 'access',
        'line' => '192.168.1.1 - - [01/Jan/2024:00:00:00 +0100] "GET /index.php HTTP/1.1" 200 1234'
            ],
    'error' => [
        'description' => 'Apache Error Log',
                'type' => 'error',
        'line' => '[Mon Jan 01 00:00:00 2024] [error] [client 192.168.1.1] PHP Fatal error: Uncaught Error'
    ],
    'nginx' => [
        'description' => 'Nginx Access Log',
        'type' => 'nginx',
        'line' => '192.168.1.1 - - [01/Jan/2024:00:00:00 +0100] "GET /index.php HTTP/1.1" 200 1234'
    ]
];

// Test des expressions régulières
$regexResults = [];
$patterns_to_test = [
    'apache_access' => $log_patterns['apache']['access']['pattern'],
    'apache_error' => $log_patterns['apache']['error']['pattern'],
    'apache_404' => $log_patterns['apache']['404_only']['pattern'],
    'nginx_access' => $log_patterns['nginx']['access']['pattern'],
    'nginx_error' => $log_patterns['nginx']['error']['pattern'],
    'syslog' => $log_patterns['syslog']['pattern'],
    'npm_access' => $log_patterns['npm']['default_host_access']['pattern'],
    'npm_error' => $log_patterns['npm']['default_host_error']['pattern']
];

foreach ($patterns_to_test as $type => $pattern) {
    $regexResults[$type] = testRegex($pattern);
    if (!$regexResults[$type]['success']) {
        $allRegexValid = false;
    }
}

// Test des permissions des dossiers
$permissionResults = [];
$paths_to_test = [
    '../logs',
    '../config',
    '../parsers',
    '../includes'
];

foreach ($paths_to_test as $path) {
    $permissionResults[$path] = testDirectoryPermissions($path);
    if (!$permissionResults[$path]['readable']) {
    $allPathsAccessible = false;
}
}

// Test des extensions PHP requises
$requiredExtensions = ['json', 'session', 'pcre'];
foreach ($requiredExtensions as $ext) {
    if (!extension_loaded($ext)) {
        $allExtensionsLoaded = false;
        break;
    }
}

// Inclusion du template d'affichage
require_once 'test_template.php'; 