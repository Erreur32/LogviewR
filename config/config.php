<?php
return array (
  'debug' => 
  array (
    'enabled' => false,
    'log_level' => 'ERROR',
  ),
  'app' => 
  array (
    'max_execution_time' => 120,
    'max_lines_per_request' => 1000,
    'default_lines_per_page' => 25,
    'refresh_interval' => 1200,
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
    'nginx_logs' => '/var/log/nginx',
    'syslog' => '/var/log',
  ),
  'nginx' => 
  array (
    'use_npm' => true,
  ),
  'date_formats' => 
  array (
    'display' => 'd/m/Y H:i:s',
    'file' => 'Y-m-d H:i:s',
  ),
  'timezone' => 'Europe/Paris',
  'theme' => 'dark',
);
