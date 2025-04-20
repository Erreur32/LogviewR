# Guide de Développement LogviewR 🛠️

## État du Projet 📊

### Fonctionnalités Implémentées ✅
- Parsing de base des logs Apache, Nginx et Syslog
- Interface utilisateur de base avec thème sombre/clair
- Système d'authentification
- Filtrage simple des logs
- Configuration des patterns de logs
- Support des logs NPM (Nginx Proxy Manager)
- Amélioration de la détection des types de logs
- Interface responsive et moderne
- Auto-rafraîchissement des logs
- Gestion des filtres dynamiques

### Fonctionnalités en Cours de Développement 🚧
1. **Amélioration du Parsing**
   - Support de nouveaux formats de logs
   - Optimisation des performances
   - Meilleure gestion des erreurs
   - Support des logs avec noms de domaine personnalisés

2. **Interface Utilisateur**
   - Amélioration de la réactivité
   - Ajout de graphiques et statistiques
   - Export avancé des données
   - Optimisation de l'affichage des filtres

3. **Administration**
   - Gestion des rôles utilisateurs
   - Configuration avancée des sources
   - Monitoring en temps réel
   - Backup automatique

4. **Sécurité**
   - Implémentation de 2FA
   - Audit logging avancé
   - Protection contre les attaques DDoS
   - Chiffrement des données sensibles

## Architecture Technique 🏗️

### Structure des Parsers
```
parsers/
├── BaseParser.php        # Classe de base pour tous les parsers
├── ApacheParser.php      # Parser pour les logs Apache
├── NginxParser.php       # Parser pour les logs Nginx
├── SyslogParser.php      # Parser pour les logs Syslog
├── NPMProxyHostParser.php # Parser pour les logs NPM Proxy Host
├── NPMDefaultHostParser.php # Parser pour les logs NPM Default Host
├── NPMDeadHostParser.php # Parser pour les logs NPM Dead Host
├── NPMFallbackParser.php # Parser pour les logs NPM Fallback
└── ParserFactory.php     # Factory pour la création des parsers
```

### Flux d'Exécution 🔄

### Chaîne d'Appel
```
script.php
├── Réception fichier ($_POST['logfile'])
├── Chargement configurations
│   ├── config.php
│   └── log_patterns.php
│
├── ParserFactory
│   ├── detectLogType($logfile) → "apache-access" | "npm-proxy-host-access" | etc.
│   └── getParser($logType) → new AppropriateParser
│
└── Traitement du fichier
    ├── Lecture ligne par ligne
    └── Pour chaque ligne
        └── parser->parse($line)
            ├── Applique le pattern spécifique
            ├── Extrait les données
            └── Retourne le résultat formaté
```

### Responsabilités
1. **script.php**
   - Point d'entrée
   - Gestion du fichier
   - Orchestration du parsing
   - Gestion de l'auto-rafraîchissement

2. **ParserFactory**
   - Détection du type de log
   - Support des logs NPM
   - Instanciation du parser approprié
   - Gestion des configurations

3. **BaseParser**
   - Chargement des patterns/filtres
   - Formatage commun (badges, colonnes)
   - Méthodes utilitaires
   - Support des filtres dynamiques

4. **Parsers Spécifiques**
   - Patterns spécifiques
   - Colonnes spécifiques
   - Héritent du formatage commun
   - Support des logs avec noms de domaine

### Points d'Attention ⚠️
1. **Performance**
   - Optimiser le parsing des gros fichiers
   - Mettre en cache les résultats
   - Utiliser des index pour la recherche

2. **Sécurité**
   - Valider toutes les entrées utilisateur
   - Sanitizer les données avant affichage
   - Implémenter des timeouts

3. **Maintenabilité**
   - Documenter le code
   - Ajouter des tests unitaires
   - Suivre les standards de codage

## Configuration des Patterns 🎯

