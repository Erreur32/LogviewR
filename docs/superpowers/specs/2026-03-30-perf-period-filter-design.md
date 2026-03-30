# Design — Optimisation filtre de période Fail2ban

**Date :** 2026-03-30
**Branche :** feat/perf-period-filter
**Scope :** Plan A (backend SQLite + cache) + Plan B (frontend progressive loading)

---

## Problème

Changer le filtre de période dans Statistiques de bans est lent (1–10s) ou sans réaction apparente.

### Causes racines identifiées

1. **`/tops` — 15 requêtes SQLite séquentielles + scan NPM logs** → 800ms–1.5s côté serveur
2. **Pas d'indexes sur `f2b_events(timeofban, jail, event_type)`** → full-table-scan sur chaque requête
3. **`/ipset/info` et `/ipset/history` — zéro cache backend** → re-hit serveur à chaque changement
4. **TTL backend 30s uniforme** → une période "30j" expire aussi vite qu'une période "1j" alors que les données passées sont immuables
5. **Frontend vide l'état au changement de période** → UX bloquée pendant 1–1.5s
6. **Aucun prewarm des périodes adjacentes** → chaque nouvelle période repart à froid

---

## Section 1 — Backend : SQLite + cache

### 1.1 Indexes SQLite

Ajout via migration au démarrage du plugin (`initDb()`) :

```sql
CREATE INDEX IF NOT EXISTS idx_f2b_events_time      ON f2b_events(timeofban);
CREATE INDEX IF NOT EXISTS idx_f2b_events_jail_time ON f2b_events(jail, timeofban);
CREATE INDEX IF NOT EXISTS idx_f2b_events_type_time ON f2b_events(event_type, timeofban);
```

**Gain estimé :** ×3 à ×5 sur les 15 requêtes de `/tops`.

### 1.2 Parallélisation des requêtes `/tops`

Regrouper les requêtes actuellement séquentielles en 3 `Promise.all()` :

- **Groupe 1** : topIps, topJails, topRecidivists, summary (indépendants)
- **Groupe 2** : heatmap × 4 (indépendants)
- **Groupe 3** : prevSummary × 3 (si `compare=1`, après groupe 1 pour partager le cutoff timestamp)

Groupes 1 et 2 partent en parallèle dès le début.

**Gain estimé :** de ~1s séquentiel à ~200ms.

### 1.3 TTL cache sur `/ipset/info` et `/ipset/history`

| Endpoint | TTL actuel | TTL après |
|----------|-----------|-----------|
| `/ipset/info` | aucun | 60s |
| `/ipset/history?days=N` (days ≤ 7) | aucun | 2min |
| `/ipset/history?days=N` (days > 7) | aucun | 10min |

Cache key : `ipset:info` et `ipset:history:{days}`.

### 1.4 TTL adaptatifs sur `/tops` et `/history`

Les données passées sont quasi-immuables. TTL par période :

| Période | `/tops` TTL actuel | `/tops` TTL après | `/history` TTL actuel | `/history` TTL après |
|---------|--------------------|-------------------|-----------------------|----------------------|
| days ≤ 2 | 30s | 30s (inchangé) | 30s | 30s (inchangé) |
| days 3–7 | 30s | 2min | 30s | 2min |
| days > 7 | 30s | 10min | 30s | 10min |

### 1.5 Endpoint `/tops` avec paramètre `?phase=`

Nouveau paramètre optionnel sur `/api/plugins/fail2ban/tops` :

- `?phase=fast` : retourne uniquement `summary` + `heatmap` (~2 requêtes, ~80ms)
- `?phase=full` (défaut) : retourne tout (comportement actuel, optimisé par 1.2)

Le cache reste unifié par clé `tops:{days}:{compare}:{phase}`.

### 1.6 Extraction du scan NPM logs

Le scan de fichiers logs NPM est déplacé dans une route dédiée `/api/plugins/fail2ban/tops/domains`. La route `/tops` principale ne déclenche plus ce scan. La route `/tops/domains` est appelée uniquement si l'onglet domaines est monté.

---

## Section 2 — Frontend : Progressive loading

### 2.1 Données stale visibles pendant le chargement

**Comportement actuel :**
```
clic "7j" → setTopsData(null) → spinner → données 7j
```

**Comportement après :**
```
clic "7j" → données 1j restent affichées + badge "chargement" sur le sélecteur
          → données 7j arrivent → remplacement silencieux
```

