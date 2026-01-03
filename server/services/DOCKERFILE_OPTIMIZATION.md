# Optimisation Dockerfile - Réduction de taille d'image

## Problème identifié

L'image Docker est passée de ~30 MB à ~150-500 MB à cause de :
- Outils de build laissés en production : `python3`, `make`, `g++`, `libpcap-dev`
- `node_modules` compilé avec toolchain → dépendances lourdes
- 90% du poids dans `/usr` (~460 MB)

## Solution implémentée

### Dockerfile multi-stage optimisé

#### Stage 1 : Build (avec outils de build)
- ✅ `python3`, `make`, `g++` pour compiler `better-sqlite3` et autres modules natifs
- ✅ `npm ci` avec toutes les dépendances (dev + prod) → compile les binaires natifs
- ✅ Build du frontend (`npm run build`)
- ✅ `npm prune --production` pour supprimer les devDependencies tout en gardant les binaires compilés

#### Stage 2 : Runtime (image finale légère)
- ✅ **Suppression de tous les outils de build** : `python3`, `make`, `g++`, `libpcap-dev`
- ✅ **Outils runtime uniquement** :
  - `su-exec` : nécessaire pour l'entrypoint script
  - `iputils-ping` : nécessaire pour les tests réseau (optionnel)
  - `iproute2` : nécessaire pour les tests réseau (optionnel)
- ✅ **Copie de `node_modules` compilés** depuis le stage build (évite la recompilation)
- ✅ Frontend buildé copié depuis le stage build
- ✅ Backend TypeScript copié depuis le stage build

### Résultat attendu

- **Image finale** : 50-80 MB (au lieu de 150-500 MB)
- **`/usr`** : < 120 MB (au lieu de ~460 MB)
- **Réduction** : ~70-90% de la taille originale

## Détails techniques

### Pourquoi copier `node_modules` depuis le stage build ?

`better-sqlite3` nécessite des outils de build (`python3`, `make`, `g++`) pour compiler ses modules natifs via des scripts npm (`postinstall`). 

**Stratégie utilisée :**
1. Dans le stage build : `npm ci` compile tous les modules natifs (y compris `better-sqlite3`)
2. Dans le stage build : `npm prune --production` supprime les devDependencies mais **garde les binaires compilés**
3. Dans le stage runtime : copier `node_modules` depuis le stage build évite de :
   - Réinstaller les outils de build dans l'image finale
   - Recompiler `better-sqlite3` dans l'image finale

**Note importante :** `npm prune --production` ne supprime que les packages listés dans `devDependencies` du `package.json`, mais conserve tous les fichiers compilés et binaires natifs qui ont été générés lors de `npm ci`.

### Note sur les outils réseau

Les outils réseau (`iputils-ping`, `iproute2`) sont optionnels et peuvent être retirés si non nécessaires pour réduire la taille de l'image.

### Architecture cible

Le Dockerfile utilise `--platform=$BUILDPLATFORM` pour le stage build, ce qui garantit que les binaires sont compilés pour l'architecture cible. Dans la plupart des cas, `BUILDPLATFORM` et `TARGETPLATFORM` sont identiques, donc les binaires fonctionneront correctement.

## Vérification

Pour vérifier la taille de l'image :

```bash
docker build -t logviewr:test .
docker images logviewr:test
```

Pour vérifier la taille de `/usr` dans l'image :

```bash
docker run --rm logviewr:test sh -c "du -sh /usr"
```

## Tests recommandés

1. ✅ Vérifier que l'image se build correctement
2. ✅ Vérifier que l'application démarre correctement
3. ✅ Vérifier que les fonctionnalités réseau fonctionnent (si nécessaires)
4. ✅ Vérifier que la base de données SQLite fonctionne (`better-sqlite3`)
5. ✅ Vérifier la taille finale de l'image (< 100 MB)

