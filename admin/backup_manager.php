<?php
session_start();

// Vérifier la connexion admin
if (!isset($_SESSION['admin_logged_in']) || $_SESSION['admin_logged_in'] !== true) {
    header('HTTP/1.1 403 Forbidden');
    echo json_encode([
        'success' => false,
        'message' => 'Session expirée ou non autorisée. Veuillez vous reconnecter.'
    ]);
    exit;
}

// Vérifier que la requête est bien en POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('HTTP/1.1 405 Method Not Allowed');
    echo json_encode([
        'success' => false,
        'message' => 'Méthode non autorisée'
    ]);
    exit;
}

// Vérifier que l'action est spécifiée
if (!isset($_POST['action'])) {
    header('HTTP/1.1 400 Bad Request');
    echo json_encode([
        'success' => false,
        'message' => 'Action non spécifiée'
    ]);
    exit;
}

// Charger la configuration
require_once __DIR__ . '/../includes/config.php';

/**
 * Class BackupManager - Gère les sauvegardes de configuration
 */
class BackupManager {
    // Dossier de sauvegarde
    private $backupDir;
    
    // Fichiers à sauvegarder
    private $filesToBackup = [
        'config.php',
        'log_patterns.php',
        'admin.php',
        'default_config.php',
        'default_log_patterns.php'
    ];
    
    /**
     * Constructeur
     */
    public function __construct() {
        $this->backupDir = dirname(__DIR__) . '/config/backups';
        $this->ensureBackupDir();
    }
    
    /**
     * Crée une nouvelle sauvegarde
     * @return array Statut de l'opération
     */
    public function createBackup() {
        try {
            // Créer le timestamp pour le dossier
            $timestamp = date('Y-m-d_His');
            $backupPath = $this->backupDir . '/' . $timestamp;
            
            // Créer le dossier de sauvegarde
            if (!mkdir($backupPath, 0755, true)) {
                throw new Exception("Impossible de créer le dossier de sauvegarde");
            }
            
            // Initialiser le manifest
            $manifest = [
                'timestamp' => $timestamp,
                'version' => LOGVIEWR_VERSION,
                'files' => []
            ];
            
            // Copier chaque fichier
            foreach ($this->filesToBackup as $file) {
                $sourcePath = dirname(__DIR__) . '/config/' . $file;
                $destPath = $backupPath . '/' . $file;
                
                if (file_exists($sourcePath)) {
                    if (!copy($sourcePath, $destPath)) {
                        throw new Exception("Erreur lors de la copie de $file");
                    }
                    
                    // Ajouter au manifest
                    $manifest['files'][] = [
                        'name' => $file,
                        'size' => filesize($sourcePath),
                        'hash' => md5_file($sourcePath)
                    ];
                }
            }
            
            // Sauvegarder le manifest
            $manifestPath = $backupPath . '/manifest.json';
            if (!file_put_contents($manifestPath, json_encode($manifest, JSON_PRETTY_PRINT))) {
                throw new Exception("Erreur lors de la création du manifest");
            }
            
            // Définir les permissions correctes
            chmod($backupPath, 0755);
            foreach (glob($backupPath . '/*') as $file) {
                chmod($file, 0644);
            }
            
            return [
                'success' => true,
                'message' => 'Sauvegarde créée avec succès',
                'backup' => [
                    'path' => $backupPath,
                    'timestamp' => $timestamp,
                    'files' => count($manifest['files'])
                ]
            ];
            
        } catch (Exception $e) {
            // Logger l'erreur
            error_log("Erreur de sauvegarde: " . $e->getMessage());
            
            // Nettoyer la sauvegarde échouée
            if (isset($backupPath) && is_dir($backupPath)) {
                $this->removeDirectory($backupPath);
            }
            
            return [
                'success' => false,
                'message' => $e->getMessage()
            ];
        }
    }
    
    /**
     * Récupère la liste des sauvegardes disponibles
     * @return array Liste des sauvegardes avec détails
     */
    public function getBackups() {
        $backups = [];
        
        if (!is_dir($this->backupDir)) {
            return $backups;
        }
        
        foreach (glob($this->backupDir . '/*', GLOB_ONLYDIR) as $dir) {
            $manifestPath = $dir . '/manifest.json';
            if (file_exists($manifestPath)) {
                $manifest = json_decode(file_get_contents($manifestPath), true);
                if ($manifest) {
                    $backups[] = [
                        'timestamp' => $manifest['timestamp'],
                        'version' => $manifest['version'],
                        'files' => count($manifest['files']),
                        'path' => $dir
                    ];
                }
            }
        }
        
        // Trier par timestamp décroissant
        usort($backups, function($a, $b) {
            return strcmp($b['timestamp'], $a['timestamp']);
        });
        
        return $backups;
    }
    
