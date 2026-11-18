# Como funciona o PDF-Editor

Aplicação web local para manipular PDFs. O navegador cuida da interface e das prévias; o servidor Node.js executa as operações e usa ferramentas instaladas no próprio computador. Nenhum arquivo é enviado para a internet.

- Endereço padrão: `http://127.0.0.1:3000`
- Entrada: `npm start`
- Comandos e solução de problemas: [COMANDOS.txt](./COMANDOS.txt)

---

## 1. Visão geral da arquitetura

```mermaid
flowchart LR
  subgraph NAV["Navegador - interface"]
    HOME["Página inicial<br/>catálogo e filtros"]
    TOOL["Página da ferramenta<br/>upload, opções e resultado"]
    PDFJS["PDF.js<br/>prévias, miniaturas e recorte visual"]
    DL["Download do resultado"]
  end

  subgraph SRV["Servidor Node.js / Express"]
    API_TOOLS["GET /api/tools"]
    API_UPLOAD["POST /api/upload"]
    API_FILE["GET /api/file/:id"]
    API_PROC["POST /api/process/:slug"]
    API_DOWN["GET /api/download/:token"]
    VALID["Validação de arquivos<br/>e opções"]
    REG["lib/tools.js<br/>catálogo de ferramentas"]
    PROC["lib/processors.js<br/>implementação das tarefas"]
    UTIL["lib/pdfutil.js<br/>páginas, cores, ZIP e comandos"]
  end

  subgraph DATA["Armazenamento local"]
    UP["data/uploads<br/>arquivos enviados"]
    TMP["data/tmp<br/>trabalho temporário"]
    OUT["data/output<br/>resultados"]
    MEM["Memória do processo<br/>IDs e tokens de download"]
  end

  subgraph ENG["Ferramentas locais"]
    PDFLIB["pdf-lib<br/>merge, split, crop, rotação,<br/>marca d'água, números, assinatura"]
    GS["Ghostscript<br/>compressão, reparo e PDF/A"]
    QPDF["QPDF<br/>criptografia e desbloqueio"]
    POP["Poppler<br/>renderização e extração de texto"]
    TESS["Tesseract<br/>OCR"]
    LO["LibreOffice<br/>Office para PDF"]
    IMG["sharp<br/>imagens e miniaturas"]
    OFFICE["docx / xlsx / pptxgenjs<br/>conversões de saída"]
    DIFF["pixelmatch / pngjs<br/>comparação visual"]
  end

  HOME --> API_TOOLS
  TOOL --> API_UPLOAD
  TOOL --> PDFJS
  PDFJS --> API_FILE
  API_UPLOAD --> UP
  API_UPLOAD --> MEM
  API_FILE --> UP
  TOOL --> API_PROC
  API_PROC --> VALID
  VALID --> REG
  VALID --> PROC
  PROC --> UTIL
  PROC --> PDFLIB
  PROC --> GS
  PROC --> QPDF
  PROC --> POP
  PROC --> TESS
  PROC --> LO
  PROC --> IMG
  PROC --> OFFICE
  PROC --> DIFF
  PROC --> TMP
  PROC --> OUT
  API_PROC --> MEM
  MEM --> API_DOWN
  API_DOWN --> OUT
  API_DOWN --> DL
```

---

## 2. Fluxo completo de uma tarefa

```mermaid
sequenceDiagram
  autonumber
  actor U as Usuário
  participant B as Navegador
  participant S as Servidor Express
  participant D as data/
  participant P as Processador
  participant X as Ferramentas do sistema

  U->>B: Escolhe ou arrasta arquivo(s)
  B->>S: POST /api/upload (multipart)
  S->>D: Salva em data/uploads com UUID
  S->>S: Lê páginas/dimensões (pdf-lib ou sharp)
  S-->>B: IDs, nomes, tamanhos e páginas

  B->>S: GET /api/file/:id
  S-->>B: PDF/Imagem para prévia
  B->>B: PDF.js renderiza página ou miniaturas
  U->>B: Ajusta opções (inclusive recorte visual)
  U->>B: Clica no botão de processar

  B->>S: POST /api/process/:slug (JSON)
  S->>S: Valida arquivo, ferramenta e opções
  S->>D: Cria data/tmp/<job> e data/output/<job>
  S->>P: Executa o processador da ferramenta

  loop Enquanto houver páginas/arquivos
    P->>X: pdf-lib, Ghostscript, QPDF, Poppler,<br/>Tesseract, LibreOffice etc.
    X-->>P: Resultado parcial
  end

  P->>D: Grava resultado final
  P-->>S: Caminho, nome e metadados
  S->>S: Gera token aleatório de download
  S-->>B: { download, filename, size, meta }

  B->>S: GET /api/download/:token
  S->>D: Lê resultado
  S-->>U: Download do arquivo

  Note over S,D: Limpeza automática a cada hora<br/>remove itens com mais de 12 horas
```

---

## 3. Mapa de ferramentas e motores

