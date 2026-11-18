#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/carlosteixeirausi-bot/PDF-EDITOR.git"
TARBALL_URL="https://github.com/carlosteixeirausi-bot/PDF-EDITOR/archive/refs/heads/main.tar.gz"
DEST="${1:-$HOME/PDF-EDITOR}"
MIN_NODE_MAJOR=22
SERVICE_NAME="pdf-editor"

info() { printf '\n[PDF-Editor] %s\n' "$*"; }
erro() { printf '\n[PDF-Editor] ERRO: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -ne 0 ] || erro "Não execute como root. Use seu usuário normal; o script usa sudo quando necessário."
command -v sudo >/dev/null 2>&1 || erro "sudo não encontrado. Instale o sudo ou execute os comandos manualmente (veja o README)."

sudo -v

if command -v apt-get >/dev/null 2>&1; then
  PKG=apt
elif command -v dnf >/dev/null 2>&1; then
  PKG=dnf
elif command -v pacman >/dev/null 2>&1; then
  PKG=pacman
else
  erro "Gerenciador de pacotes não suportado. Instale as dependências manualmente (veja o README)."
fi

info "Instalando dependências do sistema..."
case "$PKG" in
  apt)
    sudo apt-get update
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
      qpdf ghostscript poppler-utils tesseract-ocr tesseract-ocr-por \
      libreoffice git curl ca-certificates
    ;;
  dnf)
    sudo dnf install -y \
      qpdf ghostscript poppler-utils tesseract tesseract-langpack-por \
      libreoffice git curl ca-certificates
    ;;
  pacman)
    sudo pacman -Sy --needed --noconfirm \
      qpdf ghostscript poppler tesseract tesseract-data-por \
      libreoffice-fresh git curl ca-certificates
    ;;
esac

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local major
  major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
  [ "$major" -ge "$MIN_NODE_MAJOR" ]
}

if ! node_ok; then
  info "Node.js ${MIN_NODE_MAJOR}+ não encontrado. Instalando..."
  case "$PKG" in
    apt)
      curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
      sudo apt-get install -y nodejs
      ;;
    dnf)
      curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
      sudo dnf install -y nodejs
      ;;
    pacman)
      sudo pacman -S --needed --noconfirm nodejs npm
      ;;
  esac
fi

node_ok || erro "Node.js ${MIN_NODE_MAJOR}+ não pôde ser instalado. Instale manualmente e execute novamente."

info "Obtendo o projeto..."
if [ -f "$(pwd)/server.js" ] && [ -f "$(pwd)/package.json" ]; then
  DEST="$(pwd)"
  info "Usando o projeto atual: $DEST"
elif [ -d "$DEST/.git" ]; then
  info "Atualizando repositório existente em $DEST..."
  git -C "$DEST" pull --ff-only
elif [ -e "$DEST" ] && [ -n "$(ls -A "$DEST" 2>/dev/null)" ]; then
  erro "$DEST já existe e não está vazio. Escolha outro destino: ./instalar.sh ~/outra-pasta"
else
  info "Clonando $REPO_URL em $DEST..."
  if command -v git >/dev/null 2>&1; then
    git clone --depth 1 "$REPO_URL" "$DEST"
  else
    mkdir -p "$DEST"
    curl -fsSL "$TARBALL_URL" | tar -xz -C "$DEST" --strip-components=1
  fi
fi

case "$DEST" in
  *" "*) erro "O caminho do projeto não pode conter espaços: $DEST" ;;
esac

info "Instalando dependências Node.js (pode levar alguns minutos)..."
cd "$DEST"
npm install --no-audit --no-fund

info "Configurando inicialização automática na rede local..."
if [ ! -f config.env ]; then
  cat > config.env <<'EOF'
# Configuração usada por iniciar.sh e pelo serviço pdf-editor
HOST=0.0.0.0
PORT=3000
EOF
fi

PORT=3000
set -a
# shellcheck disable=SC1091
. ./config.env
set +a
PORT="${PORT:-3000}"

chmod +x iniciar.sh iniciar-rede.sh 2>/dev/null || true

NODE_BIN="$(command -v node)"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

iniciar_servico() {
  if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
    info "Criando serviço systemd ${SERVICE_NAME}.service..."
    sudo tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=PDF-Editor - ferramentas PDF locais
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(id -un)
Group=$(id -gn)
WorkingDirectory=$DEST
Environment=HOST=0.0.0.0
Environment=PORT=$PORT
Environment=NODE_ENV=production
ExecStart=$NODE_BIN server.js
Restart=always
RestartSec=3
SyslogIdentifier=$SERVICE_NAME

[Install]
WantedBy=multi-user.target
EOF
    sudo systemctl daemon-reload
    sudo systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
    sudo systemctl restart "$SERVICE_NAME"
    sleep 2
    if ! systemctl is-active --quiet "$SERVICE_NAME"; then
      erro "O serviço não iniciou. Veja os detalhes com: sudo journalctl -u ${SERVICE_NAME} -n 50 --no-pager"
    fi
  else
    info "systemd indisponível; iniciando em segundo plano..."
    if [ -f pdf-editor.pid ] && kill -0 "$(cat pdf-editor.pid)" 2>/dev/null; then
      kill "$(cat pdf-editor.pid)" || true
      sleep 1
    fi
    HOST=0.0.0.0 PORT="$PORT" nohup "$NODE_BIN" server.js > pdf-editor.log 2>&1 &
    echo $! > pdf-editor.pid
    sleep 2
    kill -0 "$(cat pdf-editor.pid)" 2>/dev/null || erro "O servidor não iniciou. Veja pdf-editor.log."
  fi
}

liberar_firewall() {
  if command -v ufw >/dev/null 2>&1; then
    if sudo ufw status 2>/dev/null | grep -qiE '^(Status|Estado):[[:space:]]*(active|ativo)'; then
      info "Liberando a porta ${PORT} no ufw..."
      sudo ufw allow "${PORT}/tcp" >/dev/null 2>&1 || true
    fi
  fi

  if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld 2>/dev/null; then
    info "Liberando a porta ${PORT} no firewalld..."
    sudo firewall-cmd --permanent --add-port="${PORT}/tcp" >/dev/null 2>&1 || true
    sudo firewall-cmd --reload >/dev/null 2>&1 || true
  fi
}

iniciar_servico
liberar_firewall

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -n "$IP" ] || IP="IP_DA_MAQUINA"

info "Instalação concluída. O PDF-Editor já está rodando e inicia junto com o sistema."
printf '%s\n' \
  "  Pasta:          $DEST" \
  "  Este computador: http://127.0.0.1:${PORT}" \
  "  Rede local:      http://${IP}:${PORT}" \
  "" \
  "  Status:  sudo systemctl status ${SERVICE_NAME}" \
  "  Logs:    sudo journalctl -u ${SERVICE_NAME} -f" \
  "  Parar:   sudo systemctl stop ${SERVICE_NAME}"
