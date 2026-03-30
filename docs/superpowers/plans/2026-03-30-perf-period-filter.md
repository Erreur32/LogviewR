# Perf Period Filter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre le changement de période dans Statistiques de bans instantané (graphiques < 200ms, données complètes < 500ms).

**Architecture:** Backend — index composite SQLite + TTL adaptatifs + endpoint `?phase=fast` + extraction NPM vers route dédiée. Frontend — affichage des données stale pendant refresh + chargement progressif fast→full + prewarm silencieux + badge "actualisé il y a Xs".

**Tech Stack:** better-sqlite3 (synchrone), Express, React 18, TypeScript strict.

**Note importante:** better-sqlite3 est entièrement **synchrone** — `Promise.all()` ne parallélise pas les requêtes SQLite. Le vrai gain vient des indexes et de la réduction du nombre de requêtes (phase=fast).

---

## Fichiers modifiés

| Fichier | Rôle des changements |
|---------|----------------------|
| `server/database/connection.ts` | Ajouter index composite `(event_type, timeofban)` |
| `server/plugins/fail2ban/Fail2banPlugin.ts` | TTL adaptatifs, cache ipset, `?phase=fast`, extraction NPM |
| `src/pages/fail2ban/TabStats.tsx` | Stale data, progressive loading, adaptive TTL, prewarm, badge |

---

## Task 1 : Créer la branche de travail

- [ ] **Step 1 : Créer et basculer sur la branche**

```bash
git checkout -b feat/perf-period-filter
```

Expected: `Switched to a new branch 'feat/perf-period-filter'`

---

## Task 2 : Index composite `(event_type, timeofban)` dans connection.ts

**Files:**
- Modify: `server/database/connection.ts:299-306`

Toutes les requêtes `/tops` filtrent `WHERE event_type='ban' AND timeofban >= ?`. L'index existant sur `timeofban` seul force SQLite à re-filtrer par event_type sur chaque ligne. L'index composite permet de scanner directement les lignes 'ban' dans la plage temporelle.

- [ ] **Step 1 : Ajouter l'index dans le bloc d'initialisation**

Dans `server/database/connection.ts` à la ligne 305, après `idx_f2b_events_ip_time`, ajouter la ligne suivante dans le même bloc de création d'indexes :

```sql
CREATE INDEX IF NOT EXISTS idx_f2b_events_type_time ON f2b_events(event_type, timeofban)
```

Le bloc complet doit ressembler à :

```
idx_f2b_events_rowid   (unique, f2b_rowid)
idx_f2b_events_ip      (ip)
idx_f2b_events_jail    (jail)
idx_f2b_events_timeofban (timeofban)
idx_f2b_events_jail_time (jail, timeofban)
idx_f2b_events_ip_time   (ip, timeofban)
idx_f2b_events_type_time (event_type, timeofban)   ← NOUVEAU
```

- [ ] **Step 2 : Vérifier TypeScript**

```bash
cd /home/tools/Project/LogviewR && npx tsc 2>&1 | grep -c "error TS"
```

Expected: `0`

- [ ] **Step 3 : Commit**

```bash
git add server/database/connection.ts
git commit -m "perf: add (event_type, timeofban) composite index on f2b_events"
```

---

## Task 3 : TTL adaptatifs backend pour `/tops` et `/history`

**Files:**
- Modify: `server/plugins/fail2ban/Fail2banPlugin.ts:494-496` (après `_cachePut`), `line 1960` (tops), `line 897` (history)

- [ ] **Step 1 : Ajouter le helper `_adaptiveTtl` après `_cachePut` (ligne 496)**

Dans `Fail2banPlugin.ts`, ajouter la méthode suivante juste après `_cachePut` :

```typescript
/** Returns cache TTL in ms adapted to the time range: recent data expires fast, old data stays longer. */
private _adaptiveTtl(days: number): number {
    if (days <= 0)  return 600_000; // all-time: 10min
    if (days <= 2)  return 30_000;  // 24h/48h: 30s
    if (days <= 7)  return 120_000; // 7j: 2min
    return 600_000;                 // 30j, 6m, 1an: 10min
}
```

