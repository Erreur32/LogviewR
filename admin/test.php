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

// Initialisation des variables
$log_patterns = [];
$config = [];
$default_config = [];
$default_patterns = [];

// Chargement des configurations avec vérification
if (file_exists('../config/log_patterns.php')) {
    require_once '../config/log_patterns.php';
} else {
    die("❌ Erreur : Fichier log_patterns.php manquant");
}

if (file_exists('../config/config.php')) {
    require_once '../config/config.php';
} else {
    die("❌ Erreur : Fichier config.php manquant");
}

if (file_exists('../config/default_config.php')) {
    require_once '../config/default_config.php';
} else {
    die("❌ Erreur : Fichier default_config.php manquant");
}

if (file_exists('../config/default_patterns.php')) {
    require_once '../config/default_patterns.php';
} else {
    die("❌ Erreur : Fichier default_patterns.php manquant");
}

// Vérification des variables après chargement
if (!isset($log_patterns) || !is_array($log_patterns)) {
    die("❌ Erreur : Variable log_patterns non définie ou invalide");
}

if (!isset($config) || !is_array($config)) {
    die("❌ Erreur : Variable config non définie ou invalide");
}

if (!isset($default_config) || !is_array($default_config)) {
    die("❌ Erreur : Variable default_config non définie ou invalide");
}

if (!isset($default_patterns) || !is_array($default_patterns)) {
    die("❌ Erreur : Variable default_patterns non définie ou invalide");
}

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

/**
 * Compare two configurations and return differences
 * @param array $config1 First configuration
 * @param array $config2 Second configuration
 * @return array Differences between configurations
 */
function compareConfigurations($config1, $config2) {
    $differences = [];
    
    foreach ($config1 as $key => $value) {
        if (!array_key_exists($key, $config2)) {
            $differences[$key] = ['type' => 'missing', 'value' => $value];
        } elseif (is_array($value) && is_array($config2[$key])) {
            $sub_differences = compareConfigurations($value, $config2[$key]);
            if (!empty($sub_differences)) {
                $differences[$key] = $sub_differences;
            }
        } elseif ($value !== $config2[$key]) {
            $differences[$key] = [
                'type' => 'different',
                'value1' => $value,
                'value2' => $config2[$key]
            ];
        }
    }
    
    return $differences;
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

// Test des expressions régulières avec vérification
$regexResults = [];
$patterns_to_test = [];

if (isset($log_patterns['apache']['access']['pattern'])) {
    $patterns_to_test['apache_access'] = $log_patterns['apache']['access']['pattern'];
}
if (isset($log_patterns['apache']['error']['pattern'])) {
    $patterns_to_test['apache_error'] = $log_patterns['apache']['error']['pattern'];
}
if (isset($log_patterns['apache']['404_only']['pattern'])) {
    $patterns_to_test['apache_404'] = $log_patterns['apache']['404_only']['pattern'];
}
if (isset($log_patterns['nginx']['access']['pattern'])) {
    $patterns_to_test['nginx_access'] = $log_patterns['nginx']['access']['pattern'];
}
if (isset($log_patterns['nginx']['error']['pattern'])) {
    $patterns_to_test['nginx_error'] = $log_patterns['nginx']['error']['pattern'];
}
if (isset($log_patterns['syslog']['pattern'])) {
    $patterns_to_test['syslog'] = $log_patterns['syslog']['pattern'];
}
if (isset($log_patterns['npm']['default_host_access']['pattern'])) {
    $patterns_to_test['npm_access'] = $log_patterns['npm']['default_host_access']['pattern'];
}
if (isset($log_patterns['npm']['default_host_error']['pattern'])) {
    $patterns_to_test['npm_error'] = $log_patterns['npm']['default_host_error']['pattern'];
}

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

// Comparaison des configurations
$configDifferences = compareConfigurations($config, $default_config);
$patternDifferences = compareConfigurations($log_patterns, $default_patterns);

// Inclusion du template d'affichage
require_once 'test_template.php'; 