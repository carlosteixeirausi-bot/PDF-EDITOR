#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ -f config.env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./config.env
  set +a
fi

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3000}"

printf '\nPDF-Editor\n  Local: http://127.0.0.1:%s\n\n' "$PORT"
HOST="$HOST" PORT="$PORT" exec npm start