| Ferramenta | Rota | Motor principal |
|---|---|---|
| Juntar PDF | `/ferramenta/juntar_pdf` | `pdf-lib` (`copyPages`) |
| Dividir PDF | `/ferramenta/dividir_pdf` | `pdf-lib` + ZIP (`archiver`) |
| Organizar PDF | `/ferramenta/organizar-pdf` | `pdf-lib` + miniaturas PDF.js |
| Remover páginas | `/ferramenta/excluir-paginas-do-pdf` | `pdf-lib` |
| Girar PDF | `/ferramenta/rodar_pdf` | `pdf-lib` (`setRotation`) |
| Recortar PDF | `/ferramenta/recortar-pdf` | PDF.js + `pdf-lib` (`setCropBox`) |
| Numerar páginas | `/ferramenta/pdf_inserir_numeros_de_paginas` | `pdf-lib` (`drawText`) |
| Marca d'água | `/ferramenta/pdf_inserir_marca_daigua` | `pdf-lib` (`drawText`) |
| Comprimir PDF | `/ferramenta/comprimir_pdf` | Ghostscript (`pdfwrite`) |
| Reparar PDF | `/ferramenta/reparar-pdf` | Ghostscript, fallback QPDF |
| PDF para PDF/A | `/ferramenta/pdf_para_pdfa` | Ghostscript (`-dPDFA=2`) |
| PDF para JPG | `/ferramenta/pdf_para_jpg` | Poppler (`pdftoppm`) + ZIP |
| JPG para PDF | `/ferramenta/jpg_para_pdf` | `sharp` + `pdf-lib` |
| PDF para Word | `/ferramenta/pdf_para_word` | Poppler (`pdftotext`) + `docx` |
| PDF para Excel | `/ferramenta/pdf_para_excel` | Poppler (`pdftotext`) + `xlsx` |
| PDF para PowerPoint | `/ferramenta/pdf_para_powerpoint` | Poppler + `pptxgenjs` |
| Word para PDF | `/ferramenta/word_para_pdf` | LibreOffice |
| Excel para PDF | `/ferramenta/excel_para_pdf` | LibreOffice |
| PowerPoint para PDF | `/ferramenta/powerpoint_para_pdf` | LibreOffice |
| OCR PDF | `/ferramenta/ocr-pdf` | Poppler + Tesseract + `pdf-lib` |
| Proteger PDF | `/ferramenta/proteger-pdf` | QPDF (`--encrypt 256`) |
| Desbloquear PDF | `/ferramenta/desbloquear_pdf` | QPDF (`--decrypt`) |
| Assinar PDF | `/ferramenta/assinar-pdf` | PDF.js + `pdf-lib` |
| Comparar PDFs | `/ferramenta/comparar-pdf` | Poppler + `pixelmatch` + ZIP |

---

## 4. Recorte visual (sem coordenadas)

O recorte foi feito para ser 100% visual. O usuário não digita `x`, `y`, largura ou altura.

```mermaid
flowchart TD
  A["Upload do PDF"] --> B["PDF.js carrega a página"]
  B --> C["Canvas da página é desenhado"]
  C --> D["Camada de seleção transparente<br/>sobre o canvas"]
  D --> E["Usuário arrasta o mouse<br/>formando um retângulo"]
  E --> F["Coordenadas da tela são convertidas<br/>com viewport.convertToPdfPoint()"]
  F --> G["Objeto interno:<br/>{ página, x, y, largura, altura }"]
  G --> H{"Aplicar a todas<br/>as páginas?"}
  H -- "Sim" --> I["Envia { applyAll: true, all: área }"]
  H -- "Não" --> J["Envia { crops: [ ... ] }"]
  I --> K["Servidor valida e limita<br/>a área ao tamanho real da página"]
  J --> K
  K --> L["pdf-lib aplica page.setCropBox()"]
  L --> M["Novo PDF recortado<br/>disponível para download"]
```

Detalhes:

- A prévia usa PDF.js em `public/js/tool.js`.
- O retângulo é desenhado por cima do canvas, sem inputs de coordenadas.
- A conversão para o espaço do PDF considera rotação e escala da página.
- O servidor ainda valida e limita a área para impedir valores inválidos.
- O mesmo raciocínio visual é usado em **Assinar PDF**.

---

## 5. Como cada grupo de conversão funciona

```mermaid
flowchart LR
  subgraph PDF_ENTRADA["PDF de entrada"]
    PDF["PDF"]
  end

  subgraph TEXTO["Extração de texto"]
    TXT["pdftotext -layout"]
    DOCX["docx"]
    XLSX["xlsx"]
  end

  subgraph IMAGENS["Renderização de páginas"]
    PNG["pdftoppm PNG/JPG"]
    PPTX["pptxgenjs"]
    OCRPDF["Tesseract PDF<br/>com camada de texto"]
  end

  subgraph ESCRITA["Segurança e otimização"]
    QPDF["QPDF"]
    GS["Ghostscript"]
  end

  PDF --> TXT
  TXT --> DOCX
  TXT --> XLSX
  PDF --> PNG
  PNG --> PPTX
  PNG --> OCRPDF
  PDF --> QPDF
  PDF --> GS

  DOCX --> OUT1["DOCX editável"]
  XLSX --> OUT2["XLSX editável"]
  PPTX --> OUT3["PPTX com slides"]
  OCRPDF --> OUT4["PDF pesquisável"]
  QPDF --> OUT5["PDF protegido ou desbloqueado"]
  GS --> OUT6["PDF comprimido, reparado ou PDF/A"]
```

