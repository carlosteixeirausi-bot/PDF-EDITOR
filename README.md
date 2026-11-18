# PDF-Editor

Suíte local de ferramentas PDF que roda no seu próprio computador, sem enviar documentos para serviços externos. A interface fica no navegador e o processamento acontece no servidor Node.js local.

Recursos: juntar, dividir, organizar, remover e recortar páginas; comprimir, reparar e converter para PDF/A; converter PDF para Word, PowerPoint, Excel e JPG; converter Office para PDF; OCR; girar, numerar, marcar com água, proteger, desbloquear, assinar e comparar PDFs.

- Repositório: <https://github.com/carlosteixeirausi-bot/PDF-EDITOR>
- Endereço local: `http://127.0.0.1:3000`
- Rede local: `http://IP_DO_COMPUTADOR:3000`
- Guia técnico: [COMO-FUNCIONA.md](./COMO-FUNCIONA.md)
- Comandos do dia a dia: [COMANDOS.txt](./COMANDOS.txt)

## Requisitos

- Linux (Debian/Ubuntu, Fedora ou Arch)
- Node.js 22 ou superior
- `qpdf`, Ghostscript, Poppler, Tesseract (com português) e LibreOffice
- Cerca de 500 MB livres para dependências e conversões

O instalador detecta o gerenciador de pacotes e instala tudo o que estiver faltando.

## Instalação em um comando

O script baixa o projeto, instala as dependências, configura o acesso na rede local, cria um serviço systemd e **já deixa o PDF-Editor rodando**. Ele também é configurado para iniciar automaticamente com o sistema.

```bash
curl -fsSL https://raw.githubusercontent.com/carlosteixeirausi-bot/PDF-EDITOR/main/instalar.sh -o instalar.sh
chmod +x instalar.sh
./instalar.sh
```

Ao final, o próprio script mostra os endereços:

```text
PDF-Editor
  Este computador: http://127.0.0.1:3000
  Rede local:      http://192.168.0.10:3000
```

Por padrão, o projeto fica em `~/PDF-EDITOR`. Para escolher outro destino:

```bash
./instalar.sh ~/Projetos/PDF-EDITOR
```

> O script usa `sudo` para instalar pacotes do sistema, criar o serviço e liberar a porta no firewall quando necessário. Não execute como root.

### O que o instalador faz

1. Instala as dependências do sistema.
2. Instala o Node.js 22 se necessário.
3. Baixa ou atualiza o projeto do GitHub.
4. Roda `npm install`.
5. Cria `config.env` com `HOST=0.0.0.0` e `PORT=3000`.
6. Cria e ativa o serviço systemd `pdf-editor`.
7. Libera a porta no `ufw` ou `firewalld`, se estiverem ativos.
8. Inicia o servidor e exibe os endereços de acesso.

Se o systemd não estiver disponível, o instalador inicia o servidor em segundo plano e grava o log em `pdf-editor.log`.

## Acessar da rede local

A instalação já deixa tudo pronto. Em outro computador, celular ou tablet na mesma rede, abra:

```text
http://IP_DO_COMPUTADOR:3000
```

Para descobrir o IP:

```bash
hostname -I
```

A porta é liberada automaticamente quando `ufw` ou `firewalld` estão ativos. Se o acesso ainda não funcionar, libere manualmente:

```bash
# Ubuntu/Debian (ufw)
sudo ufw allow 3000/tcp

# Fedora/RHEL (firewalld)
sudo firewall-cmd --add-port=3000/tcp --permanent
sudo firewall-cmd --reload
```

> **Segurança:** o modo rede não possui login. Use apenas em uma rede confiável e nunca exponha a porta diretamente à internet. Os arquivos ficam em `data/` e são apagados automaticamente após 12 horas.

## Gerenciar o serviço

```bash
# Ver status
sudo systemctl status pdf-editor

# Reiniciar após atualizar o projeto
sudo systemctl restart pdf-editor

# Parar
sudo systemctl stop pdf-editor

# Iniciar novamente
sudo systemctl start pdf-editor

# Ver logs em tempo real
sudo journalctl -u pdf-editor -f

# Impedir que inicie com o sistema
sudo systemctl disable pdf-editor
```

