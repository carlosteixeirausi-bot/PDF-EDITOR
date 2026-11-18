# PDF-Editor

Suíte local de ferramentas PDF que roda no seu próprio computador, sem enviar documentos para serviços externos. A interface fica no navegador e o processamento acontece no servidor Node.js local.

Recursos: juntar, dividir, organizar, remover e recortar páginas; comprimir, reparar e converter para PDF/A; converter PDF para Word, PowerPoint, Excel e JPG; converter Office para PDF; OCR; girar, numerar, marcar com água, proteger, desbloquear, assinar e comparar PDFs.

- Repositório: <https://github.com/carlosteixeirausi-bot/PDF-EDITOR>
- Endereço local padrão: `http://127.0.0.1:3000`
- Guia técnico: [COMO-FUNCIONA.md](./COMO-FUNCIONA.md)
- Comandos do dia a dia: [COMANDOS.txt](./COMANDOS.txt)

## Requisitos

- Linux (Debian/Ubuntu, Fedora ou Arch)
- Node.js 22 ou superior
- `qpdf`, Ghostscript, Poppler, Tesseract (com português) e LibreOffice
- Cerca de 500 MB livres para dependências e conversões

O script de instalação detecta o gerenciador de pacotes e instala tudo o que estiver faltando.

## Instalação rápida com script

O script baixa o projeto do GitHub, instala as dependências do sistema e do Node.js, e deixa o app pronto para iniciar.

```bash
curl -fsSL https://raw.githubusercontent.com/carlosteixeirausi-bot/PDF-EDITOR/main/instalar.sh -o instalar.sh
chmod +x instalar.sh
./instalar.sh
```

Por padrão, o projeto é instalado em `~/PDF-EDITOR`. Para escolher outro destino:

```bash
./instalar.sh ~/Projetos/PDF-EDITOR
```

Se o script for executado dentro de uma cópia já existente do projeto, ele usa a pasta atual e apenas instala/atualiza as dependências.

Ao final, inicie com:

```bash
cd ~/PDF-EDITOR
./iniciar.sh
```

Abra `http://127.0.0.1:3000`.

> O script usa `sudo` para instalar pacotes do sistema e, se necessário, o Node.js 22 via NodeSource. Ele não deve ser executado como root.

## Instalação manual

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

Verifique a versão:

```bash
node -v
```

Se for menor que 22, instale pelo site oficial ou pelo NodeSource. Em Debian/Ubuntu:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

### 3. Baixar e instalar o projeto

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

ou:

```bash
npm start
```

## Visualizar na rede local

Para acessar o PDF-Editor de outro computador, celular ou tablet na mesma rede:

```bash
cd ~/PDF-EDITOR
./iniciar-rede.sh
```

O script inicia o servidor em `0.0.0.0` e mostra os endereços:

```text
PDF-Editor na rede local
  Este computador: http://127.0.0.1:3000
  Rede local:       http://192.168.0.10:3000
```

No outro aparelho, abra o endereço de rede exibido. Para descobrir o IP manualmente:

```bash
hostname -I
```

Se a conexão não abrir, libere a porta no firewall:

```bash
# Ubuntu/Debian (ufw)
sudo ufw allow 3000/tcp

# Fedora/RHEL (firewalld)
sudo firewall-cmd --add-port=3000/tcp --permanent
sudo firewall-cmd --reload
```

### Configuração de porta

Copie o exemplo e edite se quiser usar outra porta:

```bash
cp config.env.example config.env
```

```env
HOST=127.0.0.1
PORT=3000
```

`iniciar.sh` usa o arquivo `config.env`. `iniciar-rede.sh` sempre força `HOST=0.0.0.0`, mas respeita a `PORT` configurada.

> **Segurança:** o modo rede não possui login. Use apenas em uma rede confiável e nunca exponha a porta diretamente à internet. Os arquivos ficam em `data/` e são apagados automaticamente após 12 horas.

## Atualizar o projeto

Com o projeto clonado:

```bash
cd ~/PDF-EDITOR
git pull
npm install
```

Ou execute novamente o instalador apontando para a pasta existente:

```bash
./instalar.sh ~/PDF-EDITOR
```

## Parar o servidor

No terminal onde ele está rodando: `Ctrl+C`.

Se estiver em segundo plano:

```bash
pkill -f "node server.js"
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
├── instalar.sh        instalação automática
├── iniciar.sh         inicia em 127.0.0.1
├── iniciar-rede.sh    inicia em 0.0.0.0 para acesso na rede local
├── config.env.example porta e host usados pelos scripts
├── COMANDOS.txt       comandos operacionais
├── COMO-FUNCIONA.md   arquitetura e detalhes técnicos
└── MEMORIA.md         guia de contexto do projeto
```

## Problemas comuns

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
Confirme que está usando `./iniciar-rede.sh`, que os aparelhos estão na mesma rede e que a porta 3000 está liberada no firewall.

**Porta 3000 ocupada**
Altere `PORT` em `config.env` ou execute `PORT=8080 ./iniciar.sh`.