    /**
     * Nettoie les anciennes sauvegardes
     * @param int $keep Nombre de sauvegardes à conserver
     * @return array Statut de l'opération
     */
    public function cleanOldBackups($keep = 5) {
        $backups = $this->getBackups();
        
        if (count($backups) <= $keep) {
            return [
                'success' => true,
                'message' => 'Aucun nettoyage nécessaire'
            ];
        }
        
        $removed = 0;
        for ($i = $keep; $i < count($backups); $i++) {
            if ($this->removeDirectory($backups[$i]['path'])) {
                $removed++;
            }
        }
        
        return [
            'success' => true,
            'message' => "$removed sauvegardes anciennes supprimées",
            'removed' => $removed
        ];
    }
    
    /**
     * S'assure que le dossier de sauvegarde existe avec les bonnes permissions
     */
    private function ensureBackupDir() {
        if (!is_dir($this->backupDir)) {
            if (!mkdir($this->backupDir, 0755, true)) {
                throw new Exception("Impossible de créer le dossier de sauvegarde");
            }
        }
        
        if (!is_writable($this->backupDir)) {
            throw new Exception("Le dossier de sauvegarde n'est pas accessible en écriture");
        }
    }
    
    /**
     * Supprime récursivement un dossier
     * @param string $dir Dossier à supprimer
     * @return bool Statut de succès
     */
    private function removeDirectory($dir) {
        if (!is_dir($dir)) {
            return false;
        }
        
        $files = array_diff(scandir($dir), ['.', '..']);
        foreach ($files as $file) {
            $path = $dir . '/' . $file;
            is_dir($path) ? $this->removeDirectory($path) : unlink($path);
        }
        
        return rmdir($dir);
    }

    /**
     * Get Git version information
     * @return array Git version info or error
     */
    public function getGitVersion() {
        try {
            $rootDir = dirname(dirname(__FILE__));
            
            // Check if .git directory exists
            if (!is_dir($rootDir . '/.git')) {
                return ['success' => false, 'message' => 'Not a git repository'];
            }

            // Get current branch
            $branch = trim(shell_exec('cd ' . escapeshellarg($rootDir) . ' && git rev-parse --abbrev-ref HEAD'));
            
            // Get current commit hash
            $commit = trim(shell_exec('cd ' . escapeshellarg($rootDir) . ' && git rev-parse --short HEAD'));
            
            // Get latest tag
            $tag = trim(shell_exec('cd ' . escapeshellarg($rootDir) . ' && git describe --tags --abbrev=0 2>/dev/null'));
            
            return [
                'success' => true,
                'branch' => $branch ?: 'unknown',
                'commit' => $commit ?: 'unknown',
                'tag' => $tag ?: 'no tag'
            ];
        } catch (Exception $e) {
            return ['success' => false, 'message' => $e->getMessage()];
        }
    }

