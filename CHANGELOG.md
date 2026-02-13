# Changelog

All notable changes to LogviewR will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

---

## [0.2.5] - 2026-02-13

### Added

#### Stats Logs – Tooltips et panneaux
- **Tooltips via portail** : tous les tooltips (Top URLs, Top Referrers, Top IPs, Top HTTP codes, Top Browsers, Top User-Agents, Referrer URLs, HTTP Status Codes, Requested Files) sont rendus via `createPortal` dans `document.body` pour éviter tout masquage par overflow ou z-index.
- **Tooltips toujours visibles** : z-index 99999, position fixe, fond opaque (`rgb(17, 24, 39)`) pour éviter la transparence imposée par le thème (`themes.css` remplace `bg-gray-900` par `var(--bg-tertiary)`).
- **Bouton bascule vue** : icône Maximize2/Minimize2 dans chaque panneau Top pour afficher 5 résultats ou la liste complète.
- **Traductions** : `showAllItems` (Tout afficher), `showLimitedItems` (Vue limitée (5)).

### Changed

#### Stats Logs – Layout et affichage
- **Distribution HTTP Status / Methods** : barres plus fines (`h-3`), count et pourcentage sur une seule ligne (`whitespace-nowrap`), alignement des barres avec colonne count fixe (`min-w-[5.5rem] text-right`), label adapté (4rem pour codes, 7rem pour méthodes).
- **Top panels** : Top URLs et Top Referrers sur la première ligne (2 colonnes) ; Top IPs, Top Status, Top Browsers sur la deuxième ligne ; Top User-Agents sur une ligne dédiée (même largeur que Top Referrers).
- **TopPanel par défaut** : affichage de 5 résultats sans scroll ; clic sur l’icône pour afficher tout.
- **TopPanel extrait** : composant déplacé au niveau du module pour éviter la réinitialisation de l’état (`showAll`) à chaque rendu du parent.
- **Tooltips enrichis** : contenu (Hits, Total %), séparateur, padding et bordures améliorés.

---

## [0.2.4] - 2026-02-13

### Added