### Structure des Patterns
```php
return array (
  'filters' => array (
    'exclude' => array (
      'ips' => array (
        // Patterns pour filtrer les IPs
        '/^192\\.168\\.1\\.(10|50)$/',
        '/^127\\.0\\.0\\.1$/',
        '/^10\\.0\\.0\\.1$/',
        '/^10\\.0\\.0\\.2$/',
        '/^192\\.168\\.1\\.150$/',
        '/^192\\.168\\.1\\.254$/',
        '/^212\\.203\\.103\\.210$/',
        '/^188\\.165\\.194\\.218$/'
      ),
      'requests' => array (
        // Patterns pour filtrer les requêtes
        '/server-status\\?auto/',
        '/favicon\\.ico/',
        '/\\.(jpg|png|gif|css|js)$/',
        '/robots\\.txt/'
      ),
      'user_agents' => array (
        // Patterns pour filtrer les user agents
        '/bot/',
        '/crawler/',
        '/spider/',
        '/wget/',
        '/curl/',
        '/munin/'
      ),
      'users' => array (
        // Patterns pour filtrer les utilisateurs
        '/^Erreur32$/',
        '/^bot$/',
        '/^crawler$/',
        '/^spider$/'
      ),
      'referers' => array (
        // Patterns pour filtrer les referers
        '/^https?:\\/\\/localhost/',
        '/^https?:\\/\\/127\\.0\\.0\\.1/',
        '/^https?:\\/\\/192\\.168\\.1\\.150/'
      )
    )
  ),
  'apache' => array (
    'access' => array (
      // Pattern pour les logs Apache access
      'pattern' => '/^([^:]+):(\\d+)\\s+(\\S+)\\s+(\\S+)\\s+(\\S+)\\s+\\[([^\\]]+)\\]\\s+"([^"]+)"\\s+(\\d{3})\\s+(\\d+|-)\\s+"([^"]*)"\\s+"([^"]*)"/',
      'columns' => array (
        'date' => array (
          'name' => 'Date',
          'class' => 'column-date'
        ),
        'host' => array (
          'name' => 'Host:Port',
          'class' => 'column-host'
        ),
        'ip' => array (
          'name' => 'IP',
          'class' => 'column-ip'
        ),
        'user' => array (
          'name' => 'User',
          'class' => 'column-user'
        ),
        'request' => array (
          'name' => 'Request',
          'class' => 'column-request'
        ),
        'status' => array (
          'name' => 'Status',
          'class' => 'column-status'
        ),
        'size' => array (
          'name' => 'Size',
          'class' => 'column-size'
        ),
        'referer' => array (
          'name' => 'Referer',
          'class' => 'column-referer'
        ),
        'user_agent' => array (
          'name' => 'User-Agent',
          'class' => 'column-user-agent'
        )
      )
    ),
    'error' => array (
      // Pattern pour les logs Apache error
      'pattern' => '/^\\[(.*?)\\] \\[([^:]+):([^\\]]+)\\] (?:\\[pid (\\d+)(?::tid (\\d+))?\\])?(?: \\[client ([^\\]]+)\\])? (.*)$/',
      'columns' => array (
        'timestamp' => array (
          'name' => 'Timestamp',
          'class' => 'column-timestamp'
        ),
        'type' => array (
          'name' => 'Type',
          'class' => 'column-type'
        ),
        'process' => array (
          'name' => 'Process',
          'class' => 'column-process'
        ),
        'client' => array (
          'name' => 'Client',
          'class' => 'column-client'
        ),
        'message' => array (
          'name' => 'Message',
          'class' => 'column-message'
        )
      )
    ),
    '404_only' => array (
      // Pattern pour les logs 404
      'pattern' => '/^(\\S+)(?::(\\d+))?\\s+(\\S+),\\s+(\\S+)\\s+\\S+\\s+\\S+\\s+\\[([^\\]]+)\\]\\s+"([^"]*?)"\\s+404\\s+(\\d+|-)(?:\\s+"([^"]*)")?(?:\\s+"([^"]*)")?/',
      'columns' => array (
        'host' => array (
          'name' => 'Host',
          'class' => 'column-host'
        ),
        'ip' => array (
          'name' => 'IP',
          'class' => 'column-ip'
        ),
        'real_ip' => array (
          'name' => 'Real IP',
          'class' => 'column-real-ip'
        ),
        'date' => array (
          'name' => 'Date',
          'class' => 'column-date'
        ),
        'request' => array (
          'name' => 'Request',
          'class' => 'column-request'
        ),
        'size' => array (
          'name' => 'Size',
          'class' => 'column-size'
        ),
        'referer' => array (
          'name' => 'Referer',
          'class' => 'column-referer'
        ),
        'user_agent' => array (
          'name' => 'User-Agent',
          'class' => 'column-user-agent'
        )
      )
    )
  ),
  'nginx' => array (
    'access' => array (
      // Pattern pour les logs Nginx access
      'pattern' => '/^(\\S+) - \\S+ \\[([^\\]]+)\\] "(.*?)" (\\d{3}) (\\d+) "(.*?)" "(.*?)"$/',
      'alt_pattern' => '/^(\\S+) - \\S+ \\[([^\\]]+)\\] "(.*?)" (\\d{3}) (\\d+)$/',
      'columns' => array (
        'ip' => array (
          'name' => 'IP',
          'class' => 'column-ip'
        ),
        'date' => array (
          'name' => 'Date',
          'class' => 'column-date'
        ),
        'request' => array (
          'name' => 'Requête',
          'class' => 'column-request'
        ),
        'code' => array (
          'name' => 'Code',
          'class' => 'column-code'
        ),
        'size' => array (
          'name' => 'Taille',
          'class' => 'column-size'
        ),
        'referer' => array (
          'name' => 'Referer',
          'class' => 'column-referer'
        ),
        'user_agent' => array (
          'name' => 'User-Agent',
          'class' => 'column-user-agent'
        )
      )
    ),
    'error' => array (
      // Pattern pour les logs Nginx error
      'pattern' => '/^(\\d{4}/\\d{2}/\\d{2} \\d{2}:\\d{2}:\\d{2}) \\[(\\w+)\\] (\\d+)#\\d+: (.*)$/',
      'alt_pattern' => '/^(\\d{4}/\\d{2}/\\d{2} \\d{2}:\\d{2}:\\d{2}) \\[(\\w+)\\] (.*)$/',
      'columns' => array (
        'date' => array (
          'name' => 'Date',
          'class' => 'column-date'
        ),
        'level' => array (
          'name' => 'Level',
          'class' => 'column-level'
        ),
        'pid' => array (
          'name' => 'PID',
          'class' => 'column-pid'
        ),
        'message' => array (
          'name' => 'Message',
          'class' => 'column-message'
        )
      )
    )
  )
);
```

