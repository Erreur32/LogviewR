# LogviewR 📊

Un visualiseur de logs old school pour Apache, Nginx, NPM et Syslog.

## Fonctionnalités Principales ✨

- **Support Multi-Format** 🎯
  - Logs Apache (access, error, 404)
  - Logs Nginx (access, error)
  - Logs NPM (Proxy Host, Default Host, Dead Host, Fallback)
  - Logs Syslog (auth, kern, daemon, etc.)

- **Interface Moderne** 🎨
  - Thème sombre/clair
  - Design responsive
  - Auto-rafraîchissement des logs
  - Filtres dynamiques
  - Affichage optimisé des données

- **Parsing Intelligent** 🧠
  - Détection automatique des types de logs
  - Support des noms de domaine personnalisés
  - Filtrage avancé
  - Formatage intelligent des données

- **Administration** 🔒
  - Interface d'administration sécurisée
  - Gestion des patterns de logs
  - Configuration des sources
  - Monitoring en temps réel

## Installation 🚀

1. Cloner le dépôt :
```bash
git clone https://github.com/votre-utilisateur/LogviewR.git
cd LogviewR
```
 
 
2. Configurer le serveur web :
```apache
<VirtualHost *:80>
    ServerName logviewr.local
    DocumentRoot /chemin/vers/LogviewR
    <Directory /chemin/vers/LogviewR>
        AllowOverride All
        Require all granted
    </Directory>
</VirtualHost>
```

## Configuration ⚙️

### Fichiers de Configuration
- `config/config.php` : Configuration générale
- `config/log_patterns.php` : Patterns de logs
- `config/admin.php` : Configuration admin

### Options Principales
```php
return [
    'app' => [
        'excluded_extensions' => ['gz', 'zip', 'tar'],
        'max_execution_time' => 300,
        'default_lines_per_page' => 25,
        'refresh_interval' => 1000
    ],
    'paths' => [
        'apache_logs' => '/var/log/apache2',
        'nginx_logs' => '/var/log/nginx',
        'npm_logs' => '/var/log/npm',
        'syslog' => '/var/log'
    ],
    'nginx' => [
        'use_npm' => false
    ]
];
```

## Utilisation 📝

1. **Accès à l'Interface**
   - Ouvrir `http://votre-domaine/` dans votre navigateur
   - Se connecter avec les identifiants admin

2. **Visualisation des Logs**
   - Sélectionner le type de log (Apache/Nginx/NPM/Syslog)
   - Choisir le fichier de log
   - Utiliser les filtres pour affiner les résultats

3. **Administration**
   - Accéder à `http://votre-domaine/admin/`
   - Configurer les patterns de logs
   - Gérer les sources de logs

## Contribution 👥

Les contributions sont les bienvenues ! Voici comment contribuer :

1. Fork le projet
2. Créer une branche (`git checkout -b feature/AmazingFeature`)
3. Commit les changements (`git commit -m 'Add some AmazingFeature'`)
4. Push vers la branche (`git push origin feature/AmazingFeature`)
5. Ouvrir une Pull Request

## Licence 📄

Ce projet est sous licence MIT. Voir [LICENSE](LICENSE) pour plus de détails.

## Support 🆘

Pour toute question ou problème :
- Ouvrir une issue sur GitHub
- Consulter la [documentation](DEVELOPMENT.md)
- Contacter l'équipe de développement

## Versions 🔄

### Version 1.3.0 (En cours)
- Amélioration de la détection des types de logs
- Optimisation du parsing des logs
- Correction des problèmes de performance
- Amélioration de la gestion des filtres
- Support des logs avec noms de domaine personnalisés
- Correction des bugs de l'interface

### Version 1.2.0
- Support complet des logs NPM
- Amélioration de la détection des types de logs
- Optimisation de l'interface utilisateur
- Auto-rafraîchissement des logs
- Support des noms de domaine personnalisés

### Version 1.1.0
- Thème sombre/clair
- Interface responsive
- Optimisation des performances
- Correction des bugs

### Version 1.0.0
- Version initiale
- Support des logs Apache, Nginx et Syslog
- Interface utilisateur de base
- Système d'authentification 