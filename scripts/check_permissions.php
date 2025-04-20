<?php

class PermissionChecker {
    private $base_path;
    private $log_paths;

    public function __construct() {
        $this->base_path = dirname(__DIR__);
        $config = require $this->base_path . '/config/config.php';
        $this->log_paths = [
            'apache' => $config['paths']['apache_logs'] ?? '/var/log/apache2',
            'nginx' => $config['paths']['nginx_logs'] ?? '/var/log/nginx'
        ];
    }

    public function checkLogviewrPermissions() {
        $results = [
            'all_ok' => true,
            'details' => []
        ];

        // Vérification des fichiers principaux de LogviewR
        $core_files = [
            'index.php' => ['path' => $this->base_path . '/index.php', 'required' => '664'],
            'admin/index.php' => ['path' => $this->base_path . '/admin/index.php', 'required' => '664'],
            'config/config.php' => ['path' => $this->base_path . '/config/config.php', 'required' => '770'],
            'config/admin.php' => ['path' => $this->base_path . '/config/admin.php', 'required' => '770'],
            'config/log_patterns.php' => ['path' => $this->base_path . '/config/log_patterns.php', 'required' => '760']
        ];

        foreach ($core_files as $name => $info) {
            $current_perms = $this->getFilePermissions($info['path']);
            $is_ok = $current_perms === $info['required'];
            
            if (!$is_ok) {
                $results['all_ok'] = false;
            }

            $results['details'][$name] = [
                'path' => $info['path'],
                'current' => $current_perms,
                'required' => $info['required'],
                'ok' => $is_ok,
                'type' => 'core'
            ];
        }

        // Vérification des dossiers principaux
        $core_dirs = [
            'config' => ['path' => $this->base_path . '/config', 'required' => '770'],
            'admin' => ['path' => $this->base_path . '/admin', 'required' => '770'],
            'scripts' => ['path' => $this->base_path . '/scripts', 'required' => '770'],
            'assets' => ['path' => $this->base_path . '/assets', 'required' => '775']
        ];

        foreach ($core_dirs as $name => $info) {
            $current_perms = $this->getFilePermissions($info['path']);
            $is_ok = $current_perms === $info['required'];
            
            if (!$is_ok) {
                $results['all_ok'] = false;
            }

            $results['details'][$name] = [
                'path' => $info['path'],
                'current' => $current_perms,
                'required' => $info['required'],
                'ok' => $is_ok,
                'type' => 'directory'
            ];
        }

        return $results;
    }

    public function checkLogPathsPermissions() {
        $results = [
            'all_ok' => true,
            'details' => []
        ];

        foreach ($this->log_paths as $type => $path) {
            if (!file_exists($path)) {
                $results['details'][$type] = [
                    'path' => $path,
                    'exists' => false,
                    'readable' => false,
                    'type' => 'logs'
                ];
                $results['all_ok'] = false;
                continue;
            }

            $readable = is_readable($path);
            if (!$readable) {
                $results['all_ok'] = false;
            }

            $results['details'][$type] = [
                'path' => $path,
                'exists' => true,
                'readable' => $readable,
                'type' => 'logs'
            ];
        }

        return $results;
    }

    private function getFilePermissions($path) {
        return substr(sprintf('%o', fileperms($path)), -3);
    }

    public function generateFixCommands($results) {
        $commands = [];
        
        foreach ($results['details'] as $name => $info) {
            if (!$info['ok'] && isset($info['required'])) {
                $mode = $info['required'];
                $path = $info['path'];
                $commands[] = "chmod {$mode} \"{$path}\"";
            }
        }
        
        return $commands;
    }
} 