<?php
/**
 * UpdateChecker class
 * Handles version checking and update notifications
 */

class UpdateChecker {
    private $currentVersion;
    private $apiUrl;
    private $updateUrl;
    private $lastCheck;
    private $checkInterval;
    private $cacheDir;
    private $cacheFile;
    private $enabled;
    private $versionInfo;

    public function __construct() {
        // Load version info
        $this->versionInfo = require __DIR__ . '/../version.php';
        if (!is_array($this->versionInfo)) {
            error_log("❌ Erreur: version.php doit retourner un tableau");
            $this->enabled = false;
            return;
        }

        // Initialize properties with default values if not set
        $this->currentVersion = $this->versionInfo['version'] ?? '1.0.0';
        $this->apiUrl = $this->versionInfo['api_url'] ?? '';
        $this->updateUrl = $this->versionInfo['update_check']['update_url'] ?? 'https://api.logviewr.com/updates';
        $this->checkInterval = $this->versionInfo['update_check']['check_interval'] ?? 86400;
        
        // Get the root directory of the project
        $rootDir = dirname(dirname(__FILE__));
        
        // Set cache directory - use absolute path from project root
        $this->cacheDir = $rootDir . '/cache';
        $this->cacheFile = $this->versionInfo['update_check']['cache_file'] ?? 'update_cache.json';

        // Load update_check enabled from admin.php (priority)
        $adminConfigFile = __DIR__ . '/../config/admin.php';
        if (file_exists($adminConfigFile)) {
            $adminConfig = require $adminConfigFile;
            // Use admin.php value if available
            if (isset($adminConfig['admin']['update_check']['enabled'])) {
                $this->enabled = $adminConfig['admin']['update_check']['enabled'];
            } else {
                // Fallback to version.php value
                $this->enabled = $this->versionInfo['update_check']['enabled'] ?? true;
            }
        } else {
            // Fallback to version.php value
            $this->enabled = $this->versionInfo['update_check']['enabled'] ?? true;
        }

        // Ensure cache directory exists and is writable
        if (!is_dir($this->cacheDir)) {
            if (!mkdir($this->cacheDir, 0755, true)) {
                error_log("❌ Impossible de créer le dossier de cache : " . $this->cacheDir);
                $this->enabled = false;
                return;
            }
        }

        if (!is_writable($this->cacheDir)) {
            error_log("❌ Le dossier de cache n'est pas accessible en écriture : " . $this->cacheDir);
            $this->enabled = false;
            return;
        }
        
        $this->lastCheck = $this->getLastCheckTime();
    }

    // Ajout de getters publics
    public function getCurrentVersion() {
        return $this->currentVersion;
    }

    public function getUpdateUrl() {
        return $this->updateUrl;
    }

    public function isEnabled() {
        return $this->enabled;
    }

    public function getCheckInterval() {
        return $this->checkInterval;
    }

    public function getLastCheck() {
        return $this->lastCheck;
    }

    public function getVersionInfo() {
        return $this->versionInfo;
    }

    /**
     * Check if an update is available
     * @return array|null Update information or null if no update available
     */
    public function checkForUpdates() {
        // Return null if updates are disabled
        if (!$this->enabled) {
            return null;
        }

        // Check if we need to perform a new check
        if (!$this->shouldCheck()) {
            return $this->getCachedUpdateInfo();
        }

        try {
            $latestVersion = $this->fetchLatestVersion();
            $this->updateLastCheckTime();

            if ($this->isNewerVersion($latestVersion)) {
                $updateInfo = [
                    'available' => true,
                    'current_version' => $this->currentVersion,
                    'latest_version' => $latestVersion,
                    'update_url' => $this->updateUrl,
                    'last_check' => time()
                ];
                $this->cacheUpdateInfo($updateInfo);
                return $updateInfo;
            }
        } catch (Exception $e) {
            error_log("Update check failed: " . $e->getMessage());
        }

        return null;
    }

    /**
     * Fetch the latest version from the remote version.php (raw GitHub)
     * @return string Latest version number
     */
    private function fetchLatestVersion() {
        $url = 'https://raw.githubusercontent.com/Erreur32/LogviewR/refs/heads/main/version.php';
        $context = stream_context_create([
            'http' => [
                'timeout' => 5,
                'user_agent' => 'LogviewR-UpdateChecker'
            ]
        ]);
        $raw = @file_get_contents($url, false, $context);
        if ($raw === false) {
            throw new Exception('Unable to fetch remote version.php');
        }
        // Extract the $versionInfo array from the remote PHP file
        if (preg_match('/\$versionInfo\s*=\s*(\[.*?\]);/s', $raw, $matches)) {
            $arrayCode = $matches[1];
            // Convert PHP array syntax to PHP array (for eval)
            $arrayCode = str_replace(['array (', ')'], ['[', ']'], $arrayCode);
            $arrayCode = preg_replace('/=>/', '=>', $arrayCode);
            try {
                eval('$remote = ' . $arrayCode . ';');
                if (isset($remote['version'])) {
                    return $remote['version'];
                } else {
                    throw new Exception('No version found in remote version.php');
                }
            } catch (Throwable $e) {
                throw new Exception('Error parsing remote version.php: ' . $e->getMessage());
            }
        } else {
            throw new Exception('Could not extract versionInfo from remote version.php');
        }
    }

    /**
     * Compare version numbers
     * @param string $version Version to compare
     * @return bool True if the version is newer
     */
    private function isNewerVersion($version) {
        return version_compare($version, $this->currentVersion, '>');
    }

    /**
     * Check if we should perform a new version check
     * @return bool
     */
    private function shouldCheck() {
        return (time() - $this->lastCheck) > $this->checkInterval;
    }

    /**
     * Get the last check time from cache
     * @return int Timestamp
     */
    private function getLastCheckTime() {
        $cacheFile = $this->getCacheFile();
        if (file_exists($cacheFile)) {
            $data = json_decode(file_get_contents($cacheFile), true);
            return $data['last_check'] ?? 0;
        }
        return 0;
    }

    /**
     * Update the last check time in cache
     */
    private function updateLastCheckTime() {
        $cacheFile = $this->getCacheFile();
        $data = [
            'last_check' => time()
        ];
        file_put_contents($cacheFile, json_encode($data));
    }

    /**
     * Cache update information
     * @param array $updateInfo Update information to cache
     */
    private function cacheUpdateInfo($updateInfo) {
        $cacheFile = $this->getCacheFile();
        file_put_contents($cacheFile, json_encode($updateInfo));
    }

    /**
     * Get cached update information
     * @return array|null Cached update information
     */
    private function getCachedUpdateInfo() {
        $cacheFile = $this->getCacheFile();
        if (file_exists($cacheFile)) {
            $data = json_decode(file_get_contents($cacheFile), true);
            if (isset($data['available']) && $data['available']) {
                return $data;
            }
        }
        return null;
    }

    /**
     * Get the cache file path
     * @return string Cache file path
     */
    private function getCacheFile() {
        return $this->cacheDir . '/' . $this->cacheFile;
    }

    /**
     * Always fetch the remote version (even if not newer)
     * @return string|null
     */
    public function getRemoteVersion() {
        try {
            return $this->fetchLatestVersion();
        } catch (Exception $e) {
            return null;
        }
    }
} 