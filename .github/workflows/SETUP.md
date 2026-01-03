# Configuration du workflow GitHub Actions

## ✅ Correction effectuée

Le workflow a été corrigé pour utiliser `GITHUB_TOKEN` au lieu de `GHCR_TOKEN`. Le `GITHUB_TOKEN` est automatiquement disponible dans tous les workflows GitHub Actions.

## 🔍 Vérification

Le workflow devrait maintenant fonctionner car :
- ✅ `GITHUB_TOKEN` est automatiquement disponible
- ✅ Les permissions `packages: write` sont configurées
- ✅ Le workflow utilise le bon registry (`ghcr.io`)

## 🔧 Si le workflow échoue encore

### Option 1 : Vérifier les permissions du dépôt

1. Allez dans **Settings** → **Actions** → **General**
2. Vérifiez que **"Read and write permissions"** est activé pour les workflows
3. Vérifiez que **"Allow GitHub Actions to create and approve pull requests"** est activé si nécessaire

### Option 2 : Créer un Personal Access Token (si nécessaire)

Si `GITHUB_TOKEN` ne fonctionne pas, créez un PAT :

1. **Créer un token** :
   - GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
   - Generate new token (classic)
   - Nom : "GitHub Actions Docker Push"
   - Scopes : `write:packages`, `read:packages`, `delete:packages`
   - Generate token
   - **Copiez le token**

2. **Ajouter le secret** :
   - Allez dans le dépôt → **Settings** → **Secrets and variables** → **Actions**
   - Cliquez sur **"New repository secret"**
   - Nom : `GHCR_TOKEN`
   - Valeur : Collez le token
   - Cliquez sur **"Add secret"**

3. **Modifier le workflow** :
   Changez `password: ${{ secrets.GITHUB_TOKEN }}` en `password: ${{ secrets.GHCR_TOKEN }}`

### Option 3 : Vérifier que le package existe

Si c'est la première fois que vous poussez vers GitHub Container Registry :
- Le package sera créé automatiquement lors du premier push
- Assurez-vous que le workflow a les permissions nécessaires

## 📦 Image publiée

Une fois le workflow réussi, l'image sera disponible sur :
- `ghcr.io/erreur32/logviewr:latest`
- `ghcr.io/erreur32/logviewr:v0.1.2` (si tag créé)

## 🔍 Vérifier le workflow

Pour vérifier que le workflow fonctionne :
1. Allez dans l'onglet **Actions** de votre dépôt GitHub
2. Cliquez sur le dernier workflow exécuté
3. Vérifiez les logs pour voir où ça échoue

## 🐛 Dépannage courant

### Erreur "Password required"
- ✅ **Corrigé** : Le workflow utilise maintenant `GITHUB_TOKEN`

### Erreur "Permission denied"
- Vérifiez les permissions du dépôt (Settings → Actions → General)
- Vérifiez que `packages: write` est dans les permissions du job

### Erreur "Package not found"
- Normal pour le premier push, le package sera créé automatiquement