## Configuração de porta

O instalador cria `config.env`:

```env
HOST=0.0.0.0
PORT=3000
```

Para trocar a porta, edite o arquivo e execute o instalador novamente para recriar o serviço:

```bash
nano ~/PDF-EDITOR/config.env
cd ~/PDF-EDITOR
./instalar.sh
```

Também é possível iniciar manualmente em primeiro plano:

```bash
cd ~/PDF-EDITOR
./iniciar.sh       # usa HOST e PORT de config.env
./iniciar-rede.sh  # força 0.0.0.0 e mostra o IP
```

## Atualizar o projeto

```bash
cd ~/PDF-EDITOR
git pull
npm install
sudo systemctl restart pdf-editor
```

Ou execute o instalador novamente; ele atualiza o código, as dependências e o serviço:

```bash
./instalar.sh ~/PDF-EDITOR
```

## Instalação manual

Caso não queira usar o script.

### 1. Dependências do sistema

Debian/Ubuntu:

```bash
sudo apt update
sudo apt install -y qpdf ghostscript poppler-utils \
  tesseract-ocr tesseract-ocr-por libreoffice git curl
```

Fedora:

```bash
sudo dnf install -y qpdf ghostscript poppler-utils \
  tesseract tesseract-langpack-por libreoffice git curl
```

Arch:

```bash
sudo pacman -Sy --needed qpdf ghostscript poppler \
  tesseract tesseract-data-por libreoffice-fresh git curl
```

### 2. Node.js 22+

```bash
node -v
```

Se for menor que 22, em Debian/Ubuntu:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

### 3. Baixar e instalar

```bash
git clone https://github.com/carlosteixeirausi-bot/PDF-EDITOR.git
cd PDF-EDITOR
npm install
chmod +x iniciar.sh iniciar-rede.sh
```

### 4. Iniciar

```bash
./iniciar.sh
```

ou, para acesso na rede local:

```bash
./iniciar-rede.sh
```

## Testes

```bash
npm test
```

A suíte sobe um servidor temporário na porta 3123 e valida upload, processamento e download das principais ferramentas.

## Estrutura

```text
PDF-EDITOR/
├── server.js          servidor Express e rotas da API
├── lib/               catálogo, processadores e utilidades PDF
├── public/            interface, estilos, scripts e PDF.js local
├── tests/             testes de integração
├── instalar.sh        instala, configura o serviço e inicia na rede local
├── iniciar.sh         inicia manualmente em primeiro plano
├── iniciar-rede.sh    inicia manualmente com acesso pela rede
├── config.env.example modelo de configuração de host e porta
├── COMANDOS.txt       comandos operacionais
├── COMO-FUNCIONA.md   arquitetura e detalhes técnicos
└── MEMORIA.md         guia de contexto do projeto
```

## Problemas comuns

**O serviço não iniciou**

```bash
sudo systemctl status pdf-editor
sudo journalctl -u pdf-editor -n 80 --no-pager
```

**Porta 3000 ocupada**

Altere `PORT` em `config.env`, execute `./instalar.sh` novamente ou use `PORT=8080 ./iniciar.sh`.

**`node: command not found` ou versão antiga**

Instale o Node.js 22+ e confirme com `node -v`.

**Ferramentas de conversão não funcionam**

Confira as dependências:

```bash
qpdf --version
gs --version
pdftoppm -v
tesseract --list-langs
soffice --version
```

**OCR não reconhece português**

Instale `tesseract-ocr-por` (Debian/Ubuntu) ou `tesseract-langpack-por`/`tesseract-data-por` e confirme se `por` aparece em `tesseract --list-langs`.

**Não abre em outro aparelho da rede**

Confirme que o serviço está ativo, que os aparelhos estão na mesma rede e que a porta 3000 está liberada no firewall.
