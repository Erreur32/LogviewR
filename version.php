<?php
/**
 * Version information for LogviewR
 * This file is used to check for updates
 */

// Version information
$versionInfo = [
    'version' => '1.5.0', // ou '1.4.1'
    'release_date' => '2024-05-01',
    'changelog' => [
        '1.5.0' => [
            'date' => '2024-05-01',
            'changes' => [
                '🚧 Version de développement',
                '✨ Nouveau thème glassmorphism moderne',
                '🛠️ Correction de la gestion des tags GitHub',
                '🔒 Amélioration de la sécurité',
                '🧪 Refactoring du code admin',
                '📝 Documentation enrichie'
            ]
        ],    
         '1.4.1' => [
            'date' => '2024-04-22',
            'changes' => [
                '🐛 Correction du parsing des logs d\'erreur NPM Proxy Host',
                '🔧 Amélioration de la gestion des types de logs NPM',
                '✨ Meilleure détection des colonnes selon le type de log',
                '📝 Mise à jour de la documentation',
                '🎨 Réorganisation du code des parsers'
            ]
        ],
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
        ],
    ],
    'update_url' => 'https://github.com/Erreur32/LogviewR/tags',
    'api_url' => 'https://api.github.com/repos/Erreur32/LogviewR/tags',
    'update_check' => [
        'enabled' => true,
        'check_interval' => 86400, // 24 heures en secondes
        'cache_dir' => '/home/tools/Project/LogviewR/cache',
        'cache_file' => 'update_cache.json'
    ]
];

return $versionInfo; 