#### Stats Logs (style GoAccess)
- **Page plein écran** : Statistiques graphiques des logs (KPI, Stats KPI, timeline, Time Distribution, Unique Visitors, HTTP Status Codes, Referring Sites, Virtual Hosts, Referrer URLs, Requested Files, top panels), inspirée de [GoAccess for Nginx Proxy Manager](https://github.com/xavier-hernandez/goaccess-for-nginxproxymanager).
- **Bouton footer** : Accès à la page Stats Logs à côté d'Analytique.
- **API analytics** : Endpoint `GET /api/log-viewer/analytics` avec `pluginId`, `from`, `to`, `bucket`, `topLimit`, `fileScope`, `includeCompressed`.
- **Filtre plugin** : Tous (NPM + Apache), NPM ou Apache.
- **Plage temporelle** : 1h, 24h, 7j, 30j + personnalisé (datetime-local).
- **Scope fichiers** : Dernier fichier uniquement ou tous les fichiers (access.log, .1, .2, etc.).
- **Option .gz** : Inclusion des fichiers compressés (si activé dans Réglages > Plugins).
- **Requêtes dans le temps** : Bascule Barres / Courbe + axe X avec labels date/heure espacés.
- **Axes X lisibles** : Repères temporels (6 graduations) et grille verticale sur Distribution temporelle et Visiteurs uniques.
- **Courbes duales** : Time Distribution et Unique Visitors (DualLineChart).
- **Panels tableau** : HTTP Status Codes, Referring Sites, Virtual Hosts, Referrer URLs (label gauche, barres droite).
- **Codes HTTP par domaine** : Panel détaillé host + status.
- **Stats KPI étendus** : valid requests, failed requests, not found, static files.
- **Infos et tooltips** : Section « Comprendre les chiffres » + tooltips sur les badges.
- **Documentation** : `Doc_Dev/LOG_ANALYTICS_GRAPHS_GOACCESS.md`.

---

## [0.2.3] - 2026-02-10

### Fixed

#### Header – Flickering des icônes de choix de logs
- **Tremblement au survol** : les boutons (Fichiers, Historique, Regex, Play, Stop, Actualiser, Mode parsé/brut) étaient enveloppés dans un composant `Tooltip` (span inline-flex), provoquant des entrées/sorties de survol et un flickering. Remplacement par l’attribut natif `title` sur les boutons. Suppression de l’animation `fadeInDown` du menu déroulant plugin et de la `transition-transform` du chevron.

#### Changelog en version Docker
- **Changelog non disponible dans Admin > Info** : `CHANGELOG.md` n’était pas copié dans l’image Docker finale. Ajout d’un `COPY` dans le Dockerfile pour inclure `CHANGELOG.md` à la racine du conteneur (`/app/CHANGELOG.md`), afin que la route `GET /api/info/changelog` renvoie le contenu en Docker.

#### Vue logs bruts – Hauteur du cadre
- **Cadre trop petit** : la zone scrollable des logs bruts avait une hauteur fixe `max-h-[600px]`. Remplacement par `min-h-[400px] h-[calc(100vh-15rem)]` pour adapter la hauteur au viewport tout en conservant le choix « Lignes par page » et la pagination.

### Changed

#### Admin > Info – Texte « À propos »
- **Tagline et description (EN/FR)** : formulation mise à jour pour préciser que LogviewR **lit les fichiers de logs locaux** (machine ou conteneur) et qu’**aucune connexion sortante** vers les serveurs n’est nécessaire, ce qui est préférable pour la sécurité. Les clés `tagline` et `aboutDescription` ont été modifiées dans `en.json` et `fr.json`.

#### Apache – Regex personnalisées et affichage des options
- **Regex custom utilisée pour le parsing** : lorsqu’une regex personnalisée est enregistrée pour un fichier Apache (access), le backend utilisait `CustomLogParser` sans mapping des colonnes. Désormais, pour le plugin Apache et le type access, la regex custom est passée à `ApacheParser.parseAccessLineWithCustomRegex()` : les colonnes (ip, vhost, method, url, status, size, referer, userAgent) sont correctement remplies.
- **Default regex access** : la regex par défaut pour Apache access (éditeur et API default-regex) est désormais `APACHE_ACCESS_VHOST_COMBINED_REGEX` (format vhost_combined avec `%t` en premier).
- **Options regex : 3 entrées génériques + Custom** : dans « Fichiers détectés avec regex » (Réglages > Plugins > Apache), affichage de seulement **access.log**, **error.log** et **access_*.log** (édition générique). Les fichiers dont la regex a été éditée via le header du visualiseur apparaissent en **Custom** ; une entrée Custom remplace l’entrée générique correspondante (pas de doublon). Bouton **Réinitialiser** affiché pour toute entrée Custom ou lorsque la regex diffère du défaut.
- **Reconnaissance access.\*.log** : les fichiers du type `access.home32.myoueb.fr.log` ou `access.ip.myoueb.fr.log` sont désormais rattachés au slot **access_*.log** pour l’application de la regex vhost_combined (correction de l’affichage VIRTUAL HOST / STATUS / METHOD / URL).

#### NPM – Regroupement des options regex
- **Options regex : 10 entrées génériques + Custom** : dans « Fichiers détectés avec regex » pour NPM, affichage de **proxy-host-*_access.log**, **proxy-host-*_error.log**, **dead-host-*_access/error**, **default-host_access/error**, **fallback_access/error**, **letsencrypt-requests_access/error**. Une regex enregistrée pour une entrée s’applique à tous les fichiers correspondants. Même logique Custom que pour Apache (remplacement du générique, pas de doublon). Résolution de la regex par clé via `getNpmRegexKeyForPath()`.

#### Nginx – Regroupement des options regex
- **Options regex : 2 entrées génériques + Custom** : pour Nginx, affichage de **access.log** et **error.log** uniquement ; une regex par type s’applique à tous les fichiers access/error. Résolution par `getNginxRegexKeyForPath()`.

#### i18n
- **Hints options regex** : ajout de `apacheRegexHint`, `npmRegexHint` et `nginxRegexHint` dans les locales (fr/en), affichés au-dessus de la liste dans la section « Fichiers détectés avec regex » pour Apache, NPM et Nginx.

---

## [0.2.2] - 2026-02-10

### Changed

#### Script update-version.sh
- **Intégration de `commit-message.txt` dans `--tag-push`** : le mode `--tag-push` utilise désormais `git commit -F commit-message.txt` au lieu du message générique `"release: v$NEW"`. Si le fichier est absent ou ne mentionne pas la version, fallback automatique avec avertissement.
- **Ajout de `server/routes/system.ts`** (step 5) : le fallback `appVersion` dans `system.ts` est maintenant mis à jour automatiquement par le script (il était oublié auparavant).
- **Détection intelligente du commit-message.txt** : après le bump, le script vérifie si `commit-message.txt` existe et mentionne la bonne version (check vert / avertissement jaune / génération de template).
- **Sortie améliorée** : commandes numérotées 1-2-3 en fin de script, option "re-run with --tag-push", all-in-one avec `git commit -F commit-message.txt`.
- **Parsing d'arguments flexible** : l'ordre `--tag-push` / version n'a plus d'importance.

---

## [0.2.1] - 2026-02-10

### Fixed

#### Plugin NPM – Parsing des fichiers error.log
- **Fichiers `proxy-host-*_error.log` non affichés dans le tableau** : la méthode `determineLogType()` dans `NpmLogPlugin.ts` vérifiait `proxy-host` avant `error` dans le nom du fichier. Un fichier `proxy-host-12_error.log` était classifié comme `access` au lieu de `error`, le parser access échouait sur les lignes d'erreur Nginx, et toutes les lignes restaient non parsées. L'ordre de vérification est maintenant inversé : `error` est testé en premier.
- **Parser error NPM sans support PID/TID** : `NpmParser.parseErrorLine()` n'avait qu'une seule regex basique qui ne gérait pas le format `497#497:` (PID/TID) omniprésent dans les logs d'erreur Nginx. Ajout du format PID/TID comme dans `NginxParser`, avec extraction de `pid` et `tid`.
- **Colonnes `pid`/`tid` manquantes pour les error logs NPM** : `getColumns('error')` retournait `['timestamp', 'level', 'message']`. Aligné sur Nginx avec `['timestamp', 'level', 'pid', 'tid', 'message']`.

#### LogTable – Débordement du badge timestamp
- **Badge timestamp qui déborde de la colonne** : la largeur timestamp était de 146px (access) et 158px (error), insuffisante pour le badge mono fr-FR "08/02/2026 13:30:06" (~149px de badge + 32px de padding cellule = 181px minimum). Largeur unifiée à 185px pour tous les plugins et logTypes.

### Changed

#### LogTable – Unification des colonnes
- **Largeurs de colonnes centralisées** : remplacement des ~110 lignes de `if/else` dupliquées (branche error vs non-error) dans le `colgroup` par un objet unique `COLUMN_WIDTHS` (source de vérité unique pour les 30+ colonnes). Toute colonne commune a désormais la même largeur quel que soit le plugin ou le logType.
- **Padding cellule unifié** : suppression du padding spécial `px-5` pour les error logs. Toutes les cellules et headers utilisent `px-4 py-3` uniformément.
- **`getColumnType` complété** : ajout de `port` dans les colonnes numériques, `action` dans les colonnes badge.
- **`getColumnDisplayName` complété** : ajout des noms d'affichage manquants (`tid` → TID, `protocol` → Protocol) et des alias défensifs (`severity`, `statuscode`, `httpcode`, `urlpath`, `user-agent`).
- **`COLUMN_WIDTHS` avec alias défensifs** : ajout des variantes de noms de colonnes (`severity`, `statuscode`, `httpcode`, `urlpath`, `user-agent`) pour garantir des largeurs correctes même avec des parsers custom.

---

## [0.2.0] - 2026-02-08

### Added

#### Internationalisation (i18n)
- **Traduction complète de l’administration** : namespaces et clés pour tous les onglets (Exporter, Database, Analysis, Notifications, Debug, Info). Tous les textes utilisent `t()` avec `fr.json` / `en.json`.
- **Page Analytique** : namespace `analytics` (titres, sections plugins, plus gros fichiers, base de données, infos utilisateur, rôles). Composant `AnalyticsPage` entièrement traduit.
- **Vue Log (LogTable)** : namespace `logViewer` pour la pagination (lignes par page, page X sur Y), les stats (lignes totales/valides/filtrées/illisibles), les tooltips des cellules (codes HTTP, taille, GZIP, upstream, temps de réponse, niveau, méthode HTTP). S’applique à Apache, Nginx, NPM et System.
- **Footer** : namespace `footer` pour les tooltips des boutons Analytique et Administration, et les tooltips détaillés des badges de stats (fichiers lisibles, taille totale, taille .gz).

#### Footer – UX
- **Tooltips sur les boutons** : tooltips au survol pour le bouton Analytique (« Statistiques et infos détaillées ») et Administration (« Paramètres et administration »). Tooltips détaillés pour les badges de stats (fichiers, taille, .gz).
- **Boutons icône seule** : boutons Analytique et Administration affichés en icône uniquement (sans texte) pour un footer plus compact.
- **Effet au clic** : retour visuel au clic sur les boutons de navigation (Analytique, Administration, plugins) via `active:brightness-90`, sans décalage des autres boutons.

#### Composant Tooltip
- **Affichage fiable** : rendu du tooltip dans un portail (`createPortal` vers `document.body`) pour éviter tout masquage par le footer (overflow, z-index). Z-index porté à 10000.
- **Position** : calcul de la position en `useLayoutEffect` avant affichage pour éviter un flash en (0,0). Contraintes pour rester dans le viewport.
- **Option `wrap`** : tooltips longs (badges stats) avec retour à la ligne et `max-w-sm`.

### Changed

#### Licence
- **Licence projet** : affichage dans l’onglet Info passé de « Privée » à « Public, MIT » (fr.json / en.json, clé `info.licenseValue`).

#### Versions
- **Fallback version serveur** : valeur par défaut dans `server/index.ts` et `server/routes/system.ts` alignée sur `0.2.0` lorsque `package.json` n’est pas lisible.

---

## [0.1.16] - 2026-02-08

### Fixed

#### Dashboard / Footer – Stats des plugins en Docker
- **Stats à 0 en Docker** : les routes `GET /plugins/:pluginId/stats` et l’agrégation « tous les plugins » utilisaient `getDefaultBasePath()` au lieu du chemin sauvegardé en base. Elles utilisent désormais `getEffectiveBasePath()` : les statistiques (Total, Lisibles, Taille) du dashboard et du footer reflètent le chemin configuré (ex. `/home/docker/nginx_proxy/data/logs` pour NPM).

#### Thème – Réglages d’animation en direct
- **Curseurs sans effet** : en passant au fond une seconde instance des paramètres (`animationParametersForBackground`), les sliders (vitesse, couleurs, etc.) ne mettaient à jour que le contexte, pas l’animation affichée. Quand une seule animation est sélectionnée, le fond reçoit maintenant les mêmes paramètres que le panneau Réglages (`backgroundParams` = paramètres du contexte), donc les réglages s’appliquent en direct.
- **Vitesse et animation non synchronisées (même onglet)** : `StorageEvent` ne se déclenche pas dans l’onglet qui modifie le `localStorage`. Événements personnalisés ajoutés (`logviewr_animation_speed_sync`, `logviewr_full_animation_id_sync`) pour que toutes les instances du hook `useBackgroundAnimation` (App + Réglages) reçoivent les changements de vitesse et de sélection d’animation en temps réel.

### Added

#### Thème – Animations
- **Bouton « Réinitialiser »** : à côté du titre « Paramètres de l’animation », un bouton remet tous les paramètres de l’animation courante aux valeurs par défaut (idéales).
- **Animation Étoiles** : paramètre **Couleur des étoiles (palette)** (`starColor`, type color, défaut `#6eb5ff`) ; si défini, dégradé et fond utilisent cette couleur (avec helper `hexToDarkHsl` pour les tons sombres).
- **Animation Sidelined** : paramètre **Couleur des lignes (palette)** (`lineColor`, type color, défaut `#a78bfa`) ; si défini, traits et glow utilisent cette couleur.

### Changed

#### Thème – Vagues de particules
- **Vitesse max et réactivité** : paramètre Vitesse étendu (max 8 → 15, défaut 0.5 → 0.8) ; diviseur de temps 5000 ms → 1500 ms ; phase des vagues amplifiée (`phaseSpeed = waveSpeed * 2.5`) pour un effet visible à vitesse max. Le curseur Vitesse (et le multiplicateur global) ont un impact net sur l’animation.

---

## [0.1.15] - 2026-02-08

### Fixed

#### Docker – Plugin NPM et chemin personnalisé
- **Liste de fichiers vide en Docker** : lorsque la page Log Viewer appelle l’API sans envoyer le paramètre `basePath` (route `files-direct`), le backend utilisait toujours le chemin par défaut du plugin (`/var/log/npm`) au lieu du chemin enregistré en base (ex. `/home/docker/nginx_proxy/data/logs`). Une fonction `getEffectiveBasePath()` a été ajoutée : priorité 1) valeur de la requête, 2) chemin sauvegardé en base (config du plugin), 3) défaut du plugin. Les routes `files`, `files-direct`, `scan` et `detected-files` utilisent désormais ce chemin effectif. Le chemin configuré dans Réglages → plugin NPM est ainsi respecté en Docker sans avoir à déclarer de volume supplémentaire.

