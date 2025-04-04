<?php
return [
    'admin' => [
        'username' => 'admin',
        'password' => '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // 'password' en hash
        'session_timeout' => 3600, // 1 heure
        'min_password_length' => 8,
        'require_special_chars' => true,
        'require_numbers' => true,
        'require_uppercase' => true
    ],
    'security' => [
        'max_login_attempts' => 5,
        'lockout_time' => 1800, // 30 minutes
        'password_history' => 5, // Nombre d'anciens mots de passe à conserver
        'password_expiry' => 90, // Jours avant expiration du mot de passe
    ]
]; 