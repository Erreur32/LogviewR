# <img src="favicon.png" alt="LogviewR" width="42"> LogviewR 
 
LogviewR est un outil de visualisation et d'analyse de logs en temps réel, conçu pour être simple. 


 

## Fonctionnalités Principales ✨

<details>
  <summary>  Support Multi-Format  🎯</summary>
  
  - **Logs Apache** (access, error, 404)  
  - **Logs Nginx** (access, error)  
  - **Logs NPM** (Proxy Host, Default Host, Dead Host, Fallback)  
  - **Logs Syslog** (auth, kern, daemon, etc.)
</details>

<details>
  <summary>  Interface Moderne  🎨</summary>
  
  - **Thème sombre/clair**  
  - **Design responsive**  
  - **Auto-rafraîchissement des logs**  
  - **Filtres dynamiques**  
  - **Affichage optimisé des données**
</details>

<details>
  <summary>  Parsing Intelligent  🧠</summary>
  
  - **Détection automatique des types de logs**  
  - **Support des noms de domaine personnalisés**  
  - **Filtrage avancé**  
  - **Formatage intelligent des données**
</details>

<details>
  <summary>  Administration  🔒</summary>
  
  - **Interface d'administration sécurisée**  
  - **Gestion des patterns de logs**  
  - **Configuration des sources**  

</details>


## Installation 🚀

1. **Prérequis**
   - PHP 8.0+
   - Serveur web (Apache/Nginx)
   - Droits de lecture sur les fichiers de logs

2. **Installation**
   ```bash
   # Cloner le dépôt
   git clone https://github.com/Erreur32/LogviewR.git
   cd LogviewR

   # Configurer les permissions
   chmod -R 755 .
   chmod -R 777 cache/
   ```

 
## Screen

<details>
  <summary>Voir l'image</summary>
 
  ![Logviewer](https://github.com/Erreur32/LogviewR/blob/main/assets/logviewer.png)
</details>

## Configuration ⚙️

Panneau admin avec toutes les options configurable!

    login : admin
    password: password 

### Permissions des Logs 🔐

Pour accéder aux logs Apache, il est nécessaire de configurer les permissions correctement :

```bash
# Ajouter l'utilisateur www-data au groupe adm pour accéder aux logs
sudo usermod -aG adm www-data

# Vérifier les permissions du dossier des logs
sudo chmod 750 /var/log/apache2
```

Cette configuration permet à l'application web d'accéder aux logs Apache tout en maintenant la sécurité du système.

## Utilisation 🖥️

1. **Accès à l'Interface**
   - Ouvrir `http://votre-domaine/` dans votre navigateur
   - Se connecter avec les identifiants admin (pour la partie admin)

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

### Version 1.5.0 (2024-04-25)
- ✨ Nouveau thème "Dark Moderne Glass" avec effet glassmorphism
- 🔧 Système de debug amélioré avec logs détaillés
- 🎨 Nouvelle interface d'administration repensée
- 📊 Support des logs PHP avec visualisation en temps réel
- 🔒 Système de permissions avancé avec vérification automatique

### Version 1.4.1 (2024-04-22)
- 🐛 Correction du parsing des logs d'erreur NPM Proxy Host
- 🔧 Amélioration de la gestion des types de logs NPM
- ✨ Meilleure détection des colonnes selon le type de log
- 📝 Mise à jour de la documentation
- 🎨 Réorganisation du code des parsers

### Version 1.4.0 (2024-03-20)
- ✨ Nouveau système de mise à jour amélioré
- 🔧 Optimisation des performances
- 🎨 Amélioration de l'interface utilisateur
- 🛡️ Renforcement de la sécurité
- 📝 Documentation mise à jour

### Version 1.3.0 (2024-04-02)
- Support complet des logs NPM
- Amélioration de la détection des types de logs
- Optimisation de l'interface utilisateur
- Auto-rafraîchissement des logs
- Support des noms de domaine personnalisés

### Version 1.2.0 (2024-03-31)
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
