#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ -f config.env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./config.env
  set +a
fi

PORT="${PORT:-3000}"
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -n "$IP" ] || IP="IP_DA_MAQUINA"

printf '\nPDF-Editor na rede local\n  Este computador: http://127.0.0.1:%s\n  Rede local:       http://%s:%s\n\n' "$PORT" "$IP" "$PORT"
printf 'Se não abrir em outro aparelho, libere a porta no firewall:\n'
printf '  Ubuntu/Debian: sudo ufw allow %s/tcp\n' "$PORT"
printf '  Fedora/RHEL:   sudo firewall-cmd --add-port=%s/tcp --permanent && sudo firewall-cmd --reload\n\n' "$PORT"

HOST=0.0.0.0 PORT="$PORT" exec npm start
