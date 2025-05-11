<?php
// Vérifier si la session n'est pas déjà démarrée
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

// Vérifier si l'utilisateur est connecté
if (!isset($_SESSION['admin_logged_in']) || $_SESSION['admin_logged_in'] !== true) {
    header('Location: login.php');
    exit;
}

// Inclure les fonctions nécessaires
require_once __DIR__ . '/functions.php';

// Charger la configuration globale
require_once __DIR__ . '/../includes/config.php';

// Check configuration files
$config_file = file_exists(__DIR__ . '/../config/config.user.php')
    ? __DIR__ . '/../config/config.user.php'
    : __DIR__ . '/../config/config.php';

$admin_config_file = __DIR__ . '/../config/admin.php';

// Initialize configurations
$config = [];
$patterns = [];
$default_patterns = [];
$custom_patterns = [];

// Initialize default debug configuration
// $config['debug'] = [
//     'enabled' => false,
//     'log_level' => 'INFO',
//     'log_format' => '[%timestamp%] [%level%] %message%'
// ];

// Load configuration
if (file_exists($config_file)) {
    $loaded_config = require $config_file;
    if (is_array($loaded_config)) {
        $config = array_replace_recursive($config, $loaded_config);
    }
} else {
    die('Error: Configuration file missing (config.php)');
}

// Load patterns
$default_patterns_file = __DIR__ . '/../config/log_patterns.php';
$user_patterns_file = __DIR__ . '/../config/log_patterns.user.php';

// Charger les patterns par défaut
$default_patterns = require $default_patterns_file;

// Initialiser les patterns avec les valeurs par défaut
$patterns = $default_patterns;

// Charger les patterns personnalisés s'ils existent
if (file_exists($user_patterns_file)) {
    try {
        $custom_patterns = require $user_patterns_file;
        
        // Ne mettre à jour que les patterns qui ont été modifiés
        foreach ($custom_patterns as $type => $type_patterns) {
            if (is_array($type_patterns)) {
                foreach ($type_patterns as $pattern_type => $pattern_data) {
                    // Vérifier si le pattern existe dans les patterns par défaut
                    if (isset($default_patterns[$type][$pattern_type])) {
                        // Ne mettre à jour que si le pattern est différent
                        if (isset($pattern_data['pattern']) && 
                            !empty($pattern_data['pattern']) && 
                            $pattern_data['pattern'] !== $default_patterns[$type][$pattern_type]['pattern']) {
                            $patterns[$type][$pattern_type] = $pattern_data;
                           // error_log("Pattern modifié: $type/$pattern_type");
                        }
                    }
                }
            }
        }
    } catch (Exception $e) {
        error_log('Error loading user patterns: ' . $e->getMessage());
    }
}

// Configuration des couleurs et icônes
$pattern_config = [
    'apache' => [
        'icon' => 'fa-server',
        'title' => 'Apache',
        'access_color' => '#4CAF50',
        'error_color' => '#F44336'
    ],
    'nginx' => [
        'icon' => 'fa-cubes',
        'title' => 'Nginx',
        'access_color' => '#2196F3',
        'error_color' => '#FF9800'
    ],
    'npm' => [
        'icon' => 'fa-cubes',
        'title' => 'Nginx Proxy Manager',
        'access_color' => '#9C27B0',
        'error_color' => '#E91E63',
        'patterns' => [
            'default_host_access' => [
                'label' => 'Default Host Access',
                'icon' => 'fa-server'
            ],
            'proxy_host_access' => [
                'label' => 'Proxy Host Access',
                'icon' => 'fa-exchange-alt'
            ],
            'dead_host_access' => [
                'label' => 'Dead Host Access',
                'icon' => 'fa-skull'
            ],
            'fallback_access' => [
                'label' => 'Fallback Access',
                'icon' => 'fa-random'
            ],
            'letsencrypt_requests_access' => [
                'label' => 'Let\'s Encrypt Requests',
                'icon' => 'fa-lock'
            ],
            'error' => [
                'label' => 'Error Log',
                'icon' => 'fa-exclamation-triangle'
            ],
            'default_host_error' => [
                'label' => 'Default Host Error',
                'icon' => 'fa-exclamation-circle'
            ],
            'proxy_host_error' => [
                'label' => 'Proxy Host Error',
                'icon' => 'fa-exclamation-circle'
            ],
            'dead_host_error' => [
                'label' => 'Dead Host Error',
                'icon' => 'fa-exclamation-circle'
            ],
            'fallback_error' => [
                'label' => 'Fallback Error',
                'icon' => 'fa-exclamation-circle'
            ]
        ]
    ]
];

// Load admin configuration
if (!file_exists($admin_config_file)) {
    die('Error: Admin configuration file missing (admin.php)');
}

try {
    $admin_config = require $admin_config_file;
    if (!is_array($admin_config)) {
        throw new Exception('Invalid configuration: admin.php must return an array');
    }
} catch (Exception $e) {
    die('Configuration loading error: ' . $e->getMessage());
}

// Vérifier le timeout de session
if (!isset($_SESSION['admin_login_time']) || (time() - $_SESSION['admin_login_time'] > ($admin_config['admin']['session_timeout'] ?? 3600))) {
    session_destroy();
    header('Location: login.php?timeout=1');
    exit;
}

// Mettre à jour le temps de connexion
$_SESSION['admin_login_time'] = time();

// Initialiser les variables
$message = '';
$error = '';

// Fonction pour recharger les configurations

function reloadConfigurations() {
    global $config_file, $patterns_file, $admin_config_file;
    global $config, $patterns, $admin_config;
    
    // Recharger la configuration
    if (file_exists($config_file)) {
        $config = require $config_file;
    }
    
    // Recharger les patterns
    if (file_exists($patterns_file)) {
        $patterns = require $patterns_file;
    }
    
    // Recharger la configuration admin
    if (file_exists($admin_config_file)) {
        $admin_config = require $admin_config_file;
    }
}

// Traitement des actions
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (isset($_POST['action'])) {
        switch ($_POST['action']) {
            case 'update_config':
                try {
                    // Charger la configuration actuelle
                    $current_config = require $config_file;
                    
                    // Initialiser la nouvelle configuration avec les valeurs actuelles
                    $new_config = $current_config;
                    
                    // Mettre à jour uniquement les valeurs qui ont été soumises
                    if (isset($_POST['config'])) {
                        foreach ($_POST['config'] as $key => $value) {
                            if (isset($new_config[$key])) {
                                // Préserver le chemin du fichier de log s'il existe
                                if ($key === 'debug' && isset($value['log_file'])) {
                                    $new_config[$key]['log_file'] = $current_config[$key]['log_file'];
                                } else {
                                    $new_config[$key] = $value;
                                }
                            }
                        }
                    }

                    // Charger la configuration admin actuelle
                    $admin_config = require $admin_config_file;
                    // Mettre à jour les options admin
                    if (isset($_POST['admin'])) {
                        foreach ($_POST['admin'] as $key => $value) {
                            if ($key === 'remember_me') {
                                $admin_config['admin']['remember_me'] = true;
                            } else {
                                $admin_config['admin'][$key] = $value;
                            }
                        }
                        // Si la case n'est pas cochée, elle n'est pas envoyée dans $_POST
                        if (!isset($_POST['admin']['remember_me'])) {
                            $admin_config['admin']['remember_me'] = false;
                        }
                    }

                    // Mettre à jour les filtres si présents
                    if (isset($_POST['config']['filters'])) {
                        if (!isset($new_config['filters'])) {
                            $new_config['filters'] = [
                                'enabled' => false,
                                'exclude' => []
                            ];
                        }
                        
                        // Mettre à jour l'état des filtres
                        if (isset($_POST['config']['filters']['enabled'])) {
                            $new_config['filters']['enabled'] = $_POST['config']['filters']['enabled'] === '1';
                        }
                        
                        // Mettre à jour les patterns d'exclusion
                        if (isset($_POST['config']['filters']['exclude'])) {
                            foreach ($_POST['config']['filters']['exclude'] as $type => $patterns) {
                                if (is_string($patterns)) {
                                    // Convertir les patterns en tableau et les nettoyer
                                    $patterns = array_filter(array_map('trim', explode("\n", $patterns)));
                                    // Créer un tableau indexé numériquement
                                    $new_config['filters']['exclude'][$type] = array_values($patterns);
                                }
                            }
                        }
                    }
                    
                    // Sauvegarder la configuration admin
                  if (file_put_contents($admin_config_file, "<?php\nreturn " . var_export($admin_config, true) . ";\n")) {
                        $admin_config = require $admin_config_file;
                    } else {
                        throw new Exception('Erreur lors de la sauvegarde de la configuration admin');
                    }
                  
                    // Sauvegarder la configuration utilisateur
                    if (saveConfig($new_config)) {
                        // Désactivation du rafraîchissement automatique
                        // header('Location: index.php');
                        $success_message = "Configuration sauvegardée avec succès !";
                    } else {
                        $error_message = "Erreur lors de la sauvegarde de la configuration.";
                    }
                    
                } catch (Exception $e) {
                    $error = $e->getMessage();
                }
                break;
                
 
            case 'change_password':
                $current_password = $_POST['current_password'] ?? '';
                $new_password = $_POST['new_password'] ?? '';
                $confirm_password = $_POST['confirm_password'] ?? '';

                // Vérifier l'ancien mot de passe
                if (!password_verify($current_password, $admin_config['admin']['password'])) {
                    $error = 'Mot de passe actuel incorrect';
                    break;
                }

                // Vérifier la confirmation du nouveau mot de passe
                if ($new_password !== $confirm_password) {
                    $error = 'Les mots de passe ne correspondent pas';
                    break;
                }

                // Vérifier les critères de sécurité
                if (strlen($new_password) < $admin_config['admin']['min_password_length']) {
                    $error = 'Le mot de passe doit contenir au moins ' . $admin_config['admin']['min_password_length'] . ' caractères';
                    break;
                }

                if ($admin_config['admin']['require_special_chars'] && !preg_match('/[^a-zA-Z0-9]/', $new_password)) {
                    $error = 'Le mot de passe doit contenir au moins un caractère spécial';
                    break;
                }

                if ($admin_config['admin']['require_numbers'] && !preg_match('/[0-9]/', $new_password)) {
                    $error = 'Le mot de passe doit contenir au moins un chiffre';
                    break;
                }

                if ($admin_config['admin']['require_uppercase'] && !preg_match('/[A-Z]/', $new_password)) {
                    $error = 'Le mot de passe doit contenir au moins une majuscule';
                    break;
                }

                // Mettre à jour le mot de passe
                $config_file = __DIR__ . '/../config/admin.php';
                $config_content = file_get_contents($config_file);
                $new_hash = password_hash($new_password, PASSWORD_DEFAULT);
                
                $config_content = preg_replace(
                    "/'password' => '[^']*'/",
                    "'password' => '$new_hash'",
                    $config_content
                );

                if (file_put_contents($config_file, $config_content)) {
                    $message = 'Mot de passe mis à jour avec succès';
                } else {
                    $error = 'Erreur lors de la mise à jour du mot de passe';
                }
                break;

            case 'update_paths':
                try {
                    // Créer un tableau de configuration à jour
                    $new_config = $config;
                    
                    // Mettre à jour les chemins
                    $new_config['paths'] = [
                        'apache_logs' => $_POST['paths']['apache_logs'] ?? '/var/log/apache2',
                        'nginx_logs' => $_POST['paths']['nginx_logs'] ?? '/var/log/nginx',
                        'npm_logs' => $_POST['paths']['npm_logs'] ?? '/var/log/npm',
                        'syslog' => $_POST['paths']['syslog'] ?? '/var/log'
                    ];
                    
                    // Mettre à jour les extensions exclues
                    $new_config['app']['excluded_extensions'] = isset($_POST['app']['excluded_extensions']) ? 
                        array_filter(array_map('trim', explode("\n", $_POST['app']['excluded_extensions']))) : 
                        ['gz', 'zip', 'tar', 'rar', '7z', 'bz2', 'xz'];

                    // Générer le contenu du fichier de configuration
                    $config_content = "<?php\nreturn " . var_export($new_config, true) . ";\n";

                    // Sauvegarder la configuration
                    if (file_put_contents($config_file, $config_content) === false) {
                        throw new Exception('Impossible d\'écrire le fichier de configuration');
                    }
                    
                    // Recharger la configuration
                    $config = require $config_file;
                    
                } catch (Exception $e) {
                    $error = $e->getMessage();
                }
                break;

            case 'update_excluded_ips':
                $config = require __DIR__ . '/../config/config.php';
                $config['app']['excluded_ips'] = array_filter(explode("\n", $_POST['excluded_ips']));
                $config['app']['enable_ip_exclusion'] = isset($_POST['enable_ip_exclusion']);
                if (file_put_contents(__DIR__ . '/../config/config.php', '<?php return ' . var_export($config, true) . ';')) {
                    reloadConfigurations(); // Recharger les configurations
                    $message = "Configuration des IPs exclues mise à jour avec succès.";
                }
                break;

            case 'reset_options':
                try {
                    // Sauvegarder le mot de passe actuel
                    $current_password = $admin_config['admin']['password'];
                    
                    // Réinitialiser la configuration avec les valeurs par défaut
                    $new_config = $default_config;
                    
                    // Réinitialiser la configuration admin avec le mot de passe actuel
                    $new_admin_config = [
                        'admin' => [
                            'username' => 'admin',
                            'password' => $current_password,
                            'session_timeout' => 3600,
                            'min_password_length' => 8,
                            'require_special_chars' => true,
                            'require_numbers' => true,
                            'require_uppercase' => true
                        ],
                        'security' => [
                            'max_login_attempts' => 5,
                            'lockout_time' => 1800,
                            'password_history' => 5,
                            'password_expiry' => 90
                        ]
                    ];
                    
                    // Réinitialiser les patterns avec les valeurs par défaut
                    $new_patterns = $default_patterns;
                    
                    // Sauvegarder les configurations
                    if (file_put_contents($config_file, "<?php\nreturn " . var_export($new_config, true) . ";\n") &&
                        file_put_contents($admin_config_file, "<?php\nreturn " . var_export($new_admin_config, true) . ";\n") &&
                        file_put_contents($patterns_file, "<?php\nreturn " . var_export($new_patterns, true) . ";\n")) {
                        reloadConfigurations(); // Recharger les configurations
                        $_SESSION['success_message'] = "Les options ont été réinitialisées avec succès. Le mot de passe actuel a été conservé.";
                    } else {
                        throw new Exception('Erreur lors de la sauvegarde des configurations');
                    }
                } catch (Exception $e) {
                    $_SESSION['error_message'] = "Erreur lors de la réinitialisation des options : " . $e->getMessage();
                }
                break;

            case 'reset_config':
                try {
                    // Charger les configurations par défaut
                    $default_config = require __DIR__ . '/../config/config.php';
                    $default_patterns = require __DIR__ . '/../config/log_patterns.php';
                    
                    // Sauvegarder la configuration par défaut
                    if (file_put_contents($config_file, "<?php\nreturn " . var_export($default_config, true) . ";\n")) {
                        // Sauvegarder les patterns par défaut
                        if (file_put_contents($patterns_file, "<?php\nreturn " . var_export($default_patterns, true) . ";\n")) {
                            reloadConfigurations(); // Recharger les configurations
                            $_SESSION['message'] = 'Configuration réinitialisée avec succès';
                        } else {
                            throw new Exception('Erreur lors de la réinitialisation des patterns');
                        }
                    } else {
                        throw new Exception('Erreur lors de la réinitialisation de la configuration');
                    }
                } catch (Exception $e) {
                    $error = $e->getMessage();
                }
                break;

            case 'reset_patterns':
                try {
                    // Charger les patterns par défaut
                    $default_patterns = require __DIR__ . '/../config/log_patterns.php';
                    
                    // Sauvegarder les patterns par défaut
                    if (file_put_contents($patterns_file, "<?php\nreturn " . var_export($default_patterns, true) . ";\n")) {
                        $patterns = $default_patterns;
                        $message = 'Patterns réinitialisés avec succès';
                    } else {
                        throw new Exception('Erreur lors de la réinitialisation des patterns');
                    }
                } catch (Exception $e) {
                    $error = $e->getMessage();
                }
                break;

            case 'update_patterns':
             
                // Gestion des patterns de logs
                if (isset($_POST['patterns'])) {
                    $patterns = $_POST['patterns'];
                    
                    // Log pour debug
                    error_log('Patterns reçus: ' . print_r($patterns, true));
                    
                    // Construire le contenu du fichier
                    $content = "<?php\n";
                    $content .= "// Patterns de logs utilisateur\n";
                    $content .= "return array (\n";
                    
                    // Fonction récursive pour formater les tableaux
                    function formatPatterns($array, $indent = 2) {
                        $result = "array (\n";
                        $spaces = str_repeat(' ', $indent);
                        
                        foreach ($array as $key => $value) {
                            $result .= $spaces;
                            
                            // Handle numeric keys for patterns
                            if (is_numeric($key)) {
                                $result .= $key . ' => ';
                            } else {
                                $result .= "'" . addslashes($key) . "' => ";
                            }
                            
                            if (is_array($value)) {
                                $result .= formatPatterns($value, $indent + 2);
                            } else {
                                // Special handling for regex patterns
                                if (is_string($value) && preg_match('/^\/.*\/[imsxADSUXJu]*$/', $value)) {
                                    $result .= $value;
                                } else {
                                    $result .= "'" . addslashes($value) . "'";
                                }
                            }
                            
                            $result .= ",\n";
                        }
                        
                        $result .= str_repeat(' ', $indent - 2) . ")";
                        return $result;
                    }
                    
                    $content .= formatPatterns($patterns);
                    $content .= ");\n";
                    
                    // Log pour debug
                    error_log('Contenu généré: ' . $content);
                    
                    // Chemin du fichier
                    $filePath = __DIR__ . '/../config/log_patterns.user.php';
                    
                    // Sauvegarder dans le fichier
                    if (file_put_contents($filePath, $content) !== false) {
                        // Recharger la configuration
                        reloadConfigurations();
                        
                        // Afficher un message de succès
                        showNotification('✅ Les patterns de logs ont été mis à jour avec succès !', 'success');
                    } else {
                        showNotification('❌ Erreur lors de la sauvegarde des patterns', 'error');
                    }
                }
                
        }
    }
}


