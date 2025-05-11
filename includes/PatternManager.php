<?php

/**
 * Class PatternManager
 * Gère la validation, le formatage et la sauvegarde des patterns de logs
 */
class PatternManager {
    /** @var string Chemin du fichier des patterns par défaut */
    private $default_patterns_file;
    
    /** @var string Chemin du fichier des patterns utilisateur */
    private $user_patterns_file;
    
    /** @var array Patterns par défaut */
    private $default_patterns;
    
    /** @var array Patterns utilisateur */
    private $user_patterns;

    // Constants for pattern validation
    private const PATTERN_REGEX = '/^\/.*\/[imsxADSUXJu]*$/';
    private const FILE_PERMISSIONS = 0755;
    private const PHP_HEADER = "<?php\n// User defined patterns\nreturn ";

    /**
     * Constructeur
     */
    public function __construct() {
        $base_dir = dirname(__DIR__); // Remonte d'un niveau de manière propre
        $this->default_patterns_file = $base_dir . '/config/log_patterns.php';
        $this->user_patterns_file = $base_dir . '/config/log_patterns.user.php';
        $this->loadPatterns();
    }

    /**
     * Charge les patterns par défaut et utilisateur
     */
    private function loadPatterns() {
        // Charger les patterns utilisateur s'ils existent
        if (file_exists($this->user_patterns_file)) {
            $this->user_patterns = require $this->user_patterns_file;
           //error_log('PatternManager - Patterns utilisateur chargés: ' . print_r($this->user_patterns, true));
        } else {
            // Créer le fichier avec une structure de base
            $this->user_patterns = [
                'apache' => [
                    'access' => [
                        'pattern' => '/^(\S+) (\S+) (\S+) \[([^\]]+)\] "([^"]*)" (\d+) (\d+) "([^"]*)" "([^"]*)"$/'
                    ],
                    'error' => [
                        'pattern' => '/^\[(.*?)\] \[([^\]]*)\] \[([^\]]*)\] (.*)$/'
                    ]
                ],
                'nginx' => [
                    'access' => [
                        'pattern' => '/^(\S+) - (\S+) \[([^\]]+)\] "([^"]*)" (\d{3}) (\d+) "([^"]*)" "([^"]*)"$/'
                    ],
                    'error' => [
                        'pattern' => '/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\] (\d+)#\d+: \*(\d+) (.*)$/'
                    ]
                ]
            ];

            // Créer le dossier si nécessaire
            $dir = dirname($this->user_patterns_file);
            if (!is_dir($dir)) {
                if (!mkdir($dir, self::FILE_PERMISSIONS, true)) {
                    error_log('PatternManager - Erreur création dossier: ' . $dir);
                    throw new Exception("Impossible de créer le dossier de configuration");
                }
            }

            // Sauvegarder le fichier initial
            $content = "<?php\n// User defined patterns\nreturn " . var_export($this->user_patterns, true) . ";\n";
            if (file_put_contents($this->user_patterns_file, $content) === false) {
                error_log('PatternManager - Erreur création fichier: ' . $this->user_patterns_file);
                throw new Exception("Impossible de créer le fichier de patterns");
            }

            error_log('PatternManager - Fichier de patterns créé avec succès');
        }
    }

    /**
     * Valide un pattern
     * @param string $pattern Le pattern à valider
     * @return array ['valid' => bool, 'message' => string]
     */
    public function validatePattern($pattern) {
        if (empty($pattern)) {
            return ['valid' => false, 'message' => 'Le pattern ne peut pas être vide'];
        }

        // Vérifier le format regex
        if (!preg_match(self::PATTERN_REGEX, $pattern)) {
            return ['valid' => false, 'message' => 'Format de pattern invalide. Doit être une expression régulière valide'];
        }

        // Tester si le pattern est une regex valide
        try {
            preg_match($pattern, 'test string');
            return ['valid' => true, 'message' => 'Pattern valide'];
        } catch (Exception $e) {
            return ['valid' => false, 'message' => 'Expression régulière invalide: ' . $e->getMessage()];
        }
    }

