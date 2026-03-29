# ===========================================
# LogviewR - Node 22 Alpine (OPTIMIZED MULTI-STAGE)
# ===========================================

# ---------- Stage 0 : fail2ban 1.0.2 provider (Alpine 3.19) ----------
# Debian 12 / Ubuntu 22.04 ship fail2ban 1.0.2. The Alpine 3.21 community
# package (1.1.0) has a different socket protocol that breaks reload against
# these hosts. We extract just the client script + pure-Python package from
# Alpine 3.19 and inject it into the runtime image — no build-time dependency
# conflicts since nothing is compiled.
FROM alpine:3.19 AS fail2ban-provider
RUN apk add --no-cache fail2ban python3 && \
    # Locate the site-packages dir dynamically (py version may change)
    F2B_PKG=$(python3 -c "import site; print(site.getsitepackages()[0])")/fail2ban && \
    cp -r "$F2B_PKG" /fail2ban-pkg

# ---------- Stage 1 : Build (avec outils de build) ----------
FROM --platform=$BUILDPLATFORM node:22-alpine AS builder

WORKDIR /app

# 🔴 Outils de build OBLIGATOIRES pour compiler better-sqlite3 et autres modules natifs
# Ces outils seront supprimés dans l'image finale
RUN apk add --no-cache python3 make g++

# Install all dependencies (including devDependencies) to compile native modules
# devDependencies are removed in the final image (see npm prune --production below)
COPY package*.json ./
RUN NO_UPDATE_NOTIFIER=1 npm ci --loglevel=error --no-fund

# Copier le code source et builder
COPY . .
RUN npm run build

# Préparer node_modules de production (sans devDependencies mais avec binaires compilés)
# On garde les binaires compilés de better-sqlite3 et on supprime seulement les devDependencies
# npm prune --production supprime les devDependencies mais garde les binaires compilés
RUN npm prune --production && npm cache clean --force


# ---------- Stage 2 : Runtime (image finale légère) ----------
FROM node:22-alpine

WORKDIR /app

# 🎯 Outils RUNTIME uniquement (pas d'outils de build)
# su-exec    : nécessaire pour l'entrypoint script (switch root → node)
# python3    : interpréteur pour fail2ban-client (script Python)
# iptables   : lecture des règles pare-feu (onglet IPTables — nécessite cap_add: NET_ADMIN)
# ipset      : lecture des sets d'IPs (onglet IPSet — nécessite cap_add: NET_ADMIN)
# nftables   : lecture des règles nftables (onglet NFTables — nécessite cap_add: NET_ADMIN)
# fail2ban-client 1.0.2 is injected from Stage 0 (see COPY below) to match
# Debian 12 / Ubuntu 22.04 hosts — NOT installed via apk to avoid version conflicts.
RUN apk add --no-cache su-exec iptables ipset nftables sudo python3

# Inject fail2ban-client 1.0.2 from Alpine 3.19 (pure Python — runs on any Python 3.x)
COPY --from=fail2ban-provider /usr/bin/fail2ban-client /usr/bin/fail2ban-client
COPY --from=fail2ban-provider /fail2ban-pkg /usr/local/lib/fail2ban/
ENV PYTHONPATH=/usr/local/lib
# Allow the node user to run network tools as root (needed when app runs as non-root
# but the host kernel's nf_tables backend requires UID 0 even with NET_ADMIN cap).
RUN echo "node ALL=(root) NOPASSWD: /usr/sbin/iptables, /usr/sbin/iptables-save, /usr/sbin/iptables-restore, /usr/sbin/ipset, /usr/sbin/nft" \
    > /etc/sudoers.d/logviewr-nettools \
    && chmod 0440 /etc/sudoers.d/logviewr-nettools

# Créer le répertoire data avec les bonnes permissions
RUN mkdir -p /app/data && chown -R node:node /app

# Créer les répertoires de montage pour les volumes host (évite les erreurs de montage)
# Ces répertoires seront montés par docker-compose avec les volumes du host
RUN mkdir -p /host/logs /host/proc /host/sys /host/etc /host/usr/bin

# Copier l'entrypoint script (nécessite su-exec)
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Entrypoint pour corriger les permissions au démarrage
ENTRYPOINT ["/app/docker-entrypoint.sh"]

# 🎯 Copier node_modules compilés depuis le stage build (binaires natifs déjà compilés)
# Cela évite de recompiler better-sqlite3 dans l'image finale
# Les binaires sont compilés pour l'architecture cible dans le stage build
COPY --chown=node:node --from=builder /app/node_modules ./node_modules

# Copier package.json pour référence (nécessaire pour certaines dépendances)
COPY --chown=node:node package*.json ./

# Frontend buildé
COPY --chown=node:node --from=builder /app/dist ./dist

# Backend TypeScript (exécuté par tsx)
COPY --chown=node:node --from=builder /app/server ./server
COPY --chown=node:node --from=builder /app/tsconfig.json ./

# CHANGELOG.md for Administration > Info tab (GET /api/info/changelog)
COPY --chown=node:node --from=builder /app/CHANGELOG.md ./

ENV NODE_ENV=production
ENV PORT=3000

# Healthcheck avec wget (déjà présent dans Alpine de base)
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
 CMD wget -q --spider http://127.0.0.1:${PORT}/api/health || exit 1

EXPOSE 3000

# TS runtime (tsx exécute les fichiers TypeScript directement)
CMD ["node_modules/.bin/tsx", "server/index.ts"]
