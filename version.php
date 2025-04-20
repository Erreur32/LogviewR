<?php
/**
 * Version information for LogviewR
 * This file is used to check for updates
 */

// Version information
$versionInfo = [
    'version' => '1.4.0', // 🎉 Nouvelle version majeure
    'release_date' => '2024-03-20',
    'changelog' => [
        '1.4.0' => [
            'date' => '2024-03-20',
            'changes' => [
                '✨ Nouveau système de mise à jour amélioré',
                '🔧 Optimisation des performances',
                '🎨 Amélioration de l\'interface utilisateur',
                '🛡️ Renforcement de la sécurité',
                '📝 Documentation mise à jour'
            ]
        ],
        '1.3.0' => [
            'date' => '2024-02-15',
            'changes' => [
                'Ajout du support complet des logs NPM',
                'Amélioration de l\'interface utilisateur',
                'Optimisation des performances'
            ]
        ]
    ],
    'update_url' => 'https://github.com/Erreur32/LogviewR/releases/latest',
    'api_url' => 'https://api.github.com/repos/Erreur32/LogviewR/releases/latest',
    'update_check' => [
        'enabled' => true,
        'check_interval' => 86400, // 24 heures en secondes
        'cache_dir' => '/home/tools/Project/LogviewR/cache',
        'cache_file' => 'update_cache.json'
    ]
];

return $versionInfo; 