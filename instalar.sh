#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/carlosteixeirausi-bot/PDF-EDITOR.git"
TARBALL_URL="https://github.com/carlosteixeirausi-bot/PDF-EDITOR/archive/refs/heads/main.tar.gz"
DEST="${1:-$HOME/PDF-EDITOR}"
MIN_NODE_MAJOR=22

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

info "Instalando dependências Node.js (pode levar alguns minutos)..."
cd "$DEST"
npm install --no-audit --no-fund

chmod +x iniciar.sh iniciar-rede.sh 2>/dev/null || true

info "Instalação concluída."
printf '%s\n' \
  "  Pasta:        $DEST" \
  "  Uso local:    cd \"$DEST\" && ./iniciar.sh" \
  "  Rede local:   cd \"$DEST\" && ./iniciar-rede.sh" \
  "  Endereço:     http://127.0.0.1:3000"