### Changed

#### Thème – Animation de fond
- **Slider « Vitesse » (cycle Toutes)** : affichage de la valeur avec unité multiplicateur (×), plage 0,3× à 3,0× ; libellé et tooltip explicatifs (lent/rapide) ; utilisation de `speedToMultiplier` depuis `useBackgroundAnimation`.

#### Docker
- **docker-compose.yml** : commentaire ajouté précisant que le chemin personnalisé NPM (ex. `/home/docker/nginx_proxy/data/logs`) n’a pas besoin d’être déclaré en volume : le montage `/: /host:ro` expose déjà tout l’hôte, l’app résout le chemin automatiquement.

---

## [0.1.10] - 2026-02-08

### Fixed

#### Docker – Chemins des plugins
- **Chemins absolus hôte dans les options** : en Docker, tout chemin absolu saisi dans les options d’un plugin (ex. `/home/docker/nginx_proxy/data/logs`) est désormais préfixé par `HOST_ROOT_PATH` (`/host` par défaut). Le conteneur accède ainsi au bon répertoire (ex. `/host/home/docker/nginx_proxy/data/logs`), notamment quand `/var/log/npm` sur l’hôte est un symlink vers un autre répertoire.
- **Plugin NPM** : utilisation de `resolveDockerPathSync` (test des deux variantes `/host/logs/npm` et `/host/var/log/npm`) et logs de diagnostic en cas d’échec de `testConnection` ou de `scanLogFiles` (chemin testé + commande `docker exec` pour vérifier).

