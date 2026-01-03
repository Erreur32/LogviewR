# GitHub Actions Workflows

## Docker Build & Push

Le workflow `docker-publish.yml` construit et pousse automatiquement l'image Docker vers GitHub Container Registry (ghcr.io) lors de :
- Push sur la branche `main`
- Création d'un tag `v*.*.*`
- Pull requests (build uniquement, pas de push)

### Authentification

Le workflow utilise le `GITHUB_TOKEN` automatique fourni par GitHub Actions. Ce token a automatiquement les permissions nécessaires grâce à la configuration `packages: write` dans les permissions du job.

### Image publiée

L'image est publiée sur : `ghcr.io/erreur32/logviewr`

Tags disponibles :
- `latest` : Dernière version sur la branche main
- `v0.1.2` : Tag de version spécifique
- `main` : Build de la branche main

### Utilisation

Pour utiliser l'image dans docker-compose :

```yaml
services:
  logviewr:
    image: ghcr.io/erreur32/logviewr:latest
    # ou
    image: ghcr.io/erreur32/logviewr:v0.1.2
```

### Authentification pour pull (si privé)

Si le package est privé, vous devrez vous authentifier :

```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin
```

Ou avec un Personal Access Token :

```bash
echo $PAT_TOKEN | docker login ghcr.io -u USERNAME --password-stdin
```
