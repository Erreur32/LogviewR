<?php
/**
 * LogManager - Gère les opérations liées aux logs
 * 
 * @package LogviewR
 * @subpackage Admin
 */

class LogManager {
    private $config;
    private $debug;

    /**
     * Constructeur
     * 
     * @param array $config Configuration de l'application
     * @param bool $debug Mode debug
     */
    public function __construct($config, $debug = false) {
        $this->config = $config;
        $this->debug = $debug;
    }

    /**
     * Récupère le contenu d'un fichier de log
     * 
     * @param string $file Chemin du fichier
     * @return array|false Contenu du fichier ou false en cas d'erreur
     */
    public function getLogContent($file) {
        try {
            if (!file_exists($file)) {
                throw new Exception("Le fichier n'existe pas");
            }

            if (!is_readable($file)) {
                throw new Exception("Le fichier n'est pas accessible en lecture");
            }

            $content = file_get_contents($file);
            if ($content === false) {
                throw new Exception("Impossible de lire le fichier");
            }

            return [
                'success' => true,
                'content' => $content
            ];
        } catch (Exception $e) {
            return [
                'success' => false,
                'message' => $e->getMessage()
            ];
        }
    }

    /**
     * Vide un fichier de log
     * 
     * @param string $file Chemin du fichier
     * @return array Résultat de l'opération
     */
    public function clearLogFile($file) {
        try {
            if (!file_exists($file)) {
                throw new Exception("Le fichier n'existe pas");
            }

            if (!is_writable($file)) {
                throw new Exception("Le fichier n'est pas accessible en écriture");
            }

            if (file_put_contents($file, '') === false) {
                throw new Exception("Impossible de vider le fichier");
            }

            return [
                'success' => true,
                'message' => 'Fichier vidé avec succès'
            ];
        } catch (Exception $e) {
            return [
                'success' => false,
                'message' => $e->getMessage()
            ];
        }
    }

    /**
     * Parse une ligne de log selon un pattern
     * 
     * @param string $line Ligne de log
     * @param string $pattern Pattern de parsing
     * @return array Données parsées
     */
    public function parseLogLine($line, $pattern) {
        if (preg_match($pattern, $line, $matches)) {
            return $matches;
        }
        return [];
    }

    /**
     * Filtre les logs selon des critères
     * 
     * @param array $logs Liste des logs
     * @param array $filters Critères de filtrage
     * @return array Logs filtrés
     */
    public function filterLogs($logs, $filters) {
        return array_filter($logs, function($log) use ($filters) {
            foreach ($filters as $key => $value) {
                if (isset($log[$key]) && $log[$key] !== $value) {
                    return false;
                }
            }
            return true;
        });
    }

    /**
     * Formate une ligne de log pour l'affichage
     * 
     * @param array $data Données du log
     * @return string Ligne formatée
     */
    public function formatLogLine($data) {
        $format = $this->config['debug']['log_format'] ?? '[%timestamp%] [%level%] %message%';
        
        $replacements = [
            '%timestamp%' => $data['timestamp'] ?? date('Y-m-d H:i:s'),
            '%level%' => $data['level'] ?? 'INFO',
            '%message%' => $data['message'] ?? ''
        ];

        return str_replace(
            array_keys($replacements),
            array_values($replacements),
            $format
        );
    }

    /**
     * Calcule les statistiques des logs
     * 
     * @param array $logs Liste des logs
     * @return array Statistiques
     */
    public function getLogStats($logs) {
        $stats = [
            'total' => count($logs),
            'by_level' => [],
            'by_hour' => [],
            'by_day' => []
        ];

        foreach ($logs as $log) {
            // Statistiques par niveau
            $level = $log['level'] ?? 'UNKNOWN';
            $stats['by_level'][$level] = ($stats['by_level'][$level] ?? 0) + 1;

            // Statistiques par heure
            $hour = date('H', strtotime($log['timestamp'] ?? 'now'));
            $stats['by_hour'][$hour] = ($stats['by_hour'][$hour] ?? 0) + 1;

            // Statistiques par jour
            $day = date('Y-m-d', strtotime($log['timestamp'] ?? 'now'));
            $stats['by_day'][$day] = ($stats['by_day'][$day] ?? 0) + 1;
        }

        return $stats;
    }
} 