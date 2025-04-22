<?php
// Auto-generated file - Do not modify manually
// Generation date: 2025-04-22 12:25:56
return array (
  'debug' => 
  array (
    'enabled' => false,
    'log_format' => '[%timestamp%] [%level%] %message%',
    'timestamp_format' => 'Y-m-d H:i:s.u T',
    'log_level' => 'DEBUG',
    'log_to_apache' => false,
    'log_file' => __DIR__ . '/../logs/debug.log',
  ),
  'timezone' => 'Europe/Paris',
  'date_formats' => 
  array (
    'display' => 'd/m/Y H:i:s',
    'log' => 'Y-m-d H:i:s',
    'input' => 'Y-m-d',
  ),
  'app' => 
  array (
    'max_execution_time' => 30,
    'max_lines_per_request' => 20032,
    'default_lines_per_page' => 32,
    'refresh_interval' => 32,
    'excluded_extensions' => 
    array (
      0 => 'gz',
      1 => 'zip',
      2 => 'tar',
      3 => 'rar',
      4 => '7z',
      5 => 'bz2',
      6 => 'xz',
      7 => 'bak',
    ),
  ),
  'paths' => 
  array (
    'apache_logs' => '/var/log/apache2',
    'nginx_logs' => '/var/log/nginx2',
    'npm_logs' => '/var/log/npm',
    'syslog' => '/var/log',
  ),
  'nginx' => 
  array (
    'use_npm' => true,
  ),
  'filters' => 
  array (
    'exclude' => 
    array (
      'ips' => 
      array (
        0 => '/^192\\.168\\.1\\.(10|50)$/',
        1 => '/^127\\.0\\.0\\.1$/',
        2 => '/^10\\.0\\.0\\.[1-2]$/',
        3 => '/^192\\.168\\.1\\.(150|254)$/',
        4 => '/^212\\.203\\.103\\.210$/',
        5 => '/^188\\.165\\.194\\.218$/',
      ),
      'requests' => 
      array (
        0 => '/server-status\\?auto/',
        1 => '/favicon\\.ico/',
        2 => '/\\.(jpg|png|gif|css|js)$/',
        3 => '/robots\\.txt/',
      ),
      'user_agents' => 
      array (
        0 => '/bot/',
        1 => '/crawler/',
        2 => '/spider/',
        3 => '/wget/',
        4 => '/curl/',
        5 => '/munin/',
      ),
      'users' => 
      array (
        0 => '/^Erreur32$/',
        1 => '/^(bot|crawler|spider)$/',
      ),
      'referers' => 
      array (
        0 => '/^https?:\\/\\/(localhost|127\\.0\\.0\\.1|192\\.168\\.1\\.150)/',
      ),
      'content' => 
      array (
      ),
    ),
  ),
  'themes' => 
  array (
    'light' => 
    array (
      'primary_color' => '#3498db',
      'text_color' => '#333333',
      'bg_color' => '#ffffff',
    ),
    'dark' => 
    array (
      'primary_color' => '#3498db',
      'text_color' => '#ffffff',
      'bg_color' => '#1a1a1a',
    ),
  ),
  'theme' => 'dark',
);
