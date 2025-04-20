<?php
/**
 * Default configuration file
 * Contains all default settings and patterns
 * Used as a base configuration that can be overridden by config.php and log_patterns.php
 */

return [
    'debug' => [
        'enabled' => false,
        'log_format' => '[%timestamp%] [%level%] %message%',
        'timestamp_format' => 'Y-m-d H:i:s.u T',
        'log_level' => 'DEBUG',
        'log_to_apache' => false
    ],
    'app' => [
        'max_execution_time' => 30,
        'max_lines_per_request' => 20000,
        'default_lines_per_page' => 100,
        'refresh_interval' => 6000,
        'excluded_extensions' => ['gz', 'zip', 'tar', 'rar', '7z', 'bz2', 'xz']
    ],
    'paths' => [
        'apache_logs' => '/var/log/apache2',
        'nginx_logs' => '/var/log/nginx',
        'syslog' => '/var/log'
    ],
    'date_formats' => [
        'display' => 'd/m/Y H:i:s'
    ],
    'themes' => [
        'light' => [
            'primary_color' => '#3498db',
            'text_color' => '#333333',
            'bg_color' => '#ffffff'
        ],
        'dark' => [
            'primary_color' => '#3498db',
            'text_color' => '#ffffff',
            'bg_color' => '#1a1a1a'
        ]
    ],
    'theme' => 'dark',
    'filters' => [
        'exclude' => [
            'ips' => [
                '/^192\.168\.1\.(10|50)$/',
                '/^127\.0\.0\.1$/',
                '/^10\.0\.0\.[1-2]$/',
                '/^192\.168\.1\.(150|254)$/',
                '/^212\.203\.103\.210$/',
                '/^188\.165\.194\.218$/'
            ],
            'requests' => [
                '/server-status\?auto/',
                '/favicon\.ico/',
                '/\.(jpg|png|gif|css|js)$/',
                '/robots\.txt/'
            ],
            'user_agents' => [
                '/bot/',
                '/crawler/',
                '/spider/',
                '/wget/',
                '/curl/',
                '/munin/'
            ],
            'users' => [
                '/^Erreur32$/',
                '/^(bot|crawler|spider)$/'
            ],
            'referers' => [
                '/^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.1\.150)/'
            ],
            'content' => []
        ]
    ]
]; 