function isExcludedFile($filename, $excluded_extensions) {
    $extension = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    return in_array($extension, $excluded_extensions);
}

// Remplacer la fonction checkPermissions existante
require_once __DIR__ . '/../scripts/check_permissions.php';

function checkPermissions() {
    $checker = new PermissionChecker();
    $core_results = $checker->checkLogviewrPermissions();
    $logs_results = $checker->checkLogPathsPermissions();
    
    return [
        'all_ok' => $core_results['all_ok'] && $logs_results['all_ok'],
        'core' => $core_results,
        'logs' => $logs_results
    ];
}

// Function to count readable files in a directory
function countReadableFiles($directory) {
    $count = 0;
    if (is_dir($directory) && is_readable($directory)) {
        $files = scandir($directory);
        foreach ($files as $file) {
            if ($file !== '.' && $file !== '..' && is_file($directory . '/' . $file) && is_readable($directory . '/' . $file)) {
                $count++;
            }
        }
    }
    return $count;
}

// Function to count unreadable files in a directory
function countUnreadableFiles($directory) {
    $count = 0;
    if (is_dir($directory) && is_readable($directory)) {
        $files = scandir($directory);
        foreach ($files as $file) {
            if ($file !== '.' && $file !== '..' && is_file($directory . '/' . $file) && !is_readable($directory . '/' . $file)) {
                $count++;
            }
        }
    }
    return $count;
}

 
require_once __DIR__ . '/../includes/UpdateChecker.php';

// Initialize update checker
$updateChecker = new UpdateChecker();
$versionInfo = $updateChecker->getVersionInfo();
$updateInfo = $updateChecker->checkForUpdates();

 

// Add update notification in the header
if ($updateInfo) {
    echo '<div class="alert alert-warning alert-dismissible fade show update-alert" role="alert">
        <div class="update-alert-content">
            <i class="fas fa-exclamation-triangle"></i>
            <div class="update-alert-text">
                <strong>Nouvelle version disponible !</strong>
                <p>Version ' . $updateInfo['latest_version'] . ' est disponible (vous utilisez ' . $updateInfo['current_version'] . ')</p>
                <div class="update-actions">
                    <a href="' . $updateInfo['update_url'] . '" target="_blank" class="btn btn-warning btn-sm">
                     <!--   <i class="fas fa-download"></i> Télécharger la mise à jour -->
                    </a>
                    <a href="?tab=updates" class="btn btn-info btn-sm">
                        <i class="fas fa-info-circle"></i> Plus d\'informations
                    </a>
                </div>
            </div>
        </div>
        <button type="button" class="btn-close ms-auto" data-bs-dismiss="alert" aria-label="Close">
            <i class="fas fa-times"></i>
        </button>
    </div>';
}

// Initialisation des variables pour l'onglet Mises à jour
require_once __DIR__ . '/../includes/UpdateChecker.php';
$updateChecker = new UpdateChecker();
$currentVersion = $updateChecker->getCurrentVersion() ?? '';
$remoteVersion = $updateChecker->getRemoteVersion() ?? $currentVersion;
$updateInfo = $updateChecker->checkForUpdates();
$versionInfo = $updateChecker->getVersionInfo();
$changelog = $versionInfo['changelog'] ?? [];
$lastCheck = $updateChecker->getLastCheck();

