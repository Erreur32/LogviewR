# Changelog 📋

Toutes les modifications notables de ce projet seront documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/),
et ce projet adhère au [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.1] - 2024-04-22 🔧
### Corrigé
- 🐛 Correction du parsing des logs d'erreur NPM Proxy Host
- 🔧 Amélioration de la gestion des types de logs NPM
- ✨ Meilleure détection des colonnes selon le type de log
- 📝 Mise à jour de la documentation
- 🎨 Réorganisation du code des parsers

### Détails techniques
- Correction de la méthode `setType` dans `NPMProxyHostParser`
- Amélioration de la détection des types dans `ParserFactory`
- Réorganisation du code pour une meilleure maintenabilité
- Mise à jour des patterns de logs pour une meilleure compatibilité

## [1.4.0] - 2024-03-20 🎉
### Ajouté
- ✨ Nouveau système de mise à jour amélioré
- 🔧 Optimisation des performances
- 🎨 Amélioration de l'interface utilisateur
- 🛡️ Renforcement de la sécurité
- 📝 Documentation mise à jour

## [1.3.0] - 2024-04-02

### Ajouté ✨
- Support complet des logs Nginx Proxy Manager (NPM)
- Nouveaux patterns pour les logs NPM (default-host, dead-host, proxy-host, fallback)
- Système de badges colorés pour les méthodes HTTP et codes de statut
- Formatage intelligent des tailles de fichiers (B, KB, MB)
- Catégorisation automatique des fichiers de logs NPM

### Modifié 🔄
- Refonte complète du parser NPM pour une meilleure précision
- Amélioration de l'affichage des requêtes avec séparation méthode/URL/protocole
- Optimisation du traitement des dates et des IP
- Mise à jour du système de filtrage pour supporter les nouveaux formats NPM

### Corrigé 🐛
- Correction de l'affichage [object Object] dans les requêtes
- Résolution des problèmes d'ordre des colonnes
- Correction du formatage des badges de statut
- Amélioration de la gestion des logs vides ou incomplets

## [1.2.0] - 2024-03-31

### Ajouté ✨
- Interface d'administration sécurisée
- Support des filtres génériques pour tout type de contenu
- Nouveau thème sombre/clair avec transitions fluides
- Système de badges pour les statuts HTTP
- Support des logs avec ports dans les adresses IP

### Modifié 🔄
- Amélioration de la gestion des patterns d'exclusion
- Optimisation des performances de parsing
- Refonte de l'interface utilisateur pour plus de clarté
- Mise à jour du système de filtrage des IPs

### Corrigé 🐛
- Correction du bug d'affichage des dates dans certains fuseaux horaires
- Résolution du problème de filtrage des IPs avec ports
- Correction des problèmes de performance avec les grands fichiers de logs
- Amélioration de la stabilité du parsing des logs Nginx

## [1.1.0] - 2024-02-15

### Ajouté ✨
- Support des logs Nginx
- Filtrage en temps réel
- Export des logs filtrés
- Système de notifications

### Modifié 🔄
- Amélioration de la détection automatique du format des logs
- Optimisation du chargement des fichiers volumineux
- Mise à jour du système de cache

### Corrigé 🐛
- Correction des problèmes de mémoire avec les grands fichiers
- Résolution des conflits de filtres
- Correction du parsing des dates spéciales

## [1.0.0] - 2024-01-01

### Ajouté ✨
- Version initiale stable
- Support des logs Apache (access et error)
- Support basique de Syslog
- Interface responsive
- Système de filtrage basique
- Documentation utilisateur 