<?php
/**
 * ConfigManager - Gère les opérations liées à la configuration
 * 
 * @package LogviewR
 * @subpackage Admin
 */

class ConfigManager {
    private $config;
    private $configFile;
    private $patternsFile;
    private $debug;
    private $configDir;

    /**
     * Constructeur
     * 
     * @param bool $debug Mode debug
     */
    public function __construct($debug = false) {
        $this->debug = $debug;
        $this->configDir = dirname(dirname(__DIR__)) . '/config';
        
        // Initialiser les chemins des fichiers
        $this->initFilePaths();
        
        // Charger la configuration
        $this->loadConfig();
    }

    /**
     * Normalise une valeur booléenne
     * 
     * @param mixed $value Valeur à normaliser
     * @return bool Valeur booléenne normalisée
     */
    private function normalizeBoolean($value) {
        if (is_bool($value)) {
            return $value;
        }
        if (is_string($value)) {
            return strtolower($value) === 'true' || $value === '1';
        }
        return (bool)$value;
    }

    /**
     * Initialise les chemins des fichiers
     */
    private function initFilePaths() {
        // Configuration
        $this->configFile = $this->configDir . '/config.user.php';
        if (!file_exists($this->configFile)) {
            $this->configFile = $this->configDir . '/config.php';
        }

        // Patterns
        $this->patternsFile = $this->configDir . '/log_patterns.user.php';
        if (!file_exists($this->patternsFile)) {
            $this->patternsFile = $this->configDir . '/log_patterns.php';
        }
    }

    /**
     * Charge la configuration depuis le fichier
     * 
     * @throws Exception Si le fichier n'existe pas ou n'est pas lisible
     */
    private function loadConfig() {
        if (!file_exists($this->configFile)) {
            throw new Exception('Le fichier de configuration n\'existe pas: ' . $this->configFile);
        }

        if (!is_readable($this->configFile)) {
            throw new Exception('Le fichier de configuration n\'est pas accessible en lecture: ' . $this->configFile);
        }

        $this->config = require $this->configFile;
        
        // Normaliser les valeurs booléennes
        $this->normalizeConfigBooleans();
    }

    /**
     * Normalise les valeurs booléennes dans la configuration
     */
    private function normalizeConfigBooleans() {
        // Debug
        if (isset($this->config['debug'])) {
            foreach ($this->config['debug'] as $key => $value) {
                if (in_array($key, ['enabled', 'log_to_apache'])) {
                    $this->config['debug'][$key] = $this->normalizeBoolean($value);
                }
            }
        }

        // Nginx
        if (isset($this->config['nginx']['use_npm'])) {
            $this->config['nginx']['use_npm'] = $this->normalizeBoolean($this->config['nginx']['use_npm']);
        }

        // Filters
        if (isset($this->config['filters_enabled'])) {
            $this->config['filters_enabled'] = $this->normalizeBoolean($this->config['filters_enabled']);
        }
    }

    /**
     * Met à jour la configuration
     * 
     * @param array $data Données à mettre à jour
     * @return array Résultat de la mise à jour
     */
    public function update($data) {
        try {
            // Vérifier si on doit utiliser le fichier user
            if (!file_exists($this->configDir . '/config.user.php')) {
                // Copier le fichier par défaut vers user
                if (!copy($this->configDir . '/config.php', $this->configDir . '/config.user.php')) {
                    throw new Exception('Impossible de créer le fichier de configuration utilisateur');
                }
                $this->configFile = $this->configDir . '/config.user.php';
                $this->loadConfig();
            }

            // Mettre à jour les chemins
            if (isset($data['paths'])) {
                foreach ($data['paths'] as $key => $value) {
                    if (isset($this->config['paths'][$key])) {
                        $this->config['paths'][$key] = $value;
                    }
                }
            }

            // Mettre à jour les paramètres de l'application
            if (isset($data['app'])) {
                foreach ($data['app'] as $key => $value) {
                    if (isset($this->config['app'][$key])) {
                        if ($key === 'excluded_extensions' && is_array($value)) {
                            $this->config['app'][$key] = array_values($value);
                        } else {
                            $this->config['app'][$key] = $value;
                        }
                    }
                }
            }

            // Mettre à jour les filtres
            if (isset($data['filters_enabled'])) {
                $this->config['filters_enabled'] = $this->normalizeBoolean($data['filters_enabled']);
            }

            if (isset($data['filters'])) {
                if (!isset($this->config['filters'])) {
                    $this->config['filters'] = ['exclude' => []];
                }
                if (isset($data['filters']['exclude'])) {
                    foreach ($data['filters']['exclude'] as $type => $filters) {
                        if (!isset($this->config['filters']['exclude'][$type])) {
                            $this->config['filters']['exclude'][$type] = [];
                        }
                        // Convertir en tableau si ce n'est pas déjà le cas
                        $filters = is_array($filters) ? $filters : explode("\n", $filters);
                        // Nettoyer et filtrer les valeurs vides
                        $filters = array_map('trim', $filters);
                        $filters = array_filter($filters, function($value) {
                            return !empty($value);
                        });
                        // Réindexer le tableau
                        $this->config['filters']['exclude'][$type] = array_values($filters);
                    }
                }
            }

            // Mettre à jour le thème
            if (isset($data['theme'])) {
                $this->config['theme'] = $data['theme'];
            }

            // Mettre à jour les couleurs des thèmes
            if (isset($data['themes'])) {
                if (!isset($this->config['themes'])) {
                    $this->config['themes'] = [
                        'light' => [],
                        'dark' => []
                    ];
                }
                foreach ($data['themes'] as $theme => $colors) {
                    if (!isset($this->config['themes'][$theme])) {
                        $this->config['themes'][$theme] = [];
                    }
                    foreach ($colors as $color => $value) {
                        $this->config['themes'][$theme][$color] = $value;
                    }
                }
            }

            // Valider la configuration avant de sauvegarder
            $validationResult = $this->validate();
            if (!$validationResult['success']) {
                throw new Exception($validationResult['message']);
            }

            // Sauvegarder la configuration
            $this->save();

            return [
                'success' => true,
                'message' => 'Configuration mise à jour avec succès'
            ];
        } catch (Exception $e) {
            if ($this->debug) {
                error_log("[ERROR] " . $e->getMessage());
            }
            return [
                'success' => false,
                'message' => $e->getMessage()
            ];
        }
    }