### Changed

#### Plugins Apache et NPM
- **Alignement Apache / NPM** : Apache utilise désormais `resolveDockerPathSync` et les mêmes messages de diagnostic que NPM en cas d’échec de connexion ou de scan. Les deux plugins partagent la même logique de résolution de chemin et de regex pour les fichiers (rotation `.log.1`, compression `.gz`/`.bz2`/`.xz`).
- **BasePlugin** : `resolveDockerPathSync` étendu pour gérer tout chemin absolu de l’hôte (pas seulement `/var/log`) en le préfixant par `/host` lorsque l’app tourne en Docker.

---

## [0.1.9] - 2026-02-08

### Added

#### Docker
- **Indication HOST_IP au démarrage** : en Docker, si `HOST_IP` n’est pas défini, un message dans les logs rappelle de définir `HOST_IP` dans le `.env` (ex. `HOST_IP=192.168.32.150`) pour afficher l’IP de la machine hôte dans le bandeau au lieu de la passerelle Docker

### Fixed

#### Plugin NPM (Docker)
- **Fichiers NPM visibles en Docker** : le plugin NPM applique désormais `convertToDockerPath()` sur le `basePath` (comme Apache et Nginx), afin que `/var/log/npm` soit converti en `/host/logs/npm` ou `/host/var/log/npm` et que les fichiers de logs NPM s’affichent correctement

