<?php
return array (
  'admin' => 
  array (
    'username' => 'admin',
    'password' => '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    'session_timeout' => 3600,
    'min_password_length' => 8,
    'require_special_chars' => true,
    'require_numbers' => true,
    'require_uppercase' => true,
    'max_execution_time' => 300,
    'update_check' => 
    array (
      'enabled' => false,
    ),
    'remember_me' => true,
  ),
  'security' => 
  array (
    'max_login_attempts' => 5,
    'lockout_time' => 1800,
    'password_history' => 5,
    'password_expiry' => 90,
  ),
  'debug' => 
  array (
    'enabled' => false,
    'log_format' => '[%timestamp%] [%level%] %message%',
    'timestamp_format' => 'Y-m-d H:i:s.u T',
    'log_to_apache' => false,
    'log_file' => '/home/tools/Project/LogviewR_25_last/logs/debug.log',
    'require_login' => true,
  ),
);