### Guide d'Utilisation des Patterns 📝

1. **Format des Patterns** 🎯
   - Utiliser des expressions régulières valides
   - Toujours commencer par `/` et finir par `/`
   - Échapper les caractères spéciaux avec `\\`
   - Utiliser des groupes nommés pour une meilleure lisibilité

2. **Types de Patterns** 🔍
   - **Filtres** : Pour exclure des lignes spécifiques
   - **Parsing** : Pour extraire les données des logs
   - **Validation** : Pour vérifier le format des données

3. **Exemples de Patterns** 💡
   ```php
   // Pattern pour une IP
   '/^192\\.168\\.1\\.\\d{1,3}$/'
   
   // Pattern pour une requête HTTP
   '/^(GET|POST|PUT|DELETE)\\s+\\S+\\s+HTTP\\/\\d\\.\\d$/'
   
   // Pattern pour une date Apache
   '/\\[(\\d{2}\\/\\w{3}\\/\\d{4}:\\d{2}:\\d{2}:\\d{2} [+-]\\d{4})\\]/'
   ```

4. **Bonnes Pratiques** ✅
   - Tester les patterns avant de les déployer
   - Documenter chaque pattern
   - Utiliser des commentaires pour expliquer les groupes
   - Maintenir une liste de patterns testés

5. **Dépannage** 🐛
   - Vérifier la syntaxe des expressions régulières
   - Tester avec des exemples réels
   - Utiliser des outils de test de regex
   - Consulter les logs d'erreur

### Interface d'Administration 🖥️

1. **Onglet Patterns** 📊
   - Liste des patterns actifs
   - Édition en ligne
   - Test des patterns
   - Historique des modifications

2. **Validation** ✅
   - Vérification de la syntaxe
   - Test avec des exemples
   - Suggestions d'amélioration
   - Rapports d'erreur

3. **Gestion des Versions** 🔄
   - Sauvegarde automatique
   - Historique des modifications
   - Restauration des versions
   - Comparaison des versions

4. **Sécurité** 🔒
   - Validation des entrées
   - Protection contre les injections
   - Audit des modifications
   - Backup automatique

### Exemple de Parser Fonctionnel : Apache Access Log 🔍