### Changed

#### Docker
- **docker-compose.yml** : commentaires renforcés pour `HOST_IP` (recommandation et exemple 192.168.32.150)

---

## [0.1.8] - 2026-02-08

### Added

#### Log Viewer – Mode Live et Refresh auto
- **Bouton Play dans le header** : une fois un fichier sélectionné, affichage d’un bouton Play ouvrant un menu
  - **Live (temps réel)** : suivi WebSocket existant (tail -f)
  - **Refresh auto** : rechargement HTTP périodique avec intervalle choisi (2s, 5s, 10s, 15s, 30s)
- **Bouton Square (Stop)** : arrête le mode Live ou le Refresh auto
- **Persistance** : l’intervalle choisi pour le Refresh auto est sauvegardé dans `localStorage` (`logviewer_auto_refresh_interval_ms`)
- Constantes `AUTO_REFRESH_INTERVALS_MS`, `AUTO_REFRESH_DEFAULT_MS` et `AUTO_REFRESH_STORAGE_KEY` dans `src/utils/constants.ts`
- Compatible mode parsé et mode brut (raw) : le refresh auto utilise la même logique que le bouton Actualiser

### Changed

#### Sécurité des dépendances
- **Overrides npm** : `tar` >= 7.5.7 et `esbuild` >= 0.25.0 pour corriger les vulnérabilités (Dependabot) sans passage à bcrypt 6 ni vitest 4

---

## [0.1.7] - 2026-02-08

### Added

#### Footer
- **Badge taille des .gz**: Nouveau badge affichant la taille totale des fichiers de logs compressés (.gz)
  - Affiché uniquement si au moins un plugin a des fichiers .gz (et option "Lire les .gz" activée)
  - Style vert (emerald), icône Archive, tooltip explicatif
  - Calcul via double appel stats (quick=true pour non .gz, sans quick pour total) puis différence

#### Scripts
- **update-version.sh**: Script de mise à jour de version adapté au projet LogviewR
  - Met à jour `package.json`, `src/constants/version.ts` et `README.md` (badge, lien release, texte)
  - Lecture de la version courante depuis `package.json` ; suggestion de version patch si aucun argument
  - Rappel d’ajouter une entrée dans `CHANGELOG.md` et commandes git suggérées
  - Portable macOS/Linux (sed in-place), couleurs ANSI si TTY

### Changed

#### Header / Clock
- **Indicateur LED de l’horloge**: Couleur et animation alignées sur le thème
  - Couleur jaune fixe remplacée par `var(--accent-primary)` (suit le thème)
  - Nouvelle animation `clockLedGlow` (respiration 2s) : opacité et halo (box-shadow) en boucle
  - Définition de l’animation dans `src/index.css`, appliquée sur le point du composant Clock

#### Footer
- **Libellés des badges stats**: Tooltip du badge « taille » précisé : « Taille totale des fichiers de logs non compressés »
  - État des stats étendu avec `totalSizeGz` pour le nouveau badge .gz

---

## [0.1.4] - 2026-01-03

### Fixed

