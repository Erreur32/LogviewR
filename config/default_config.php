<?php
/**
 * Default configuration file for LogviewR
 * DO NOT MODIFY THIS FILE! Create a config.php file instead.
 */

return [
    // Application settings
    'app_name' => 'LogviewR',
    'timezone' => 'Europe/Paris',
    'locale' => 'fr_FR',
    
    // Debug settings
    'debug' => [
        'enabled' => false,
        'log_file' => __DIR__ . '/../logs/debug.log',
        'log_level' => 'INFO'  // DEBUG, INFO, WARNING, ERROR
    ],
    
    // Security settings
    'security' => [
        'allowed_ips' => ['127.0.0.1', '::1'],  // localhost IPv4 and IPv6
        'session_lifetime' => 3600,  // 1 hour
        'max_login_attempts' => 5
    ],
    
    // Display settings
    'display' => [
        'lines_per_page' => 100,
        'date_format' => 'Y-m-d H:i:s',
        'refresh_interval' => 30,  // seconds
        'theme' => 'light'  // light or dark
    ],
    
    // Log file settings
    'logs' => [
        'directory' => __DIR__ . '/../logs',
        'max_file_size' => 10485760,  // 10MB
        'retention_days' => 30
    ]
]; 