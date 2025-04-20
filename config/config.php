<?php
return array (
  'debug' => 
  array (
    'enabled' => false,
    'log_format' => '[%timestamp%] [%level%] %message%',
    'timestamp_format' => 'Y-m-d H:i:s.u T',
    'log_level' => 'ERROR',
    'log_to_apache' => false,
  ),
  'app' => 
  array (
    'max_execution_time' => 30,
    'max_lines_per_request' => 20000,
    'default_lines_per_page' => 100,
    'refresh_interval' => 6000,
    'excluded_extensions' => 
    array (
      0 => 'gz',
      1 => 'zip',
      2 => 'tar',
      3 => 'rar',
      4 => '7z',
      5 => 'bz2',
      6 => 'xz',
    ),
  ),
  'paths' => 
  array (
    'apache_logs' => '/var/log/apache2',
    'npm_logs' => '/var/log/npm',
    'nginx_logs' => '/var/log/nginx',
    'syslog' => '/var/log',
  ),
  'date_formats' => 
  array (
    'display' => 'd/m/Y H:i:s',
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
  'nginx' => 
  array (
    'enabled' => false,
    'use_npm' => true,
  ),
);