- [ ] **Step 2 : Remplacer le TTL fixe sur `/tops` (ligne 1960)**

```typescript
// AVANT
const _tCached = this._cachePeek<TopsPayload>(_tCacheKey, 30_000);

// APRÈS
const _tCached = this._cachePeek<TopsPayload>(_tCacheKey, this._adaptiveTtl(days));
```

- [ ] **Step 3 : Remplacer le TTL fixe sur `/history` (ligne 897)**

```typescript
// AVANT
const _hCached = this._cachePeek<unknown>(_hCacheKey, 30_000);

// APRÈS
const _hCached = this._cachePeek<unknown>(_hCacheKey, this._adaptiveTtl(days));
```

- [ ] **Step 4 : Vérifier TypeScript**

```bash
npx tsc 2>&1 | grep -c "error TS"
```

Expected: `0`

- [ ] **Step 5 : Commit**

```bash
git add server/plugins/fail2ban/Fail2banPlugin.ts
git commit -m "perf: adaptive TTL for /tops and /history (30s->10min for old periods)"
```

---

## Task 4 : Cache TTL sur `/ipset/info` et `/ipset/history`

**Files:**
- Modify: `server/plugins/fail2ban/Fail2banPlugin.ts:2794-2832`

Ces deux endpoints n'ont aucun cache serveur.

- [ ] **Step 1 : Ajouter cache 60s sur `/ipset/info` (handler à la ligne 2794)**

Modifier le handler `/ipset/info` — ajouter un cache peek/put autour de l'appel à `ipsetInfo()` :

```typescript
router.get('/ipset/info', requireAuth, asyncHandler(async (_req, res) => {
    if (!this.isEnabled()) return res.json({ success: true, result: { ok: false, sets: [], error: 'Plugin désactivé' } });
    const _cached = this._cachePeek<unknown>('ipset:info', 60_000);
    if (_cached) return res.json({ success: true, result: _cached });
    const r = await this.client?.ipsetInfo() ?? { ok: false, sets: [], error: 'client not initialized' };
    if (r.ok && r.sets.length > 0) {
        try {
            // ... (bloc snapshot existant inchangé) ...
        } catch { /* non-critical */ }
        this._cachePut('ipset:info', r);
    }
    res.json({ success: true, result: r });
}));
```

Concrètement : (1) ajouter les 2 lignes `_cachePeek` + early return avant `const r = await`, (2) ajouter `this._cachePut('ipset:info', r)` à la fin du `if (r.ok && r.sets.length > 0)` avant la `}` finale.

- [ ] **Step 2 : Ajouter cache adaptatif sur `/ipset/history` (handler à la ligne 2815)**

Modifier le handler `/ipset/history` — ajouter un peek/put :

```typescript
router.get('/ipset/history', requireAuth, asyncHandler(async (req, res) => {
    if (!this.isEnabled()) return res.json({ success: true, result: { ok: false, ipset_names: [], ipset_days: {} } });
    const days = Math.min(Math.max(1, parseInt(String(req.query.days ?? '30'), 10)), 365);
    const _ihKey = `ipset:history:${days}`;
    const _ihCached = this._cachePeek<unknown>(_ihKey, this._adaptiveTtl(days));
    if (_ihCached) return res.json({ success: true, result: _ihCached });
    // ... (requête SQLite existante inchangée) ...
    const result = { ok: true, ipset_names, ipset_days };
    this._cachePut(_ihKey, result);
    res.json({ success: true, result });
}));
```

Concrètement : (1) ajouter les 3 lignes peek avant la requête SQLite, (2) remplacer le `res.json` final par les 2 lignes `cachePut` + `res.json` avec la variable `result`.

- [ ] **Step 3 : Vérifier TypeScript**

```bash
npx tsc 2>&1 | grep -c "error TS"
```

Expected: `0`

- [ ] **Step 4 : Commit**

```bash
git add server/plugins/fail2ban/Fail2banPlugin.ts
git commit -m "perf: add TTL cache on /ipset/info (60s) and /ipset/history (adaptive)"
```

---

