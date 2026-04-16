#!/bin/bash
# =============================================================================
# setup-fail2ban-access.sh — Fail2ban Docker access setup
#
# Checks and fixes permissions so LogviewR (Docker) can access fail2ban.
# Run as root or with sudo.
#
# Usage:
#   sudo ./scripts/setup-fail2ban-access.sh          # check + auto-fix
#   sudo ./scripts/setup-fail2ban-access.sh --check  # check only
# =============================================================================

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

CHECK_ONLY=false
[[ "$1" == "--check" ]] && CHECK_ONLY=true

ok()   { echo -e "  ${GREEN}✔${RESET}  $*"; }
warn() { echo -e "  ${YELLOW}⚠${RESET}  $*"; }
fail() { echo -e "  ${RED}✘${RESET}  $*"; }
info() { echo -e "  ${CYAN}→${RESET}  $*"; }
section() { echo -e "\n${BOLD}$*${RESET}"; echo "  $(printf '─%.0s' {1..55})"; }

SOCKET_PATH="/var/run/fail2ban/fail2ban.sock"
SQLITE_PATH="/var/lib/fail2ban/fail2ban.sqlite3"
DROPIN_DIR="/etc/systemd/system/fail2ban.service.d"
DROPIN_FILE="$DROPIN_DIR/docker-access.conf"
ENV_FILE=".env"
ERRORS=0

# ── Root check ────────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
    echo -e "${RED}Ce script doit être lancé en root (sudo).${RESET}"
    exit 1
fi

echo -e "\n${BOLD}${CYAN}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${CYAN}║   LogviewR — Fail2ban access setup               ║${RESET}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════╝${RESET}"
$CHECK_ONLY && echo -e "  ${YELLOW}Mode: vérification uniquement (--check)${RESET}"

# ─────────────────────────────────────────────────────────────────────────────
section "1. fail2ban installé et actif"

if ! command -v fail2ban-client &>/dev/null; then
    fail "fail2ban-client introuvable"
    info "Installez fail2ban : sudo apt install fail2ban"
    ERRORS=$((ERRORS+1))
else
    ok "fail2ban-client trouvé : $(command -v fail2ban-client)"
fi

if systemctl is-active --quiet fail2ban; then
    ok "fail2ban service actif"
else
    warn "fail2ban service inactif"
    if ! $CHECK_ONLY; then
        info "Démarrage de fail2ban..."
        systemctl start fail2ban && ok "fail2ban démarré" || { fail "Impossible de démarrer fail2ban"; ERRORS=$((ERRORS+1)); }
    fi
fi

# ─────────────────────────────────────────────────────────────────────────────
section "2. Groupe fail2ban"

if getent group fail2ban &>/dev/null; then
    FAIL2BAN_GID=$(getent group fail2ban | cut -d: -f3)
    ok "Groupe fail2ban existant — GID $FAIL2BAN_GID"
else
    warn "Groupe fail2ban inexistant"
    if ! $CHECK_ONLY; then
        groupadd fail2ban
        FAIL2BAN_GID=$(getent group fail2ban | cut -d: -f3)
        ok "Groupe fail2ban créé — GID $FAIL2BAN_GID"
    else
        info "Fix : sudo groupadd fail2ban"
        ERRORS=$((ERRORS+1))
    fi
fi

# ─────────────────────────────────────────────────────────────────────────────
section "3. Drop-in systemd (permissions socket au démarrage)"

DROPIN_NEEDED=false
if [[ -f "$DROPIN_FILE" ]]; then
    if grep -q "chown root:fail2ban.*fail2ban.sock" "$DROPIN_FILE" && grep -q "chmod 660.*fail2ban.sock" "$DROPIN_FILE"; then
        ok "Drop-in existant et correct : $DROPIN_FILE"
    else
        warn "Drop-in existant mais n'applique pas chown root:fail2ban + chmod 660 sur le socket"
        DROPIN_NEEDED=true
    fi
else
    warn "Drop-in absent : $DROPIN_FILE"
    DROPIN_NEEDED=true
fi

