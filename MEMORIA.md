# MEMORIA — PDF-Editor

Guia de contexto do projeto para continuidade por pessoas ou agentes.

## 1. Identidade

- Nome: **PDF-Editor**
- Pacote npm: `pdf-editor`
- Pasta: `/home/Carlos/Projetos/Editor`
- Tipo: aplicação web local (não é SaaS, não envia arquivos para a internet)
- Idioma da interface e documentação: português do Brasil
- Plataformas: Linux (systemd) e Windows Server (serviço NSSM)
- Endereço padrão: `http://127.0.0.1:3000`

Objetivo: oferecer um conjunto completo de ferramentas PDF que roda inteiramente no computador do usuário, com interface no navegador e processamento no servidor Node.js local.

## 2. Início rápido

```bash
cd /home/Carlos/Projetos/Editor
npm install
npm start
```

Abrir `http://127.0.0.1:3000`.

### Instalação automatizada

- **Linux:** `sudo ./instalar.sh` instala dependências, configura systemd, `HOST=0.0.0.0`, libera o firewall e deixa o serviço rodando.
- **Windows Server:** execute `instalar.ps1` em PowerShell **como Administrador**. Ele instala as dependências via Chocolatey, cria o serviço NSSM, libera a porta 3000 e inicia o PDF-Editor.

Ambos os instaladores permitem acesso pela rede local e início automático com o sistema. Detalhes e opções: [README.md](./README.md).

Comandos completos de operação: [COMANDOS.txt](./COMANDOS.txt).
Explicação técnica e diagramas: [COMO-FUNCIONA.md](./COMO-FUNCIONA.md).

## 3. Arquitetura

```text
Navegador
  index.html / tool.html
  public/js/app.js, public/js/tool.js, public/js/common.js
  PDF.js local (public/vendor/pdfjs)
        |
        | HTTP JSON + multipart
        v
Express (server.js)
  /api/tools, /api/health, /api/upload, /api/file/:id
  /api/process/:slug, /api/download/:token
        |
        v
lib/tools.js       catálogo e metadados das ferramentas
lib/processors.js  implementação de cada operação
lib/pdfutil.js     utilidades (páginas, intervalos, cores, ZIP, exec)
        |
        +--> data/uploads   arquivos enviados
        +--> data/tmp       trabalho temporário
        +--> data/output    resultados e tokens de download
        |
        +--> pdf-lib, Ghostscript, QPDF, Poppler, Tesseract,
             LibreOffice, sharp, docx, xlsx, pptxgenjs, pixelmatch
```

Fluxo principal:

1. O navegador envia arquivos para `POST /api/upload` (multipart).
2. O servidor salva em `data/uploads`, cria IDs e devolve metadados.
3. A interface mostra opções específicas da ferramenta e miniaturas via `GET /api/file/:id`.
4. Ao processar, o navegador chama `POST /api/process/:slug` com IDs e opções.
5. O processador gera o resultado em `data/output` e devolve um token.
6. O download ocorre em `GET /api/download/:token`.
7. A limpeza automática remove arquivos antigos (retenção padrão de 12 horas).

## 4. Estrutura do projeto

```text
Editor/
├── server.js              servidor Express, rotas, upload, tokens e limpeza
├── package.json           scripts e dependências Node
├── COMANDOS.txt           guia operacional
├── COMO-FUNCIONA.md       guia técnico com diagramas Mermaid
├── MEMORIA.md             este arquivo
├── instalar.sh            instalação Linux com systemd
├── instalar.ps1           instalação Windows Server com serviço NSSM
├── iniciar.sh             inicia manualmente em primeiro plano
├── iniciar-rede.sh        inicia manualmente com acesso pela rede
├── config.env.example     modelo de configuração de HOST e PORT
├── lib/
│   ├── tools.js           catálogo das 24 ferramentas
│   ├── processors.js      implementação das operações
│   └── pdfutil.js         helpers de PDF, ZIP, exec e validação
├── public/
│   ├── index.html         catálogo inicial
│   ├── tool.html          página genérica de ferramenta
│   ├── favicon.svg
│   ├── css/styles.css
│   ├── js/app.js          catálogo, filtros e menus
│   ├── js/tool.js         upload, builders de opções, recorte e assinatura visuais
│   ├── js/common.js       utilidades de UI
│   └── vendor/pdfjs/      PDF.js servido localmente
├── tests/
│   ├── run.mjs            orquestra servidor temporário e testes
│   ├── smoke.mjs          verificações de integração
│   └── fixtures.mjs       gera PDFs/imagens de teste
└── data/                  criado em tempo de execução (não versionar)
    ├── uploads/
    ├── tmp/
    └── output/
```

## 5. Dependências

### Sistema (Linux — Debian/Ubuntu)

```bash
sudo apt update
sudo apt install -y qpdf ghostscript poppler-utils \
  tesseract-ocr tesseract-ocr-por libreoffice
```