#### Plugin Options Panel
- **Auto-refresh issue**: Fixed automatic refresh that was overwriting user input when editing `basePath` field
  - Added debounce (500ms) for `basePath` field auto-save
  - Added debounce (1s) for detected files reload after `basePath` changes
  - Prevents file list from reloading while user is typing
  - User modifications are no longer overwritten during editing

#### Docker Path Conversion
- **Apache and Nginx plugins**: Fixed Docker path conversion for log files
  - Added `convertToDockerPath()` method in `BasePlugin` for automatic path conversion
  - Converts `/var/log/apache2` to `/host/logs/apache2` (or `/host/var/log/apache2` as fallback)
  - Converts `/var/log/nginx` to `/host/logs/nginx` (or `/host/var/log/nginx` as fallback)
  - Handles all paths starting with `/var/log` automatically
  - Works correctly even when `/host/logs` symlink doesn't exist

#### Host System Plugin
- **Docker path fallback**: Improved fallback mechanism for log base path
  - Uses `/host/var/log` directly when `/host/logs` symlink doesn't exist
  - Prevents "Connection failed" errors when symlink creation fails
  - Better compatibility with read-only filesystems

#### HTML Validation
- **Nested buttons**: Fixed React hydration error caused by nested `<button>` elements
  - Replaced parent buttons with `<div>` elements using `role="button"` and `tabIndex={0}`
  - Added keyboard navigation support (Enter and Space keys)
  - Applied to "Fichiers de logs système" and "Fichiers détectés avec regex" sections
  - Maintains full functionality and accessibility

#### TypeScript Errors
- **Type conversions**: Fixed TypeScript errors for `HostSystemPluginConfig` type conversions
  - Added `as unknown as` intermediate conversion for safe type casting
  - Fixed type mapping for 'user' and 'cron' log types in auto-detected files
  - Improved type safety in plugin configuration handling

### Added

#### Log File Permissions
- **Docker permissions**: Added automatic configuration for reading system log files
  - Container automatically adds `node` user to `adm` group (GID 4)
  - Allows reading files owned by `root:adm` with permissions `640`
  - Configurable via `ADM_GID` environment variable for custom GID
  - Supports reading auth.log, cron.log, daemon.log, syslog, and other system logs

#### Documentation
- **README updates**: Added comprehensive documentation for log file permissions
  - Section explaining Docker permissions configuration
  - Instructions for handling files with restrictive permissions (600)
  - Examples for fixing permissions on php8.0-fpm.log and rkhunter.log.1
  - Security notes about adm group usage

### Changed

#### Docker Configuration
- **docker-compose.yml**: Added `group_add` configuration for adm group
  - Automatically adds container to adm group for log file access
  - Configurable via `ADM_GID` environment variable (default: 4)

#### docker-entrypoint.sh
- **Group management**: Enhanced entrypoint script to add node user to adm group
  - Creates adm group with standard GID 4 if it doesn't exist
  - Adds node user to adm group for log file access
  - Works seamlessly with Docker volume mounts

---

## [0.1.3] - 2026-01-03

---

## [0.1.2] - 2025-01-28

### Changed

#### UI/UX Improvements
- **Header file selector**: Removed file count badge from "Fichiers de logs" button - count now only displayed on plugin icon badge
  - Cleaner header interface
  - File count remains visible on plugin icon for quick reference
- **Log table statistics**: Improved statistics badges display
  - Added file size badge (displayed first, before other badges)
  - Removed "Statistiques :" label text - only badges are now displayed
  - File size badge uses purple color scheme to differentiate from other badges
  - File size formatted automatically (B, KB, MB, GB)
- **Filter badges layout**: Enhanced filter badges display for better readability
  - Filter titles and badges now displayed on a single line with separator "|"
  - Applied to "Niveau", "Code HTTP", and "Méthode HTTP" filters
  - More compact and consistent layout
  - Better use of horizontal space

### Technical Details

- **Frontend**:
  - Updated `Header.tsx` to remove file count from file selector button
  - Updated `LogTable.tsx` to add file size badge and remove statistics label
  - Updated `LogFilters.tsx` to display filter titles and badges on single line
  - Added `fileSize` prop to `LogTable` component
  - Updated `LogViewerPage.tsx` to pass file size from `availableFiles` to `LogTable`

## [0.1.1] - 2025-01-28

### Added

#### Log Viewer Improvements
- **Automatic log loading**: Logs are now automatically loaded when a file is selected, eliminating the need to click "Refresh"
  - Automatic loading triggered when `selectedFilePath` or `selectedLogType` changes
  - Seamless user experience with immediate log display
- **Custom regex editor**: New modal for editing custom regex patterns for log files
  - `RegexEditorModal` component with full regex editing capabilities
  - Display of default regex pattern (if available) for the selected log type
  - Real-time regex testing with sample log lines
  - Visual feedback showing capture groups and matches
  - Validation of regex syntax before saving
