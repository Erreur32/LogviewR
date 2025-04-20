<?php
session_start();

// Vérifier si les fichiers de configuration existent
if (!file_exists('../config/config.php') || !file_exists('../config/admin.php') || !file_exists('../config/log_patterns.php')) {
    header('Content-Type: application/json');
    echo json_encode([
        'success' => false,
        'message' => 'Fichiers de configuration manquants'
    ]);
    exit;
}

// Vérifier si l'utilisateur est connecté
if (!isset($_SESSION['admin_logged_in']) || $_SESSION['admin_logged_in'] !== true) {
    header('Content-Type: application/json');
    echo json_encode([
        'success' => false,
        'message' => 'Non autorisé'
    ]);
    exit;
}

// Charger les configurations
$config_file = '../config/config.php';
$admin_config_file = '../config/admin.php';
$patterns_file = '../config/log_patterns.php';

$current_config = require $config_file;
$admin_config = require $admin_config_file;
$current_patterns = require $patterns_file;

// Fonction pour sauvegarder la configuration
function saveConfig($config) {
    $configContent = "<?php\n";
    $configContent .= "return " . var_export($config, true) . ";\n";
    return file_put_contents('../config/config.php', $configContent) !== false;
}

// Fonction pour nettoyer les patterns (enlever les sauts de ligne)
function cleanPatterns($patterns) {
    if (isset($patterns['filters']['exclude'])) {
        foreach ($patterns['filters']['exclude'] as $type => $items) {
            if (is_array($items)) {
                $patterns['filters']['exclude'][$type] = array_map(function($pattern) {
                    return rtrim($pattern, "\n\r");
                }, $items);
            }
        }
    }
    return $patterns;
}

// Fonction pour sauvegarder les patterns
function savePatterns($patterns) {
    // Nettoyer les patterns avant de les sauvegarder
    $patterns = cleanPatterns($patterns);
    
    $patternsContent = "<?php\n";
    $patternsContent .= "return " . var_export($patterns, true) . ";\n";
    return file_put_contents('../config/log_patterns.php', $patternsContent) !== false;
}