| Dependência | Uso |
|---|---|
| `qpdf` | proteger/desbloquear PDF, operações estruturais |
| `gs` (Ghostscript) | compressão, reparo, PDF/A |
| `pdftoppm` / `pdftotext` (Poppler) | renderização de páginas e extração de texto |
| `tesseract` + `tesseract-ocr-por` | OCR em PDFs digitalizados |
| `libreoffice` / `soffice` | conversão Office para PDF |

### Sistema (Windows Server)

Instalado pelo `instalar.ps1` via Chocolatey:

| Pacote | Uso |
|---|---|
| `nodejs-lts` | execução do servidor |
| `ghostscript` | compressão, reparo, PDF/A (comando `gswin64c`) |
| `qpdf` | proteger/desbloquear PDF, operações estruturais |
| `poppler` | `pdftoppm` / `pdftotext` |
| `tesseract` + tessdata `por` | OCR em português |
| `libreoffice-fresh` | conversão Office para PDF |
| `git` | clonar/atualizar o projeto |
| `nssm` | registrar o serviço `pdf-editor` com início automático |

O código trata o nome diferente do Ghostscript no Windows; ver seção 8.

### Node.js

| Pacote | Uso |
|---|---|
| `express` | servidor HTTP e rotas |
| `multer` | upload multipart em disco |
| `pdf-lib` | merge, split, crop, rotação, watermark, numeração, assinatura |
| `pdfjs-dist` | renderização no navegador |
| `archiver` | geração de arquivos ZIP |
| `docx` | geração de DOCX |
| `xlsx` | planilhas XLSX |
| `pptxgenjs` | geração de PPTX |
| `sharp` | imagens, miniaturas e conversão |
| `pixelmatch` + `pngjs` | comparação visual de páginas |

**Fixação importante:** `pdfjs-dist@4.10.38`. Versões 6.x usam `Uint8Array.prototype.toHex`, indisponível no Chrome 130, e quebram a interface. Não atualizar sem testar no navegador alvo.

## 6. Ferramentas disponíveis (24)

Organizar: `juntar_pdf`, `dividir_pdf`, `organizar-pdf`, `excluir-paginas-do-pdf`.
Otimizar: `comprimir_pdf`, `reparar-pdf`, `pdf_para_pdfa`.
Converter: `pdf_para_word`, `pdf_para_powerpoint`, `pdf_para_excel`, `word_para_pdf`, `powerpoint_para_pdf`, `excel_para_pdf`, `pdf_para_jpg`, `jpg_para_pdf`, `ocr-pdf`.
Editar: `rodar_pdf`, `recortar-pdf`, `pdf_inserir_numeros_de_paginas`, `pdf_inserir_marca_daigua`, `comparar-pdf`.
Segurança: `proteger-pdf`, `desbloquear_pdf`, `assinar-pdf`.

O catálogo e os metadados ficam em `lib/tools.js`. A implementação correspondente fica em `lib/processors.js`, com a mesma chave `slug`.

## 7. API

| Método | Rota | Função |
|---|---|---|
| GET | `/api/health` | status do servidor e dependências |
| GET | `/api/tools` | catálogo de ferramentas |
| POST | `/api/upload` | upload multipart de arquivos |
| GET | `/api/file/:id` | bytes do arquivo enviado (prévias/miniaturas) |
| POST | `/api/process/:slug` | executa a ferramenta |
| GET | `/api/download/:token` | baixa o resultado |

O corpo de processamento usa IDs de arquivo e um objeto de opções específico de cada ferramenta.

## 8. Decisões e detalhes de implementação

### Recorte visual (obrigatório)

- O usuário arrasta sobre a página renderizada no canvas do PDF.js.
- O cliente converte o retângulo da tela para coordenadas PDF com `viewport.convertToPdfPoint`.
- O cliente envia `crops` por página e/ou `applyAll`.
- O servidor aplica `setCropBox` com `pdf-lib`.
- Implementação: builder `crop` em `public/js/tool.js`; processador `crop` em `lib/processors.js`.
- Não reintroduzir entrada manual de coordenadas.

### Assinatura visual

- Assinatura desenhada em canvas ou nome digitado, posicionada por arrasto sobre a página.
- Posição convertida para coordenadas PDF e aplicada no servidor.

### Comparação

- Renderiza páginas com Poppler, compara com `pixelmatch`/`pngjs`.
- Gera imagens de diferença em ZIP e um resumo textual.
- Limitada a 200 páginas para evitar uso excessivo de memória/tempo.

### Conversões

- PDF para Word/PowerPoint/Excel: texto/imagens extraídos e remontados com `docx`, `pptxgenjs` e `xlsx`; não é conversão perfeita de layout.
- Office para PDF: `soffice --headless`.
- PDF para JPG: Poppler/`pdftoppm`.
- JPG para PDF: `pdf-lib`/`sharp`.
- OCR: rasterização + Tesseract com idioma português.

### Compatibilidade Windows