?>
<!DOCTYPE html>
<html lang="fr" data-theme="<?php echo htmlspecialchars($config['theme'] ?? 'dark'); ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🛠️ LogviewR - Administration</title>
    
    <!-- Charger jQuery en premier -->
    <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
    <link rel="stylesheet" href="../assets/css/variables.css">
    <!--<link rel="stylesheet" href="../assets/css/base_.css">-->
    <link rel="stylesheet" href="assets/css/debug-log.css">
    <link rel="stylesheet" href="assets/css/admin.css">

    <script>
        // Initialiser la configuration pour le JavaScript
        window.currentConfig = <?php echo json_encode($config); ?>;
    </script>
    <script src="assets/js/admin.js"></script>
    <script src="assets/js/debug-log.js" defer></script>

    <style>
    /* Make the admin container wider and centered */
    .admin-container {
        width: 98vw; /* Use almost the full viewport width */
        max-width: 1800px; /* Large max width for big screens */
        margin: 30px auto 60px auto; /* Centered with top/bottom margin */
        padding: 20px 10px 40px 10px; /* Reduce side padding */
        background: var(--bg-color, #232526);
        border-radius: 16px;
        box-shadow: 0 4px 32px rgba(0,0,0,0.10);
        min-height: 80vh;
        overflow-x: visible; /* Prevent horizontal scroll */
    }

    /* Make the admin tabs wrap and avoid horizontal scroll */
    .admin-tabs {
        display: flex;
        flex-wrap: wrap; /* Allow tabs to wrap to next line */
        gap: 8px;
        overflow-x: visible; /* Remove horizontal scroll */
        width: 100%;
        margin-bottom: 24px;
        justify-content: flex-start;
    }

    .admin-tab {
        flex: 0 1 auto; /* Allow tabs to shrink/grow */
        min-width: 120px;
        max-width: 220px;
        text-align: center;
        white-space: nowrap;
        padding: 8px 18px;
        border-radius: 8px 8px 0 0;
        background: var(--bg-color, #232526);
        color: var(--text-color, #e0e6ed);
        border: 1px solid #444;
        border-bottom: none;
        transition: background 0.2s, color 0.2s;
        cursor: pointer;
    }

    .admin-tab.active {
        background: var(--primary-color, #3498db);
        color: #fff;
        font-weight: bold;
        border-bottom: 2px solid var(--primary-color, #3498db);
    }

    @media (max-width: 900px) {
        .admin-container {
            width: 100vw;
            max-width: 100vw;
            padding: 8px 2px 40px 2px;
        }
        .admin-tabs {
            gap: 4px;
        }
        .admin-tab {
            min-width: 90px;
            padding: 6px 8px;
            font-size: 13px;
        }
    }
    </style>
</head>
<body>
    <div class="admin-container">
        <div class="admin-header">
            <h1>
                <i class="fas fa-cog"></i> LogviewR   administration <?php echo LOGVIEWR_VERSION; ?>
                <?php if (isset($admin_config['debug']['enabled']) && $admin_config['debug']['enabled']): ?>
                    <span class="debug-badge" title="Mode Debug Activé">
                        <i class="fas fa-bug"></i> DEBUG
                    </span>
                <?php endif; ?>
            </h1>
            <div class="admin-nav">
                <a href="../index.php"><i class="fas fa-home"></i> Retour à l'accueil</a>
                <a href="test.php"><i class="fas fa-vial"></i> Tests</a>
                <a href="logout.php" class="btn btn-danger"><i class="fas fa-sign-out-alt"></i> Déconnexion</a>
            </div>
        </div>

        <?php if (!empty($message)): ?>
            <div class="alert alert-success">
                <i class="fas fa-check-circle"></i> <?php echo htmlspecialchars($message); ?>
            </div>
        <?php endif; ?>

        <?php if (!empty($error)): ?>
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-circle"></i> <?php echo htmlspecialchars($error); ?>
            </div>
        <?php endif; ?>

        <!-- Section des onglets -->
        <div class="admin-tabs">
            <a href="?tab=general" class="admin-tab <?php echo (!isset($_GET['tab']) || $_GET['tab'] === 'general') ? 'active' : ''; ?>" data-tab="general">
                <i class="fas fa-cog"></i> Options Générales
            </a>

            <a href="?tab=paths" class="admin-tab <?php echo (isset($_GET['tab']) && $_GET['tab'] === 'paths') ? 'active' : ''; ?>" data-tab="paths">
                <i class="fas fa-folder"></i> Chemins des logs
            </a>
            <a href="?tab=filters" class="admin-tab <?php echo (isset($_GET['tab']) && $_GET['tab'] === 'filters') ? 'active' : ''; ?>" data-tab="filters">
                <i class="fas fa-filter"></i> Filtres d'Exclusion
            </a>
            <a href="?tab=patterns" class="admin-tab <?php echo (isset($_GET['tab']) && $_GET['tab'] === 'patterns') ? 'active' : ''; ?>" data-tab="patterns">
                <i class="fas fa-code"></i> Patterns de Logs
            </a>
            <a href="?tab=theme" class="admin-tab <?php echo (isset($_GET['tab']) && $_GET['tab'] === 'theme') ? 'active' : ''; ?>" data-tab="theme">
                <i class="fas fa-palette"></i> Thème
            </a>
            <a href="?tab=password" class="admin-tab <?php echo (isset($_GET['tab']) && $_GET['tab'] === 'password') ? 'active' : ''; ?>" data-tab="password">
                <i class="fas fa-key"></i> Mot de passe
            </a>
            <a href="?tab=updates" class="admin-tab <?php echo (isset($_GET['tab']) && $_GET['tab'] === 'updates') ? 'active' : ''; ?>" data-tab="updates">
                <i class="fas fa-sync-alt"></i> Mises à jour
            </a>
            <a href="?tab=debug" class="admin-tab <?php echo (isset($_GET['tab']) && $_GET['tab'] === 'debug') ? 'active' : ''; ?>" data-tab="debug">
                <i class="fas fa-bug"></i> Login & Debug  
            </a>            
        </div>

        <!-- Onglet Options Générales -->
        <div class="admin-card" id="general-tab" style="display: block;">
            <h2><i class="fas fa-sliders-h"></i> Options Générales</h2><hr>
            <form method="POST" action="" id="general-form" data-form="main">
                <input type="hidden" name="action" value="update_config">
                <input type="hidden" name="active_tab" id="active_tab" value="general">
                
                <div class="form-group">
                    <h4>📊 Paramètres d'Affichage</h4>
                    <div class="settings-container_">
                        <div class="settings-column">
                            <div class="option-group">
                                <label for="default_lines_per_page">Lignes par page par défaut</label>
                                <input type="number" id="default_lines_per_page" name="config[app][default_lines_per_page]" 
                                       value="<?php echo $config['app']['default_lines_per_page'] ?? 50; ?>" class="form-control">
                            </div>
                            <div class="option-group">
                                <label for="max_lines_per_request">Lignes maximum par requête</label>
                                <input type="number" class="form-control" id="max_lines_per_request" name="config[app][max_lines_per_request]" 
                                       value="<?php echo htmlspecialchars($config['app']['max_lines_per_request'] ?? 20000); ?>"
                                       min="100" max="200000">
                                <small class="form-text text-muted">
                                    <i class="fas fa-info-circle"></i> Définit le nombre maximum de lignes qui peuvent être chargées en une seule requête. 
                                    Valeur recommandée : entre 1000 et 10000 pour de meilleures performances.
                                </small>
                                <div class="alert_ alert-warning mt-2" id="max_lines_warning" style="display: none;">
                                    <i class="fas fa-exclamation-triangle"></i> Attention : Une valeur supérieure à 10000 peut ralentir l'application et consommer plus de ressources serveur.
                                </div>
                            </div>
                        </div>
                        <div class="settings-column">
                            <div class="option-group">
                                <label for="refresh_interval">Intervalle de rafraîchissement (secondes)</label>
                                <input type="number" id="refresh_interval" name="config[app][refresh_interval]" 
                                    value="<?php echo $config['app']['refresh_interval'] ?? 6; ?>" 
                                    min="1" step="1" class="form-control">
                                <small class="form-text">
                                    Intervalle en secondes entre chaque rafraîchissement automatique.<br>
                                    Valeur par défaut: 15 secondes
                                </small>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Section Exclusions -->
                <div class="option-group exclusions-section">
                    <h3><i class="fas fa-ban"></i> Extensions Exclues</h3>
                    <div class="exclusion-group">
                        <label for="excluded_extensions">Liste de nom d'extensions à exclure</label>
                        <div class="exclusion-content">
                            <textarea id="excluded_extensions" name="app[excluded_extensions]" class="form-control" rows="4"><?php
                                if (isset($config['app']['excluded_extensions'])) {
                                    echo htmlspecialchars(implode("\n", $config['app']['excluded_extensions']));
                                }
                            ?></textarea>
                            <div class="exclusion-examples">
                                <h4><i class="fas fa-lightbulb"></i> Exemples</h4>
                                <div class="example-item">
                                    <code>.gz</code>
                                    <span class="example-description">Exclure tous les fichiers .gz</span>
                                </div>
                                <div class="example-item">
                                    <code>.zip</code>
                                    <span class="example-description">Exclure tous les fichiers .zip</span>
                                </div>
                                <div class="example-item">
                                    <code>.tar</code>
                                    <span class="example-description">Exclure tous les fichiers .tar</span>
                                </div>
                                <div class="example-note">
                                    <i class="fas fa-info-circle"></i>
                                    Une extension par ligne, sans le point (.)
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="form-group">
                    <h4>📅 Formats de Date et Fuseaux Horaires</h4>
                    <div class="option-group">
                        <h4>Format d'affichage dans l'interface</h4>
                        <label for="date_format_display">Format d'affichage</label>
                        <input type="text" id="date_format_display" name="config[date_formats][display]" 
                               value="<?php echo htmlspecialchars($config['date_formats']['display'] ?? 'd/m/Y H:i:s'); ?>" class="form-control">
                        
                        <button type="button" class="toggle-examples-btn" id="toggleExamplesBtn">
                            <i class="fas fa-chevron-down"></i>
                            Voir les exemples de format
                        </button>

                        <div class="format-info-container">
                        <div class="format-examples">
                            <h5>Exemples de formats disponibles :</h5>
                            <div class="example-group">
                                <code>d/m/Y H:i:s</code>
                                <span class="arrow">→</span>
                                <span class="result">25/03/2024 14:30:45</span>
                            </div>
                            <div class="example-group">
                                <code>Y-m-d H:i:s</code>
                                <span class="arrow">→</span>
                                <span class="result">2024-03-25 14:30:45</span>
                            </div>
                            <div class="example-group">
                                <code>d M Y H:i:s</code>
                                <span class="arrow">→</span>
                                <span class="result">25 Mar 2024 14:30:45</span>
                            </div>
                        </div>
                        <div class="format-variables">
                            <h5>Variables disponibles :</h5>
                            <div class="variable-group">
                                <code>d</code>
                                <span class="description">Jour du mois (01-31)</span>
                            </div>
                            <div class="variable-group">
                                <code>m</code>
                                <span class="description">Mois (01-12)</span>
                            </div>
                            <div class="variable-group">
                                <code>Y</code>
                                <span class="description">Année complète (2024)</span>
                            </div>
                            <div class="variable-group">
                                <code>H</code>
                                <span class="description">Heure au format 24h (00-23)</span>
                            </div>
                            <div class="variable-group">
                                <code>i</code>
                                <span class="description">Minutes (00-59)</span>
                            </div>
                            <div class="variable-group">
                                <code>s</code>
                                <span class="description">Secondes (00-59)</span>
                                </div>
                            </div>
                        </div>
                    </div>

 

                    <div class="option-group">
                        <h4>Fuseau Horaire</h4>
                        <label for="timezone">Fuseau horaire</label>
                        <select id="timezone" name="config[timezone]" class="form-control">
                            <?php
                            $timezones = DateTimeZone::listIdentifiers();
                            $current_timezone = $config['timezone'] ?? 'Europe/Paris';
                            foreach ($timezones as $tz) {
                                $selected = ($current_timezone === $tz) ? 'selected' : '';
                                $dt = new DateTime('now', new DateTimeZone($tz));
                                $offset = $dt->format('P');
                                echo "<option value=\"$tz\" $selected>$tz (UTC$offset)</option>";
                            }
                            ?>
                        </select>
                        <small class="form-text">
                            Fuseau horaire utilisé pour l'affichage des dates dans l'interface.<br>
                            Par défaut : Europe/Paris (UTC+1)
                        </small>
                    </div>
                </div>

  

                <button type="submit" class="btn btn-primary">
                    <i class="fas fa-save"></i> Sauvegarder les options
                </button>
                <button type="button" class="btn btn-danger" id="resetOptionsBtn" onclick="confirmReset()">
                    <i class="fas fa-undo"></i> Réinitialiser les options
                </button>
            </form>
        </div>

        <script>
        function confirmReset() {
            if (confirm('⚠️ Attention ! Cette action va réinitialiser TOUTE la configuration aux valeurs par défaut.\n\nÊtes-vous sûr de vouloir continuer ?\n\nCette action :\n- Réinitialisera tous les paramètres\n- Réinitialisera tous les patterns\n- Ne peut pas être annulée')) {
                // Créer un formulaire temporaire pour envoyer la requête
                const form = document.createElement('form');
                form.method = 'POST';
                form.action = '';

                // Ajouter l'action de réinitialisation
                const actionInput = document.createElement('input');
                actionInput.type = 'hidden';
                actionInput.name = 'action';
                actionInput.value = 'reset_config';
                form.appendChild(actionInput);

                // Ajouter le formulaire au document et le soumettre
                document.body.appendChild(form);
                form.submit();
            }
        }
        </script>

        <!-- Nouvel onglet Debug & Logs -->
        <div class="admin-card" id="debug-tab" style="display: none;">


            <h2>🔐 Login Page principal</h2>
                <div class="option-group debug-toggle">
                    <label class="switch">
                        <input type="checkbox" name="debug[require_login]" id="debug_require_login" data-switch 
                        <?php echo isset($admin_config['debug']['require_login']) && $admin_config['debug']['require_login'] ? 'checked' : ''; ?>>
                        <span class="slider"></span>
                    </label>
                    <div class="debug-label">
                        <label>Exiger une connexion pour la page principale</label>
                    </div>



            </div>
            <div class="option-group debug-toggle" style="">
                                <label class="switch">
                                    <input type="checkbox" name="admin[remember_me]" id="remember_me" data-switch
                                    <?php echo isset($admin_config['admin']['remember_me']) && $admin_config['admin']['remember_me'] ? 'checked' : ''; ?>>
                                    <span class="slider"></span>
                                </label>
                                <div class="debug-label">
                                    <label>Rester connecté</label> 
                                    <small class="form-text">plus besoin de se reconnecter !</small>
                                </div>
                            </div>  
                    
            <h2><i class="fas fa-bug"></i> Debug & Infos</h2>
            <form method="POST" action="" id="debug-form" data-form="main">
                <input type="hidden" name="action" value="update_config">
                <input type="hidden" name="active_tab" value="debug">
                
                <div class="form-group">
                    <h4>🔧 Paramètres de Debug</h4>
                    <div class="settings-container">
                        <div class="settings-column_">
                            <div class="option-group debug-toggle">
                                <label class="switch">
                                    <input type="checkbox" name="debug[enabled]" id="debug_enabled" data-switch 
                                    <?php echo isset($admin_config['debug']['enabled']) && $admin_config['debug']['enabled'] ? 'checked' : ''; ?>>
                                    <span class="slider"></span>
                                </label>
                                <div class="debug-label">
                                    <label>Activer le mode debug</label>
                                </div>
                            </div>
                            


                            <div class="option-group debug-toggle">
                                <label class="switch">
                                    <input type="checkbox" name="debug[log_to_apache]" id="debug_log_to_apache" data-switch <?php echo isset($admin_config['debug']['log_to_apache']) && $admin_config['debug']['log_to_apache'] ? 'checked' : ''; ?>>
                                    <span class="slider"></span>
                                </label>
                                <div class="debug-label">
                                    <label>Écrire les logs dans Apache</label>
                                    <small class="form-text">
                                        Les logs seront écrits à la fois dans le fichier debug.log et dans les logs Apache
                                    </small>
                                </div>
                            </div>



                            <div class="form-actions">
                                <!-- Bouton Enregistrer les changements supprimé du formulaire debug -->
                            </div>
                        </div>
                        
                        <?php if (!isset($admin_config['debug']['enabled']) || !$admin_config['debug']['enabled']): ?>
                            <div class="debug-status-message">
                                <i class="fas fa-info-circle"></i> Le mode debug est actuellement désactivé. Activez-le et enregistrez pour voir les logs de debug.
                            </div>
                        <?php else: ?>

    
                <?php endif; ?>
                <!-- Section d'affichage des logs de debug -->
                <div class="form-group">
                     <?php if (isset($admin_config['debug']['enabled']) && $admin_config['debug']['enabled']): ?>

                        <div class="debug-log-container log-card" style="margin-top:32px;">
                            <div class="debug-log-header">
                                <h5><i class="fas fa-file-alt"></i> debug.log</h5>
                                <div class="debug-log-controls">
                                    <button type="button" class="btn btn-sm btn-refresh" id="refreshPhpLogBtn">
                                        <i class="fas fa-sync-alt"></i> Rafraîchir
                                    </button>
                                    <button type="button" class="btn btn-sm btn-danger" id="clearPhpLogBtn">
                                        <i class="fas fa-trash-alt"></i> Vider
                                    </button>
                                </div>
                            </div>
                            <div id="php-log-content" class="debug-log-content">
                                <pre><code><?php
                                $php_log = dirname(__DIR__) . '/logs/debug.log';
                                if (file_exists($php_log) && is_readable($php_log)) {
                                    $lines = array_slice(file($php_log), -100);
                                    foreach ($lines as $line) {
                                        echo htmlspecialchars($line);
                                    }
                                } else {
                                    echo "Le fichier debug.log n'existe pas ou n'est pas lisible.";
                                }
                                ?></code></pre>
                            </div>
                            <div id="php-log-status" class="log-status"></div>
                        </div>
                        
                        
                        <!-- Bloc pour php_errors.log -->
                        <div class="debug-log-container log-card" style="margin-top:32px;">
                            <div class="debug-log-header">
                                <h5><i class="fas fa-file-alt"></i> php_errors.log</h5>
                                <div class="debug-log-controls">
                                    <button type="button" class="btn btn-sm btn-refresh" id="refreshPhpLogBtn">
                                        <i class="fas fa-sync-alt"></i> Rafraîchir
                                    </button>
                                    <button type="button" class="btn btn-sm btn-danger" id="clearPhpLogBtn">
                                        <i class="fas fa-trash-alt"></i> Vider
                                    </button>
                                </div>
                            </div>
                            <div id="php-log-content" class="debug-log-content">
                                <pre><code><?php
                                $php_log = dirname(__DIR__) . '/logs/php_errors.log';
                                if (file_exists($php_log) && is_readable($php_log)) {
                                    $lines = array_slice(file($php_log), -100);
                                    foreach ($lines as $line) {
                                        echo htmlspecialchars($line);
                                    }
                                } else {
                                    echo "Le fichier php_errors.log n'existe pas ou n'est pas lisible.";
                                }
                                ?></code></pre>
                            </div>
                            <div id="php-log-status" class="log-status"></div>
                        </div>
                    <?php endif; ?>
                </div>

              

                        <div class="settings-column">
                            <div class="permissions-status">
                                <h3><i class="fas fa-shield-alt"></i> État des Permissions</h3>
                                <?php
                                $permissions = checkPermissions();
                                $checker = new PermissionChecker();
                                ?>
                                
                                <div class="permissions-status">
                                    <?php if ($permissions['all_ok']): ?>
                                        <div class="permission-item success">
                                            <div class="permission-icon">
                                                <i class="fas fa-check-circle"></i>
                                            </div>
                                            <div class="permission-info">
                                                Toutes les permissions sont correctement configurées
                                            </div>
                                        </div>
                                    <?php else: ?>
                                        <?php foreach ($permissions['core']['details'] as $name => $info): ?>
                                            <?php if (!$info['ok']): ?>
                                                <div class="permission-item <?php echo $info['type'] === 'core' ? 'error' : 'warning'; ?>">
                                                    <div class="permission-icon">
                                                        <i class="fas fa-<?php echo $info['type'] === 'directory' ? 'folder' : 'file'; ?>"></i>
                                                    </div>
                                                    <div class="permission-info">
                                                        <div class="permission-path"><?php echo $name; ?></div>
                                                        <div class="permission-details">
                                                            Permissions actuelles: <?php echo $info['current']; ?> 
                                                            (requis: <?php echo $info['required']; ?>)
                                                        </div>
                                                    </div>
                                                </div>
                                            <?php endif; ?>
                                        <?php endforeach; ?>

                                        <?php foreach ($permissions['logs']['details'] as $type => $info): ?>
                                            <?php if (!$info['readable']): ?>
                                                <div class="permission-item warning">
                                                    <div class="permission-icon">
                                                        <i class="fas fa-exclamation-triangle"></i>
                                                    </div>
                                                    <div class="permission-info">
                                                        <div class="permission-path">Logs <?php echo ucfirst($type); ?></div>
                                                        <div class="permission-details">
                                                            <?php echo $info['exists'] ? 
                                                                'Le dossier existe mais n\'est pas lisible' : 
                                                                'Le dossier n\'existe pas'; ?>
                                                            <br>
                                                            Chemin: <?php echo $info['path']; ?>
                                                        </div>
                                                    </div>
                                                </div>
                                            <?php endif; ?>
                                        <?php endforeach; ?>

                                        <div class="fix-commands">
                                            <div class="title">
                                                <i class="fas fa-terminal"></i>
                                                Commandes pour corriger les permissions :
                                            </div>
                                            <pre><code><?php
                                            $commands = $checker->generateFixCommands($permissions['core']);
                                            echo implode("\n", $commands);
                                            ?></code></pre>
                                        </div>
                                    <?php endif; ?>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>







             <!--   <button type="submit" class="btn btn-primary">
                    <i class="fas fa-save"></i> Sauvegarder les paramètres de debug
                </button> -->
            </form>
        </div>

        <!-- Onglet Chemins logs -->
        <div class="admin-card paths-section" id="paths-tab">
            <h2><i class="fas fa-folder-tree"></i> Chemins des logs</h2>
            <form method="POST" action="" id="paths-form" data-form="main">
                <input type="hidden" name="action" value="update_paths">
                <input type="hidden" name="active_tab" value="paths">

                <!-- Section Apache -->
                <div class="option-group">
                    <h3><i class="fas fa-server"></i> Apache</h3>
                    <div class="path-group">
                        <div class="path-input-container">
                        <label for="apache_path">Chemin des logs Apache</label>
                        <div class="input-with-example" style="display: flex; align-items: flex-start; gap: 16px;">
                            <div class="input-validation-container" style="flex: 1;">
                                <input type="text" id="apache_path" name="paths[apache_logs]" 
                                    value="<?php echo htmlspecialchars($config['paths']['apache_logs'] ?? ''); ?>" 
                                    class="form-control path-input" placeholder="/var/log/apache2">
                                <div class="validation-feedback">
                                    <span class="validation-status"></span>
                                    <span class="validation-message"></span>
                                </div>
                            </div>
                            <div class="file-count" style="min-width: 160px;">
                                <i class="fas fa-file-alt"></i>
                                <?php
                                $apache_path = $config['paths']['apache_logs'] ?? '/var/log/apache2';
                                $readable_files = countReadableFiles($apache_path);
                                $unreadable_files = countUnreadableFiles($apache_path);
                                echo "<span class='readable-count'>Fichiers lisibles: $readable_files</span>";
                                if ($unreadable_files > 0) {
                                    echo "<span class='unreadable-count'>Fichiers non lisibles: $unreadable_files</span>";
                                }
                                ?>
                            </div>
                        </div>
                        </div>
                    </div>
                </div>


                <!-- Section Nginx -->
                <div class="option-group">
                    <h3><i class="fas fa-cubes"></i> <?php echo (isset($config['nginx']['use_npm']) && $config['nginx']['use_npm']) ? 'Nginx Proxy Manager' : 'Nginx'; ?></h3>
                    <div class="option-group"  style="width: 200px; margin-left: 24px; margin-top: 25px;">
                        <label class="switch">
                            <input type="checkbox" id="use_npm" name="nginx[use_npm]" data-switch <?php echo $config['nginx']['use_npm'] ? 'checked' : ''; ?>>
                            <span class="slider round"></span>
                        </label>
                        <span class="switch-label">Utiliser Nginx Proxy Manager</span>
                    </div>
                    <div class="path-group">
                        <div class="path-input-container">
                            <label for="nginx_path">Chemin des logs <?php echo (isset($config['nginx']['use_npm']) && $config['nginx']['use_npm']) ? 'Nginx Proxy Manager' : 'Nginx'; ?></label>
                            <div class="input-with-example">
                                <?php if (isset($config['nginx']['use_npm']) && $config['nginx']['use_npm']): ?>
                                    <div class="input-with-example" style="display: flex; align-items: flex-start; gap: 16px;">
                                        <div class="input-validation-container" style="flex: 1;">                                    
                                        <input type="text" id="nginx_path" name="paths[npm_logs]" 
                                            value="<?php echo htmlspecialchars($config['paths']['npm_logs'] ?? ''); ?>" 
                                            class="form-control path-input" placeholder="/var/log/nginx-proxy-manager">
                                            <div class="validation-feedback">
                                                    <span class="validation-status"></span>
                                                    <span class="validation-message"></span>
                                                </div>
                                        </div>                                            
                                <?php else: ?>
                                    <input type="text" id="nginx_path" name="paths[nginx_logs]" 
                                           value="<?php echo htmlspecialchars($config['paths']['nginx_logs'] ?? ''); ?>" 
                                           class="form-control path-input" placeholder="/var/log/nginx">
                                           <div class="validation-feedback">
                                                <span class="validation-status"></span>
                                                <span class="validation-message"></span>
                                            </div>
                                <?php endif; ?>
                                <div class="file-count">
                                    <i class="fas fa-file-alt"></i>
                                    <?php
                                    $nginx_path = (isset($config['nginx']['use_npm']) && $config['nginx']['use_npm']) ? 
                                        ($config['paths']['npm_logs'] ?? '/var/log/nginx-proxy-manager') : 
                                        ($config['paths']['nginx_logs'] ?? '/var/log/nginx');
                                    $readable_files = countReadableFiles($nginx_path);
                                    $unreadable_files = countUnreadableFiles($nginx_path);
                                    echo "<span class='readable-count'>Fichiers lisibles: $readable_files</span>";
                                    if ($unreadable_files > 0) {
                                        echo "<span class='unreadable-count'>Fichiers non lisibles: $unreadable_files</span>";
                                    }
                                    ?>
                                </div>
                            </div>

                            </div>
                        </div>
                    </div>
                </div>

                <!-- Section Syslog -->
                <div class="option-group">
                    <h3><i class="fas fa-terminal"></i>  Syslog</h3>
                    <div class="path-group">
                        <div class="path-input-container">
                         <label for="syslog_path">Chemin des logs Syslog</label>
                            <div class="input-with-example">

                                <div class="input-with-example" style="display: flex; align-items: flex-start; gap: 16px;">
                                    <div class="input-validation-container" style="flex: 1;">                        
                                        <input type="text" id="syslog_path" name="paths[syslog]" 
                                            value="<?php echo htmlspecialchars($config['paths']['syslog'] ?? ''); ?>" 
                                            class="form-control path-input" placeholder="/var/log/syslog">
                                                    <div class="validation-feedback">
                                                        <span class="validation-status"></span>
                                                        <span class="validation-message"></span>
                                                    </div>
                                    </div> 
                                    <div class="file-count">
                                        <i class="fas fa-file-alt"></i>
                                        <?php
                                        $syslog_path = $config['paths']['syslog'] ?? '/var/log/syslog';
                                        $readable_files = countReadableFiles($syslog_path);
                                        $unreadable_files = countUnreadableFiles($syslog_path);
                                        echo "<span class='readable-count'>Fichiers lisibles: $readable_files</span>";
                                        if ($unreadable_files > 0) {
                                            echo "<span class='unreadable-count'>Fichiers non lisibles: $unreadable_files</span>";
                                        }
                                        ?>
                                    </div>
                                </div>

                            </div>
                        </div>
                    </div>
                </div>



                <button type="submit" class="btn btn-primary">
                    <i class="fas fa-save"></i> Sauvegarder les logs
                </button>
            </form>
        </div>

        <!-- Onglet Filtres d'Exclusion -->
        <div class="admin-card" id="filters-tab" style="display: none;">
            <h2><i class="fas fa-filter"></i> Filtres d'Exclusion Globaux</h2>
            
            <form method="post" action="" id="filters-form" data-form="main">
                <input type="hidden" name="action" value="update_config">
                <input type="hidden" name="active_tab" value="filters">
                
                <div class="filter-toggle-container">
                    <label class="switch">
                        <input type="checkbox" name="config[filters][enabled]" value="1" <?php echo ($config['filters']['enabled'] ?? false) ? 'checked' : ''; ?>>
                        <span class="slider round"></span>
                    </label>
                    <span class="filter-toggle-label">Activer les filtres par défaut</span>
                </div>
                
                <div class="global-filters">
                    <h3><i class="fas fa-shield-alt"></i> Filtres d'Exclusion Globaux</h3>
                    
                    <div class="filter-group">
                        <label>
                            <div class="label-content">
                                <i class="fas fa-ban"></i> IPs à Exclure
                            </div>
                            <span class="pattern-help" data-help="Exclure des IPs spécifiques des logs. Format: /pattern/ - Exemple: /^192\.168\.1\./ exclura toutes les IPs commençant par 192.168.1., /^10\.0\.0\./ exclura les IPs du réseau 10.0.0.0/24">
                                <i class="fas fa-question-circle"></i>
                            </span>
                        </label>
                        <div class="input-validation-container">
                            <textarea name="config[filters][exclude][ips]" id="exclude_ips" class="pattern-input" rows="4"><?php 
                                if (isset($config['filters']['exclude']['ips'])) {
                                    echo implode("\n", $config['filters']['exclude']['ips']);
                                }
                            ?></textarea>
                            <div class="validation-wrapper">
                                <div class="validation-status"></div>
                                <div class="validation-message"></div>
                            </div>
                        </div>
                        <small><i class="fas fa-info-circle"></i> Un pattern par ligne .ex: <pre><code style="background:rgb(35, 91, 40);">/^192\.168\.1\./, /^10\.0\.0\./</code></pre></small>
                    </div>
                    
                    <div class="filter-group">
                        <label>
                            <div class="label-content">
                                <i class="fas fa-link"></i> Requêtes à Exclure
                            </div>
                            <span class="pattern-help" data-help="Exclure des requêtes spécifiques des logs. Format: /pattern/ - Exemple: /favicon\.ico/ exclura toutes les requêtes pour favicon.ico, /\.(jpg|png|gif)$/ exclura les requêtes d'images">
                                <i class="fas fa-question-circle"></i>
                            </span>
                        </label>
                        <div class="input-validation-container">
                            <textarea name="config[filters][exclude][requests]" id="exclude_requests" class="pattern-input" rows="4"><?php 
                                if (isset($config['filters']['exclude']['requests'])) {
                                    echo implode("\n", $config['filters']['exclude']['requests']);
                                }
                            ?></textarea>
                            <div class="validation-wrapper">
                                <div class="validation-status"></div>
                                <div class="validation-message"></div>
                            </div>
                        </div>
                        <small><i class="fas fa-info-circle"></i> Un pattern par ligne .ex: <pre><code style="background:rgb(35, 91, 40);">/favicon\.ico/, /\.(jpg|png|gif)$/</code></pre></small>
                    </div>
                    
                    <div class="filter-group">
                        <label>
                            <div class="label-content">
                                <i class="fas fa-robot"></i> User-Agents à Exclure
                            </div>
                            <span class="pattern-help" data-help="Exclure des User-Agents spécifiques des logs. Format: /pattern/ - Exemple: /bot/ exclura tous les bots, /crawler/ exclura les crawlers, /^Mozilla/ exclura les navigateurs standards">
                                <i class="fas fa-question-circle"></i>
                            </span>
                        </label>
                        <div class="input-validation-container">
                            <textarea name="config[filters][exclude][user_agents]" id="exclude_user_agents" class="pattern-input" rows="4"><?php 
                                if (isset($config['filters']['exclude']['user_agents'])) {
                                    echo implode("\n", $config['filters']['exclude']['user_agents']);
                                }
                            ?></textarea>
                            <div class="validation-wrapper">
                                <div class="validation-status"></div>
                                <div class="validation-message"></div>
                            </div>
                        </div>
                        <small><i class="fas fa-info-circle"></i> Un pattern par ligne .ex: <pre><code style="background:rgb(35, 91, 40);">/bot/, /crawler/, /^Mozilla/</code></pre></small>
                    </div>
                    
                    <div class="filter-group">
                        <label>
                            <div class="label-content">
                                <i class="fas fa-user"></i> Utilisateurs à Exclure
                            </div>
                            <span class="pattern-help" data-help="Exclure des utilisateurs spécifiques des logs. Format: /pattern/ - Exemple: /^admin/ exclura tous les utilisateurs commençant par 'admin', /^system/ exclura les utilisateurs système">
                                <i class="fas fa-question-circle"></i>
                            </span>
                        </label>
                        <div class="input-validation-container">
                            <textarea name="config[filters][exclude][users]" id="exclude_users" class="pattern-input" rows="4"><?php 
                                if (isset($config['filters']['exclude']['users'])) {
                                    echo implode("\n", $config['filters']['exclude']['users']);
                                }
                            ?></textarea>
                            <div class="validation-wrapper">
                                <div class="validation-status"></div>
                                <div class="validation-message"></div>
                            </div>
                        </div>
                        <small><i class="fas fa-info-circle"></i> Un pattern par ligne .ex: <pre><code style="background:rgb(35, 91, 40);">/^admin/, /^system/</code></pre></small>
                    </div>
                    
                    <div class="filter-group">
                        <label>
                            <div class="label-content">
                                <i class="fas fa-file-alt"></i> Contenu à Exclure
                            </div>
                            <span class="pattern-help" data-help="Exclure des contenus spécifiques des logs. Format: /pattern/ - Exemple: /error/ exclura les lignes contenant 'error', /warning/ exclura les lignes contenant 'warning'">
                                <i class="fas fa-question-circle"></i>
                            </span>
                        </label>
                        <div class="input-validation-container">
                            <textarea name="config[filters][exclude][content]" id="exclude_content" class="pattern-input" rows="4"><?php 
                                if (isset($config['filters']['exclude']['content'])) {
                                    if (is_array($config['filters']['exclude']['content'])) {
                                        echo implode("\n", $config['filters']['exclude']['content']);
                                    } else {
                                        echo $config['filters']['exclude']['content'];
                                    }
                                }
                            ?></textarea>
                            <div class="validation-wrapper">
                                <div class="validation-status"></div>
                                <div class="validation-message"></div>
                            </div>
                        </div>
                        <small><i class="fas fa-info-circle"></i> Un pattern par ligne .ex: <pre><code style="background:rgb(35, 91, 40);">/error/, /warning/</code></pre></small>
                    </div>
                </div>
                
                <div class="form-actions">
                    <button type="submit" class="btn btn-primary">
                        <i class="fas fa-save"></i> Enregistrer les Filtres
                    </button>
                </div>
            </form>
        </div>

        <style>
        .filter-toggle-container {
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .switch {
            position: relative;
            display: inline-block;
            width: 40px;  /* Réduit de 60px à 40px */
            height: 22px; /* Réduit de 34px à 22px */
        }

        .switch input {
            opacity: 0;
            width: 0;
            height: 0;
        }

        .slider {
            position: absolute;
            cursor: pointer;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: #ccc;
            transition: .4s;
        }

        .slider:before {
            position: absolute;
            content: "";
            height: 16px; /* Réduit de 26px à 16px */
            width: 16px;  /* Réduit de 26px à 16px */
            left: 3px;    /* Ajusté de 4px à 3px */
            bottom: 3px;  /* Ajusté de 4px à 3px */
            background-color: white;
            transition: .4s;
        }

        input:checked + .slider {
            background-color: #2196F3;
        }

        input:checked + .slider:before {
            transform: translateX(18px); /* Ajusté de 26px à 18px */
        }

        .slider.round {
            border-radius: 22px; /* Ajusté de 34px à 22px */
        }

        .slider.round:before {
            border-radius: 50%;
        }

        .filter-toggle-label {
            font-size: 14px;
            color: #666;
        }
        </style>

        <!-- Onglet Patterns de Logs -->
        <div class="admin-card" id="patterns-tab" style="display: none;">
            <h2><i class="fas fa-code"></i> Patterns de Logs</h2>
            <form id="patterns-form" method="post" class="space-y-6">
                <input type="hidden" name="action" value="update_patterns">
                <input type="hidden" name="active_tab" value="patterns">
                
                <?php
                // Utiliser les patterns déjà chargés
                global $patterns, $default_patterns, $custom_patterns;
                
                // Utiliser la configuration globale des couleurs et icônes
                global $pattern_config;
                
                foreach ($pattern_config as $type => $config):
                ?>
                    <div class="pattern-group">
                        <h3 style="border-left: 4px solid <?php echo $config['access_color']; ?>;">
                            <i class="fas <?php echo $config['icon']; ?>"></i> <?php echo $config['title']; ?>
                        </h3>
                        <?php if (isset($patterns[$type])): ?>
                            <?php if ($type === 'npm'): ?>
                                <?php foreach ($config['patterns'] as $pattern_type => $pattern_config): ?>
                                    <?php if (isset($patterns[$type][$pattern_type])): ?>
                                        <?php
                                        $custom_value = $custom_patterns[$type][$pattern_type]['pattern'] ?? null;
                                        $default_value = $default_patterns[$type][$pattern_type]['pattern'] ?? null;
                                        $is_custom = ($custom_value !== null) && ($custom_value !== $default_value);
                                        $pattern_source = $is_custom ? 'custom' : 'default';
                                        ?>
                                        <div class="pattern-subgroup" style="border-left: 4px solid <?php echo strpos($pattern_type, 'error') !== false ? $config['error_color'] : $config['access_color']; ?>;">
                                            <label for="<?php echo $type; ?>_<?php echo $pattern_type; ?>_pattern">
                                                <i class="fas <?php echo $pattern_config['icon']; ?>" style="color: <?php echo strpos($pattern_type, 'error') !== false ? $config['error_color'] : $config['access_color']; ?>;"></i>
                                                <?php echo $pattern_config['label']; ?>
                                            </label>
                                            <div class="pattern-input-container">
                                                <input type="text" 
                                                       id="<?php echo $type; ?>_<?php echo $pattern_type; ?>_pattern" 
                                                       name="patterns[<?php echo $type; ?>][<?php echo $pattern_type; ?>][pattern]" 
                                                       value="<?php echo htmlspecialchars($patterns[$type][$pattern_type]['pattern'] ?? ''); ?>" 
                                                       class="form-control">
                                                <span class="pattern-info <?php echo $pattern_source; ?>">
                                                    <i class="fas <?php echo $is_custom ? 'fa-edit' : 'fa-copy'; ?>"></i>
                                                    <?php echo ucfirst($pattern_source); ?>
                                                </span>
                                            </div>
                                            <div class="pattern-help">
                                                <i class="fas fa-info-circle"></i>
                                                <?php echo $pattern_config['help'] ?? 'Pattern pour les logs ' . $pattern_config['label']; ?>
                                            </div>
                                        </div>
                                    <?php endif; ?>
                                <?php endforeach; ?>
                            <?php else: ?>
                                <?php if (isset($patterns[$type]['access'])): ?>
                                    <?php
                                    $custom_value = $custom_patterns[$type]['access']['pattern'] ?? null;
                                    $default_value = $default_patterns[$type]['access']['pattern'] ?? null;
                                    $is_custom = ($custom_value !== null) && ($custom_value !== $default_value);
                                    $pattern_source = $is_custom ? 'custom' : 'default';
                                    ?>
                                    <div class="pattern-subgroup" style="border-left: 4px solid <?php echo $config['access_color']; ?>;">
                                        <label for="<?php echo $type; ?>_access_pattern">
                                            <i class="fas fa-check-circle" style="color: <?php echo $config['access_color']; ?>;"></i>
                                            Pattern Access Log
                                        </label>
                                        <div class="pattern-input-container">
                                            <input type="text" 
                                                   id="<?php echo $type; ?>_access_pattern" 
                                                   name="patterns[<?php echo $type; ?>][access][pattern]" 
                                                   value="<?php echo htmlspecialchars($patterns[$type]['access']['pattern'] ?? ''); ?>" 
                                                   class="form-control">
                                            <span class="pattern-info <?php echo $pattern_source; ?>">
                                                <i class="fas <?php echo $is_custom ? 'fa-edit' : 'fa-copy'; ?>"></i>
                                                <?php echo ucfirst($pattern_source); ?>
                                            </span>
                                        </div>
                                        <div class="pattern-help">
                                            <i class="fas fa-info-circle"></i>
                                            Pattern pour les logs d'accès <?php echo $config['title']; ?>
                                        </div>
                                    </div>
                                <?php endif; ?>
                                <?php if (isset($patterns[$type]['error'])): ?>
                                    <?php
                                    $custom_value = $custom_patterns[$type]['error']['pattern'] ?? null;
                                    $default_value = $default_patterns[$type]['error']['pattern'] ?? null;
                                    $is_custom = ($custom_value !== null) && ($custom_value !== $default_value);
                                    $pattern_source = $is_custom ? 'custom' : 'default';
                                    ?>
                                    <div class="pattern-subgroup" style="border-left: 4px solid <?php echo $config['error_color']; ?>;">
                                        <label for="<?php echo $type; ?>_error_pattern">
                                            <i class="fas fa-exclamation-triangle" style="color: <?php echo $config['error_color']; ?>;"></i>
                                            Pattern Error Log
                                        </label>
                                        <div class="pattern-input-container">
                                            <input type="text" 
                                                   id="<?php echo $type; ?>_error_pattern" 
                                                   name="patterns[<?php echo $type; ?>][error][pattern]" 
                                                   value="<?php echo htmlspecialchars($patterns[$type]['error']['pattern'] ?? ''); ?>" 
                                                   class="form-control">
                                            <span class="pattern-info <?php echo $pattern_source; ?>">
                                                <i class="fas <?php echo $is_custom ? 'fa-edit' : 'fa-copy'; ?>"></i>
                                                <?php echo ucfirst($pattern_source); ?>
                                            </span>
                                        </div>
                                        <div class="pattern-help">
                                            <i class="fas fa-info-circle"></i>
                                            Pattern pour les logs d'erreur <?php echo $config['title']; ?>
                                        </div>
                                    </div>
                                <?php endif; ?>
                                <?php if ($type === 'apache'): ?>
                                    <!-- Pattern pour Apache 404 -->
                                    <?php
                                    $custom_value = $custom_patterns['apache-404']['pattern'] ?? null;
                                    $default_value = $default_patterns['apache-404']['pattern'] ?? null;
                                    $is_custom = ($custom_value !== null) && ($custom_value !== $default_value);
                                    $pattern_source = $is_custom ? 'custom' : 'default';
                                    ?>
                                    <div class="pattern-subgroup" style="border-left: 4px solid #FF9800;">
                                        <label for="apache_404_pattern">
                                            <i class="fas fa-exclamation-circle" style="color: #FF9800;"></i>
                                            Pattern 404 Log
                                        </label>
                                        <div class="pattern-input-container">
                                            <input type="text" 
                                                   id="apache_404_pattern" 
                                                   name="patterns[apache-404][pattern]" 
                                                   value="<?php echo htmlspecialchars($patterns['apache-404']['pattern'] ?? ''); ?>" 
                                                   class="form-control">
                                            <span class="pattern-info <?php echo $pattern_source; ?>">
                                                <i class="fas <?php echo $is_custom ? 'fa-edit' : 'fa-copy'; ?>"></i>
                                                <?php echo ucfirst($pattern_source); ?>
                                            </span>
                                        </div>
                                        <div class="pattern-help">
                                            <i class="fas fa-info-circle"></i>
                                            Pattern pour les logs d'erreurs 404 Apache
                                        </div>
                                    </div>
                                    <!-- Pattern pour Apache Referer -->
                                    <?php
                                    $custom_value = $custom_patterns['apache-referer']['pattern'] ?? null;
                                    $default_value = $default_patterns['apache-referer']['pattern'] ?? null;
                                    $is_custom = ($custom_value !== null) && ($custom_value !== $default_value);
                                    $pattern_source = $is_custom ? 'custom' : 'default';
                                    ?>
                                    <div class="pattern-subgroup" style="border-left: 4px solid #2196F3;">
                                        <label for="apache_referer_pattern">
                                            <i class="fas fa-link" style="color: #2196F3;"></i>
                                            Pattern Referer Log
                                        </label>
                                        <div class="pattern-input-container">
                                            <input type="text" 
                                                   id="apache_referer_pattern" 
                                                   name="patterns[apache-referer][pattern]" 
                                                   value="<?php echo htmlspecialchars($patterns['apache-referer']['pattern'] ?? ''); ?>" 
                                                   class="form-control">
                                            <span class="pattern-info <?php echo $pattern_source; ?>">
                                                <i class="fas <?php echo $is_custom ? 'fa-edit' : 'fa-copy'; ?>"></i>
                                                <?php echo ucfirst($pattern_source); ?>
                                            </span>
                                        </div>
                                        <div class="pattern-help">
                                            <i class="fas fa-info-circle"></i>
                                            Pattern pour les logs de référents Apache
                                        </div>
                                    </div>
                                <?php endif; ?>
                            <?php endif; ?>
                        <?php endif; ?>
                    </div>
                <?php endforeach; ?>

                <div class="form-actions">
                    <button type="submit" class="btn btn-primary">
                        <i class="fas fa-save"></i> Enregistrer les Patterns
                    </button>
                    <button type="button" class="btn btn-warning" onclick="resetPatterns()">
                        <i class="fas fa-undo"></i> Réinitialiser les Patterns
                    </button>
                </div>
            </form>
        </div>

        <script>
        function resetPatterns() {
            if (confirm('Êtes-vous sûr de vouloir réinitialiser tous les patterns ?\n\nCette action :\n- Réinitialisera tous les patterns aux valeurs par défaut\n- Ne peut pas être annulée')) {
                const form = document.createElement('form');
                form.method = 'POST';
                form.action = '';

                const actionInput = document.createElement('input');
                actionInput.type = 'hidden';
                actionInput.name = 'action';
                actionInput.value = 'reset_patterns';
                form.appendChild(actionInput);

                document.body.appendChild(form);
                form.submit();
            }
        }
        </script>

        <!-- Nouvel onglet Thème -->
        <div class="admin-card" id="theme-tab" style="display: none;">
            <h2><i class="fas fa-palette"></i> Configuration du Thème</h2>
            <div class="form-group">
                <h3>Sélection du Thème</h3>
                <div class="theme-selector">

                   <div class="theme-option">
                        <input type="radio" id="theme_dark" name="theme" value="dark"
                        <?php echo (!isset($config['theme']) || $config['theme'] === 'dark') ? 'checked' : ''; ?>>
                        <label for="theme_dark" class="theme-preview dark">
                            <span class="theme-name">Thème Sombre</span>
                            <div class="theme-colors">
                                <span class="color" style="background: <?php echo $config['themes']['dark']['primary_color'] ?? '#3498db'; ?>"></span>
                                <span class="color" style="background: <?php echo $config['themes']['dark']['text_color'] ?? '#ffffff'; ?>"></span>
                                <span class="color" style="background: <?php echo $config['themes']['dark']['bg_color'] ?? '#1a1a1a'; ?>"></span>
                            </div>
                            <small class="theme-description">👁️ Réduit la fatigue oculaire !</small>
                        </label>
                  </div>

                    <div class="theme-option">
                        <input type="radio" id="theme_light" name="theme" value="light"
                        <?php echo (isset($config['theme']) && $config['theme'] === 'light') ? 'checked' : ''; ?>>
                        <label for="theme_light" class="theme-preview light">
                            <span class="theme-name">Thème Clair</span>
                            <div class="theme-colors">
                                <span class="color" style="background: <?php echo $config['themes']['light']['primary_color'] ?? '#3498db'; ?>"></span>
                                <span class="color" style="background: <?php echo $config['themes']['light']['text_color'] ?? '#333333'; ?>"></span>
                                <span class="color" style="background: <?php echo $config['themes']['light']['bg_color'] ?? '#ffffff'; ?>"></span>
                            </div>
                            <small class="theme-description">☀️ si tu es en plein soleil </small>
                        </label>
                    </div>
                    
                    <div class="theme-option">
                        <input type="radio" id="theme_glass" name="theme" value="glass"
                        <?php echo (isset($config['theme']) && $config['theme'] === 'glass') ? 'checked' : ''; ?>>
                        <label for="theme_glass" class="theme-preview glass">
                            <span class="theme-name">Dark Moderne Glass</span>
                            <div class="theme-colors">
                                <span class="color" style="background: linear-gradient(90deg, #6a85b6 0%, #b993d6 100%);"></span>
                                <span class="color" style="background: <?php echo $config['themes']['glass']['text_color'] ?? '#e0e6ed'; ?>;"></span>
                                <span class="color" style="background: <?php echo $config['themes']['glass']['bg_color'] ?? '#232526'; ?>;"></span>
                            </div>
                            <small class="theme-description">✨ Effet glassmorphism moderne</small>
                        </label>
                    </div>

                </div>
 
                  <div class="alert1 mt-3" id="theme-warning" style="display: none;">
                <!-- <div class="alert alert-info mt-3" id="theme-warning" style="display: none;">
                     <i class="fas fa-info-circle"></i> 
                    Le thème est actuellement sauvegardé uniquement pour votre session. 
                    Pour le rendre permanent, cliquez sur "Enregistrer le thème".
                    -->
                </div>
    
                <div class="alert alert-success mt-3" id="theme-success" style="display: none;">
                    <i class="fas fa-check-circle"></i> 
                    Le thème est correctement enregistré dans la configuration.
                </div>

                <div class="theme-actions" style="margin-top: 20px; text-align: center;">
                    <button type="button" id="save-theme" class="btn btn-primary">
                        <i class="fas fa-save"></i> Enregistrer le thème
                    </button>
                    <button type="button" id="reset-themes" class="btn btn-warning">
                        <i class="fas fa-undo"></i> Réinitialiser les thèmes par défaut
                    </button>
                </div>

                <script>
                document.addEventListener('DOMContentLoaded', function() {
                    const configTheme = '<?php echo $config['theme'] ?? 'dark'; ?>';
                    const themeWarning = document.getElementById('theme-warning');
                    const themeSuccess = document.getElementById('theme-success');
                    const radioButtons = document.querySelectorAll('input[name="theme"]');
                    
                    // Ne pas afficher de message au chargement initial
                    themeWarning.style.display = 'none';
                    themeSuccess.style.display = 'none';
                    
                    // Fonction pour vérifier si le thème actuel correspond à la configuration
                    function checkThemeMatch() {
                        const selectedTheme = document.querySelector('input[name="theme"]:checked').value;
                        // Afficher le message d'avertissement uniquement si le thème sélectionné est différent
                        if (selectedTheme !== configTheme) {
                            themeWarning.style.display = 'block';
                            themeSuccess.style.display = 'none';
                        } else {
                            themeWarning.style.display = 'none';
                            themeSuccess.style.display = 'none';
                        }
                    }

                    // Forcer la sélection du thème configuré au chargement
                    const defaultTheme = document.querySelector(`input[value="${configTheme}"]`);
                    if (defaultTheme) {
                        defaultTheme.checked = true;
                    }

                    // Vérifier à chaque changement de thème
                    radioButtons.forEach(radio => {
                        radio.addEventListener('change', checkThemeMatch);
                    });

                    document.getElementById('save-theme').addEventListener('click', function() {
                        const selectedTheme = document.querySelector('input[name="theme"]:checked').value;
                        const button = this;
                        
                        button.disabled = true;
                        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enregistrement...';
                        
                        // Récupérer les couleurs personnalisées pour chaque thème
                        const themeData = {};
                        document.querySelectorAll('.color-input input[type="color"]').forEach(input => {
                            const name = input.name;
                            const value = input.value;
                            themeData[name] = value;
                        });
                        // Construction du body POST
                        const params = new URLSearchParams();
                        params.append('action', 'save_all');
                        params.append('theme', selectedTheme);
                        for (const key in themeData) {
                            params.append(key, themeData[key]);
                        }
                        fetch('ajax_actions.php', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/x-www-form-urlencoded',
                            },
                            body: params.toString()
                        })
                        .then(response => response.json())
                        .then(data => {
                            if (data.success) {
                                themeWarning.style.display = 'none';
                                themeSuccess.style.display = 'block';
                            //    showNotification('success', '✨ Thème enregistré avec succès !');
                                // Mettre à jour le thème configuré
                                window.configTheme = selectedTheme;
                                
                                // Masquer le message de succès après 3 secondes
                                setTimeout(() => {
                                    themeSuccess.style.display = 'none';
                                }, 3000);
                            } else {
                                showNotification('error', '❌ Erreur lors de l\'enregistrement du thème');
                                themeWarning.style.display = 'block';
                                themeSuccess.style.display = 'none';
                            }
                        })
                        .catch(error => {
                            console.error('Error:', error);
                            showNotification('error', '❌ Erreur lors de l\'enregistrement du thème');
                        })
                        .finally(() => {
                            button.disabled = false;
                            button.innerHTML = '<i class="fas fa-save"></i> Enregistrer le thème';
                        });
                    });
                });
                </script>
            </div>

            <div class="form-group">
                <h3>Personnalisation des Couleurs</h3>
                <div class="color-customization">


                    
                    <div class="color-group">
                        <h4>Thème Sombre</h4>
                        <div class="color-input">
                            <label for="dark_primary_color">Couleur principale</label>
                            <input type="color" id="dark_primary_color" name="themes[dark][primary_color]" 
                                   value="<?php echo $config['themes']['dark']['primary_color'] ?? '#3498db'; ?>">
                        </div>
                        <div class="color-input">
                            <label for="dark_text_color">Couleur du texte</label>
                            <input type="color" id="dark_text_color" name="themes[dark][text_color]" 
                                   value="<?php echo $config['themes']['dark']['text_color'] ?? '#ffffff'; ?>">
                        </div>
                        <div class="color-input">
                            <label for="dark_bg_color">Couleur de fond</label>
                            <input type="color" id="dark_bg_color" name="themes[dark][bg_color]" 
                                   value="<?php echo $config['themes']['dark']['bg_color'] ?? '#1a1a1a'; ?>">
                        </div>
                    </div>

                        
                    <div class="color-group">
                        <h4>Thème Clair</h4>
                        <div class="color-input">
                            <label for="light_primary_color">Couleur principale</label>
                            <input type="color" id="light_primary_color" name="themes[light][primary_color]" 
                                   value="<?php echo $config['themes']['light']['primary_color'] ?? '#3498db'; ?>">
                        </div>
                        <div class="color-input">
                            <label for="light_text_color">Couleur du texte</label>
                            <input type="color" id="light_text_color" name="themes[light][text_color]" 
                                   value="<?php echo $config['themes']['light']['text_color'] ?? '#333333'; ?>">
                        </div>
                        <div class="color-input">
                            <label for="light_bg_color">Couleur de fond</label>
                            <input type="color" id="light_bg_color" name="themes[light][bg_color]" 
                                   value="<?php echo $config['themes']['light']['bg_color'] ?? '#ffffff'; ?>">
                        </div>
                    </div>



                    <div class="color-group">
                        <h4>Dark Moderne Glass</h4>
                        <div class="color-input">
                            <label for="glass_primary_color">Couleur principale (dégradé)</label>
                            <input type="color" id="glass_primary_color" name="themes[glass][primary_color]" 
                                   value="<?php echo $config['themes']['glass']['primary_color'] ?? '#6a85b6'; ?>">
                        </div>
                        <div class="color-input">
                            <label for="glass_text_color">Couleur du texte</label>
                            <input type="color" id="glass_text_color" name="themes[glass][text_color]" 
                                   value="<?php echo $config['themes']['glass']['text_color'] ?? '#e0e6ed'; ?>">
                        </div>
                        <div class="color-input">
                            <label for="glass_bg_color">Couleur de fond</label>
                            <input type="color" id="glass_bg_color" name="themes[glass][bg_color]" 
                                   value="<?php echo $config['themes']['glass']['bg_color'] ?? '#232526'; ?>">
                        </div>
                        <div class="color-input">
                            <label for="glass_accent_color">Accent</label>
                            <input type="color" id="glass_accent_color" name="themes[glass][accent_color]" 
                                   value="<?php echo $config['themes']['glass']['accent_color'] ?? '#b993d6'; ?>">
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Nouvel onglet Mot de passe -->
        <div class="admin-card" id="password-tab" style="display: none;">
            <h2>🔐 Sécurité du Compte</h2>
            <form method="POST" action="" id="password-form" data-form="main">
                <input type="hidden" name="action" value="change_password">
                <input type="hidden" name="active_tab" id="active_tab" value="password">
                
                <div class="form-group">
 
                    <div class="password-section">
                        <h4><i class="fas fa-key"></i> Changer le mot de passe</h4>
                        <div class="option-group">
                    <label for="current_password">Mot de passe actuel</label>
                            <input type="password" id="current_password" name="current_password" class="form-control">
                </div>
                        <div class="option-group">
                    <label for="new_password">Nouveau mot de passe</label>
                            <input type="password" id="new_password" name="new_password" class="form-control">
                        </div>
                        <div class="option-group">
                            <label for="confirm_password">Confirmer le nouveau mot de passe</label>
                            <input type="password" id="confirm_password" name="confirm_password" class="form-control">
                        </div>
                        <div class="password-requirements">
                            <h5><i class="fas fa-info-circle"></i> Exigences du mot de passe</h5>
                            <ul>
                                <li><i class="fas fa-check"></i> Au moins 8 caractères</li>
                                <li><i class="fas fa-check"></i> Au moins une lettre majuscule</li>
                                <li><i class="fas fa-check"></i> Au moins un chiffre</li>
                                <li><i class="fas fa-check"></i> Au moins un caractère spécial</li>
                        </ul>
                </div>
                    </div>
                </div>

                <button type="submit" class="btn btn-primary">
                    <i class="fas fa-save"></i> Mettre à jour le mot de passe
                </button>
            </form>
        </div>

        <!-- Onglet Mises à jour -->
        <div class="admin-card" id="updates-tab" style="display: none;">
            <h2><i class="fas fa-sync-alt"></i> Configuration des Mises à jour</h2>
            <form method="POST" action="" id="updates-form" data-form="main">
                <input type="hidden" name="action" value="update_config">
                <input type="hidden" name="active_tab" value="updates">
                
                <div class="form-group">
                    <div class="option-group">
                        <label class="switch">
                            <input type="checkbox" name="admin[update_check][enabled]" id="update_check_enabled" 
                                   <?php echo ($admin_config['admin']['update_check']['enabled'] ?? false) ? 'checked' : ''; ?>>
                            <span class="slider"></span>
                        </label>
                        <label>Activer la vérification des mises à jour</label>
                        <small class="form-text">
                            Si activé, le système vérifiera automatiquement les nouvelles versions disponibles via les tags GitHub
                        </small>
                    </div>
                </div>

                <!-- Bouton de vérification instantanée -->
                <div class="form-actions" style="margin-top: 10px;">
                    <button type="button" class="btn btn-info" id="check-update-now">
                        <i class="fas fa-search"></i> Vérifier maintenant
                    </button>
                </div>

                <!-- Retrait du bouton sauvegarde -->
                <!--
                <button type="submit" class="btn btn-primary">
                    <i class="fas fa-save"></i> Sauvegarder la configuration
                </button>
                -->
            </form>

            <div class="update-status">
                <h3><i class="fas fa-info-circle"></i> État actuel</h3>
                <div class="status-item">
                    <span class="label">Version actuelle :</span>
                    <span class="value"><?php echo htmlspecialchars($currentVersion ?? ''); ?></span>
                </div>
                <div class="status-item">
                    <span class="label">Dernière version distante :</span>
                    <span class="value"><?php echo htmlspecialchars($remoteVersion ?? ''); ?></span>
                </div>
                <div class="status-item">
                    <span class="label">Dernière vérification :</span>
                    <span class="value"><?php echo $lastCheck ? date('d/m/Y H:i:s', $lastCheck) : 'Jamais'; ?></span>
                </div>
            </div>

            <div class="changelog">
                <h3><i class="fas fa-list"></i> Historique des versions</h3>
                <div class="changelog-content">
                    <?php
                    // Afficher changelog version distante si différente
                    if ($remoteVersion !== $currentVersion && isset($changelog[$remoteVersion])) {
                        echo '<div class="version-entry version-remote">';
                        echo '<h4>Nouvelle version : ' . htmlspecialchars($remoteVersion) . '</h4>';
                        echo '<ul class="changelog-list">';
                        foreach ($changelog[$remoteVersion]['changes'] as $change) {
                            echo '<li>' . htmlspecialchars($change) . '</li>';
                        }
                        echo '</ul>';
                        echo '</div>';
                    }
                    // Afficher changelog version locale
                    if (isset($changelog[$currentVersion])) {
                        echo '<div class="version-entry version-local">';
                        echo '<h4>Votre version : ' . htmlspecialchars($currentVersion) . '</h4>';
                        echo '<ul class="changelog-list">';
                        foreach ($changelog[$currentVersion]['changes'] as $change) {
                            echo '<li>' . htmlspecialchars($change) . '</li>';
                        }
                        echo '</ul>';
                        echo '</div>';
                    }
                    // Afficher l'historique complet
                    if (is_array($changelog)) {
                        foreach ($changelog as $ver => $log) {
                            if ($ver === $currentVersion || $ver === $remoteVersion) continue;
                            echo '<div class="version-entry">';
                            echo '<h4>Version ' . htmlspecialchars($ver) . '</h4>';
                            echo '<ul class="changelog-list">';
                            foreach ($log['changes'] as $change) {
                                echo '<li>' . htmlspecialchars($change) . '</li>';
                            }
                            echo '</ul>';
                            echo '</div>';
                        }
                    }
                    ?>
                </div>
            </div>
        </div>

        <style>
        /* Styles pour l'onglet Mises à jour */
        .update-status {
            margin: 20px 0;
            padding: 15px;
            background: var(--bg-color);
            border-radius: 8px;
            border: 1px solid var(--border-color);
        }

        .status-item {
            display: flex;
            justify-content: space-between;
            margin: 10px 0;
            padding: 8px;
            background: rgba(255,255,255,0.05);
            border-radius: 4px;
        }

        .status-item .label {
            font-weight: bold;
            color: var(--text-color);
        }

        .status-item .value {
            font-family: 'Consolas', monospace;
            color: var(--primary-color);
        }

        .changelog {
            margin-top: 30px;
        }

        .version-entry {
            margin: 15px 0;
            padding: 15px;
            background: var(--bg-color);
            border-radius: 8px;
            border: 1px solid var(--border-color);
        }

        .version-entry h4 {
            color: var(--primary-color);
            margin: 0 0 10px 0;
        }

        .version-date {
            color: var(--text-color);
            font-size: 0.9em;
            opacity: 0.8;
        }

        .no-versions {
            text-align: center;
            padding: 20px;
            color: var(--text-color);
            opacity: 0.7;
        }
        </style>
    </div>

    <footer>
        <div class="footer-left">
            <span id="datetime" class="footer-datetime"></span>
        </div>
        <div class="footer-center">
            <span class="footer-made-by">
            Made with <i class="fas fa-coffee"></i> by 
            <a href="https://github.com/Erreur32" target="_blank">Erreur32</a>
            
            | <a href="../admin/login.php" class="admin-link" ><i class="fas fa-cog"></i> Admin</a>
            | <i class="fab fa-github"></i><a href="https://github.com/Erreur32/LogviewR" target="_blank"> v<?php echo LOGVIEWR_VERSION; ?></a> DEV
            </span>
        </div>
        <div class="footer-right">
            <div class="execution-times" style="display: flex; flex-direction: column; gap: 2px;">
            <!-- Temps de chargement de la page -->
            <div class="execution-time-badge page-load" style="text-align: right;">
                <?php
                $execution_time = microtime(true) - $_SERVER["REQUEST_TIME_FLOAT"];
                echo sprintf('Chargement page: %.4f secondes', $execution_time);
                ?>
            </div>
            <!-- Temps d'exécution des scripts -->
            <div class="execution-time-badge script-load" id="execution_time" style="text-align: right;"></div>
            </div>
        </div>
    </footer>

        <script> // date heure footer
            function updateDateTime() {
                const now = new Date();
                const datetime = now.toLocaleString('fr-FR');
                document.getElementById('datetime').textContent = datetime;
            }
            setInterval(updateDateTime, 1000);
            updateDateTime();
        </script>

<style>
footer {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background-color: var(--bg-color, #232526);
    border-top: 1px solid #444;
    padding: 5px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
    z-index: 1000;
    height: 30px;
    box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.1);
}
.footer-left, .footer-center, .footer-right {
    flex: 1;
}
.footer-center {
    text-align: center;
}
.footer-left {
    text-align: left;
    padding-left: 40px;
}
.footer-right {
    text-align: right;
    padding-right: 40px;
}



/* ==========================================================================
   Footer Styles
   ========================================================================== */
   footer {
    position: fixed !important;
    bottom: 0 !important;
    left: 0 !important;
    right: 0 !important;
    background-color: var(--bg-color) !important;
    border-top: 1px solid var(--border-color) !important;
    padding: 5px 20px !important;
    display: flex !important;
    justify-content: space-between !important;
    align-items: center !important;
    font-size: 12px !important;
    z-index: 1000 !important;
    height: 30px !important;
    box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.1) !important;
}

.footer-left {
    flex: 1;
    text-align: left;
    padding-left: 40px;
}

.footer-center {
    flex: 1;
    text-align: center;
}

.footer-right {
    flex: 1;
    text-align: right;
    padding-right: 40px;
}

.footer-datetime {
    color: var(--text-color);
    font-family: 'Consolas', monospace;
}

.footer-made-by {
    color: var(--text-color);
    display: inline-flex;
    align-items: center;
    gap: 5px;
}

.footer-made-by i {
    color: var(--primary-color);
    margin: 0 3px;
}

.footer-made-by a {
    color: var(--primary-color);
    text-decoration: none;
    transition: color 0.3s ease;
}

.footer-made-by a:hover {
    color: var(--text-color);
}

.footer-execution-time {
    color: var(--badge-method-get);
    opacity: 0.8;
    font-family: 'Consolas', monospace;
}

</style>   
    <script>
    document.addEventListener('DOMContentLoaded', function() {
        // Gestion du switch des filtres
        const filterSwitch = document.querySelector('input[name="config[filters][enabled]"]');
        if (filterSwitch) {
            filterSwitch.addEventListener('change', function() {
                const form = document.getElementById('filters-form');
                const formData = new FormData(form);
                formData.append('action', 'update_config');
                
                fetch('', {
                    method: 'POST',
                    body: formData
                })
                .then(response => {
                    if (!response.ok) {
                        throw new Error('Erreur lors de la sauvegarde');
                    }
                    return response.text();
                })
                .then(() => {
                    // Supprimer les messages existants
                    const existingMessages = form.querySelectorAll('.alert');
                    existingMessages.forEach(msg => msg.remove());
                    
                    // Afficher un message de succès uniquement si ce n'est pas le switch des filtres
                    if (!form.querySelector('input[name="config[filters][enabled]"]')) {
                        const successMessage = document.createElement('div');
                        successMessage.className = 'alert alert-success';
                        successMessage.innerHTML = '<i class="fas fa-check-circle"></i> Filtres activés/désactivés avec succès !';
                        form.insertBefore(successMessage, form.firstChild);
                        
                        // Supprimer le message après 3 secondes
                        setTimeout(() => {
                            successMessage.remove();
                        }, 3000);
                    }
                })
                .catch(error => {
                    console.error('Erreur:', error);
                });
            });
        }

        // Gestion du bouton de réinitialisation
        const resetOptionsBtn = document.getElementById('resetOptionsBtn');
        if (resetOptionsBtn) {
            resetOptionsBtn.addEventListener('click', function() {
                if (confirm('Êtes-vous sûr de vouloir réinitialiser toutes les options à leurs valeurs par défaut ?\n\nCette action :\n- Réinitialisera tous les paramètres\n- Conservera votre mot de passe actuel\n- Ne peut pas être annulée')) {
                    const form = document.createElement('form');
                    form.method = 'POST';
                    form.action = '';

                    const actionInput = document.createElement('input');
                    actionInput.type = 'hidden';
                    actionInput.name = 'action';
                    actionInput.value = 'reset_options';
                    form.appendChild(actionInput);

                    document.body.appendChild(form);
                    form.submit();
                }
            });
        }


        // Gestion des logs
        const debugTab = document.getElementById('debug-tab');
        if (debugTab && debugTab.style.display !== 'none') {
            const refreshBtn = document.getElementById('refreshLogBtn');
            const toggleBtn = document.getElementById('toggleLogBtn');
            const clearBtn = document.getElementById('clearLogBtn');

            if (refreshBtn) {
                refreshBtn.addEventListener('click', async function() {
                    const button = this;
                    button.disabled = true;
                    button.classList.add('btn-loading');
                    
                    try {
                        const response = await fetch('get_debug_log.php');
                        if (!response.ok) {
                            throw new Error(`Erreur HTTP: ${response.status}`);
                        }
                        const content = await response.text();
                        const logContent = document.getElementById('debug-log-content');
                        if (logContent) {
                            logContent.innerHTML = `<pre><code>${content}</code></pre>`;
                        }
                        showStatus('Logs rafraîchis avec succès');
                    } catch (error) {
                        console.error('Erreur:', error);
                        showStatus(`Erreur lors du rafraîchissement: ${error.message}`, 'error');
                    } finally {
                        button.disabled = false;
                        button.classList.remove('btn-loading');
                    }
                });
            }

            if (toggleBtn) {
                toggleBtn.addEventListener('click', function() {
                    const content = document.getElementById('debug-log-content');
                    const isHidden = content.classList.toggle('hidden');
                    const icon = this.querySelector('i');
                    const text = this.querySelector('i').nextSibling;
                    
                    if (isHidden) {
                        icon.className = 'fas fa-eye';
                        text.textContent = ' Afficher';
                        showStatus('Logs masqués');
                    } else {
                        icon.className = 'fas fa-eye-slash';
                        text.textContent = ' Masquer';
                        showStatus('Logs affichés');
                    }
                });
            }

            if (clearBtn) {
                clearBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    showModal();
                });
            }
        }

        // Fonction utilitaire pour afficher le statut
        function showStatus(message, type = 'success') {
            const statusDiv = document.getElementById('log-status');
            if (statusDiv) {
                statusDiv.textContent = message;
                statusDiv.className = `log-status ${type}`;
                setTimeout(() => {
                    statusDiv.style.display = 'none';
                }, 5000);
            }
        }

        // Fonctions pour la modale
        function showModal() {
            document.getElementById('confirmModal').classList.add('show');
        }

        function hideModal() {
            document.getElementById('confirmModal').classList.remove('show');
        }

        // Gestion des événements de la modale
        const cancelClear = document.getElementById('cancelClear');
        const confirmClear = document.getElementById('confirmClear');
        const confirmModal = document.getElementById('confirmModal');

        if (cancelClear) {
            cancelClear.addEventListener('click', hideModal);
        }

        if (confirmClear) {
            confirmClear.addEventListener('click', clearLogs);
        }

        if (confirmModal) {
            confirmModal.addEventListener('click', function(e) {
                if (e.target === this) {
                    hideModal();
                }
            });
        }

        // Fonction pour vider les logs
        async function clearLogs() {
            const button = document.getElementById('clearLogBtn');
            try {
                button.disabled = true;
                button.classList.add('btn-loading');
                showStatus('Envoi de la requête...', 'info');

                const response = await fetch('clear_debug_log.php', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: {
                        'Accept': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest'
                    }
                });

                if (!response.ok) {
                    throw new Error(`Erreur HTTP: ${response.status}`);
                }

                const result = await response.json();
                if (result.success) {
                    showStatus('✨ Logs réinitialisés avec succès');
                    document.getElementById('refreshLogBtn').click();
                } else {
                    throw new Error(result.message || 'Erreur inconnue');
                }
            } catch (error) {
                console.error('Erreur:', error);
                showStatus(`❌ Erreur: ${error.message}`, 'error');
            } finally {
                button.disabled = false;
                button.classList.remove('btn-loading');
                hideModal();
            }
        }
    });
    </script>

    <script>
    document.getElementById('max_lines_per_request').addEventListener('input', function() {
        const value = parseInt(this.value);
        const warning = document.getElementById('max_lines_warning');
        
        if (value > 10000) {
            warning.style.display = 'block';
        } else {
            warning.style.display = 'none';
        }
    });

    </script>

    <script>
    document.addEventListener('DOMContentLoaded', function() {
        const filtersForm = document.getElementById('filters-form');
        
        if (filtersForm) {
            filtersForm.addEventListener('submit', async function(e) {
                e.preventDefault();
                
                const formData = new FormData(this);
                formData.append('action', 'update_config');
                
                try {
                    const response = await fetch('', {
                        method: 'POST',
                        body: formData
                    });
                    
                    if (!response.ok) {
                        throw new Error('Erreur lors de la sauvegarde');
                    }
                    
                    const result = await response.text();
                    
                    // Afficher un message de succès
                    const successMessage = document.createElement('div');
                    successMessage.className = 'alert alert-success';
                    successMessage.innerHTML = '<i class="fas fa-check-circle"></i> Configuration sauvegardée avec succès !';
                    filtersForm.insertBefore(successMessage, filtersForm.firstChild);
                    
                    // Supprimer le message après 3 secondes
                    setTimeout(() => {
                        successMessage.remove();
                    }, 3000);
                    
                } catch (error) {
                    // Afficher un message d'erreur
                    const errorMessage = document.createElement('div');
                    errorMessage.className = 'alert alert-danger';
                    errorMessage.innerHTML = '<i class="fas fa-exclamation-circle"></i> Erreur lors de la sauvegarde : ' + error.message;
                    filtersForm.insertBefore(errorMessage, filtersForm.firstChild);
                    
                    // Supprimer le message après 5 secondes
                    setTimeout(() => {
                        errorMessage.remove();
                    }, 5000);
                }
            });
        }
    });
    </script>

    <script>
    document.addEventListener('DOMContentLoaded', function() {
                // ... existing code ...
        // Vérification instantanée des mises à jour
        const checkUpdateBtn = document.getElementById('check-update-now');
        if (checkUpdateBtn) {
            checkUpdateBtn.addEventListener('click', function() {
                checkUpdateBtn.disabled = true;
                checkUpdateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Vérification...';
                fetch('ajax_actions.php?action=check_update_now', {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' }
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        // Si le message indique qu'il n'y a pas de nouvelle version
                        if (data.message && data.message.match(/(à jour|dernière version|latest|up to date)/i)) {
                            LogviewR.UI.showNotification(
                                `🎉 Vous utilisez déjà la dernière version : <b>${data.current_version || ''}</b>`,
                                'success'
                            );
                            // <-- AJOUTE CETTE LIGNE :
                            //autoResizeTextareas('#patterns-tab');
                        } else {
                            LogviewR.UI.showNotification('✅ Vérification terminée : ' + data.message, 'success');
                            setTimeout(() => window.location.reload(), 3200);
                        }
                    } else {
                        LogviewR.UI.showNotification('❌ ' + (data.message || 'Erreur lors de la vérification.'), 'error');
                        // <-- AJOUTE CETTE LIGNE :
                        //autoResizeTextareas('#patterns-tab');
                    }
                })
                .catch(error => {
                    showNotification('error', '❌ Erreur : ' + error.message);
                })
                .finally(() => {
                    checkUpdateBtn.disabled = false;
                    checkUpdateBtn.innerHTML = '<i class="fas fa-search"></i> Vérifier maintenant';
                });
            });
        }
    });


 

    </script>

    <script>
    document.addEventListener('DOMContentLoaded', function() {
        // ... autres codes ...
        const updateSwitch = document.getElementById('update_check_enabled');
        if (updateSwitch) {
            updateSwitch.addEventListener('change', function() {
                updateSwitch.disabled = true;
                const enabled = updateSwitch.checked ? 1 : 0;
                fetch('ajax_actions.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: 'action=save_update_switch&enabled=' + enabled
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        showNotification('success', '✅ Option sauvegardée !');
                    } else {
                        showNotification('error', '❌ ' + (data.message || 'Erreur lors de la sauvegarde.'));
                    }
                })
                .catch(error => {
                    showNotification('error', '❌ Erreur : ' + error.message);
                })
                .finally(() => {
                    setTimeout(() => { updateSwitch.disabled = false; }, 600);
                });
            });
        }
    });

    
    document.addEventListener('DOMContentLoaded', function() {
    // Gestionnaire pour le bouton de fermeture du popup de mise à jour (admin)
    const closeButtons = document.querySelectorAll('.update-alert .btn-close');
    closeButtons.forEach(button => {
        button.addEventListener('click', function() {
        const alert = this.closest('.update-alert');
        if (alert) {
            alert.classList.add('fade'); // Animation
            setTimeout(() => { alert.remove(); }, 150);
        }
        });
    });
    });
    </script>

    <script>
    document.addEventListener('DOMContentLoaded', function() {
        // ... existing code ...

        // --- PHP Errors Log (php_errors.log) ---
        const refreshPhpBtn = document.getElementById('refreshPhpLogBtn');
        const clearPhpBtn = document.getElementById('clearPhpLogBtn');
        const phpLogContent = document.getElementById('php-log-content');
        const phpLogStatus = document.getElementById('php-log-status');

        // Refresh php_errors.log content
        if (refreshPhpBtn) {
            refreshPhpBtn.addEventListener('click', async function() {
                refreshPhpBtn.disabled = true;
                refreshPhpBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Rafraîchir';
                try {
                    const response = await fetch('get_php_errors_log.php');
                    const text = await response.text();
                    phpLogContent.innerHTML = `<pre><code>${text}</code></pre>`;
                    phpLogStatus.textContent = 'Logs PHP rafraîchis avec succès';
                    phpLogStatus.className = 'log-status success';
                } catch (e) {
                    phpLogStatus.textContent = 'Erreur lors du rafraîchissement : ' + e.message;
                    phpLogStatus.className = 'log-status error';
                } finally {
                    setTimeout(() => { phpLogStatus.textContent = ''; }, 4000);
                    refreshPhpBtn.disabled = false;
                    refreshPhpBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Rafraîchir';
                }
            });
        }

        // Clear php_errors.log content
        if (clearPhpBtn) {
            clearPhpBtn.addEventListener('click', async function() {
                if (!confirm('Voulez-vous vraiment vider php_errors.log ?')) return;
                clearPhpBtn.disabled = true;
                clearPhpBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Vider';
                try {
                    const response = await fetch('clear_php_errors_log.php', {
                        method: 'POST',
                        headers: { 'Accept': 'application/json' }
                    });
                    const result = await response.json();
                    if (result.success) {
                        phpLogContent.innerHTML = '<pre><code>(vide)</code></pre>';
                        phpLogStatus.textContent = 'php_errors.log vidé avec succès';
                        phpLogStatus.className = 'log-status success';
                    } else {
                        phpLogStatus.textContent = result.message || 'Erreur lors du vidage';
                        phpLogStatus.className = 'log-status error';
                    }
                } catch (e) {
                    phpLogStatus.textContent = 'Erreur lors du vidage : ' + e.message;
                    phpLogStatus.className = 'log-status error';
                } finally {
                    setTimeout(() => { phpLogStatus.textContent = ''; }, 4000);
                    clearPhpBtn.disabled = false;
                    clearPhpBtn.innerHTML = '<i class="fas fa-trash-alt"></i> Vider';
                }
            });
        }
    });


 

    // This code sends the value of the switch to the server as soon as it is toggled.
    document.addEventListener('DOMContentLoaded', function() {
    const rememberMeSwitch = document.getElementById('remember_me');
    if (rememberMeSwitch) {
        rememberMeSwitch.addEventListener('change', function() {
            const formData = new FormData();
            formData.append('action', 'update_config');
            formData.append('admin[remember_me]', rememberMeSwitch.checked ? '1' : '');

            fetch('', {
                method: 'POST',
                body: formData
            })
            .then(response => response.text())
            .then(() => {
                LogviewR.UI.showNotification('Option "Rester connecté" sauvegardée !', 'success');
            });
        });
    }
});
    </script>

</body>
</html> 