#!/bin/bash
LOGDIR="/home/docker/nginx_proxy/data/logs"
cd "$LOGDIR" || exit 1

echo "📁 $PWD ($(ls | wc -l) fichiers)"
echo "================================"

declare -A types
types[access_proxy]="proxy-host-[0-9]*_access.log*"
types[error_proxy]="proxy-host-[0-9]*_error.log*"
types[default]="default-host_*"
types[dead]="dead-host-*"
types[fallback]="fallback_*"
types[letsencrypt]="letsencrypt.log*"

for type in "${!types[@]}"; do
  patt="${types[$type]}"
  mapfile -t candidates < <(ls "$patt" 2>/dev/null)
  largest=$(ls -S "${candidates[@]}" 2>/dev/null | head -1)
  
  if [ -n "$largest" ] && [ -s "$largest" ]; then
    size=$(du -h "$largest" | cut -f1)
    echo "✅ $type ($(ls "$patt" 2>/dev/null | wc -l) fichiers)"
    echo "📄 $largest ($size)"
    echo "────────────────"
    if [[ $largest == *.gz ]]; then zcat "$largest" | head -10; else head -10 "$largest"; fi
  else
    echo "❌ $type: aucun valide"
  fi
  echo
done
