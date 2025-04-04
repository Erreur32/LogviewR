# LogviewR 🔍

Un visualiseur de logs moderne et intuitif pour Apache, Nginx, Nginx Proxy Manager et Syslog.

## Fonctionnalités ✨

- 📊 Interface moderne et responsive
- 🔄 Actualisation en temps réel
- 🎨 Thème sombre/clair avec transitions fluides
- 🔍 Filtres avancés et temps réel
- 📱 Compatible mobile
- 🛡️ Sécurisé avec authentification
- 🎯 Support multi-formats de logs
- 🎨 Badges colorés pour les statuts HTTP et méthodes
- 📦 Formatage intelligent des tailles de fichiers

## Installation 🚀

1. Clonez le dépôt :
```bash
git clone https://github.com/votre-username/LogviewR.git
```

2. Configurez les permissions :
```bash
chmod 755 /chemin/vers/LogviewR
chmod 664 /chemin/vers/LogviewR/config/*.php
```

3. Configurez votre serveur web (exemple Apache) :
```apache
<VirtualHost *:80>
    ServerName logview.example.com
    DocumentRoot /path/to/LogviewR
    
    <Directory /path/to/LogviewR>
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>
</VirtualHost>
```

## Configuration 🛠️

### Fichiers de logs supportés

- Apache Access Log
- Apache Error Log
- Nginx Access Log
- Nginx Error Log
- Nginx Proxy Manager Logs:
  - Default Host (Access/Error)
  - Dead Host (Access/Error)
  - Proxy Host (Access/Error)
  - Fallback (Access/Error)
- Syslog

### Exemple de configuration (config/log_patterns.php)

```php
return [
    'filters' => [
        'exclude' => [
            'ips' => [
                '/^192\.168\.1\.(10|50)$/',
                '/^127\.0\.0\.1$/'
            ],
            'requests' => [
                '/favicon\.ico/',
                '/\.(jpg|png|gif|css|js)$/',
                '/robots\.txt/'
            ],
            'user_agents' => [
                '/bot|crawler|spider/',
                '/monitoring/'
            ]
        ]
    ]
];
```

### Exemples de logs supportés

#### Apache Access Log
```
example.com:80 192.168.1.100 - user1 [01/Jan/2025:12:00:00 +0100] "GET /index.php HTTP/1.1" 200 1234 "http://example.com" "Mozilla/5.0"
```

#### Nginx Access Log
```
192.168.1.100 - - [01/Jan/2025:12:00:00 +0100] "GET /index.php HTTP/1.1" 200 1234 "http://example.com" "Mozilla/5.0"
```

#### Syslog
```
Jan 1 12:00:00 server1 process[123]: Message de log
```

## Interface d'administration 👨‍💼

- URL : `http://votre-serveur/LogviewR/admin`
- Identifiants par défaut :
  - Utilisateur : `admin`
  - Mot de passe : `password` (à changer lors de la première connexion)

## Sécurité 🔒

- Authentification requise pour l'interface d'administration
- Protection contre les injections SQL
- Protection XSS
- Rate limiting
- Validation des entrées
- Logs d'audit

## Contribution 🤝

Les contributions sont les bienvenues ! Voir [CONTRIBUTING.md](CONTRIBUTING.md) pour plus de détails.

## Licence 📄

Ce projet est sous licence MIT. Voir [LICENSE](LICENSE) pour plus de détails. 