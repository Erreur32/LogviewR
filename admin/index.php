<?php
session_start();

// Charger la configuration globale
require_once __DIR__ . '/../includes/config.php';

// Check configuration files
$config_file = __DIR__ . '/../config/config.php';
$admin_config_file = __DIR__ . '/../config/admin.php';
$patterns_file = __DIR__ . '/../config/log_patterns.php';

// Initialize configurations
$config = [];
$patterns = [];

// Load configuration
if (file_exists($config_file)) {
    $config = require $config_file;
} else {
    die('Error: Configuration file missing (config.php)');
}

// Load patterns
if (file_exists($patterns_file)) {
    $patterns = require $patterns_file;
} else {
    die('Error: Patterns file missing (log_patterns.php)');
}

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

// Vérifier la connexion
if (!isset($_SESSION['admin_logged_in']) || $_SESSION['admin_logged_in'] !== true) {
    header('Location: login.php');
    exit;
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
                    
                    // Préparer le contenu du fichier en préservant le chemin exact
                    $content = "<?php\nreturn array (\n";
                    foreach ($new_config as $key => $value) {
                        if ($key === 'debug' && isset($value['log_file'])) {
                            $content .= "  'debug' => array (\n";
                            foreach ($value as $subkey => $subvalue) {
                                if ($subkey === 'log_file') {
                                    $content .= "    'log_file' => '" . addslashes($subvalue) . "',\n";
                                } else {
                                    $content .= "    '$subkey' => " . var_export($subvalue, true) . ",\n";
                                }
                            }
                            $content .= "  ),\n";
                        } else {
                            $content .= "  '$key' => " . var_export($value, true) . ",\n";
                        }
                    }
                    $content .= ");\n";
                    
                    // Sauvegarder la configuration
                    if (file_put_contents($config_file, $content)) {
                        reloadConfigurations(); // Recharger les configurations
                        $_SESSION['message'] = 'Configuration mise à jour avec succès';
                    } else {
                        throw new Exception('Erreur lors de la sauvegarde de la configuration');
                    }
                } catch (Exception $e) {
                    $error = $e->getMessage();
                }
                break;
                
            case 'update_patterns':
                try {
                    // Charger les patterns par défaut
                    $default_patterns = require __DIR__ . '/../config/default_log_patterns.php';
                    
                    // Charger les patterns personnalisés s'ils existent
                    $custom_patterns = [];
                    if (file_exists($patterns_file)) {
                        $custom_patterns = require $patterns_file;
                    }
                    
                    // Récupérer les patterns modifiés
                    $new_patterns = $_POST['patterns'] ?? [];
                    
                    // Fusionner les patterns (les nouveaux écrasent les personnalisés)
                    $updated_patterns = array_replace_recursive($default_patterns, $custom_patterns, $new_patterns);
                    
                    // Sauvegarder uniquement les patterns modifiés
                    $patterns_to_save = [];
                    foreach ($updated_patterns as $type => $type_data) {
                        if (isset($new_patterns[$type])) {
                            $patterns_to_save[$type] = $type_data;
                        }
                    }
                    
                    // Ajouter les filtres s'ils existent
                    if (isset($custom_patterns['filters'])) {
                        $patterns_to_save['filters'] = $custom_patterns['filters'];
                    }
                    
                    // Sauvegarder dans le fichier
                    if (file_put_contents($patterns_file, "<?php\nreturn " . var_export($patterns_to_save, true) . ";\n")) {
                        $patterns = $updated_patterns;
                        $message = 'Patterns mis à jour avec succès';
                    } else {
                        throw new Exception('Erreur lors de la sauvegarde des patterns');
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
                    $default_config = require __DIR__ . '/../config/default_config.php';
                    $default_patterns = require __DIR__ . '/../config/default_log_patterns.php';
                    
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
                    $default_patterns = require __DIR__ . '/../config/default_log_patterns.php';
                    
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

// ... existing code ...
require_once __DIR__ . '/../includes/UpdateChecker.php';

// Initialize update checker
$updateChecker = new UpdateChecker();
$versionInfo = $updateChecker->getVersionInfo();
$updateInfo = $updateChecker->checkForUpdates();

// ... existing code ...

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
                        <i class="fas fa-download"></i> Télécharger la mise à jour
                    </a>
                    <a href="?tab=updates" class="btn btn-info btn-sm">
                        <i class="fas fa-info-circle"></i> Plus d\'informations
                    </a>
                </div>
            </div>
        </div>
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    </div>';
}

// ... existing code ...

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
    <link rel="stylesheet" href="assets/css/admin.css">
    <link rel="stylesheet" href="assets/css/debug-log.css">
    <script>
        // Initialiser la configuration pour le JavaScript
        window.currentConfig = <?php echo json_encode($config); ?>;
    </script>
    <script src="assets/js/admin.js"></script>
    <script src="assets/js/debug-log.js" defer></script>
    <!-- Ajouter le style pour les notifications -->
    <style>
    .notification {
        position: fixed;
        bottom: 20px;
        right: 20px;
        padding: 15px 25px;
        border-radius: 6px;
        color: white;
        font-weight: 500;
        z-index: 9999;
        animation: slideIn 0.3s ease-out;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .notification.success {
        background-color: #4CAF50;
    }

    .notification.error {
        background-color: #f44336;
    }

    .notification.warning {
        background-color: #ff9800;
    }

    .notification.info {
        background-color: #2196F3;
    }

    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }

    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
    </style>
</head>
<body>
    <div class="admin-container">
        <div class="admin-header">
            <h1>
                <i class="fas fa-cog"></i> LogviewR   administration <?php echo LOGVIEWR_VERSION; ?>
                <?php if (isset($config['debug']['enabled']) && $config['debug']['enabled']): ?>
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
                <i class="fas fa-bug"></i> Debug & Logs
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
                                <input type="number" id="default_lines_per_page" name="app[default_lines_per_page]" 
                                       value="<?php echo $config['app']['default_lines_per_page'] ?? 50; ?>" class="form-control">
                            </div>
                            <div class="option-group">
                                <label for="max_lines_per_request">Lignes maximum par requête</label>
                                <input type="number" id="max_lines_per_request" name="app[max_lines_per_request]" 
                                       value="<?php echo $config['app']['max_lines_per_request'] ?? 20000; ?>" class="form-control">
                                <small class="form-text">
                                    Nombre maximum de lignes à charger par requête AJAX.<br>
                                    Une valeur trop élevée peut impacter les performances (default: 20000).
                                </small>
                            </div>
                        </div>
                        <div class="settings-column">
                            <div class="option-group">
                                <label for="refresh_interval">Intervalle de rafraîchissement (secondes)</label>
                                <input type="number" id="refresh_interval" name="app[refresh_interval]" 
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
                                    <code>gz</code>
                                    <span class="example-description">Exclure tous les fichiers .gz</span>
                                </div>
                                <div class="example-item">
                                    <code>zip</code>
                                    <span class="example-description">Exclure tous les fichiers .zip</span>
                                </div>
                                <div class="example-item">
                                    <code>tar</code>
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
                        <input type="text" id="date_format_display" name="date_formats[display]" 
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
                        <select id="timezone" name="timezone" class="form-control">
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
            <h2><i class="fas fa-bug"></i> Debug & Logs</h2>
            <form method="POST" action="" id="debug-form" data-form="main">
                <input type="hidden" name="action" value="update_config">
                <input type="hidden" name="active_tab" value="debug">
                
                <div class="form-group">
                    <h4>🔧 Paramètres de Debug</h4>
                    <div class="settings-container">
                        <div class="settings-column_">
                            <div class="option-group debug-toggle">
                                <label class="switch">
                                    <input type="checkbox" name="debug[enabled]" id="debug_enabled" data-switch <?php echo isset($config['debug']['enabled']) && $config['debug']['enabled'] ? 'checked' : ''; ?>>
                                    <span class="slider"></span>
                                </label>
                                <div class="debug-label">
                                    <label>Activer le mode debug</label>
                                </div>
                            </div>
                            
                            <div class="option-group debug-toggle">
                                <label class="switch">
                                    <input type="checkbox" name="debug[log_to_apache]" id="debug_log_to_apache" data-switch <?php echo isset($config['debug']['log_to_apache']) && $config['debug']['log_to_apache'] ? 'checked' : ''; ?>>
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
                                <button type="submit" class="btn btn-primary">
                                    <i class="fas fa-save"></i> Enregistrer les changements
                                </button>
                            </div>
                        </div>
                        
                        <?php if (!isset($config['debug']['enabled']) || !$config['debug']['enabled']): ?>
                            <div class="debug-status-message">
                                <i class="fas fa-info-circle"></i> Le mode debug est actuellement désactivé. Activez-le et enregistrez pour voir les logs de debug.
                            </div>
                        <?php else: ?>

                <div class="form-group">
                <h4>🔧 Config des Log</h4>
                    <div class="option-group"><h3>🔍 Niveau de Log</h3>
                        
                        <select id="log_level" name="debug[log_level]" class="form-control">
                            <option value="DEBUG" <?php echo ($config['debug']['log_level'] ?? '') === 'DEBUG' ? 'selected' : ''; ?>>DEBUG</option>
                            <option value="INFO" <?php echo ($config['debug']['log_level'] ?? '') === 'INFO' ? 'selected' : ''; ?>>INFO</option>
                            <option value="WARNING" <?php echo ($config['debug']['log_level'] ?? '') === 'WARNING' ? 'selected' : ''; ?>>WARNING</option>
                            <option value="ERROR" <?php echo ($config['debug']['log_level'] ?? '') === 'ERROR' ? 'selected' : ''; ?>>ERROR</option>
                        </select>                        <small class="form-text">
                        Niveau de log minimum  
                        </small>

                        <br><br><h3>📝 Format des messages de Log</h3>
                        <label for="log_format">Format des messages de log</label>
                        <input type="text" id="log_format" name="debug[log_format]" 
                               value="<?php echo htmlspecialchars($config['debug']['log_format'] ?? '[%timestamp%] [%level%] %message%'); ?>" 
                               class="form-control">
                        <small class="form-text">
                            Variables disponibles: %timestamp%, %level%, %message% 
                        </small>
                                          
                    </div>
                </div>   
                <?php endif; ?>
                <!-- Section d'affichage des logs de debug -->
                <div class="form-group">
                     <?php if (isset($config['debug']['enabled']) && $config['debug']['enabled']): ?>
                        <div class="debug-log-container">
                            <div class="debug-log-header">
                                <h5><i class="fas fa-file-alt"></i> debug.log</h5>
                                <div class="debug-log-controls">
                                    <button type="button" class="btn btn-sm btn-refresh" id="refreshLogBtn">
                                        <i class="fas fa-sync-alt"></i> Rafraîchir
                                    </button>
                                    <button type="button" class="btn btn-sm btn-toggle" id="toggleLogBtn">
                                        <i class="fas fa-eye-slash"></i> Masquer
                                    </button>
                                    <button type="button" class="btn btn-sm btn-danger" id="clearLogBtn">
                                        <i class="fas fa-trash-alt"></i> Vider
                                    </button>
                                </div>
                            </div>
                            <div id="debug-log-content" class="debug-log-content">
                                <pre><code><?php
                                $debug_log = dirname(__DIR__) . '/logs/debug.log';
                                if (file_exists($debug_log) && is_readable($debug_log)) {
                                    $lines = array_slice(file($debug_log), -100);
                                    foreach ($lines as $line) {
                                        // Formatage des messages de debug
                                        if (preg_match('/^\[DEBUG\]/', $line)) {
                                            $line = preg_replace('/^\[DEBUG\]/', '<span class="debug-tag">[DEBUG]</span>', $line);
                                            $line = preg_replace('/Array\\n\\(\\n(.*?)\\n\\)/s', '<span class="debug-array">Array\n(\n$1\n)</span>', $line);
                                        }
                                        echo htmlspecialchars($line);
                                    }
                                } else {
                                    echo "Le fichier debug.log n'existe pas ou n'est pas lisible.";
                                }
                                ?></code></pre>
                            </div>
                            <div id="log-status" class="log-status"></div>
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
                        <div class="input-with-example">
                            <input type="text" id="apache_path" name="paths[apache_logs]" 
                                   value="<?php echo htmlspecialchars($config['paths']['apache_logs'] ?? ''); ?>" 
                                       class="form-control path-input" placeholder="/var/log/apache2">
                            <div class="file-count">
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
                    <div class="option-group">
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
                                    <input type="text" id="nginx_path" name="paths[npm_logs]" 
                                           value="<?php echo htmlspecialchars($config['paths']['npm_logs'] ?? ''); ?>" 
                                           class="form-control path-input" placeholder="/var/log/nginx-proxy-manager">
                                <?php else: ?>
                                    <input type="text" id="nginx_path" name="paths[nginx_logs]" 
                                           value="<?php echo htmlspecialchars($config['paths']['nginx_logs'] ?? ''); ?>" 
                                           class="form-control path-input" placeholder="/var/log/nginx">
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

                <!-- Section Syslog -->
                <div class="option-group">
                    <h3><i class="fas fa-terminal"></i> Syslog</h3>
                    <div class="path-group">
                        <div class="path-input-container">
                        <label for="syslog_path">Chemin des logs Syslog</label>
                        <div class="input-with-example">
                            <input type="text" id="syslog_path" name="paths[syslog]" 
                                   value="<?php echo htmlspecialchars($config['paths']['syslog'] ?? ''); ?>" 
                                   class="form-control path-input" placeholder="/var/log/syslog">
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



                <button type="submit" class="btn btn-primary">
                    <i class="fas fa-save"></i> Sauvegarder les logs
                </button>
            </form>
        </div>

        <!-- Onglet Filtres d'Exclusion -->
        <div class="admin-card" id="filters-tab" style="display: none;">
           
                <h2><i class="fas fa-filter"></i> Filtres d'Exclusion Globaux</h2>
                
                <form method="post" action="" id="filters-form" data-form="main">
                    <input type="hidden" name="action" value="update_patterns">
                    <input type="hidden" name="active_tab" value="filters">
                    
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
                                        echo implode("\n", $config['filters']['exclude']['content']);
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

        <!-- Onglet Patterns de Logs -->
        <div class="admin-card" id="patterns-tab" style="display: none;">
            <h2><i class="fas fa-code"></i> Patterns de Logs</h2>
            <form method="post" action="" id="patterns-form" data-form="main">
                <input type="hidden" name="action" value="update_patterns">
                <input type="hidden" name="active_tab" value="patterns">
                
                <?php
                // Charger les patterns par défaut
                $default_patterns = require __DIR__ . '/../config/default_log_patterns.php';
                
                // Charger les patterns personnalisés s'ils existent
                $custom_patterns = [];
                if (file_exists($patterns_file)) {
                    $custom_patterns = require $patterns_file;
                }
                
                // Fusionner les patterns (les personnalisés écrasent les par défaut)
                $patterns = array_replace_recursive($default_patterns, $custom_patterns);
                
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
                
                foreach ($pattern_config as $type => $config):
                ?>
                    <div class="pattern-group">
                        <h3 style="border-left: 4px solid <?php echo $config['access_color']; ?>">
                            <i class="fas <?php echo $config['icon']; ?>"></i> <?php echo $config['title']; ?>
                        </h3>
                        
                        <?php if (isset($patterns[$type])): ?>
                            <?php if ($type === 'npm'): ?>
                                <?php foreach ($config['patterns'] as $pattern_type => $pattern_config): ?>
                                    <?php if (isset($patterns[$type][$pattern_type])): ?>
                                        <div class="pattern-subgroup" style="border-left: 4px solid <?php echo strpos($pattern_type, 'error') !== false ? $config['error_color'] : $config['access_color']; ?>">
                                            <label for="<?php echo $type; ?>_<?php echo $pattern_type; ?>_pattern">
                                                <i class="fas <?php echo $pattern_config['icon']; ?>" style="color: <?php echo strpos($pattern_type, 'error') !== false ? $config['error_color'] : $config['access_color']; ?>"></i>
                                                <?php echo $pattern_config['label']; ?>
                                            </label>
                                            <div class="pattern-input-container">
                                                <input type="text" 
                                                       id="<?php echo $type; ?>_<?php echo $pattern_type; ?>_pattern" 
                                                       name="patterns[<?php echo $type; ?>][<?php echo $pattern_type; ?>][pattern]" 
                                                       value="<?php echo htmlspecialchars($patterns[$type][$pattern_type]['pattern'] ?? ''); ?>" 
                                                       class="form-control">
                                                <?php
                                                $is_custom = isset($custom_patterns[$type][$pattern_type]);
                                                $pattern_source = $is_custom ? 'custom' : 'default';
                                                ?>
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
                                    <div class="pattern-subgroup" style="border-left: 4px solid <?php echo $config['access_color']; ?>">
                                        <label for="<?php echo $type; ?>_access_pattern">
                                            <i class="fas fa-check-circle" style="color: <?php echo $config['access_color']; ?>"></i>
                                            Pattern Access Log
                                        </label>
                                        <div class="pattern-input-container">
                                            <input type="text" 
                                                   id="<?php echo $type; ?>_access_pattern" 
                                                   name="patterns[<?php echo $type; ?>][access][pattern]" 
                                                   value="<?php echo htmlspecialchars($patterns[$type]['access']['pattern'] ?? ''); ?>" 
                                                   class="form-control">
                                            <?php
                                            $is_custom = isset($custom_patterns[$type]['access']);
                                            $pattern_source = $is_custom ? 'custom' : 'default';
                                            ?>
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
                                    <div class="pattern-subgroup" style="border-left: 4px solid <?php echo $config['error_color']; ?>">
                                        <label for="<?php echo $type; ?>_error_pattern">
                                            <i class="fas fa-exclamation-triangle" style="color: <?php echo $config['error_color']; ?>"></i>
                                            Pattern Error Log
                                        </label>
                                        <div class="pattern-input-container">
                                            <input type="text" 
                                                   id="<?php echo $type; ?>_error_pattern" 
                                                   name="patterns[<?php echo $type; ?>][error][pattern]" 
                                                   value="<?php echo htmlspecialchars($patterns[$type]['error']['pattern'] ?? ''); ?>" 
                                                   class="form-control">
                                            <?php
                                            $is_custom = isset($custom_patterns[$type]['error']);
                                            $pattern_source = $is_custom ? 'custom' : 'default';
                                            ?>
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
                                            <?php
                                            $is_custom = isset($custom_patterns['apache-404']);
                                            $pattern_source = $is_custom ? 'custom' : 'default';
                                            ?>
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
                                            <?php
                                            $is_custom = isset($custom_patterns['apache-referer']);
                                            $pattern_source = $is_custom ? 'custom' : 'default';
                                            ?>
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
                    


                </div>

                <div class="alert alert-info mt-3" id="theme-warning" style="display: none;">
                    <i class="fas fa-info-circle"></i> 
                    Le thème est actuellement sauvegardé uniquement pour votre session. 
                    Pour le rendre permanent, cliquez sur "Enregistrer le thème".
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
                        
                        fetch('ajax_actions.php', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/x-www-form-urlencoded',
                            },
                            body: 'action=save_all&theme=' + selectedTheme
                        })
                        .then(response => response.json())
                        .then(data => {
                            if (data.success) {
                                themeWarning.style.display = 'none';
                                themeSuccess.style.display = 'block';
                                showNotification('success', '✨ Thème enregistré avec succès !');
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
                            <input type="checkbox" name="update_check[enabled]" id="update_check_enabled" 
                                   <?php echo ($versionInfo['update_check']['enabled'] ?? true) ? 'checked' : ''; ?>>
                            <span class="slider"></span>
                        </label>
                        <label>Activer la vérification des mises à jour</label>
                        <small class="form-text">
                            Si activé, le système vérifiera automatiquement les nouvelles versions disponibles
                        </small>
                    </div>

                    <div class="option-group">
                        <label for="update_check_interval">Intervalle de vérification (heures)</label>
                        <input type="number" id="update_check_interval" name="update_check[check_interval]" 
                               value="<?php echo ($versionInfo['update_check']['check_interval'] ?? 86400) / 3600; ?>" 
                               min="1" max="168" class="form-control">
                        <small class="form-text">
                            Intervalle en heures entre chaque vérification de mise à jour (1-168 heures)
                        </small>
                    </div>
                    <button type="submit" class="btn btn-primary">
                        <i class="fas fa-save"></i> Sauvegarder les paramètres
                    </button>
                            
                </div>

            </form>

            <div class="form-actions">      
                <!-- Nouvelle section pour les backups -->
                <div class="backup-section">
                    <h3><i class="fas fa-archive"></i> Sauvegardes de Configuration</h3>
                    <div class="backup-actions">
                        <button type="button" class="btn btn-info" id="createBackupBtn">
                            <i class="fas fa-download"></i> Créer une sauvegarde
                        </button>
                        <button type="button" class="btn btn-warning" id="restoreBackupBtn">
                            <i class="fas fa-upload"></i> Restaurer une sauvegarde
                        </button>
                    </div>
                    
                    <div class="backup-list">
                        <h4><i class="fas fa-history"></i> Sauvegardes disponibles</h4>
                        <div id="backupsList" class="backup-items">
                            <!-- Les sauvegardes seront chargées ici dynamiquement -->
                        </div>
                    </div>
                </div>
                <br>
            </div>

            <div class="update-status">
                <h3><i class="fas fa-info-circle"></i> État actuel</h3>
                <div class="status-item">
                    <span class="label">Version actuelle :</span>
                    <span class="value"><?php echo htmlspecialchars(LOGVIEWR_VERSION); ?></span>
                </div>
                <div class="status-item">
                    <span class="label">Date de sortie :</span>
                    <span class="value"><?php echo htmlspecialchars($versionInfo['release_date'] ?? 'Inconnue'); ?></span>
                </div>
                <div class="status-item">
                    <span class="label">Dernière vérification :</span>
                    <span class="value"><?php 
                        $lastCheck = $updateChecker->getLastCheck();
                        echo $lastCheck ? date('d/m/Y H:i:s', $lastCheck) : 'Jamais';
                    ?></span>
                </div>
                <div class="status-item">
                    <span class="label">Prochaine vérification :</span>
                    <span class="value"><?php 
                        $lastCheck = $updateChecker->getLastCheck();
                        $interval = $updateChecker->getCheckInterval();
                        $nextCheck = $lastCheck ? $lastCheck + $interval : time() + $interval;
                        echo date('d/m/Y H:i:s', $nextCheck);
                    ?></span>
                </div>
            </div>

            <?php if ($updateInfo): ?>
            <div class="update-available">
                <h3><i class="fas fa-exclamation-triangle"></i> Mise à jour disponible</h3>
                <div class="update-details">
                    <div class="version-comparison">
                        <div class="version current">
                            <span class="label">Version actuelle :</span>
                            <span class="value"><?php echo $updateInfo['current_version']; ?></span>
                        </div>
                        <div class="version latest">
                            <span class="label">Nouvelle version :</span>
                            <span class="value"><?php echo $updateInfo['latest_version']; ?></span>
                        </div>
                    </div>
                    
                    <div class="update-actions">
                        <a href="<?php echo $updateInfo['update_url']; ?>" target="_blank" class="btn btn-warning">
                            <i class="fas fa-download"></i> Télécharger la mise à jour
                        </a>
                    </div>
                </div>
            </div>
            <?php endif; ?>

            <div class="changelog">
                <h3><i class="fas fa-list"></i> Historique des versions</h3>
                <?php foreach ($versionInfo['changelog'] as $version => $info): ?>
                <div class="changelog-entry">
                    <div class="version-header">
                        <span class="version">Version <?php echo $version; ?></span>
                        <span class="date">(<?php echo $info['date']; ?>)</span>
                    </div>
                    <ul class="changes-list">
                        <?php foreach ($info['changes'] as $change): ?>
                        <li><?php echo $change; ?></li>
                        <?php endforeach; ?>
                    </ul>
                </div>
                <?php endforeach; ?>
            </div>
        </div>

        <!-- Ajouter le style CSS pour la section backup -->
        <style>
        .backup-section {
            margin-top: 2rem;
            padding: 1.5rem;
            background: var(--bg-secondary);
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        .backup-actions {
            display: flex;
            gap: 1rem;
            margin: 1.5rem 0;
        }

        .backup-list {
            margin-top: 1.5rem;
        }

        .backup-items {
            margin-top: 1rem;
            max-height: 400px;
            overflow-y: auto;
        }

        .backup-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 1rem;
            background: var(--bg-tertiary);
            border-radius: 6px;
            margin-bottom: 0.75rem;
            transition: all 0.3s ease;
        }

        .backup-item:hover {
            background: var(--bg-hover);
            transform: translateX(5px);
        }

        .backup-info {
            flex-grow: 1;
        }

        .backup-date {
            font-weight: bold;
            color: var(--text-primary);
            margin-bottom: 0.25rem;
        }

        .backup-date i {
            color: var(--primary-color);
            margin-right: 0.5rem;
        }

        .backup-details {
            font-size: 0.9em;
            color: var(--text-secondary);
            display: flex;
            gap: 1rem;
        }

        .version-badge, .files-badge {
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
            background: var(--bg-badge);
            font-size: 0.8em;
        }

        .version-badge {
            color: #4CAF50;
            background: rgba(76, 175, 80, 0.1);
        }

        .files-badge {
            color: #2196F3;
            background: rgba(33, 150, 243, 0.1);
        }

        .backup-item-actions {
            display: flex;
            gap: 0.5rem;
        }

        .backup-item-actions button {
            padding: 0.4rem 0.8rem;
            border-radius: 4px;
            transition: all 0.2s ease;
        }

        .backup-item-actions button:hover {
            transform: translateY(-2px);
        }

        .no-backups {
            text-align: center;
            padding: 2rem;
            color: var(--text-secondary);
            font-style: italic;
        }

        /* Animation pour le chargement */
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .backup-item {
            animation: fadeIn 0.3s ease-out;
        }

        .version-info {
            display: flex;
            align-items: center;
            gap: 1rem;
            margin-bottom: 1.5rem;
            padding: 1rem;
            background: var(--bg-tertiary);
            border-radius: 6px;
        }

        .version-info-item {
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .version-info-item i {
            color: var(--primary-color);
        }

        .git-badge {
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
            font-size: 0.9em;
            font-family: monospace;
        }

        .git-branch {
            background: rgba(106, 27, 154, 0.1);
            color: #6a1b9a;
        }

        .git-commit {
            background: rgba(46, 125, 50, 0.1);
            color: #2e7d32;
        }

        .git-tag {
            background: rgba(2, 136, 209, 0.1);
            color: #0288d1;
        }
        </style>



    </div>

    <!-- Modale de confirmation -->
    <div class="modal-overlay" id="confirmModal">
        <div class="modal-confirm">
            <div class="modal-header">
                <i class="fas fa-exclamation-triangle"></i>
                <h3>Confirmation</h3>
            </div>
            <div class="modal-content">
                Êtes-vous sûr de vouloir vider le fichier de log ?
            </div>
            <div class="modal-actions">
                <button class="modal-btn modal-btn-cancel" id="cancelClear">
                    <i class="fas fa-times"></i> Annuler
                </button>
                <button class="modal-btn modal-btn-confirm" id="confirmClear">
                    <i class="fas fa-check"></i> Confirmer
                </button>
            </div>
        </div>
    </div>

    <script>
    // Code de gestion des logs directement dans la page
    document.addEventListener('DOMContentLoaded', function() {
        console.log('Initialisation des boutons de log...');
        
        function showStatus(message, type = 'success') {
            const statusDiv = document.getElementById('log-status');
            statusDiv.textContent = message;
            statusDiv.className = `log-status ${type}`;
            setTimeout(() => {
                statusDiv.style.display = 'none';
            }, 5000);
        }

        // Fonction pour montrer la modale
        function showModal() {
            document.getElementById('confirmModal').classList.add('show');
        }

        // Fonction pour cacher la modale
        function hideModal() {
            document.getElementById('confirmModal').classList.remove('show');
        }
        
        // Bouton Rafraîchir
        document.getElementById('refreshLogBtn').addEventListener('click', async function() {
            console.log('Clic sur Rafraîchir');
            const button = this;
            button.disabled = true;
            button.classList.add('btn-loading');
            
            try {
                const response = await fetch('get_debug_log.php');
                if (!response.ok) {
                    throw new Error(`Erreur HTTP: ${response.status}`);
                }
                const content = await response.text();
                document.getElementById('debug-log-content').innerHTML = 
                    `<pre><code>${content}</code></pre>`;
                showStatus('Logs rafraîchis avec succès');
            } catch (error) {
                console.error('Erreur:', error);
                showStatus(`Erreur lors du rafraîchissement: ${error.message}`, 'error');
            } finally {
                button.disabled = false;
                button.classList.remove('btn-loading');
            }
        });

        // Bouton Masquer/Afficher
        document.getElementById('toggleLogBtn').addEventListener('click', function() {
            console.log('Clic sur Masquer/Afficher');
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

                console.log('📥 Status de la réponse:', response.status);
                const data = await response.text();
                console.log('📦 Données brutes reçues:', data);

                let result;
                try {
                    result = JSON.parse(data);
                } catch (e) {
                    console.error('❌ Erreur de parsing JSON:', e);
                    throw new Error('Réponse invalide du serveur');
                }

                if (result.success) {
                    console.log('✨ Succès:', result);
                    showStatus('✨ Logs réinitialisés avec succès');
                    document.getElementById('refreshLogBtn').click();
                } else {
                    throw new Error(result.message || 'Erreur inconnue');
                }
            } catch (error) {
                console.error('❌ Erreur:', error);
                showStatus(`❌ Erreur: ${error.message}`, 'error');
            } finally {
                button.disabled = false;
                button.classList.remove('btn-loading');
                hideModal();
            }
        }

        // Bouton Vider (ouvre la modale)
        document.getElementById('clearLogBtn').addEventListener('click', function(e) {
            e.preventDefault();
            console.log('🔄 Clic sur le bouton Vider');
            showModal();
        });

        // Boutons de la modale
        document.getElementById('cancelClear').addEventListener('click', function() {
            console.log('❌ Opération annulée par l\'utilisateur');
            hideModal();
        });

        document.getElementById('confirmClear').addEventListener('click', function() {
            console.log('✅ Confirmation acceptée');
            clearLogs();
        });

        // Fermer la modale en cliquant en dehors
        document.getElementById('confirmModal').addEventListener('click', function(e) {
            if (e.target === this) {
                hideModal();
            }
        });
    });
    </script>
</body>
</html> 