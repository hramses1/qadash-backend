#!/usr/bin/env bash
# Mantiene el servidor al dia con GitHub. Pensado para correr desde cron.
#
# Vive fuera del backend a proposito: si se actualiza el propio backend y el
# proceso se reinicia, un actualizador que viviera dentro moriria a mitad. Como
# script externo eso no importa.
#
# Instalacion (cada 5 minutos):
#   crontab -e
#   */5 * * * * /home/hramses1/projects/bolivariano/qadash-backend/scripts/auto-update.sh
set -uo pipefail

BASE="${QADASH_BASE:-$HOME/projects/bolivariano}"
BACKEND="$BASE/qadash-backend"
FRONTEND="$BASE/qadash-frontend"
LOG="${QADASH_UPDATE_LOG:-$HOME/.qadash-auto-update.log}"
LOCK="/tmp/qadash-auto-update.lock"

# cron arranca con un PATH minimo: sin esto no encuentra node, npm ni pm2,
# que aqui viven bajo nvm.
export PATH="$HOME/.nvm/versions/node/v24.13.1/bin:/usr/local/bin:/usr/bin:/bin"

log() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }

# Dos ejecuciones solapadas se pisarian en el mismo working tree. flock suelta
# el lock solo si el proceso muere, asi que no hay que limpiarlo a mano.
exec 9>"$LOCK"
flock -n 9 || { log "otra ejecucion en curso, se omite"; exit 0; }

# Devuelve 0 si el repo se actualizo, 1 si no habia nada o no se pudo.
actualizar_repo() {
  local dir="$1" nombre="$2"
  cd "$dir" 2>/dev/null || { log "$nombre: no existe $dir"; return 1; }

  local rama; rama=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || return 1

  # Los archivos sin rastrear no estorban a un fast-forward; los rastreados con
  # cambios locales si, y pisarlos automaticamente seria destructivo.
  local sucios; sucios=$(git status --porcelain | grep -vc '^??' || true)
  if [ "$sucios" -gt 0 ]; then
    log "$nombre: $sucios archivo(s) con cambios sin commitear, se omite"
    return 1
  fi

  git fetch origin --quiet 2>>"$LOG" || { log "$nombre: fallo el fetch"; return 1; }

  local detras; detras=$(git rev-list --count "HEAD..origin/$rama" 2>/dev/null || echo 0)
  [ "$detras" -eq 0 ] && return 1

  local antes; antes=$(git rev-parse HEAD)
  if ! git pull --ff-only origin "$rama" --quiet 2>>"$LOG"; then
    log "$nombre: fallo el pull"
    return 1
  fi
  local despues; despues=$(git rev-parse HEAD)
  log "$nombre: $detras commit(s) -> $(git log -1 --format='%h %s')"

  # Reinstalar solo si cambio el manifiesto: npm install en cada pasada
  # convertiria una actualizacion de segundos en uno de minutos.
  if git diff --name-only "$antes" "$despues" | grep -qE '^package(-lock)?\.json$'; then
    log "$nombre: dependencias cambiaron, instalando"
    npm install --no-audit --no-fund >>"$LOG" 2>&1 || log "$nombre: fallo npm install"
  fi
  return 0
}

cambio_backend=1
cambio_frontend=1
actualizar_repo "$BACKEND" "backend" && cambio_backend=0
actualizar_repo "$FRONTEND" "frontend" && cambio_frontend=0

# El frontend se sirve como build estatico: sin reconstruir, el pull no cambia
# nada de lo que ve el navegador.
if [ "$cambio_frontend" -eq 0 ]; then
  cd "$FRONTEND" || exit 0
  if npm run build >>"$LOG" 2>&1; then
    log "frontend: build regenerado"
  else
    log "frontend: FALLO el build, se conserva el dist anterior"
  fi
fi

# El backend corre bajo nodemon, que recarga solo al cambiar los archivos. Se
# reinicia igualmente para que el dist nuevo se sirva sin restos en memoria.
if [ "$cambio_backend" -eq 0 ] || [ "$cambio_frontend" -eq 0 ]; then
  pm2 restart qadash-backend --update-env >>"$LOG" 2>&1 && log "qadash-backend reiniciado"
fi

# El log crece indefinidamente si nadie lo toca.
if [ -f "$LOG" ] && [ "$(stat -c%s "$LOG" 2>/dev/null || echo 0)" -gt 1048576 ]; then
  tail -n 500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
