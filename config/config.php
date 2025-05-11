<?php
/**
 * Default configuration file
 * Contains all default settings and patterns
 * Used as a base configuration that can be overridden by config.user.php
 */

return [
    'timezone' => 'Europe/Paris',
    'date_formats' => [
        'display' => 'd/m/Y H:i:s',
        'log' => 'Y-m-d H:i:s',
        'input' => 'Y-m-d',
    ],
    'app' => [
        'max_lines_per_request' => 10000,
        'default_lines_per_page' => 25,
        'refresh_interval' => 15,
        'excluded_extensions' => [
            '.gz',
            '.zip',
            '.tar',
            '.rar',
            '.7z',
            '.bz2',
            '.xz'
        ],
    ],
    'paths' => [
        'apache_logs' => '/var/log/apache2',
        'nginx_logs' => '/var/log/nginx',
        'npm_logs' => '/var/log/npm',
        'syslog' => '/var/log',
    ],
    'nginx' => [
        'use_npm' => false,
    ],
    'theme' => 'dark',
    'themes' => [
        'light' => [
            'primary_color' => '#3498db',
            'text_color' => '#333333',
            'bg_color' => '#ffffff',
        ],
        'dark' => [
            'primary_color' => '#3498db',
            'text_color' => '#ffffff',
            'bg_color' => '#1a1a1a',
        ],
        'glass' => [
            'primary_color' => '#6a85b6',
            'text_color' => '#e0e6ed',
            'bg_color' => '#232526',
            'accent_color' => '#b993d6',
        ],        
    ],

    'filters' => [
        'enabled' => false,
        'exclude' => [
            'ips' => [
                '/^192\.168\.(0|1)\.(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-4])$/',
                '/^127\.0\.0\.1$/',
                '/^10\.0\.0\.[1-9]$/',
            ],
            'requests' => [
                '/favicon\.ico/',
                '/robots\.txt/',
                '/\.(jpg|png|gif|css|js)$/',
            ],
            'user_agents' => [
                '/bot/',
                '/crawler/',
                '/spider/',
                '/wget/',
                '/curl/',
            ],
            'users' => [
                '/^Admin$/',
                '/^(bot|crawler|spider)$/',
            ],
            'referers' => [
                '/^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.1\.150)/',
            ],
            'content' => [],
        ],
    ],
];