    /**
     * Restaure une sauvegarde
     * @param string $timestamp Timestamp de la sauvegarde à restaurer
     * @return array Statut de l'opération
     */
    public function restoreBackup($timestamp) {
        try {
            // Vérifier le format du timestamp
            if (!preg_match('/^\d{4}-\d{2}-\d{2}_\d{6}$/', $timestamp)) {
                throw new Exception("Format de timestamp invalide");
            }

            $backupPath = $this->backupDir . '/' . $timestamp;
            
            // Vérifier que la sauvegarde existe
            if (!is_dir($backupPath)) {
                throw new Exception("Sauvegarde non trouvée");
            }

            // Vérifier le manifest
            $manifestPath = $backupPath . '/manifest.json';
            if (!file_exists($manifestPath)) {
                throw new Exception("Manifest de sauvegarde manquant");
            }

            $manifest = json_decode(file_get_contents($manifestPath), true);
            if (!$manifest) {
                throw new Exception("Manifest de sauvegarde corrompu");
            }

            // Créer une sauvegarde automatique avant restauration
            $autoBackup = $this->createBackup();
            if (!$autoBackup['success']) {
                throw new Exception("Impossible de créer la sauvegarde automatique avant restauration");
            }

            $restored = [];
            $errors = [];

            // Restaurer chaque fichier
            foreach ($manifest['files'] as $fileInfo) {
                $sourcePath = $backupPath . '/' . $fileInfo['name'];
                $destPath = dirname(__DIR__) . '/config/' . $fileInfo['name'];

                // Vérifier l'intégrité du fichier
                if (md5_file($sourcePath) !== $fileInfo['hash']) {
                    $errors[] = "Fichier corrompu: {$fileInfo['name']}";
                    continue;
                }

                // Vérifier les permissions
                if (file_exists($destPath) && !is_writable($destPath)) {
                    $errors[] = "Permissions insuffisantes pour: {$fileInfo['name']}";
                    continue;
                }

                // Copier le fichier
                if (copy($sourcePath, $destPath)) {
                    chmod($destPath, 0644);
                    $restored[] = $fileInfo['name'];
                } else {
                    $errors[] = "Erreur lors de la copie de: {$fileInfo['name']}";
                }
            }

            // Préparer le message de retour
            $message = count($restored) . " fichiers restaurés";
            if (!empty($errors)) {
                $message .= " avec " . count($errors) . " erreurs";
            }

            return [
                'success' => true,
                'message' => $message,
                'restored' => $restored,
                'errors' => $errors,
                'auto_backup' => [
                    'timestamp' => $autoBackup['backup']['timestamp'],
                    'path' => $autoBackup['backup']['path']
                ]
            ];

        } catch (Exception $e) {
            error_log("Erreur de restauration: " . $e->getMessage());
            return [
                'success' => false,
                'message' => $e->getMessage()
            ];
        }
    }

    /**
     * Supprime une sauvegarde spécifique
     * @param string $timestamp Timestamp de la sauvegarde à supprimer
     * @return array Statut de l'opération
     */
    public function deleteBackup($timestamp) {
        try {
            // Vérifier le format du timestamp
            if (!preg_match('/^\d{4}-\d{2}-\d{2}_\d{6}$/', $timestamp)) {
                throw new Exception("Format de timestamp invalide");
            }

            $backupPath = $this->backupDir . '/' . $timestamp;
            
            // Vérifier que la sauvegarde existe
            if (!is_dir($backupPath)) {
                throw new Exception("Sauvegarde non trouvée");
            }

            // Supprimer le dossier
            if ($this->removeDirectory($backupPath)) {
                return [
                    'success' => true,
                    'message' => "Sauvegarde supprimée avec succès"
                ];
            } else {
                throw new Exception("Erreur lors de la suppression de la sauvegarde");
            }

        } catch (Exception $e) {
            error_log("Erreur de suppression: " . $e->getMessage());
            return [
                'success' => false,
                'message' => $e->getMessage()
            ];
        }
    }
}

// Traiter les actions AJAX
if (isset($_POST['action'])) {
    header('Content-Type: application/json');
    $manager = new BackupManager();
    
    switch ($_POST['action']) {
        case 'create':
            $result = $manager->createBackup();
            echo json_encode($result);
            break;
            
        case 'list':
            $backups = $manager->getBackups();
            $gitInfo = $manager->getGitVersion();
            echo json_encode([
                'success' => true, 
                'backups' => $backups,
                'git_info' => $gitInfo
            ]);
            break;
            
        case 'restore':
            if (!isset($_POST['timestamp'])) {
                echo json_encode(['success' => false, 'message' => 'Timestamp manquant']);
                break;
            }
            $result = $manager->restoreBackup($_POST['timestamp']);
            echo json_encode($result);
            break;

        case 'delete':
            if (!isset($_POST['timestamp'])) {
                echo json_encode(['success' => false, 'message' => 'Timestamp manquant']);
                break;
            }
            $result = $manager->deleteBackup($_POST['timestamp']);
            echo json_encode($result);
            break;
            
        case 'clean':
            $keep = isset($_POST['keep']) ? intval($_POST['keep']) : 5;
            $result = $manager->cleanOldBackups($keep);
            echo json_encode($result);
            break;
            
        default:
            echo json_encode(['success' => false, 'message' => 'Action non reconnue']);
    }
    exit;
} 