Conversões de Office para PDF seguem o caminho inverso: o LibreOffice abre o documento local e exporta diretamente para PDF com `soffice --headless --convert-to pdf`.

---

## 6. Assinatura visual

```mermaid
flowchart TD
  A["PDF enviado"] --> B["PDF.js mostra a página"]
  B --> C{"Modo da assinatura"}
  C -- "Desenhar" --> D["Canvas da assinatura<br/>gera PNG"]
  C -- "Digitar" --> E["Nome digitado"]
  D --> F["Usuário arrasta um retângulo<br/>sobre a página"]
  E --> F
  F --> G["Retângulo é convertido para<br/>coordenadas do PDF"]
  G --> H["POST /api/process/assinar-pdf"]
  H --> I["pdf-lib insere a imagem PNG<br/>ou desenha o texto"]
  I --> J["PDF assinado para download"]
```

> A assinatura é visual. Não é uma assinatura digital certificada com ICP-Brasil ou certificado X.509.

---

## 7. Proteção e desbloqueio

```mermaid
flowchart LR
  A["PDF"] --> B{"Ação"}
  B -- "Proteger" --> C["QPDF --encrypt<br/>senha de usuário<br/>senha de proprietário<br/>AES 256"]
  C --> D["Permissões:<br/>impressão, cópia,<br/>edição e anotações"]
  D --> E["PDF protegido"]
  B -- "Desbloquear" --> F["QPDF --decrypt<br/>com a senha informada"]
  F --> G["PDF sem criptografia"]
```

O PDF protegido exige a senha para abrir. A senha não é armazenada em lugar nenhum.

---

## 8. Dados, privacidade e limpeza

```mermaid
flowchart TD
  A["Upload"] --> B["data/uploads/<uuid>.<ext>"]
  B --> C["Processamento"]
  C --> D["data/tmp/<job>"]
  C --> E["data/output/<job>/arquivo"]
  E --> F["Token de download em memória"]
  F --> G["Usuário baixa"]
  B --> H{"Mais de 12 horas?"}
  D --> H
  E --> H
  H -- "Sim" --> I["Remoção automática"]
  H -- "Não" --> J["Permanece disponível"]
```

- O servidor escuta em `127.0.0.1` por padrão.
- Não há chamadas para serviços externos.
- PDF.js, fontes e mapas de caracteres ficam em `public/vendor/pdfjs`.
- Arquivos são identificados por UUID; não há listagem pública de uploads.
- Downloads usam tokens aleatórios.
- A limpeza roda a cada hora e remove o que passou de 12 horas.

---

## 9. Estrutura do código

```mermaid
flowchart TB
  A["server.js<br/>rotas e orquestração"] --> B["lib/tools.js<br/>metadados do catálogo"]
  A --> C["lib/processors.js<br/>implementação das ferramentas"]
  C --> D["lib/pdfutil.js<br/>ajudas compartilhadas"]
  A --> E["public/index.html + app.js<br/>catálogo"]
  A --> F["public/tool.html + tool.js<br/>interface das ferramentas"]
  F --> G["public/vendor/pdfjs<br/>prévias locais"]
  E --> H["public/css/styles.css"]
  F --> H
  I["tests/run.mjs + smoke.mjs<br/>testes de integração"] --> A
```

---

## 10. Como adicionar uma nova ferramenta

1. Adicione o item em `lib/tools.js` com `slug`, título, descrição, categoria, `endpoint` e tipos aceitos.
2. Crie o processador em `lib/processors.js` e registre no objeto `PROCESSORS`.
3. Se precisar de opções próprias, adicione um construtor em `OPTION_BUILDERS`, no `public/js/tool.js`.
4. Defina `getOptions()` para devolver as opções e `validateOptions()` para validar no navegador.
5. Adicione um caso de teste em `tests/smoke.mjs`.
6. Rode `npm test` e valide a página em `http://127.0.0.1:3000/ferramenta/<slug>`.

---

## 11. Limitações conhecidas

- **Resumir PDF** e **Traduzir PDF** não foram incluídos: dependeriam de um modelo de IA externo ou local adicional.
- **Editar PDF** como editor gráfico livre (texto, formas, imagens e anotações em lote) não está incluído.
- A assinatura é visual, não certificada digitalmente.
- PDF para Word e Excel são baseados no texto extraído; layouts muito complexos podem exigir ajustes.
- OCR depende dos idiomas instalados no Tesseract.
- A comparação é visual (pixel a pixel), não semântica.