- **Regex editor button in header**: Quick access to regex editor from the log viewer header
  - Button with `Code` icon next to the file selector
  - Only visible when a log file is selected
  - Opens the regex editor modal for the current file
- **Backend API for custom regex**: New API endpoints for managing custom regex patterns
  - `GET /api/log-viewer/plugins/:pluginId/default-regex` - Get default regex for a log type
  - `GET /api/log-viewer/plugins/:pluginId/regex-config` - Get custom regex for a file
  - `PUT /api/log-viewer/plugins/:pluginId/regex-config` - Save custom regex for a file
  - Custom regexes stored in plugin configuration via `PluginConfigRepository`
- **Custom regex display in plugin settings**: List of custom regexes in plugin configuration modal
  - New "Regex personnalisées" section in `PluginConfigModal`
  - Displays all custom regexes with file path, log type, modification date, and full regex pattern
  - Available for all log source plugins (host-system, nginx, apache, npm)
  - Helpful message explaining how to configure regexes from the log viewer

### Changed

- **Log file selection behavior**: File selection now automatically triggers log loading
  - Removed manual "Refresh" requirement after file selection
  - Improved user experience with immediate feedback
- **Header component**: Enhanced with regex editor button
  - Added `Code` icon button for regex editing
  - Integrated `RegexEditorModal` component
  - Conditional rendering based on file selection

### Technical Details

- **Frontend**:
  - New `RegexEditorModal.tsx` component with regex editing and testing
  - Updated `Header.tsx` with regex editor button and modal integration
  - Updated `LogViewerPage.tsx` with automatic log loading on file selection
  - Updated `PluginConfigModal.tsx` with custom regex display section
- **Backend**:
  - New routes in `log-viewer.ts` for regex management
  - Integration with `PluginConfigRepository` for persistent storage
  - Default regex patterns for common log types (NPM, Nginx, Apache, Host System)

## [0.1.0] - 2024-01-15

### Added

#### User Management
- **Automatic default admin user creation**: On first application startup, a default admin user is automatically created
  - Default username: `admin`
  - Default password: `admin123`
  - Default email: `admin@localhost`
  - Default role: `admin`
  - Credentials can be customized via environment variables:
    - `DEFAULT_ADMIN_USERNAME`
    - `DEFAULT_ADMIN_PASSWORD`
    - `DEFAULT_ADMIN_EMAIL`
- **JWT-based authentication system**: Secure user authentication using JSON Web Tokens
  - Token stored in browser localStorage
  - Automatic token validation on application startup
  - Automatic reconnection if valid token exists
  - Configurable token expiration (default: 7 days)
- **User login modal**: Automatic display of login modal when user is not authenticated
- **Password security**: Passwords are hashed using bcrypt (10 rounds)
- **Brute force protection**: Account lockout after multiple failed login attempts
- **User roles**: Support for three roles (`admin`, `user`, `viewer`)
- **User management**: Full CRUD operations for user accounts
  - User registration
  - User login/logout
  - User profile management
  - Password change functionality
  - User enable/disable
  - Role management

#### Log Source Plugin System
- **Plugin architecture**: New plugin system for log sources
  - `LogSourcePlugin` interface for implementing log source plugins
  - Support for multiple log source types (Apache, Nginx, NPM, Host System)
  - Plugin registration and management system
- **Host System Log Plugin**: Default plugin for reading system logs
  - Automatic detection of Docker environment
  - Reads logs from `/host/logs` in Docker or `/var/log` locally
  - Support for multiple log types:
    - Syslog
    - Auth logs
    - Kernel logs
    - Daemon logs
    - Mail logs
    - Custom logs
- **Log file scanning**: Automatic detection and scanning of log files
  - Pattern-based file matching
  - Support for rotated log files
  - Compressed file support (gzip)
- **Log parsing**: Specialized parsers for different log formats
  - Syslog parser
  - Nginx access/error log parser
  - Apache access/error log parser
  - NPM log parser
  - Auth log parser
  - Kernel log parser
  - Daemon log parser
  - Mail log parser
  - Custom log parser
- **Log reading service**: Efficient log file reading with streaming support
  - Configurable line limits
  - Support for reading from specific line numbers
  - Handling of large log files
- **Log parser service**: Coordinates log reading and parsing using registered plugins
  - Dynamic column detection based on log type
  - Parsed log entry structure
- **WebSocket streaming**: Real-time log streaming via WebSocket
  - `/ws/log-viewer` WebSocket endpoint
  - Real-time log updates
  - Automatic reconnection on disconnect
  - Follow mode for live log monitoring
