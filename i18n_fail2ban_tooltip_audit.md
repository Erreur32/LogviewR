# Audit d'internationalisation des tooltips pour la page /fail2ban

## Problème identifié

Les composants `F2bTooltip` et les helpers `TT` dans le fichier `src/pages/fail2ban/helpers.tsx` contiennent des chaînes de caractères en dur qui ne sont pas internationalisées.

## Chaînes de caractères en dur trouvées

### 1. Tooltip "Bans du jour"

**Dans le fichier `Fail2banPage.tsx` :**
- Title : "Bans du jour"
- Body : Contient du texte en dur dans les éléments JSX

### 2. Tooltip "Jails actifs"

**Dans le fichier `Fail2banPage.tsx` :**
- Title : "Jails actifs"
- Body : Contient du texte en dur dans les éléments JSX

### 3. Tooltip "IPs bannies (BDD)"

**Dans le fichier `Fail2banPage.tsx` :**
- Title : "IPs bannies (BDD)"
- Body : Contient du texte en dur dans les éléments JSX

## Solution proposée

Les chaînes de caractères en dur doivent être remplacées par des clés de traduction utilisant `t()`.

### Étapes à suivre

1. **Ajouter les clés de traduction manquantes** dans `src/locales/en.json` et `src/locales/fr.json` :

```json
// Dans le bloc "fail2ban" de en.json :
"stats": {
  // ... autres clés ...
  "tooltips": {
    // ... autres clés ...
    "dailyBans": "Daily bans",
    "activeJails": "Active jails",
    "bannedIps": "Banned IPs (DB)"
  }
}

// Dans le bloc "fail2ban" de fr.json :
"stats": {
  // ... autres clés ...
  "tooltips": {
    // ... autres clés ...
    "dailyBans": "Bans du jour",
    "activeJails": "Jails actifs", 
    "bannedIps": "IPs bannies (BDD)"
  }
}
```

2. **Modifier les utilisations dans `Fail2banPage.tsx`** pour utiliser `t()` :

Remplacer :
```jsx
<F2bTooltip title="Bans du jour" body={...}>
```

Par :
```jsx
<F2bTooltip title={t('fail2ban.stats.tooltips.dailyBans')} body={...}>
```

## Implémentation recommandée

Pour les tooltips contenant du JSX, il est préférable d'ajouter des clés de traduction spécifiques dans les fichiers de traduction, plutôt que de tenter de traduire tout le JSX directement dans les tooltips.

La structure de clés de traduction devrait respecter la convention existante :
- `fail2ban.stats.tooltips.dailyBans`
- `fail2ban.stats.tooltips.activeJails` 
- `fail2ban.stats.tooltips.bannedIps`

Ces clés doivent être ajoutées dans les deux fichiers de traduction (`en.json` et `fr.json`) pour assurer la compatibilité de l'internationalisation.