Implémentation : ne pas appeler `setTopsData(null)` ni `setTopsLoading(true)` si des données existent déjà. Utiliser un state `topsRefreshing: boolean` séparé.

### 2.2 Chargement progressif en 2 temps (phase fast + full)

Séquence sur changement de période :

```
t=0ms    → fetch /tops?days=7&phase=fast
t=~150ms → summary + heatmap affichés (graphiques visibles)
           → fetch /tops?days=7&phase=full part en parallèle
t=~400ms → tableaux topIps/topJails/topRecidivists affichés
```

Les deux fetches utilisent le même `AbortController` (si la période change à nouveau, les deux sont annulés).

Ordre dans le code :
1. Lancer `phase=fast` → sur réponse, `setTopsData(fastData)`
2. Lancer `phase=full` en parallèle → sur réponse, `setTopsData(fullData)` (enrichit)

Si `phase=fast` revient depuis le cache frontend → pas de fetch réseau, `phase=full` seul part.

### 2.3 Prewarm des périodes adjacentes

Après chargement complet d'une période (phase=full reçu), lancer silencieusement les autres périodes disponibles avec un délai de 2s :

```
Périodes disponibles : [1, 7, 30, 90] (ou selon les boutons rendus)
User charge 7j → après fullData reçu → setTimeout(2000) → prefetch 1j, 30j, 90j
```

Conditions : uniquement si `navigator.onLine && !document.hidden`. Stocker en cache frontend normalement. Aucun setState visible (requêtes silencieuses).

### 2.4 TTL frontend adaptatif

Aligné sur le backend :

```typescript
const CACHE_TTL_BY_DAYS: Record<number, number> = {
  1: 30_000,
  2: 30_000,
  7: 120_000,   // 2min
  30: 600_000,  // 10min
  90: 600_000,  // 10min
};
function getTtlForDays(days: number): number {
  return CACHE_TTL_BY_DAYS[days] ?? 120_000;
}
```

Remplace le `CACHE_TTL = 60_000` constant actuel dans `TabStats.tsx`.

### 2.5 Badge "actualisé il y a Xs"

Petit texte gris affiché sous/à côté du sélecteur de période quand les données proviennent du cache et qu'un refresh tourne en arrière-plan :

```
[1j] [7j ✓] [30j] [90j]
      ↳ actualisé il y a 45s
```

Affiché uniquement si `topsRefreshing === true && topsData !== null`. Masqué quand `topsRefreshing === false`.

---

## Section 3 — Ordre d'implémentation

| Priorité | Tâche | Fichier(s) | Effort |
|----------|-------|-----------|--------|
| 1 | Indexes SQLite | `Fail2banPlugin.ts` — `initDb()` | 20min |
| 2 | Promise.all() dans `/tops` | `Fail2banPlugin.ts` — handler `/tops` | 45min |
| 3 | TTL adaptatifs backend | `Fail2banPlugin.ts` — `_cachePeek` calls | 30min |
| 4 | TTL cache `/ipset/info` + `/ipset/history` | `Fail2banPlugin.ts` | 20min |
| 5 | Extraction scan NPM → `/tops/domains` | `Fail2banPlugin.ts` | 1h |
| 6 | Endpoint `?phase=fast` | `Fail2banPlugin.ts` | 45min |
| 7 | Données stale frontend | `TabStats.tsx` — TopsSection | 1h |
| 8 | Chargement progressif phase fast+full | `TabStats.tsx` — TopsSection | 1h30 |
| 9 | TTL adaptatif frontend | `TabStats.tsx` — module cache | 20min |
| 10 | Prewarm périodes adjacentes | `TabStats.tsx` — TopsSection | 45min |
| 11 | Badge "actualisé il y a Xs" | `TabStats.tsx` — sélecteur période | 30min |

---

## Ce qui est hors scope

- Changement de BDD (MySQL/PostgreSQL)
- Refactoring du système de polling
- Toucher le système de notifications / toasts
- Modifier les autres pages (TabJails, TabTracker, etc.)

---

## Critères de succès

- Changement de période visible en < 200ms (graphiques) avec données complètes < 500ms
- Deuxième clic sur la même période dans les 2min : instantané (cache hit)
- Aucune régression sur les données affichées (mêmes résultats, juste plus vite)
- `npx tsc` sans erreur après chaque fichier modifié
