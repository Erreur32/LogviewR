#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Bump LogviewR version across the repo (run from project root or anywhere).
# Usage:   ./scripts/update-version.sh <new_version>
# Example: ./scripts/update-version.sh 0.1.7
#
# Updated files:
#   1. package.json              — "version" field
#   2. src/constants/version.ts   — APP_VERSION constant
#   3. README.md                  — LogviewR badge, release link (if any), version text
#
# After running, add a new entry in CHANGELOG.md for this version.
# ──────────────────────────────────────────────────────────────────────────────

set -e

# ── ANSI colors (disable if not a TTY) ───────────────────────────────────────
if [ -t 1 ]; then
  R="\033[0m"
  B="\033[1m"
  G="\033[32m"
  Y="\033[33m"
  C="\033[36m"
  M="\033[35m"
  RED="\033[31m"
else
  R="" B="" G="" Y="" C="" M="" RED=""
fi

# ── Resolve repo root (script lives in scripts/) ────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# ── Target files ─────────────────────────────────────────────────────────────
PACKAGE_JSON="$REPO_ROOT/package.json"
VERSION_TS="$REPO_ROOT/src/constants/version.ts"
ROOT_README="$REPO_ROOT/README.md"

# ── Read current version from package.json ────────────────────────────────────
if [ ! -f "$PACKAGE_JSON" ]; then
  echo -e "${RED}Error:${R} package.json not found at $PACKAGE_JSON"
  exit 1
fi

CURRENT=$(grep -E '"version":' "$PACKAGE_JSON" | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
if [ -z "$CURRENT" ]; then
  echo -e "${RED}Error:${R} could not read current version from package.json"
  exit 1
fi

# ── Argument: new version ────────────────────────────────────────────────────
NEW="$1"
if [ -z "$NEW" ]; then
  # Suggest next patch version (e.g. 0.1.6 -> 0.1.7)
  SUGGESTED=$(echo "$CURRENT" | awk -F. '{$NF=$NF+1; print $0}' OFS=.)
  echo ""
  echo -e "  ${B}Current version:${R} ${C}${CURRENT}${R}"
  echo ""
  echo "  Usage: $0 <new_version>"
  echo ""
  echo "  Example (next patch):"
  echo -e "    ${C}$0 ${SUGGESTED}${R}"
  echo ""
  exit 0
fi

# ── Sanity check: new != current ─────────────────────────────────────────────
if [ "$NEW" = "$CURRENT" ]; then
  echo -e "${Y}Warning:${R} new version ($NEW) is the same as current ($CURRENT). Nothing to do."
  exit 0
fi

echo ""
echo -e "${M}${B}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${R}"
echo -e "${M}${B}  Bump LogviewR version: $CURRENT → $NEW${R}"
echo -e "${M}${B}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${R}"
echo ""

# Escape dots for sed regex (replace . with \.)
CURRENT_ESC=$(echo "$CURRENT" | sed 's/\./\\./g')

# ── Helper: sed in-place (portable macOS / Linux) ───────────────────────────
# Uses .bak extension then removes the backup to stay portable across GNU
# sed (Linux) and BSD sed (macOS) which requires -i '' or -i.bak.
sedi() {
  local file="$1"; shift
  sed -i.bak "$@" "$file" && rm -f "${file}.bak"
}

# ── Generic semver pattern for sed (matches any X.Y.Z) ──────────────────────
SEMVER_PATTERN='[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*'

# ═══════════════════════════════════════════════════════════════════════════════
#  VERSION UPDATES (steps 1–3)
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "  ${B}── Version bump ──${R}"

# ── 1. package.json — version field ─────────────────────────────────────────
if [ -f "$PACKAGE_JSON" ]; then
  sedi "$PACKAGE_JSON" "s/\"version\": \"$CURRENT_ESC\"/\"version\": \"$NEW\"/"
  echo -e "  ${G}✓${R} package.json           ${C}(\"version\": \"$NEW\")${R}"
else
  echo -e "  ${RED}✗${R} package.json           ${RED}(file not found)${R}"
fi

# ── 2. src/constants/version.ts — APP_VERSION ───────────────────────────────
if [ -f "$VERSION_TS" ]; then
  sedi "$VERSION_TS" "s/APP_VERSION = '$CURRENT_ESC'/APP_VERSION = '$NEW'/"
  echo -e "  ${G}✓${R} src/constants/version.ts  ${C}(APP_VERSION = '$NEW')${R}"
else
  echo -e "  ${RED}✗${R} src/constants/version.ts  ${RED}(file not found)${R}"
fi

# ── 3. README.md — badge, release link, version text ────────────────────────
if [ -f "$ROOT_README" ]; then
  # Badge: LogviewR-X.Y.Z → LogviewR-<NEW> (match any existing version in badge)
  sedi "$ROOT_README" "s/LogviewR-${SEMVER_PATTERN}/LogviewR-$NEW/g"
  # Release link: releases/tag/vX.Y.Z → releases/tag/v<NEW> (if present)
  sedi "$ROOT_README" "s|releases/tag/v${SEMVER_PATTERN}|releases/tag/v$NEW|g"
  # Inline version: `X.Y.Z` → `<NEW>` (backtick-quoted semver, current only to avoid wide replace)
  sedi "$ROOT_README" "s/\`$CURRENT_ESC\`/\`$NEW\`/g"
  echo -e "  ${G}✓${R} README.md               ${C}(badge + release link + version text)${R}"
else
  echo -e "  ${RED}✗${R} README.md               ${RED}(file not found)${R}"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${G}${B}Done.${R} LogviewR version is now ${B}$NEW${R}."
echo -e "${Y}→${R} Add a new section in ${B}CHANGELOG.md${R} for this version."
echo ""
echo -e "${C}${B}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${R}"
echo -e "${C}${B}  Suggested commands (copy / paste)${R}"
echo -e "${C}${B}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${R}"
echo ""
echo -e "  ${B}git add -A && git commit -m \"release: v$NEW\" && git push${R}"
echo ""