## Task 5 : Extraire le scan NPM logs vers `/tops/domains`

**Files:**
- Modify: `server/plugins/fail2ban/Fail2banPlugin.ts:2056-2190`

Le scan de fichiers logs NPM (~1–3s de I/O bloquant) est dans le chemin critique de `/tops`. Il est déplacé dans une route dédiée.

- [ ] **Step 1 : Supprimer le bloc NPM de `/tops`**

Dans le handler `/tops`, localiser le bloc "Top Domaines" qui commence à la ligne 2056 :
```
// Top Domaines: scan NPM access logs directly for banned IPs
```
Et se termine à la ligne 2178 (juste avant le commentaire `// Cache the full dataset`).

Remplacer ce bloc entier par une seule ligne :
```typescript
// Top Domains moved to dedicated /tops/domains route (slow NPM log scan)
const topDomains: { domain: string; count: number; failures: number }[] = [];
```

La variable `topDomains` est déjà utilisée dans `_tResult` à la ligne 2181 — elle sera maintenant toujours vide depuis `/tops`.

- [ ] **Step 2 : Créer la route `/tops/domains`**

Copier le bloc NPM supprimé dans une nouvelle route, ajoutée après la route `/tops/domain-detail` (vers la ligne 2290). La nouvelle route doit :