- **REST API routes**: Complete API for log viewer functionality
  - `GET /api/log-viewer/plugins/:pluginId/files` - List available log files
  - `POST /api/log-viewer/plugins/:pluginId/scan` - Scan for log files
  - `GET /api/log-viewer/files/:fileId/logs` - Read logs from a file
  - `POST /api/log-viewer/plugins/:pluginId/read-direct` - Read logs directly (bypass DB)
  - `GET /api/log-viewer/plugins/:pluginId/files-direct` - List files directly (bypass DB)
  - `GET /api/log-viewer/sources` - List log sources
  - `POST /api/log-viewer/sources` - Create log source
  - `GET /api/log-viewer/sources/:id` - Get log source
  - `PUT /api/log-viewer/sources/:id` - Update log source
  - `DELETE /api/log-viewer/sources/:id` - Delete log source
  - `GET /api/log-viewer/files` - List log files
  - `PUT /api/log-viewer/files/:id` - Update log file
  - `DELETE /api/log-viewer/files/:id` - Delete log file
- **Database models**: New database models for log management
  - `LogSource` model for managing log sources
  - `LogFile` model for managing individual log files
  - Database tables with proper indexes

#### Frontend Log Viewer
- **LogViewerPage**: Complete log viewer page component
  - Plugin selection
  - File selection
  - Log display with dynamic columns
  - Real-time log streaming support
- **LogTable component**: Structured table for displaying logs
  - Dynamic columns based on log type
  - Colored badges for log levels, HTTP codes, methods
  - Responsive design with horizontal scrolling on mobile
- **LogBadge component**: Colored badges for log entries
  - Level badges (INFO, WARN, ERROR, DEBUG, etc.)
  - HTTP code badges (2xx, 3xx, 4xx, 5xx)
  - HTTP method badges (GET, POST, DELETE, etc.)
  - Response time badges
- **LogFilters component**: Advanced filtering system
  - Text search with debounce (300ms)
  - Level filtering
  - HTTP code filtering
  - HTTP method filtering
  - Date range filtering
  - IP source filtering
  - Active filter count badge
  - Reset filters button
  - Responsive modal on mobile
- **WebSocket hook**: React hook for WebSocket connection
  - `useLogViewerWebSocket` hook
  - Automatic connection management
  - Automatic reconnection on disconnect
  - Subscribe/unsubscribe to log files
  - Real-time log updates
- **Log viewer store**: Zustand store for log viewer state management
  - Selected plugin and file state
  - Log entries state
  - Filter state
  - WebSocket connection state
  - Loading and error states
- **Dashboard integration**: Button in dashboard to navigate to log viewer
- **TypeScript types**: Complete type definitions for log viewer
  - `LogEntry` interface
  - `LogFilters` interface
  - `LogFileInfo` interface

### Changed

- **Project name**: Changed from "MyNetwork" to "LogviewR"
- **Project version**: Set to `0.1.0`
- **Removed Freebox/UniFi/Scanner**: All Freebox, UniFi, and network scanner code has been removed
  - Freebox API routes removed
  - Freebox services removed
  - UniFi plugin removed
  - Network scanner plugin removed
  - Freebox-specific WebSocket removed
  - Freebox-specific configuration removed

### Removed

- Freebox API integration
- UniFi plugin
- Network scanner plugin
- Freebox WebSocket service
- Latency monitoring system
- All Freebox-specific routes and services

### Security

- JWT-based authentication
- Password hashing with bcrypt
- Brute force protection
- Token expiration management
- Secure token storage

### Technical Details

- **Backend**: Node.js with Express.js
- **Frontend**: React with TypeScript
- **Database**: SQLite with WAL mode
- **WebSocket**: ws library for real-time communication
- **Authentication**: JWT tokens
- **Password hashing**: bcrypt

---

## Future Plans

### Planned Features

- **Additional log source plugins**:
  - Apache log plugin (in progress)
  - Nginx log plugin (in progress)
  - NPM log plugin (in progress)
- **Dashboard page**: Summary dashboard with plugin statistics
- **Export functionality**: Export logs in multiple formats (CSV, JSON, TXT, Excel, PDF)
- **Advanced filtering**: Server-side filtering for better performance
- **Log statistics**: Statistics and analytics for log sources
- **Plugin icon buttons**: Footer integration with plugin icons
- **Clock component**: Real-time clock in header
- **Header improvements**: Adaptive header with file selector

---

[0.2.5]: https://github.com/Erreur32/LogviewR/releases/tag/v0.2.5
[0.2.2]: https://github.com/Erreur32/LogviewR/releases/tag/v0.2.2
[0.2.1]: https://github.com/Erreur32/LogviewR/releases/tag/v0.2.1
[0.2.0]: https://github.com/Erreur32/LogviewR/releases/tag/v0.2.0
[0.1.0]: https://github.com/Erreur32/LogviewR/releases/tag/v0.1.0