    /**
     * Sauvegarde la configuration dans le fichier
     * 
     * @throws Exception Si la sauvegarde échoue
     */
    private function save() {
        // Liste des chemins à préserver
        $pathsToPreserve = [
            'debug' => ['log_file'],
            'paths' => ['apache_logs', 'nginx_logs', 'npm_logs', 'syslog']
        ];

        // Sauvegarder les chemins originaux
        $originalPaths = [];
        foreach ($pathsToPreserve as $section => $keys) {
            foreach ($keys as $key) {
                if (isset($this->config[$section][$key])) {
                    $originalPaths[$section][$key] = $this->config[$section][$key];
                    // Remplacer temporairement par une chaîne spéciale
                    $this->config[$section][$key] = '__PATH_' . strtoupper($section . '_' . $key) . '__';
                }
            }
        }

        // Générer le contenu de la configuration
        $configContent = "<?php\nreturn " . var_export($this->config, true) . ";\n";

        // Restaurer les chemins originaux
        foreach ($pathsToPreserve as $section => $keys) {
            foreach ($keys as $key) {
                if (isset($originalPaths[$section][$key])) {
                    $this->config[$section][$key] = $originalPaths[$section][$key];
                }
            }
        }

        // Remplacer les chaînes spéciales par les chemins relatifs
        $replacements = [
            "'__PATH_DEBUG_LOG_FILE__'" => "__DIR__ . '/logs/debug.log'",
            "'__PATH_PATHS_APACHE_LOGS__'" => "'/var/log/apache2'",
            "'__PATH_PATHS_NGINX_LOGS__'" => "'/var/log/nginx'",
            "'__PATH_PATHS_NPM_LOGS__'" => "'/var/log/npm'",
            "'__PATH_PATHS_SYSLOG__'" => "'/var/log'"
        ];

        $configContent = str_replace(
            array_keys($replacements),
            array_values($replacements),
            $configContent
        );

        if (file_put_contents($this->configFile, $configContent) === false) {
            throw new Exception('Impossible d\'écrire dans le fichier de configuration: ' . $this->configFile);
        }
    }

    /**
     * Crée une sauvegarde de la configuration
     * 
     * @return array Résultat de la sauvegarde
     */
    public function backup() {
        try {
            $backupDir = $this->configDir . '/backups';
            if (!file_exists($backupDir)) {
                mkdir($backupDir, 0755, true);
            }

            $backupFile = $backupDir . '/config.backup.' . date('Y-m-d_H-i-s') . '.php';
            
            if (copy($this->configFile, $backupFile)) {
                return [
                    'success' => true,
                    'message' => 'Sauvegarde créée avec succès',
                    'backup_file' => $backupFile
                ];
            } else {
                throw new Exception('Impossible de créer la sauvegarde');
            }
        } catch (Exception $e) {
            if ($this->debug) {
                error_log("[ERROR] " . $e->getMessage());
            }
            return [
                'success' => false,
                'message' => $e->getMessage()
            ];
        }
    }

    /**
     * Restaure une configuration depuis une sauvegarde
     * 
     * @param string $backupFile Chemin du fichier de sauvegarde
     * @return array Résultat de la restauration
     */
    public function restore($backupFile) {
        try {
            if (!file_exists($backupFile)) {
                throw new Exception('Le fichier de sauvegarde n\'existe pas');
            }

            // Restaurer dans le fichier user
            $targetFile = $this->configDir . '/config.user.php';
            
            if (copy($backupFile, $targetFile)) {
                $this->configFile = $targetFile;
                $this->loadConfig();
                return [
                    'success' => true,
                    'message' => 'Configuration restaurée avec succès'
                ];
            } else {
                throw new Exception('Impossible de restaurer la configuration');
            }
        } catch (Exception $e) {
            if ($this->debug) {
                error_log("[ERROR] " . $e->getMessage());
            }
            return [
                'success' => false,
                'message' => $e->getMessage()
            ];
        }
    }

    /**
     * Valide la configuration
     * 
     * @return array Résultat de la validation
     */
    public function validate() {
        try {
            // Vérifier la structure de base
            $requiredSections = ['debug', 'timezone', 'date_formats', 'app', 'paths', 'nginx', 'filters', 'theme', 'themes'];
            foreach ($requiredSections as $section) {
                if (!isset($this->config[$section])) {
                    throw new Exception("Section manquante: $section");
                }
            }

            return [
                'success' => true,
                'message' => 'Configuration valide'
            ];
        } catch (Exception $e) {
            if ($this->debug) {
                error_log("[ERROR] " . $e->getMessage());
            }
            return [
                'success' => false,
                'message' => $e->getMessage()
            ];
        }
    }
} 