if $DROPIN_NEEDED; then
    info "Contenu attendu :"
    echo -e "    ${CYAN}[Service]${RESET}"
    echo -e "    ${CYAN}ExecStartPost=/bin/sh -c 'i=0; while [ \$i -lt 30 ] && ! fail2ban-client ping >/dev/null 2>&1; do sleep 0.5; i=\$((i+1)); done; chown root:fail2ban /var/run/fail2ban/fail2ban.sock 2>/dev/null; chmod 660 /var/run/fail2ban/fail2ban.sock 2>/dev/null; chmod 644 /var/lib/fail2ban/fail2ban.sqlite3 2>/dev/null'${RESET}"

    if ! $CHECK_ONLY; then
        mkdir -p "$DROPIN_DIR"
        cat > "$DROPIN_FILE" << 'EOF'
[Service]
ExecStartPost=/bin/sh -c 'i=0; while [ $i -lt 30 ] && ! fail2ban-client ping >/dev/null 2>&1; do sleep 0.5; i=$((i+1)); done; chown root:fail2ban /var/run/fail2ban/fail2ban.sock 2>/dev/null; chmod 660 /var/run/fail2ban/fail2ban.sock 2>/dev/null; chmod 644 /var/lib/fail2ban/fail2ban.sqlite3 2>/dev/null'
EOF
        ok "Drop-in créé : $DROPIN_FILE"
        systemctl daemon-reload
        ok "systemctl daemon-reload effectué"
        info "Redémarrage de fail2ban pour appliquer le drop-in..."
        systemctl restart fail2ban
        sleep 4
        ok "fail2ban redémarré"
    else
        info "Fix : sudo mkdir -p $DROPIN_DIR && sudo tee $DROPIN_FILE (voir contenu ci-dessus)"
        ERRORS=$((ERRORS+1))
    fi
fi

# ─────────────────────────────────────────────────────────────────────────────
section "4. Socket Unix"

if [[ -S "$SOCKET_PATH" ]]; then
    SOCK_MODE=$(stat -c "%a" "$SOCKET_PATH" 2>/dev/null)
    SOCK_GROUP=$(stat -c "%G" "$SOCKET_PATH" 2>/dev/null)
    if [[ "$SOCK_GROUP" == "fail2ban" && "$SOCK_MODE" == "660" ]]; then
        ok "Socket OK : $SOCKET_PATH (660 root:fail2ban)"
    else
        warn "Socket présent mais mode ${SOCK_MODE} root:${SOCK_GROUP} — le container Docker ne peut pas y accéder"
        if ! $CHECK_ONLY; then
            chown root:fail2ban "$SOCKET_PATH"
            chmod 660 "$SOCKET_PATH"
            ok "Permissions corrigées : 660 root:fail2ban"
        else
            info "Fix : sudo chown root:fail2ban $SOCKET_PATH && sudo chmod 660 $SOCKET_PATH"
            ERRORS=$((ERRORS+1))
        fi
    fi
else
    fail "Socket absent : $SOCKET_PATH"
    info "fail2ban est-il démarré ? sudo systemctl start fail2ban"
    ERRORS=$((ERRORS+1))
fi

# ─────────────────────────────────────────────────────────────────────────────
section "5. Base SQLite"

if [[ -f "$SQLITE_PATH" ]]; then
    SQLITE_MODE=$(stat -c "%a" "$SQLITE_PATH" 2>/dev/null)
    if [[ -r "$SQLITE_PATH" ]]; then
        ok "SQLite accessible : $SQLITE_PATH ($SQLITE_MODE)"
    else
        warn "SQLite non lisible : $SQLITE_PATH ($SQLITE_MODE)"
        if ! $CHECK_ONLY; then
            chmod 644 "$SQLITE_PATH"
            ok "Permissions corrigées : 644"
        else
            info "Fix : sudo chmod 644 $SQLITE_PATH"
            ERRORS=$((ERRORS+1))
        fi
    fi
else
    warn "SQLite absent : $SQLITE_PATH"
    info "fail2ban utilise-t-il le backend SQLite ? (backend >= 0.8)"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "6. Config fail2ban — permissions d'écriture (édition UI)"