### Structure du Parser Apache Access
```php
class ApacheAccessParser extends BaseParser {
    // Pattern regex avec groupes nommés pour une extraction flexible
    private const PATTERN = '/^(?P<ip>\S+) (?P<user>\S+) (?P<auth>\S+) \[(?P<date>[^\]]+)\] "(?P<request>[^"]*)" (?P<status>\d{3}) (?P<size>\d+) "(?P<referer>[^"]*)" "(?P<user_agent>[^"]*)"$/';
    
    // Configuration des colonnes avec métadonnées
    private const COLUMN_CONFIG = [
        'ip' => [
            'name' => 'IP',
            'class' => 'column-ip',
            'type' => 'string',
            'filterable' => true,
            'sortable' => true
        ],
        'user' => [
            'name' => 'User',
            'class' => 'column-user',
            'type' => 'string',
            'filterable' => true,
            'sortable' => true
        ],
        // ... autres colonnes avec leurs configurations
    ];

    /**
     * Génère dynamiquement les colonnes basées sur le pattern
     */
    public function generateColumns() {
        $columns = [];
        if (preg_match_all('/\(\?P<([^>]+)>[^)]+\)/', self::PATTERN, $matches)) {
            foreach ($matches[1] as $columnName) {
                $columns[$columnName] = self::COLUMN_CONFIG[$columnName] ?? [
                    'name' => ucfirst(str_replace('_', ' ', $columnName)),
                    'class' => 'column-' . $columnName,
                    'type' => 'string',
                    'filterable' => true,
                    'sortable' => true
                ];
            }
        }
        return $columns;
    }

    /**
     * Parse une ligne de log avec extraction dynamique
     */
    public function parse($line) {
        if (preg_match(self::PATTERN, $line, $matches)) {
            $data = [];
            foreach ($this->generateColumns() as $column => $config) {
                if (isset($matches[$column])) {
                    $data[$column] = $this->formatValue($matches[$column], $config['type']);
                }
            }
            return $data;
        }
        return null;
    }

    /**
     * Formate la valeur selon son type
     */
    private function formatValue($value, $type) {
        switch ($type) {
            case 'integer':
                return (int) $value;
            case 'date':
                return $this->formatDate($value);
            case 'size':
                return $this->formatSize($value);
            default:
                return trim($value);
        }
    }
}
```

### Fonctionnement du Parser 🛠️

1. **Pattern Matching Dynamique** 🎯
   - Utilisation de groupes nommés dans la regex
   - Extraction automatique des noms de colonnes
   - Support de différents formats de date

2. **Génération des Colonnes** 📊
   ```php
   // Exemple d'utilisation
   $parser = new ApacheAccessParser();
   $columns = $parser->generateColumns();
   
   // Résultat :
   [
       'ip' => [
           'name' => 'IP',
           'class' => 'column-ip',
           'type' => 'string',
           'filterable' => true,
           'sortable' => true
       ],
       // ... autres colonnes générées
   ]
   ```

3. **Formatage Intelligent** ✨
   - Détection automatique des types de données
   - Conversion appropriée selon le type
   - Support de formats personnalisés

4. **Filtrage Flexible** 🔍
   ```php
   public function filter($data, $filters) {
       foreach ($filters as $field => $filter) {
           if (!isset($data[$field])) {
               continue;
           }
           
           $columnConfig = $this->generateColumns()[$field] ?? null;
           if (!$columnConfig || !$columnConfig['filterable']) {
               continue;
           }
           
           if (!$this->applyFilter($data[$field], $filter, $columnConfig['type'])) {
               return false;
           }
       }
       return true;
   }
   ```

### Points Clés pour la Flexibilité 📝

1. **Configuration des Colonnes** 🏗️
   - Définition des métadonnées pour chaque colonne
   - Support de différents types de données
   - Options de filtrage et tri

2. **Extraction Dynamique** 🧩
   - Utilisation de groupes nommés dans la regex
   - Génération automatique des colonnes
   - Support de formats variables

3. **Formatage Adaptatif** 🔄
   - Conversion intelligente des types
   - Support de formats personnalisés
   - Gestion des erreurs

4. **Filtrage Évolutif** 🎯
   - Filtres basés sur le type de données
   - Support de conditions complexes
   - Extensibilité facile

### Exemple d'Utilisation Avancé 💡

