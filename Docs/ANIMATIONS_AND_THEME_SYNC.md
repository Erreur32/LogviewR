# Synchronisation animations et thème (MynetworK → LogviewR)

Ce document décrit comment LogviewR reprend les **animations d’arrière-plan** et la **base de données thème** alignées sur MynetworK.

---

## 1. Code des animations (pages JS / composants)

- **Un seul fichier** contient toutes les animations : `src/components/AnimatedBackground.tsx`.
- Chaque animation (Vagues de particules, Aurore, Étoiles, etc.) est un composant React (ex. `ParticleWavesCanvas`, `AuroraCanvas`) défini dans ce fichier ; il n’y a pas de “page JS” séparée par animation.
- Les **paramètres par animation** (vitesse, couleurs, nombre de particules, etc.) sont définis dans `src/hooks/useAnimationParameters.ts` (`ANIMATION_PARAMETERS`).

### Synchroniser depuis MynetworK

Quand le dépôt contient le dossier `mynetwork_app` (référence MynetworK) :

```bash
# À la racine du projet LogviewR
node scripts/copy-animated-bg.js
```

Cela copie `mynetwork_app/src/components/AnimatedBackground.tsx` vers `src/components/AnimatedBackground.tsx`. Les imports (`../hooks/useBackgroundAnimation`, `../hooks/useAnimationParameters`) sont les mêmes dans les deux projets, aucune modification n’est nécessaire après la copie.

À faire après une mise à jour côté MynetworK :
- Re-exécuter ce script pour mettre à jour le code des animations.
- Vérifier si `useAnimationParameters.ts` (liste des animations et paramètres) doit être aligné manuellement avec MynetworK.

---

## 2. Base de données thème

La configuration thème est stockée en base (table `app_config`) sous la clé **`theme_config`**. Le schéma est aligné avec ce que l’UI Thème envoie et reçoit.

### Schéma `theme_config` (JSON)

| Champ          | Type                    | Description |
|----------------|-------------------------|-------------|
| `theme`        | `string`                | Thème actif : `dark`, `glass`, `modern`, `nightly`, `neon`, `elegant`, `full-animation` |
| `customColors` | `Record<string, string>` (optionnel) | Couleurs personnalisées pour le thème courant |
| `cardOpacity`  | `number` (optionnel)    | Opacité des cartes (0.1–1), par thème si besoin |

### API

- **GET `/api/settings/theme`** : retourne `{ success, result: themeConfig }`.
- **POST `/api/settings/theme`** : body `{ theme?, customColors?, cardOpacity? }` ; enregistre dans `app_config` via `AppConfigRepository.set('theme_config', JSON.stringify(themeConfig))`.

Les thèmes valides côté serveur sont : `dark`, `glass`, `modern`, `nightly`, `neon`, `elegant`, `full-animation` (voir `server/routes/settings.ts`).

---

## 3. Fichiers concernés

| Rôle | Fichier(s) |
|------|------------|
| Code de chaque animation | `src/components/AnimatedBackground.tsx` |
| Paramètres par animation | `src/hooks/useAnimationParameters.ts` |
| Préférences (vitesse, id animation, off) | `src/hooks/useBackgroundAnimation.ts` |
| Persistance thème (API) | `server/routes/settings.ts` |
| Persistance thème (DB) | `server/database/models/AppConfig.ts`, clé `theme_config` |

Référence MynetworK : dossiers / fichiers équivalents dans `mynetwork_app/` (si présent).