CONF_DIR="/etc/fail2ban"
CONF_FILES=("jail.local" "fail2ban.local")
CONF_NEED_FIX=false

# Check directory itself
dir_mode=$(stat -c "%a" "$CONF_DIR" 2>/dev/null)
dir_group=$(stat -c "%G" "$CONF_DIR" 2>/dev/null)
if [[ "$dir_group" == "fail2ban" && "$dir_mode" == "775" ]]; then
    ok "Dossier $CONF_DIR : $dir_mode root:fail2ban"
else
    warn "Dossier $CONF_DIR : ${dir_mode:-?} root:${dir_group:-?} — création de .local impossible depuis l'UI"
    CONF_NEED_FIX=true
fi

for f in "${CONF_FILES[@]}"; do
    fp="$CONF_DIR/$f"
    if [[ -f "$fp" ]]; then
        fmode=$(stat -c "%a" "$fp" 2>/dev/null)
        fgroup=$(stat -c "%G" "$fp" 2>/dev/null)
        if [[ "$fgroup" == "fail2ban" && ("$fmode" == "664" || "$fmode" == "660") ]]; then
            ok "$f : $fmode root:fail2ban (édition UI OK)"
        else
            warn "$f : ${fmode:-?} root:${fgroup:-?} — écriture depuis l'UI impossible"
            CONF_NEED_FIX=true
        fi
    else
        info "$f absent — sera créable depuis l'UI si le dossier est accessible"
    fi
done

if $CONF_NEED_FIX; then
    if ! $CHECK_ONLY; then
        chown root:fail2ban "$CONF_DIR" 2>/dev/null
        chmod 775 "$CONF_DIR" 2>/dev/null
        ok "Dossier $CONF_DIR : 775 root:fail2ban"
        for f in "${CONF_FILES[@]}"; do
            fp="$CONF_DIR/$f"
            if [[ -f "$fp" ]]; then
                chown root:fail2ban "$fp" 2>/dev/null
                chmod 664 "$fp" 2>/dev/null
                ok "$f : 664 root:fail2ban"
            fi
        done
        echo ""
        info "Activez aussi le montage rw dans docker-compose.yml :"
        echo -e "    ${CYAN}# Optional: enable Fail2ban config file editing from the UI${RESET}"
        echo -e "    ${CYAN}- type: bind${RESET}"
        echo -e "    ${CYAN}  source: /etc/fail2ban${RESET}"
        echo -e "    ${CYAN}  target: /host/etc/fail2ban${RESET}"
        echo -e "    ${CYAN}  bind:${RESET}"
        echo -e "    ${CYAN}    propagation: shared${RESET}"
        info "Puis : docker compose up -d --force-recreate"
    else
        info "Fix : sudo chown root:fail2ban /etc/fail2ban && sudo chmod 775 /etc/fail2ban"
        info "      sudo chown root:fail2ban /etc/fail2ban/{jail,fail2ban}.local 2>/dev/null"
        info "      sudo chmod 664 /etc/fail2ban/{jail,fail2ban}.local 2>/dev/null"
        info "Et activez le montage rw /etc/fail2ban dans docker-compose.yml"
        ERRORS=$((ERRORS+1))
    fi
fi

# ─────────────────────────────────────────────────────────────────────────────
section "7. Configuration docker-compose (.env + docker-compose.yml)"