```php
$parser = new ApacheAccessParser();

// Configuration personnalisée des colonnes
$customConfig = [
    'ip' => [
        'name' => 'Adresse IP',
        'type' => 'ip',
        'filterable' => true,
        'sortable' => true,
        'formatter' => function($value) {
            return long2ip(ip2long($value));
        }
    ],
    'date' => [
        'name' => 'Date et Heure',
        'type' => 'datetime',
        'format' => 'd/m/Y H:i:s',
        'filterable' => true,
        'sortable' => true
    ]
];

// Application de la configuration
$parser->setColumnConfig($customConfig);

// Parsing avec configuration personnalisée
$data = $parser->parse($line);

// Filtrage avancé
$filters = [
    'ip' => [
        'type' => 'range',
        'from' => '192.168.1.1',
        'to' => '192.168.1.255'
    ],
    'date' => [
        'type' => 'period',
        'from' => '2024-01-01',
        'to' => '2024-12-31'
    ]
];

if ($parser->filter($data, $filters)) {
    echo $parser->format($data);
}
```

Cette approche flexible permet :
- L'ajout facile de nouveaux types de logs
- La personnalisation des colonnes
- Le support de différents formats
- Une extensibilité simplifiée

## Changements Récents 🔄

### Version 1.3.0 (En cours)
- Amélioration de la détection des types de logs
- Optimisation du parsing des logs
- Correction des problèmes de performance
- Amélioration de la gestion des filtres
- Support des logs avec noms de domaine personnalisés
- Correction des bugs de l'interface
- Amélioration de la documentation
- Optimisation du code source

### Version 1.2.0
- Ajout du support complet des logs NPM
- Amélioration de la détection des types de logs
- Optimisation de l'interface utilisateur
- Ajout de l'auto-rafraîchissement
- Support des logs avec noms de domaine personnalisés
- Amélioration des filtres dynamiques
- Correction des problèmes de parsing

### Version 1.1.0
- Ajout du thème sombre/clair
- Amélioration de la réactivité
- Optimisation des performances
- Correction des bugs de parsing

### Version 1.0.0
- Version initiale
- Support des logs Apache, Nginx et Syslog
- Interface utilisateur de base
- Système d'authentification

## Guide de Contribution 👥

### Prérequis
- PHP 8.0+
- Composer
- MySQL/MariaDB
- Serveur web (Apache/Nginx)

### Étapes pour Contribuer
1. Fork le projet
2. Créer une branche (`git checkout -b feature/AmazingFeature`)
3. Commit les changements (`git commit -m 'Add some AmazingFeature'`)
4. Push vers la branche (`git push origin feature/AmazingFeature`)
5. Ouvrir une Pull Request

### Standards de Code 📝
- Suivre PSR-12
- Documenter les fonctions et classes
- Écrire des tests unitaires
- Utiliser des types stricts

## Tests 🧪

### Types de Tests
- Unitaires (PHPUnit)
- Fonctionnels
- Intégration
- Performance

### Exécution des Tests
```bash
# Installer les dépendances
composer install

# Exécuter les tests unitaires
./vendor/bin/phpunit

# Exécuter les tests de performance
php tests/performance.php
```

## Déploiement 🚀

### Environnements
- Développement
- Staging
- Production

### Checklist de Déploiement
- [ ] Tests passés
- [ ] Documentation à jour
- [ ] Backup de la base de données
- [ ] Vérification des permissions
- [ ] Mise à jour du CHANGELOG.md

## Documentation 📚

### À Documenter
- API endpoints
- Configuration avancée
- Patterns de logs personnalisés
- Plugins et extensions

### Outils de Documentation
- PHPDoc
- Markdown
- Swagger/OpenAPI

## Roadmap 🗺️

### Court Terme (1-2 mois)
- [ ] Amélioration de l'interface utilisateur
- [ ] Optimisation des performances
- [ ] Ajout de graphiques
- [ ] Support de nouveaux formats

### Moyen Terme (3-6 mois)
- [ ] API RESTful
- [ ] Plugins système
- [ ] Intégration avec des outils externes
- [ ] Système de notifications

### Long Terme (6+ mois)
- [ ] Architecture microservices
- [ ] Support multi-tenant
- [ ] Intelligence artificielle pour l'analyse
- [ ] Marketplace de plugins

## Support et Maintenance 🛠️

### Support
- Issues GitHub
- Documentation
- Forum communautaire

### Maintenance
- Mises à jour de sécurité
- Corrections de bugs
- Optimisations
- Nouvelles fonctionnalités

## Licence et Contribution 📄

Ce projet est sous licence MIT. Voir [LICENSE](LICENSE) pour plus de détails.

Pour contribuer, veuillez suivre les [guidelines de contribution](CONTRIBUTING.md). 