- `lib/pdfutil.js`: `commandName()` mapeia `gs` para `gswin64c`; `commandExists()` usa `where` no Windows e `which` no Linux.
- `server.js`: health e mensagens de inicialização usam `commandExists()`; não chamar `which` diretamente.
- `lib/processors.js`: o `-env:UserInstallation` do `soffice` é convertido com `pathToFileURL`, gerando um caminho `file:///...` válido no Windows.
- `instalar.ps1`: instala Chocolatey e dependências, copia o tessdata `por`, clona/atualiza em `C:\PDF-EDITOR`, cria `config.env`, registra o serviço NSSM `pdf-editor` (automático), libera a porta 3000 no firewall (Domain/Private) e inicia.
- Reinstalação: `Stop-PdfService` encerra o PID remanescente após 15 segundos; o NSSM usa `AppStopMethodSkip 7` para evitar o serviço travar em `StopPending`.
- Validado em Windows Server 2025: `/api/health` com `gs`, `qpdf`, `pdftoppm`, `pdftotext`, `tesseract` e `soffice` em `true`.

### Segurança e ciclo de vida

- Bind padrão em `127.0.0.1`; `HOST=0.0.0.0` expõe na rede local.
- Upload máximo de 150 MB por arquivo e 20 arquivos por requisição.
- Retenção padrão de 12 horas; limpeza horária.
- Tokens de download opacos, mantidos em memória, apontando para arquivos em `data/output`.
- Não há autenticação: é uma ferramenta local de usuário único.

## 9. Testes

```bash
npm test
```

- `tests/run.mjs` sobe um servidor temporário na porta 3123.
- `tests/fixtures.mjs` gera PDFs e imagens sintéticas em `/tmp/editor-pdf-fixtures`.
- `tests/smoke.mjs` valida catálogo, upload, processamento e download.
- Estado atual: 30 verificações passando no Linux.
- No Windows Server 2025 foi feita validação funcional adicional: 12/12 verificações (merge, split, compressão, PDF→JPG, OCR em português, Word→PDF via LibreOffice, proteger/desbloquear e PDF/A), além do health com todas as dependências `true`.

Sempre executar `npm test` após alterar `server.js`, `lib/` ou os fluxos de upload/processamento.

## 10. Convenções

- Código e textos de interface em português; identificadores em inglês ou slugs existentes.
- Não adicionar comentários ao código sem necessidade.
- Manter o catálogo (`lib/tools.js`) e o processador (`lib/processors.js`) sincronizados pelo `slug`.
- Novas ferramentas devem entrar nos dois arquivos, no builder de UI correspondente e, se possível, nos testes.
- Preservar o visual local/offline; não adicionar chamadas a serviços externos.
- Evitar dependências novas sem necessidade; verificar se o sistema já possui equivalente.
- Não versionar `data/`, `node_modules/` nem arquivos temporários.

## 11. Limitações conhecidas

- Conversões de PDF para Office são reconstruções, não preservam layout complexo.
- OCR depende da qualidade da digitalização e do idioma instalado.
- Comparação visual é sensível a pequenas diferenças de renderização.
- Sem autenticação e sem multiusuário.
- Sem banco de dados; tokens e metadados vivem na memória do processo.
- Reiniciar o servidor invalida tokens de download pendentes.
- A retenção de 12 horas pode ser ajustada no código, mas não há interface para isso.
- No Windows Server, a instalação exige PowerShell como Administrador e internet para o Chocolatey; o serviço é gerenciado pelo NSSM.

## 12. Diagnóstico rápido

```bash
# Servidor ativo?
curl -s http://127.0.0.1:3000/api/health

# Porta ocupada?
lsof -i :3000

# Log de uma instância em segundo plano
tail -f /tmp/editor-server.log

# Parar instância em segundo plano
kill $(cat /tmp/editor-server.pid)
```

No Windows Server (PowerShell como Administrador):

```powershell
# Serviço ativo?
Get-Service pdf-editor

# Health e dependências
Invoke-WebRequest http://127.0.0.1:3000/api/health -UseBasicParsing

# Logs
Get-Content C:\PDF-EDITOR\pdf-editor.log -Tail 80
Get-Content $env:TEMP\pdf-editor-install.log -Tail 80

# Reiniciar
Restart-Service pdf-editor
```

Problemas comuns:

- **PDF.js quebrado no navegador:** confirmar `pdfjs-dist@4.10.38`.
- **Conversão Office falha:** verificar `soffice --version`.
- **OCR sem texto:** confirmar `tesseract --list-langs` e `por`.
- **Compressão/reparo falha:** verificar `gs --version`.
- **Proteger/desbloquear falha:** verificar `qpdf --version`.
- **Miniaturas não aparecem:** conferir se `pdftoppm` existe e se o vendor do PDF.js foi servido.

## 13. Histórico resumido

- Interface e fluxo próprios, com identidade visual PDF-Editor.
- Recorte e assinatura foram implementados como interações visuais, não por coordenadas.
- Instaladores automatizados para Linux (systemd) e Windows Server (NSSM), com acesso pela rede e início automático.
- Compatibilidade Windows validada em Windows Server 2025, incluindo Ghostscript, QPDF, Poppler, Tesseract e LibreOffice.