if [[ -n "$FAIL2BAN_GID" ]]; then
    # ── .env — write FAIL2BAN_GID ──────────────────────────────────────────
    if [[ -f "$ENV_FILE" ]]; then
        if grep -q "^FAIL2BAN_GID=" "$ENV_FILE" 2>/dev/null; then
            CURRENT_GID=$(grep "^FAIL2BAN_GID=" "$ENV_FILE" | cut -d= -f2)
            if [[ "$CURRENT_GID" == "$FAIL2BAN_GID" ]]; then
                ok ".env : FAIL2BAN_GID=$FAIL2BAN_GID (déjà présent)"
            else
                if ! $CHECK_ONLY; then
                    sed -i "s/^FAIL2BAN_GID=.*/FAIL2BAN_GID=$FAIL2BAN_GID/" "$ENV_FILE"
                    ok ".env : FAIL2BAN_GID mis à jour $CURRENT_GID → $FAIL2BAN_GID"
                else
                    warn ".env : FAIL2BAN_GID=$CURRENT_GID (attendu $FAIL2BAN_GID)"
                    ERRORS=$((ERRORS+1))
                fi
            fi
        else
            if ! $CHECK_ONLY; then
                echo "FAIL2BAN_GID=$FAIL2BAN_GID" >> "$ENV_FILE"
                ok ".env : FAIL2BAN_GID=$FAIL2BAN_GID ajouté"
            else
                warn ".env : FAIL2BAN_GID absent"
                info "Fix : echo \"FAIL2BAN_GID=$FAIL2BAN_GID\" >> $ENV_FILE"
                ERRORS=$((ERRORS+1))
            fi
        fi
    else
        warn ".env introuvable — créez-le d'abord : echo \"JWT_SECRET=\$(openssl rand -base64 32)\" > .env"
        ERRORS=$((ERRORS+1))
    fi

    # ── docker-compose.yml — uncomment fail2ban lines ──────────────────────
    COMPOSE_FILE="docker-compose.yml"
    if [[ -f "$COMPOSE_FILE" ]]; then
        PATCHED=false

        # Uncomment FAIL2BAN_GID group_add line
        if grep -q '# - "\${FAIL2BAN_GID}"' "$COMPOSE_FILE" 2>/dev/null; then
            if ! $CHECK_ONLY; then
                sed -i 's|# - "\${FAIL2BAN_GID}"|- "\${FAIL2BAN_GID}"|' "$COMPOSE_FILE"
                ok "docker-compose.yml : group_add FAIL2BAN_GID décommenté"
                PATCHED=true
            else
                warn "docker-compose.yml : group_add FAIL2BAN_GID commenté"
                ERRORS=$((ERRORS+1))
            fi
        elif grep -q '- "\${FAIL2BAN_GID}"' "$COMPOSE_FILE" 2>/dev/null; then
            ok "docker-compose.yml : group_add FAIL2BAN_GID déjà actif"
        fi

        # Uncomment fail2ban socket mount
        if grep -q '# - /var/run/fail2ban/fail2ban.sock' "$COMPOSE_FILE" 2>/dev/null; then
            if ! $CHECK_ONLY; then
                sed -i 's|# - /var/run/fail2ban/fail2ban.sock:/var/run/fail2ban/fail2ban.sock|- /var/run/fail2ban/fail2ban.sock:/var/run/fail2ban/fail2ban.sock|' "$COMPOSE_FILE"
                ok "docker-compose.yml : montage socket fail2ban décommenté"
                PATCHED=true
            else
                warn "docker-compose.yml : montage socket fail2ban commenté"
                ERRORS=$((ERRORS+1))
            fi
        elif grep -q '- /var/run/fail2ban/fail2ban.sock' "$COMPOSE_FILE" 2>/dev/null; then
            ok "docker-compose.yml : montage socket déjà actif"
        fi

        if $PATCHED; then
            echo ""
            info "Relancez le container pour appliquer :"
            echo -e "    ${CYAN}docker compose up -d --force-recreate${RESET}"
        fi
    else
        info "docker-compose.yml introuvable — les lignes fail2ban sont à décommenter manuellement"
    fi
fi

# ─────────────────────────────────────────────────────────────────────────────
section "Résumé"

if [[ $ERRORS -eq 0 ]]; then
    echo -e "\n  ${GREEN}${BOLD}✔ Tout est en ordre.${RESET}"
    if ! $CHECK_ONLY; then
        echo -e "  ${GREEN}Relancez le container Docker pour prendre en compte les changements :${RESET}"
        echo -e "  ${CYAN}  docker compose up -d --force-recreate${RESET}"
    fi
else
    echo -e "\n  ${RED}${BOLD}✘ $ERRORS problème(s) détecté(s).${RESET}"
    $CHECK_ONLY && echo -e "  ${YELLOW}Relancez sans --check pour corriger automatiquement.${RESET}"
fi
echo ""