// Traiter les actions POST
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';
    $response = ['success' => false, 'message' => 'Action non reconnue'];

    switch ($action) {
        case 'update_config':
            // Mise à jour du thème
            if (isset($_POST['theme'])) {
                $current_config['theme'] = $_POST['theme'];
            }
            
            // Mise à jour des couleurs des thèmes
            if (isset($_POST['themes'])) {
                $themes = json_decode($_POST['themes'], true);
                if ($themes) {
                    $current_config['themes'] = $themes;
                } else {
                    foreach ($_POST['themes'] as $theme_name => $colors) {
                        if (!isset($current_config['themes'][$theme_name])) {
                            $current_config['themes'][$theme_name] = [];
                        }
                        foreach ($colors as $color_name => $color_value) {
                            $current_config['themes'][$theme_name][$color_name] = $color_value;
                        }
                    }
                }
            }
            
            if (saveConfig($current_config)) {
                $response = [
                    'success' => true,
                    'message' => 'Thème mis à jour avec succès'
                ];
            } else {
                $response = [
                    'success' => false,
                    'message' => 'Erreur lors de la sauvegarde du thème'
                ];
            }
            break;

        case 'save_switch':
            // Mettre à jour un switch
            $name = $_POST['name'] ?? '';
            $value = $_POST['value'] ?? '0';

            if ($name === 'debug[enabled]') {
                $current_config['debug']['enabled'] = $value === '1';
                if (saveConfig($current_config)) {
                    $response = [
                        'success' => true,
                        'message' => 'Mode debug ' . ($value === '1' ? 'activé' : 'désactivé')
                    ];
                }
            } elseif ($name === 'use_npm') {
                $current_config['nginx']['use_npm'] = $value === '1';
                if (saveConfig($current_config)) {
                    $response = [
                        'success' => true,
                        'message' => 'Nginx Proxy Manager ' . ($value === '1' ? 'activé' : 'désactivé')
                    ];
                }
            }
            break;

        case 'save_all':
            // Mise à jour des switches (debug et NPM)
            if (isset($_POST['debug']['enabled'])) {
                $current_config['debug']['enabled'] = $_POST['debug']['enabled'] === '1';
            }
            
            if (isset($_POST['use_npm'])) {
                $current_config['nginx']['use_npm'] = $_POST['use_npm'] === '1';
            }
            
            // Mise à jour des chemins
            if (isset($_POST['paths']['nginx_logs'])) {
                $current_config['paths']['nginx_logs'] = $_POST['paths']['nginx_logs'];
            }
            
            if (isset($_POST['paths']['apache_logs'])) {
                $current_config['paths']['apache_logs'] = $_POST['paths']['apache_logs'];
            }
            
            if (isset($_POST['paths']['syslog'])) {
                $current_config['paths']['syslog'] = $_POST['paths']['syslog'];
            }
            
            // Mise à jour des extensions exclues
            if (isset($_POST['app']['excluded_extensions'])) {
                $extensions = explode("\n", $_POST['app']['excluded_extensions']);
                $extensions = array_map('trim', $extensions);
                $extensions = array_filter($extensions);
                $current_config['app']['excluded_extensions'] = $extensions;
            }
            
            // Mise à jour des filtres d'exclusion
            if (isset($_POST['filters']['exclude']['ips'])) {
                $current_patterns['filters']['exclude']['ips'] = array_map('trim', array_filter(explode("\n", $_POST['filters']['exclude']['ips'])));
            }
            
            if (isset($_POST['filters']['exclude']['requests'])) {
                $current_patterns['filters']['exclude']['requests'] = array_map('trim', array_filter(explode("\n", $_POST['filters']['exclude']['requests'])));
            }
            
            if (isset($_POST['filters']['exclude']['user_agents'])) {
                $current_patterns['filters']['exclude']['user_agents'] = array_map('trim', array_filter(explode("\n", $_POST['filters']['exclude']['user_agents'])));
            }
            
            if (isset($_POST['filters']['exclude']['users'])) {
                $current_patterns['filters']['exclude']['users'] = array_map('trim', array_filter(explode("\n", $_POST['filters']['exclude']['users'])));
            }
            
            if (isset($_POST['filters']['exclude']['content'])) {
                $current_patterns['filters']['exclude']['content'] = array_map('trim', array_filter(explode("\n", $_POST['filters']['exclude']['content'])));
            }
            
            // Mise à jour des patterns
            if (isset($_POST['patterns'])) {
                foreach ($_POST['patterns'] as $type => $subtypes) {
                    foreach ($subtypes as $subtype => $data) {
                        if (isset($data['pattern'])) {
                            $current_patterns[$type][$subtype]['pattern'] = $data['pattern'];
                        }
                    }
                }
            }
            
            // Mise à jour du thème
            if (isset($_POST['theme'])) {
                $current_config['theme'] = $_POST['theme'];
            }
            
            // Mise à jour des couleurs des thèmes
            if (isset($_POST['themes'])) {
                foreach ($_POST['themes'] as $theme_name => $colors) {
                    if (!isset($current_config['themes'][$theme_name])) {
                        $current_config['themes'][$theme_name] = [];
                    }
                    foreach ($colors as $color_name => $color_value) {
                        $current_config['themes'][$theme_name][$color_name] = $color_value;
                    }
                }
            }
            
            // Sauvegarder la configuration
            $config_saved = saveConfig($current_config);
            $patterns_saved = savePatterns($current_patterns);
            
            if ($config_saved && $patterns_saved) {
                $response = [
                    'success' => true,
                    'message' => 'Configuration mise à jour avec succès'
                ];
            } else {
                $response = [
                    'success' => false,
                    'message' => 'Erreur lors de la sauvegarde de la configuration'
                ];
            }
            break;

        case 'save_debug_switch':
            // Validate debug mode value (must be 0 or 1)
            if (!isset($_POST['debug']) || !in_array($_POST['debug'], ['0', '1'], true)) {
                http_response_code(400);
                die(json_encode(['status' => 'error', 'message' => 'Invalid debug value']));
            }

            $debug = (int)$_POST['debug'];
            
            try {
                // Update configuration file
                $current_config['debug'] = $debug;
                if (!saveConfig($current_config)) {
                    throw new Exception('Failed to save configuration');
                }

                // Log the change
                error_log(sprintf("[INFO] Debug mode changed to %s by admin", $debug ? 'enabled' : 'disabled'));
                
                die(json_encode(['status' => 'success']));
            } catch (Exception $e) {
                http_response_code(500);
                die(json_encode(['status' => 'error', 'message' => $e->getMessage()]));
            }
            break;

        default:
            $response = [
                'success' => false,
                'message' => 'Action inconnue: ' . $action
            ];
    }

    header('Content-Type: application/json');
    echo json_encode($response);
} else {
    header('Content-Type: application/json');
    echo json_encode([
        'success' => false,
        'message' => 'Méthode non autorisée'
    ]);
} 