1. Lire le paramètre `days` (comme `/tops`)
2. Faire un `_cachePeek` avec clé `tops:domains:${days}` et TTL `this._adaptiveTtl(days)`
3. Si cache HIT, retourner immédiatement
4. Sinon, exécuter exactement le code NPM extrait de `/tops` (les lignes 2056-2178 qui viennent d'être supprimées)
5. Appeler `this._cachePut(_tdKey, result)` avant le `res.json`

Structure du handler :
```typescript
router.get('/tops/domains', requireAuth, asyncHandler(async (req, res) => {
    if (!this.isEnabled()) throw createError('Plugin disabled', 503, 'PLUGIN_DISABLED');
    const days  = parseInt(String(req.query.days  ?? '30'), 10);
    const limit = Math.min(parseInt(String(req.query.limit ?? '10'), 10), 100);
    const STORE_LIMIT = 100;
    const _tdKey = `tops:domains:${days}`;
    const _tdCached = this._cachePeek<unknown>(_tdKey, this._adaptiveTtl(days));
    if (_tdCached) return res.json({ success: true, result: _tdCached });

    const evDb   = getDatabase();
    const allTime = days <= 0;
    const since  = allTime ? 0 : Math.floor(Date.now() / 1000) - days * 86400;
    const topDomains: { domain: string; count: number; failures: number }[] = [];

    // [coller ici le bloc NPM extrait des lignes 2064-2178 du handler /tops]

    const result = { ok: true, topDomains: topDomains.slice(0, limit) };
    this._cachePut(_tdKey, result);
    res.json({ success: true, result });
}));
```

- [ ] **Step 3 : Vérifier TypeScript**

```bash
npx tsc 2>&1 | grep -c "error TS"
```

Expected: `0`

- [ ] **Step 4 : Commit**

```bash
git add server/plugins/fail2ban/Fail2banPlugin.ts
git commit -m "perf: extract NPM log scan from /tops into dedicated /tops/domains route"
```

---

## Task 6 : Endpoint `?phase=fast` sur `/tops`

**Files:**
- Modify: `server/plugins/fail2ban/Fail2banPlugin.ts:1950-1970` et vers ligne 2055

Quand `?phase=fast`, retourner uniquement summary + heatmaps (6 requêtes au lieu de 11). Le frontend l'appelle en premier pour afficher les graphiques rapidement.

- [ ] **Step 1 : Ajouter le paramètre `phase` et sa clé de cache**

Dans le handler `/tops` (ligne 1950), modifier le début pour lire le paramètre :

```typescript
const phase = req.query.phase === 'fast' ? 'fast' : 'full';
const _tCacheKey = phase === 'fast'
    ? `tops:fast:${days}`
    : `tops:${days}:${compareFlag}`;
```

Remplacer la ligne existante :
```typescript
const _tCacheKey = `tops:${days}:${compareFlag}`;
```

Par les deux lignes ci-dessus.

- [ ] **Step 2 : Ajouter le retour anticipé en mode `fast`**

Après le bloc `prevSummary` (vers la ligne 2054), juste **avant** la ligne commentée `// Top Domains moved to...`, insérer :

```typescript
// phase=fast: return summary + heatmaps immediately, skip tops lists (topIps, topJails, etc.)
if (phase === 'fast') {
    const _fastResult = {
        ok: true,
        topIps: [], topJails: [], topRecidivists: [], topDomains: [],
        heatmap, heatmapFailed, heatmapWeek, heatmapFailedWeek,
        summary, prevSummary,
    };
    this._cachePut(_tCacheKey, _fastResult);
    return res.json({ success: true, result: _fastResult });
}
```

- [ ] **Step 3 : Vérifier TypeScript**

```bash
npx tsc 2>&1 | grep -c "error TS"
```

Expected: `0`

- [ ] **Step 4 : Commit**

```bash
git add server/plugins/fail2ban/Fail2banPlugin.ts
git commit -m "perf: add ?phase=fast to /tops for immediate summary+heatmap response"
```

---

## Task 7 : Frontend — TTL adaptatif dans TabStats

**Files:**
- Modify: `src/pages/fail2ban/TabStats.tsx:19-26`

- [ ] **Step 1 : Remplacer la constante `CACHE_TTL` par une fonction**

Remplacer les lignes 19-26 :

```typescript
// ── Module-level cache (survives tab navigation) ──────────────────────────────
const _cache: Record<string, { data: unknown; ts: number }> = {};
/** Adaptive TTL: recent data expires fast, old data stays cached longer */
function getCacheTtl(days: number): number {
    if (days <= 0)  return 600_000; // all-time: 10min
    if (days <= 2)  return 30_000;  // 24h: 30s
    if (days <= 7)  return 120_000; // 7j: 2min
    return 600_000;                 // 30j, 6m, 1an: 10min
}
function getCached<T>(key: string, days = 7): T | null {
    const e = _cache[key];
    return (e && Date.now() - e.ts < getCacheTtl(days)) ? e.data as T : null;
}
function setCached(key: string, data: unknown) { _cache[key] = { data, ts: Date.now() }; }
```

- [ ] **Step 2 : Passer `days` aux appels `getCached` dans `TopsSection` (ligne ~1353)**

```typescript
// AVANT
const [topsData, setTopsData] = useState<TopsData | null>(() => getCached<TopsData>(`tops:all:${days}`));
const [topsLoading, setTopsLoading] = useState(() => !getCached<TopsData>(`tops:all:${days}`));
// ...
const cached = getCached<TopsData>(`tops:all:${days}`);

// APRÈS
const [topsData, setTopsData] = useState<TopsData | null>(() => getCached<TopsData>(`tops:all:${days}`, days));
const [topsLoading, setTopsLoading] = useState(() => !getCached<TopsData>(`tops:all:${days}`, days));
// ...
const cached = getCached<TopsData>(`tops:all:${days}`, days);
```

- [ ] **Step 3 : Passer `days` dans `IpSetsSection` (ligne ~375)**

```typescript
// AVANT
const cached = getCached<IpSetHist>(key);

// APRÈS
const cached = getCached<IpSetHist>(key, days);
```

- [ ] **Step 4 : Vérifier TypeScript**

```bash
npx tsc 2>&1 | grep -c "error TS"
```

Expected: `0`

- [ ] **Step 5 : Commit**

```bash
git add src/pages/fail2ban/TabStats.tsx
git commit -m "perf: adaptive frontend cache TTL aligned with backend (30s->10min by period)"
```

---

## Task 8 : Frontend — Données stale + état `topsRefreshing`

**Files:**
- Modify: `src/pages/fail2ban/TabStats.tsx:1352-1401`

Au lieu de vider `topsData` quand la période change, garder les données visibles et indiquer un refresh en cours.

- [ ] **Step 1 : Ajouter `topsRefreshing` state et `topsLastFetchRef`**

Après la ligne 1357 (`const topsAbortRef = useRef<AbortController | null>(null);`), ajouter :

```typescript
const [topsRefreshing, setTopsRefreshing] = useState(false);
const topsLastFetchRef = useRef<Partial<Record<number, number>>>({});
```

- [ ] **Step 2 : Ajouter `setTopsRefreshing(false)` dans le `.finally()` de `fetchTops`**

Dans le `.finally()` de `fetchTops` (vers ligne 1374), ajouter après `setTopsLoading(false)` :

```typescript
setTopsRefreshing(false);
```

Et dans le `.then()`, après `setTopsData(res.result)`, enregistrer le timestamp :

```typescript
topsLastFetchRef.current = { ...topsLastFetchRef.current, [days]: Date.now() };
```

- [ ] **Step 3 : Modifier le `useEffect([days, fetchTops])` pour ne pas vider les données**

Remplacer le bloc `useEffect` (lignes 1385-1401) :

```typescript
useEffect(() => {
    const cached = getCached<TopsData>(`tops:all:${days}`, days);
    if (cached) {
        setTopsData(cached);
        setTopsLoading(false);
        setTopsRefreshing(false);
        primeTopsPrevTotalFromFullFetch(days, cached.prevSummary?.totalBans ?? null);
    } else if (topsData !== null) {
        // Keep showing stale data — just indicate background refresh
        setTopsLoading(false);
        setTopsRefreshing(true);
        topsWasLoadingRef.current = false;
    } else {
        // No data at all — show full loading state
        setTopsLoading(true);
        setTopsRefreshing(false);
        topsWasLoadingRef.current = true;
    }
    fetchTops();
    const id = setInterval(fetchTops, 60_000);
    return () => {
        clearInterval(id);
        topsAbortRef.current?.abort();
    };
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [days, fetchTops]);
```

Note: `topsData` est **intentionnellement absent** des deps pour éviter une boucle infinie. Le commentaire eslint-disable est nécessaire.

- [ ] **Step 4 : Passer `refreshing` à `TopsSection`**

Trouver la ligne qui monte `<TopsSection ...>` et ajouter la prop :

```typescript
<TopsSection
    days={days} onDaysChange={onDaysChange}
    onIpClick={onIpClick} onDomainClick={setDomainDetail}
    jails={jails} data={topsData} loading={topsLoading}
    refreshing={topsRefreshing}
    lastFetchTs={topsLastFetchRef.current[days]}
/>
```

- [ ] **Step 5 : Ajouter les props `refreshing` et `lastFetchTs` dans la signature de `TopsSection` (ligne ~962)**

```typescript
const TopsSection: React.FC<{
    days: number; onDaysChange: (d: number) => void;
    onIpClick?: (ip: string) => void; onDomainClick?: (domain: string) => void;
    jails: JailStatus[]; data: TopsData | null; loading: boolean;
    refreshing?: boolean; lastFetchTs?: number;
}> = ({ days, onDaysChange, onIpClick, onDomainClick, jails, data, loading, refreshing, lastFetchTs }) => {
```

- [ ] **Step 6 : Vérifier TypeScript**

```bash
npx tsc 2>&1 | grep -c "error TS"
```

Expected: `0`

- [ ] **Step 7 : Commit**

```bash
git add src/pages/fail2ban/TabStats.tsx
git commit -m "perf: keep stale topsData visible during period change, add topsRefreshing state"
```

---

## Task 9 : Frontend — Chargement progressif phase fast→full

**Files:**
- Modify: `src/pages/fail2ban/TabStats.tsx` — callback `fetchTops`

Deux fetches en séquence : `phase=fast` affiche les graphiques (~150ms), puis `phase=full` enrichit les tableaux.

- [ ] **Step 1 : Remplacer le callback `fetchTops` par une version à 2 phases**

Remplacer le contenu du callback `fetchTops` (lignes 1359-1383) :

```typescript
const fetchTops = useCallback(() => {
    topsAbortRef.current?.abort();
    const ac = new AbortController();
    topsAbortRef.current = ac;

    // Phase 1: fast — summary + heatmaps in ~150ms (skip if full data cached)
    const fullCached = getCached<TopsData>(`tops:all:${days}`, days);
    if (!fullCached) {
        api.get<TopsData>(`/api/plugins/fail2ban/tops?days=${days}&phase=fast`, { signal: ac.signal })
            .then(res => {
                if (ac.signal.aborted) return;
                if (res.success && res.result?.ok) {
                    setTopsData(prev => {
                        // Merge: keep existing tops lists from stale data if available
                        const base = prev ?? ({} as TopsData);
                        return {
                            ...base,
                            ...res.result,
                            topIps:         base.topIps?.length         ? base.topIps         : res.result.topIps,
                            topJails:       base.topJails?.length        ? base.topJails        : res.result.topJails,
                            topRecidivists: base.topRecidivists?.length  ? base.topRecidivists  : res.result.topRecidivists,
                        };
                    });
                    setTopsLoading(false);
                }
            })
            .catch(() => {});
    }

    // Phase 2: full — all data including tops lists
    api.get<TopsData>(`/api/plugins/fail2ban/tops?days=${days}&limit=100&compare=1`, { signal: ac.signal })
        .then(res => {
            if (ac.signal.aborted) return;
            if (res.success && res.result?.ok) {
                setCached(`tops:all:${days}`, res.result);
                setTopsData(res.result);
                topsLastFetchRef.current = { ...topsLastFetchRef.current, [days]: Date.now() };
                primeTopsPrevTotalFromFullFetch(days, res.result.prevSummary?.totalBans ?? null);
            }
        })
        .catch(() => {})
        .finally(() => {
            if (ac.signal.aborted) return;
            setTopsLoading(false);
            setTopsRefreshing(false);
            if (topsWasLoadingRef.current) {
                topsWasLoadingRef.current = false;
                dispatchTabLoaded();
            }
        });
}, [days]);
```

- [ ] **Step 2 : Vérifier TypeScript**

```bash
npx tsc 2>&1 | grep -c "error TS"
```

Expected: `0`

- [ ] **Step 3 : Commit**

```bash
git add src/pages/fail2ban/TabStats.tsx
git commit -m "perf: progressive loading — phase=fast shows charts in ~150ms, full enriches after"
```

---

## Task 10 : Frontend — Prewarm des périodes adjacentes

**Files:**
- Modify: `src/pages/fail2ban/TabStats.tsx`

Après chargement complet, prefetch silencieux des autres périodes.

- [ ] **Step 1 : Ajouter `prewarmDoneRef`**

Dans `TabStats`, après `topsLastFetchRef` :

```typescript
const prewarmDoneRef = useRef<Set<number>>(new Set());
```

- [ ] **Step 2 : Ajouter le useEffect de prewarm**

Après le `useEffect([days, fetchTops])`, ajouter :

```typescript
// Silently prewarm adjacent periods after initial load
useEffect(() => {
    if (!topsData || topsRefreshing || topsLoading) return;
    const allDays = [1, 7, 30, 180, 365];
    const toPrewarm = allDays.filter(
        d => d !== days && !prewarmDoneRef.current.has(d) && !getCached<TopsData>(`tops:all:${d}`, d)
    );
    if (toPrewarm.length === 0) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    const timer = setTimeout(() => {
        for (const d of toPrewarm.slice(0, 2)) {
            prewarmDoneRef.current.add(d);
            const ac = new AbortController();
            api.get<TopsData>(`/api/plugins/fail2ban/tops?days=${d}&limit=100&compare=1`, { signal: ac.signal })
                .then(res => {
                    if (res.success && res.result?.ok) setCached(`tops:all:${d}`, res.result);
                })
                .catch(() => {});
        }
    }, 2000);
    return () => clearTimeout(timer);
}, [topsData, topsRefreshing, topsLoading, days]);
```

- [ ] **Step 3 : Vérifier TypeScript**

```bash
npx tsc 2>&1 | grep -c "error TS"
```

Expected: `0`

- [ ] **Step 4 : Commit**

```bash
git add src/pages/fail2ban/TabStats.tsx
git commit -m "perf: silently prewarm adjacent periods 2s after initial load"
```

---

## Task 11 : Frontend — Badge "actualisé il y a Xs"

**Files:**
- Modify: `src/pages/fail2ban/TabStats.tsx` — hook `useElapsed` + header `TopsSection`

- [ ] **Step 1 : Ajouter le hook `useElapsed` avant `PeriodBtns`**

Juste avant la définition de `PeriodBtns` (ligne ~45), ajouter :

```typescript
/** Returns elapsed seconds since a timestamp, re-renders every 10s */
function useElapsed(ts: number | undefined): number | null {
    const [, setTick] = useState(0);
    useEffect(() => {
        if (!ts) return;
        const id = setInterval(() => setTick(t => t + 1), 10_000);
        return () => clearInterval(id);
    }, [ts]);
    if (!ts) return null;
    return Math.floor((Date.now() - ts) / 1000);
}
```

- [ ] **Step 2 : Utiliser le hook dans `TopsSection` et afficher le badge**

Dans le corps de `TopsSection`, avant le `return`, ajouter :

```typescript
const elapsed = useElapsed(lastFetchTs);
const elapsedLabel = elapsed === null
    ? 'actualisation…'
    : elapsed < 60 ? `il y a ${elapsed}s` : `il y a ${Math.floor(elapsed / 60)}min`;
```

Dans le header de `TopsSection` (là où `right={<PeriodBtns ...>}` est passé), envelopper pour ajouter le badge :

```typescript
right={
    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
        {refreshing && (
            <span style={{ fontSize: '.65rem', color: C.muted, fontStyle: 'italic' }}>
                {elapsedLabel}
            </span>
        )}
        <PeriodBtns days={days} onChange={onDaysChange} />
    </div>
}
```

- [ ] **Step 3 : Vérifier TypeScript**

```bash
npx tsc 2>&1 | grep -c "error TS"
```

Expected: `0`

- [ ] **Step 4 : Commit**

```bash
git add src/pages/fail2ban/TabStats.tsx
git commit -m "feat: add refreshing elapsed-time badge on period selector in TopsSection"
```

---

## Task 12 : Vérification finale et push de la branche

- [ ] **Step 1 : Vérification TypeScript globale**

```bash
npx tsc 2>&1 | grep -c "error TS"
```

Expected: `0`

- [ ] **Step 2 : Vérifier la liste des commits**

```bash
git log main..HEAD --oneline
```

Expected (10 commits dans l'ordre) :
```
feat: add refreshing elapsed-time badge on period selector in TopsSection
perf: silently prewarm adjacent periods 2s after initial load
perf: progressive loading — phase=fast shows charts in ~150ms, full enriches after
perf: keep stale topsData visible during period change, add topsRefreshing state
perf: adaptive frontend cache TTL aligned with backend (30s->10min by period)
perf: add ?phase=fast to /tops for immediate summary+heatmap response
perf: extract NPM log scan from /tops into dedicated /tops/domains route
perf: add TTL cache on /ipset/info (60s) and /ipset/history (adaptive)
perf: adaptive TTL for /tops and /history (30s->10min for old periods)
perf: add (event_type, timeofban) composite index on f2b_events
```

- [ ] **Step 3 : Vérification manuelle en dev**

```bash
npm run dev
```

Scénarios à tester dans le navigateur (DevTools Network ouvert) :
1. Charger la page → aller sur Statistiques (période 7j par défaut)
2. Cliquer "30j" → les données 7j restent visibles, badge "actualisation…" apparaît, puis badge "il y a 0s" puis disparaît
3. Recliquer "30j" dans les 10min → instantané (cache HIT, aucune requête réseau pour /tops)
4. Cliquer "1an" → données 30j visibles pendant le chargement
5. Attendre 2s après chargement → voir 2 requêtes silencieuses partir en arrière-plan (prewarm)
6. Cliquer la période pré-warmée → instantané
7. Vérifier DevTools que `?phase=fast` part en premier quand cache MISS

- [ ] **Step 4 : Push de la branche**

```bash
git push -u origin feat/perf-period-filter
```