    /**
     * Sauvegarde les patterns
     * @param array $patterns Les patterns à sauvegarder
     * @return array ['success' => bool, 'message' => string]
     */
    public function savePatterns($patterns) {
        try {
            // Vérifier le chemin du fichier
            error_log('PatternManager - Chemin du fichier: ' . $this->user_patterns_file);
            error_log('PatternManager - Patterns reçus: ' . print_r($patterns, true));
            
            // Nettoyer les données non nécessaires
            unset($patterns['action'], $patterns['active_tab']);
            
            // Vérifier si les patterns sont vides
            if (empty($patterns)) {
                error_log('PatternManager - Aucun pattern à sauvegarder');
                return [
                    'success' => false,
                    'message' => 'Aucun pattern à sauvegarder'
                ];
            }

            // Charger les patterns existants
            $existing_patterns = [];
            if (file_exists($this->user_patterns_file)) {
                error_log('PatternManager - Chargement des patterns existants');
                $existing_patterns = require $this->user_patterns_file;
                error_log('PatternManager - Patterns existants: ' . print_r($existing_patterns, true));
            }
            
            // Valider chaque nouveau pattern
            foreach ($patterns as $type => $type_patterns) {
                foreach ($type_patterns as $pattern_type => $pattern_data) {
                    if (isset($pattern_data['pattern'])) {
                        // Validation plus souple des patterns
                        if (!is_string($pattern_data['pattern']) || empty($pattern_data['pattern'])) {
                            error_log('PatternManager - Pattern vide ou invalide: ' . print_r($pattern_data['pattern'], true));
                            return [
                                'success' => false, 
                                'message' => "Pattern invalide pour $type/$pattern_type: Le pattern doit être une chaîne non vide"
                            ];
                        }
                    }
                }
            }

            // Ne mettre à jour que les patterns modifiés
            foreach ($patterns as $type => $type_patterns) {
                if (!isset($existing_patterns[$type])) {
                    $existing_patterns[$type] = [];
                }
                foreach ($type_patterns as $pattern_type => $pattern_data) {
                    if (isset($pattern_data['pattern'])) {
                        // Ne garder que le pattern si la description est vide
                        if (isset($pattern_data['description']) && empty($pattern_data['description'])) {
                            $existing_patterns[$type][$pattern_type] = [
                                'pattern' => $pattern_data['pattern']
                            ];
                        } else {
                            $existing_patterns[$type][$pattern_type] = $pattern_data;
                        }
                    }
                }
            }

          //  error_log('PatternManager - Patterns mis à jour: ' . print_r($existing_patterns, true));

            // Formater et sauvegarder le contenu
            $content = "<?php\n// User defined patterns\nreturn " . var_export($existing_patterns, true) . ";\n";
           // error_log('PatternManager - Contenu à sauvegarder: ' . $content);
            
            // Vérifier et créer le dossier si nécessaire
            $dir = dirname($this->user_patterns_file);
            if (!is_dir($dir)) {
                error_log('PatternManager - Création du dossier: ' . $dir);
                if (!mkdir($dir, self::FILE_PERMISSIONS, true)) {
                    error_log('PatternManager - Erreur création dossier: ' . $dir);
                    throw new Exception("Impossible de créer le dossier de configuration");
                }
            }

            // Vérifier les permissions du dossier
            if (!is_writable($dir)) {
                error_log('PatternManager - Dossier non accessible en écriture: ' . $dir);
                throw new Exception("Le dossier de configuration n'est pas accessible en écriture");
            }

            // Sauvegarder dans le fichier
          //  error_log('PatternManager - Tentative d\'écriture dans: ' . $this->user_patterns_file);
            if (file_put_contents($this->user_patterns_file, $content) === false) {
                error_log('PatternManager - Erreur écriture fichier: ' . $this->user_patterns_file);
                throw new Exception('Erreur lors de l\'écriture du fichier');
            }

            // Définir les permissions du fichier (optionnel)
            try {
                if (!chmod($this->user_patterns_file, 0644)) {
                    error_log('PatternManager - Avertissement: Impossible de définir les permissions du fichier: ' . $this->user_patterns_file);
                    // On continue malgré l'erreur de permissions
                }
            } catch (Exception $e) {
                error_log('PatternManager - Avertissement: ' . $e->getMessage());
                // On continue malgré l'erreur de permissions
            }

            // Nettoyer le cache
            $this->clearCache();

            // Vérifier que le fichier a bien été créé/modifié
            if (!file_exists($this->user_patterns_file)) {
                error_log('PatternManager - Fichier non créé: ' . $this->user_patterns_file);
                throw new Exception('Le fichier n\'a pas été créé');
            }

            // Vérifier que le fichier est lisible
            if (!is_readable($this->user_patterns_file)) {
                error_log('PatternManager - Fichier non lisible: ' . $this->user_patterns_file);
                throw new Exception('Le fichier n\'est pas lisible');
            }

            error_log('PatternManager - Patterns sauvegardés avec succès');
            return [
                'success' => true,
                'message' => 'Patterns sauvegardés avec succès'
            ];

        } catch (Exception $e) {
            error_log('PatternManager - Exception: ' . $e->getMessage());
            return [
                'success' => false,
                'message' => 'Erreur lors de la sauvegarde: ' . $e->getMessage()
            ];
        }
    }

    /**
     * Nettoie le cache du fichier
     */
    private function clearCache() {
        clearstatcache(true, $this->user_patterns_file);
        if (function_exists('opcache_invalidate')) {
            opcache_invalidate($this->user_patterns_file, true);
        }
    }

    /**
     * Récupère tous les patterns
     * @return array Les patterns utilisateur
     */
    public function getAllPatterns() {
        return $this->user_patterns;
    }

    /**
     * Réinitialise les patterns aux valeurs par défaut
     * @return array ['success' => bool, 'message' => string]
     */
    public function resetPatterns() {
        try {
            if (file_exists($this->user_patterns_file)) {
                if (!unlink($this->user_patterns_file)) {
                    throw new Exception('Impossible de supprimer le fichier des patterns utilisateur');
                }
            }
            $this->clearCache();
            return ['success' => true, 'message' => 'Patterns réinitialisés avec succès'];
        } catch (Exception $e) {
            return ['success' => false, 'message' => 'Erreur lors de la réinitialisation: ' . $e->getMessage()];
        }
    }
} 