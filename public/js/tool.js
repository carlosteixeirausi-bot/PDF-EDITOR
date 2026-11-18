import * as pdfjsLib from '/vendor/pdfjs/pdf.min.mjs';
import {
  loadCatalog,
  setupHeaderMenus,
  iconSvg,
  escapeHtml,
  formatBytes,
  toast,
} from './common.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';

const PDF_OPTIONS = {
  cMapUrl: '/vendor/pdfjs/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
};

const root = document.getElementById('tool-root');
const overlay = document.getElementById('process-overlay');
const overlayTitle = document.getElementById('process-title');
const overlayDetail = document.getElementById('process-detail');
const progressBar = document.getElementById('progress-bar');

let catalog = null;
let tool = null;
let files = [];
let compareFiles = [null, null];
let getOptions = () => ({});
let validateOptions = () => true;
let resultShowing = false;
let progressTimer = null;
const pdfCache = new Map();

function pdfOptionsFor(file) {
  return { url: `/api/file/${file.id}`, ...PDF_OPTIONS };
}

async function getPdfDoc(file) {
  if (pdfCache.has(file.id)) return pdfCache.get(file.id);
  try {
    const doc = await pdfjsLib.getDocument(pdfOptionsFor(file)).promise;
    pdfCache.set(file.id, doc);
    return doc;
  } catch (error) {
    if (error?.name === 'PasswordException') {
      throw new Error('Este PDF está protegido por senha. Use a ferramenta Desbloquear PDF primeiro.');
    }
    throw error;
  }
}

async function totalPages(file) {
  if (file.pages) return file.pages;
  const doc = await getPdfDoc(file);
  return doc.numPages;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isReady() {
  if (tool.twoFiles) return Boolean(compareFiles[0] && compareFiles[1]);
  const minimum = tool.minFiles || 1;
  return files.length >= minimum;
}

function activeFile() {
  return tool.twoFiles ? compareFiles[0] : files[0];
}

function allActiveFiles() {
  return tool.twoFiles ? compareFiles.filter(Boolean) : files;
}

async function init() {
  try {
    catalog = await loadCatalog();
    const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
    tool = catalog.tools.find((item) => item.slug === slug);
    if (!tool) {
      location.replace('/');
      return;
    }
    document.title = `${tool.title} — PDF-Editor`;
    setupHeaderMenus(catalog.tools);
    renderShell();
    bindGlobal();
    renderUploadArea();
    updateOptionsVisibility();
  } catch (error) {
    root.innerHTML = `<div class="panel"><h1>Erro</h1><p>Não foi possível carregar esta ferramenta. Verifique se o servidor está ativo.</p></div>`;
    console.error(error);
  }
}

function renderShell() {
  root.innerHTML = `
    <section class="tool-hero">
      <div class="tool-hero-icon">${iconSvg(tool.icon.kind, tool.icon.color, 64)}</div>
      <div>
        <h1>${escapeHtml(tool.title)}</h1>
        <p>${escapeHtml(tool.long || tool.desc)}</p>
      </div>
    </section>

    <div class="tool-layout">
      <section class="panel" id="step-files">
        <div class="step-head"><span class="step-num">1</span><h2>${tool.twoFiles ? 'Selecione os dois PDFs' : 'Selecione o arquivo'}</h2></div>
        <div id="upload-area"></div>
      </section>

      <section class="panel" id="step-options" hidden>
        <div class="step-head"><span class="step-num">2</span><h2>Opções</h2></div>
        <div id="options-fields"></div>
        <div class="process-row">
          <span class="privacy-note">Processado localmente · nada é enviado para a internet</span>
          <button type="button" class="primary-btn" id="process-btn">${escapeHtml(tool.action)}</button>
        </div>
      </section>

      <section class="panel result-panel" id="result-panel" hidden></section>
    </div>
  `;
}

function bindGlobal() {
  document.getElementById('process-btn').addEventListener('click', processFile);
}

function acceptLabel() {
  const extensions = tool.accept.match(/\.[a-z0-9]+/gi) || [];
  return [...new Set(extensions.map((extension) => extension.slice(1).toUpperCase()))].join(' · ') || 'Arquivos suportados';
}

function dropzoneMarkup(multiple, index = null, label = '') {
  const inputId = index === null ? 'file-input' : `file-input-${index}`;
  return `
    <div class="upload-slot ${label ? 'has-label' : ''}">
      ${label ? `<span class="slot-label">${escapeHtml(label)}</span>` : ''}
      <label class="dropzone" for="${inputId}" data-slot="${index ?? ''}">
        <input id="${inputId}" type="file" accept="${escapeHtml(tool.accept)}" ${multiple ? 'multiple' : ''} hidden>
        <div class="dropzone-icon">${iconSvg(tool.icon.kind, tool.icon.color, 48)}</div>
        <div class="dropzone-title">${tool.twoFiles ? 'Clique ou arraste o PDF aqui' : 'Clique ou arraste o arquivo aqui'}</div>
        <div class="dropzone-hint">${escapeHtml(acceptLabel())}</div>
        <div class="dropzone-uploading"><span class="spinner"></span> Enviando…</div>
      </label>
    </div>`;
}

function fileRow(file, index) {
  const meta = [
    formatBytes(file.size),
    file.pages ? `${file.pages} página${file.pages > 1 ? 's' : ''}` : null,
  ].filter(Boolean).join(' · ');
  return `
    <div class="file-row" data-index="${index}" ${files.length > 1 ? 'draggable="true"' : ''}>
      ${files.length > 1 ? '<span class="drag-handle" title="Arraste para reordenar">⠿</span>' : ''}
      <span class="file-badge ${file.kind === 'pdf' ? 'pdf' : 'img'}">${file.kind === 'pdf' ? 'PDF' : 'IMG'}</span>
      <span class="file-main">
        <strong>${escapeHtml(file.name)}</strong>
        <small>${meta}</small>
      </span>
      ${files.length > 1 ? `
        <span class="file-order">
          <button type="button" class="icon-btn" data-move="up" data-index="${index}" title="Mover para cima">↑</button>
          <button type="button" class="icon-btn" data-move="down" data-index="${index}" title="Mover para baixo">↓</button>
        </span>` : ''}
      <button type="button" class="remove-btn" data-remove="${index}" title="Remover arquivo">×</button>
    </div>`;
}

function renderUploadArea() {
  const area = document.getElementById('upload-area');
  if (!area) return;
  if (tool.twoFiles) {
    area.innerHTML = `
      <div class="compare-grid">
        ${[0, 1].map((index) => {
          const file = compareFiles[index];
          return `
          <div class="compare-slot">
            ${file ? `
              <div class="uploaded-card">
                <span class="file-badge pdf">PDF</span>
                <span class="file-main"><strong>${escapeHtml(file.name)}</strong><small>${formatBytes(file.size)}${file.pages ? ` · ${file.pages} páginas` : ''}</small></span>
                <button type="button" class="remove-btn" data-remove-compare="${index}" title="Remover">×</button>
              </div>` : dropzoneMarkup(false, index, index === 0 ? 'PDF original' : 'PDF revisado')}
          </div>`;
        }).join('')}
      </div>
      <p class="hint">O resultado traz as imagens de diferença de cada página em um ZIP.</p>`;
  } else {
    area.innerHTML = `
      ${dropzoneMarkup(tool.multiple)}
      <div class="file-list" id="file-list">
        ${files.map(fileRow).join('')}
      </div>
      ${tool.multiple ? `<p class="hint">Você pode adicionar ${tool.endpoint === 'office2pdf' ? 'documentos' : tool.endpoint === 'img2pdf' ? 'imagens' : 'arquivos'} e reordenar com as setas.</p>` : ''}`;
  }
  bindUploadArea();
}

function bindUploadArea() {
  document.querySelectorAll('.dropzone input[type=file]').forEach((input) => {
    const slot = input.closest('.dropzone').dataset.slot;
    input.addEventListener('change', () => {
      if (input.files?.length) uploadSelected(input.files, slot === '' ? null : Number(slot));
      input.value = '';
    });
    const zone = input.closest('.dropzone');
    ['dragenter', 'dragover'].forEach((eventName) => {
      zone.addEventListener(eventName, (event) => {
        event.preventDefault();
        zone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach((eventName) => {
      zone.addEventListener(eventName, (event) => {
        event.preventDefault();
        if (eventName === 'dragleave' && event.relatedTarget && zone.contains(event.relatedTarget)) return;
        zone.classList.remove('dragover');
      });
    });
    zone.addEventListener('drop', (event) => {
      const selected = event.dataTransfer?.files;
      if (selected?.length) uploadSelected(selected, slot === '' ? null : Number(slot));
    });
  });
  document.querySelectorAll('[data-remove]').forEach((button) => {
    button.addEventListener('click', () => {
      files.splice(Number(button.dataset.remove), 1);
      renderUploadArea();
      updateOptionsVisibility();
    });
  });
  document.querySelectorAll('[data-remove-compare]').forEach((button) => {
    button.addEventListener('click', () => {
      compareFiles[Number(button.dataset.removeCompare)] = null;
      renderUploadArea();
      updateOptionsVisibility();
    });
  });
  document.querySelectorAll('[data-move]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.index);
      const target = button.dataset.move === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= files.length) return;
      const [item] = files.splice(index, 1);
      files.splice(target, 0, item);
      renderUploadArea();
      updateOptionsVisibility();
    });
  });
  bindFileDrag();
}

function bindFileDrag() {
  const rows = [...document.querySelectorAll('.file-row[draggable=true]')];
  if (!rows.length) return;
  let dragIndex = null;
  rows.forEach((row) => {
    row.addEventListener('dragstart', (event) => {
      dragIndex = Number(row.dataset.index);
      row.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      try { event.dataTransfer.setData('text/plain', String(dragIndex)); } catch { /* ignorado */ }
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      rows.forEach((item) => item.classList.remove('drop-target'));
    });
    row.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (dragIndex === null || Number(row.dataset.index) === dragIndex) return;
      row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      row.classList.remove('drop-target');
      const target = Number(row.dataset.index);
      if (dragIndex === null || target === dragIndex) return;
      const [item] = files.splice(dragIndex, 1);
      files.splice(target, 0, item);
      dragIndex = null;
      renderUploadArea();
      updateOptionsVisibility();
    });
  });
}

async function uploadSelected(fileList, slot = null) {
  let selected = [...fileList];
  if (!tool.multiple && slot === null) {
    files = [];
    renderUploadArea();
  }
  if (selected.length > 20) selected = selected.slice(0, 20);
  const zone = document.querySelector('.dropzone');
  zone?.classList.add('uploading');
  const form = new FormData();
  for (const file of selected) form.append('files', file);
  try {
    const response = await fetch('/api/upload', { method: 'POST', body: form });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Falha ao enviar o arquivo.');
    if (tool.twoFiles) {
      compareFiles[slot ?? 0] = data.files[0];
    } else if (tool.multiple) {
      files = files.concat(data.files);
    } else {
      files = data.files.slice(0, 1);
    }
    renderUploadArea();
    updateOptionsVisibility();
  } catch (error) {
    toast(error.message);
    zone?.classList.remove('uploading');
  }
}

function updateOptionsVisibility() {
  const ready = isReady();
  const panel = document.getElementById('step-options');
  const resultPanel = document.getElementById('result-panel');
  if (resultShowing) return;
  panel.hidden = !ready;
  resultPanel.hidden = true;
  if (!ready) {
    document.getElementById('options-fields').innerHTML = '';
    getOptions = () => ({});
    validateOptions = () => true;
    return;
  }
  renderOptions();
}

function infoBox(text) {
  return `<div class="info-box">${text}</div>`;
}

function field(label, control, hint = '') {
  return `<label class="field"><span class="field-label">${label}</span>${control}${hint ? `<span class="field-hint">${hint}</span>` : ''}</label>`;
}

function checkbox(id, label, checked = false) {
  return `<label class="check-row"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><span>${label}</span></label>`;
}

function numberField(id, value, min, max, step = 1, suffix = '') {
  return `<div class="number-wrap"><input type="number" id="${id}" value="${value}" min="${min}" max="${max}" step="${step}">${suffix ? `<span>${suffix}</span>` : ''}</div>`;
}

function selectField(id, options, selected) {
  return `<select id="${id}">${options.map((option) => {
    const value = typeof option === 'string' ? option : option.value;
    const label = typeof option === 'string' ? option : option.label;
    return `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('')}</select>`;
}

function renderOptions() {
  const area = document.getElementById('options-fields');
  area.innerHTML = '';
  getOptions = () => ({});
  validateOptions = () => true;
  const builder = OPTION_BUILDERS[tool.endpoint];
  if (builder) {
    Promise.resolve(builder(area)).catch((error) => {
      console.error(error);
      area.innerHTML = `<div class="error-box">${escapeHtml(error.message || 'Não foi possível preparar esta ferramenta.')}</div>`;
    });
  } else {
    area.innerHTML = infoBox('Este arquivo será processado com as configurações padrão.');
  }
}

async function paintThumb(canvas, doc, pageNumber, rotation = 0, width = 148) {
  const page = await doc.getPage(pageNumber);
  const rotationTotal = (((page.rotate || 0) + rotation) % 360 + 360) % 360;
  const base = page.getViewport({ scale: 1, rotation: rotationTotal });
  const scale = width / base.width;
  const viewport = page.getViewport({ scale, rotation: rotationTotal });
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(viewport.width * dpr);
  canvas.height = Math.round(viewport.height * dpr);
  canvas.style.width = `${Math.round(viewport.width)}px`;
  canvas.style.height = `${Math.round(viewport.height)}px`;
  const context = canvas.getContext('2d', { alpha: false });
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, viewport.width, viewport.height);
  await page.render({ canvasContext: context, viewport }).promise;
}

function placeholderThumb(canvas) {
  canvas.width = 148;
  canvas.height = 190;
  canvas.style.width = '148px';
  canvas.style.height = '190px';
  const context = canvas.getContext('2d');
  context.fillStyle = '#f4f5f7';
  context.fillRect(0, 0, 148, 190);
}

const OPTION_BUILDERS = {
  async merge(area) {
    area.innerHTML = `
      <div class="info-box compact">A ordem dos arquivos define a ordem final. Use as setas ou arraste os arquivos para reorganizar.</div>
      <div class="range-list">
        ${files.map((file, index) => `
          <label class="field compact">
            <span class="field-label">Páginas de <strong>${escapeHtml(file.name)}</strong></span>
            <input type="text" class="merge-range" data-range-index="${index}" placeholder="todas (ex.: 1-3,5)">
          </label>`).join('')}
      </div>`;
    getOptions = () => ({
      ranges: [...area.querySelectorAll('.merge-range')].map((input) => input.value.trim()),
    });
  },

  async split(area) {
    area.innerHTML = `
      <div class="mode-grid" id="split-modes">
        <label class="mode-card"><input type="radio" name="split-mode" value="ranges" checked><span><strong>Intervalos</strong><small>Crie um PDF para cada intervalo informado.</small></span></label>
        <label class="mode-card"><input type="radio" name="split-mode" value="each"><span><strong>Separar todas</strong><small>Uma página por arquivo PDF.</small></span></label>
        <label class="mode-card"><input type="radio" name="split-mode" value="every"><span><strong>A cada N páginas</strong><small>Divida o documento em blocos iguais.</small></span></label>
        <label class="mode-card"><input type="radio" name="split-mode" value="selected"><span><strong>Extrair páginas</strong><small>Gere um único PDF com as páginas escolhidas.</small></span></label>
      </div>
      <div id="split-extra" class="split-extra">
        ${field('Intervalos', '<input type="text" id="split-ranges" placeholder="1-3,4-6">', 'Cada intervalo gera um PDF separado dentro de um ZIP.')}
      </div>`;
    const extra = area.querySelector('#split-extra');
    const fields = {
      ranges: field('Intervalos', '<input type="text" id="split-ranges" placeholder="1-3,4-6">', 'Cada intervalo gera um PDF separado dentro de um ZIP.'),
      each: infoBox('Cada página será salva em um arquivo PDF separado e entregue em um ZIP.'),
      every: field('Tamanho dos blocos', numberField('split-every', 2, 1, 9999, 1, 'páginas')),
      selected: field('Páginas para extrair', '<input type="text" id="split-pages" placeholder="1,3,5-8">', 'Será gerado um único PDF com estas páginas.'),
    };
    const currentMode = () => area.querySelector('input[name=split-mode]:checked').value;
    const refresh = () => {
      extra.innerHTML = fields[currentMode()];
    };
    area.querySelectorAll('input[name=split-mode]').forEach((radio) => radio.addEventListener('change', refresh));
    getOptions = () => {
      const mode = currentMode();
      if (mode === 'every') {
        const every = Number(area.querySelector('#split-every')?.value || 2);
        if (!every || every < 1) {
          toast('Informe um número de páginas por bloco.');
          return null;
        }
        return { mode, every };
      }
      if (mode === 'ranges') {
        const ranges = area.querySelector('#split-ranges')?.value?.trim();
        if (!ranges) {
          toast('Informe pelo menos um intervalo de páginas.');
          return null;
        }
        return { mode, ranges };
      }
      if (mode === 'selected') {
        const pages = area.querySelector('#split-pages')?.value?.trim();
        if (!pages) {
          toast('Informe as páginas que deseja extrair.');
          return null;
        }
        return { mode, pages };
      }
      return { mode };
    };
    validateOptions = () => {
      if (currentMode() === 'ranges' && !area.querySelector('#split-ranges')?.value?.trim()) {
        toast('Informe pelo menos um intervalo de páginas.');
        return false;
      }
      if (currentMode() === 'selected' && !area.querySelector('#split-pages')?.value?.trim()) {
        toast('Informe as páginas que deseja extrair.');
        return false;
      }
      return true;
    };
  },

  async organize(area) {
    const file = activeFile();
    const doc = await getPdfDoc(file);
    const total = doc.numPages;
    let items = Array.from({ length: total }, (_, index) => ({ page: index + 1, rotation: 0 }));
    area.innerHTML = `
      <div class="preview-toolbar">
        <span id="org-summary">${total} página${total > 1 ? 's' : ''}</span>
        <button type="button" class="ghost-btn small" id="org-reset">Restaurar ordem</button>
      </div>
      <div class="thumb-grid" id="org-grid"></div>
      <p class="hint">Arraste as miniaturas para reordenar. Gire ou exclua páginas nos botões abaixo de cada miniatura.</p>`;
    const grid = area.querySelector('#org-grid');
    const paint = async () => {
      grid.innerHTML = items.map((item, index) => `
        <div class="thumb-card" draggable="true" data-index="${index}">
          <div class="thumb-canvas"><canvas></canvas><span class="page-badge">${item.page}</span></div>
          <div class="thumb-actions">
            <button type="button" data-org-rotate="${index}" title="Girar 90°">↻</button>
            <span class="rotation-tag">${item.rotation ? `${item.rotation}°` : '0°'}</span>
            <button type="button" data-org-remove="${index}" title="Excluir página">×</button>
          </div>
        </div>`).join('');
      const cards = [...grid.querySelectorAll('.thumb-card')];
      for (const card of cards) {
        const index = Number(card.dataset.index);
        const canvas = card.querySelector('canvas');
        placeholderThumb(canvas);
        paintThumb(canvas, doc, items[index].page, items[index].rotation, 140).catch(() => {});
      }
      bindDrag(cards);
      grid.querySelectorAll('[data-org-rotate]').forEach((button) => {
        button.addEventListener('click', () => {
          const index = Number(button.dataset.orgRotate);
          items[index].rotation = (items[index].rotation + 90) % 360;
          paint();
        });
      });
      grid.querySelectorAll('[data-org-remove]').forEach((button) => {
        button.addEventListener('click', () => {
          items.splice(Number(button.dataset.orgRemove), 1);
          paint();
        });
      });
    };
    const bindDrag = (cards) => {
      let from = null;
      cards.forEach((card) => {
        card.addEventListener('dragstart', (event) => {
          from = Number(card.dataset.index);
          card.classList.add('dragging');
          event.dataTransfer.effectAllowed = 'move';
        });
        card.addEventListener('dragend', () => {
          card.classList.remove('dragging');
          cards.forEach((item) => item.classList.remove('drop-target'));
        });
        card.addEventListener('dragover', (event) => {
          event.preventDefault();
          if (from !== null && from !== Number(card.dataset.index)) card.classList.add('drop-target');
        });
        card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
        card.addEventListener('drop', (event) => {
          event.preventDefault();
          card.classList.remove('drop-target');
          const to = Number(card.dataset.index);
          if (from === null || from === to) return;
          const [item] = items.splice(from, 1);
          items.splice(to, 0, item);
          from = null;
          paint();
        });
      });
    };
    area.querySelector('#org-reset').addEventListener('click', () => {
      items = Array.from({ length: total }, (_, index) => ({ page: index + 1, rotation: 0 }));
      paint();
    });
    await paint();
    getOptions = () => ({ order: items.map((item) => ({ page: item.page - 1, rotate: item.rotation })) });
    validateOptions = () => {
      if (!items.length) {
        toast('Mantenha pelo menos uma página no documento.');
        return false;
      }
      return true;
    };
  },

  async remove(area) {
    const file = activeFile();
    const doc = await getPdfDoc(file);
    const total = doc.numPages;
    const selected = new Set();
    area.innerHTML = `
      <div class="preview-toolbar">
        <span id="remove-summary">Clique nas páginas para removê-las</span>
        <span class="toolbar-actions">
          <button type="button" class="ghost-btn small" id="remove-all">Selecionar todas</button>
          <button type="button" class="ghost-btn small" id="remove-none">Limpar</button>
        </span>
      </div>
      <div class="thumb-grid selectable" id="remove-grid"></div>`;
    const grid = area.querySelector('#remove-grid');
    const summary = area.querySelector('#remove-summary');
    grid.innerHTML = Array.from({ length: total }, (_, index) => `
      <button type="button" class="thumb-card select-thumb" data-page="${index + 1}">
        <div class="thumb-canvas"><canvas></canvas><span class="page-badge">${index + 1}</span><span class="thumb-check">✓</span></div>
      </button>`).join('');
    const cards = [...grid.querySelectorAll('.select-thumb')];
    for (const card of cards) {
      const page = Number(card.dataset.page);
      paintThumb(card.querySelector('canvas'), doc, page, 0, 140).catch(() => {});
      card.addEventListener('click', () => {
        if (selected.has(page)) selected.delete(page);
        else selected.add(page);
        card.classList.toggle('selected', selected.has(page));
        update();
      });
    }
    const update = () => {
      summary.textContent = selected.size
        ? `${selected.size} página${selected.size > 1 ? 's' : ''} será${selected.size > 1 ? 'ão' : ''} removida${selected.size > 1 ? 's' : ''}`
        : 'Clique nas páginas para removê-las';
    };
    area.querySelector('#remove-all').addEventListener('click', () => {
      cards.forEach((card) => {
        selected.add(Number(card.dataset.page));
        card.classList.add('selected');
      });
      update();
    });
    area.querySelector('#remove-none').addEventListener('click', () => {
      selected.clear();
      cards.forEach((card) => card.classList.remove('selected'));
      update();
    });
    getOptions = () => ({ pages: [...selected].sort((a, b) => a - b) });
    validateOptions = () => {
      if (!selected.size) {
        toast('Selecione pelo menos uma página para remover.');
        return false;
      }
      return true;
    };
  },

  async rotate(area) {
    const file = activeFile();
    const doc = await getPdfDoc(file);
    const total = doc.numPages;
    let angle = 90;
    const selected = new Set(Array.from({ length: total }, (_, index) => index + 1));
    area.innerHTML = `
      <div class="angle-row">
        <span class="field-label">Girar seleção em:</span>
        <div class="segmented" id="angle-buttons">
          ${[90, 180, 270].map((value) => `<button type="button" data-angle="${value}" class="${value === angle ? 'active' : ''}">${value}°</button>`).join('')}
        </div>
        <button type="button" class="ghost-btn small" id="rotate-all">Selecionar todas</button>
        <button type="button" class="ghost-btn small" id="rotate-none">Limpar seleção</button>
      </div>
      <div class="thumb-grid selectable" id="rotate-grid"></div>
      <p class="hint">Clique nas páginas para escolher quais serão giradas. A prévia já mostra o resultado.</p>`;
    const grid = area.querySelector('#rotate-grid');
    grid.innerHTML = Array.from({ length: total }, (_, index) => `
      <button type="button" class="thumb-card select-thumb selected" data-page="${index + 1}">
        <div class="thumb-canvas"><canvas></canvas><span class="page-badge">${index + 1}</span><span class="thumb-check">✓</span></div>
      </button>`).join('');
    const cards = [...grid.querySelectorAll('.select-thumb')];
    const paintCard = async (card) => {
      const page = Number(card.dataset.page);
      const rotation = selected.has(page) ? angle : 0;
      await paintThumb(card.querySelector('canvas'), doc, page, rotation, 130);
    };
    const paintAll = async () => {
      for (const card of cards) await paintCard(card).catch(() => {});
    };
    cards.forEach((card) => {
      card.addEventListener('click', async () => {
        const page = Number(card.dataset.page);
        if (selected.has(page)) selected.delete(page);
        else selected.add(page);
        card.classList.toggle('selected', selected.has(page));
        await paintCard(card).catch(() => {});
      });
    });
    area.querySelectorAll('[data-angle]').forEach((button) => {
      button.addEventListener('click', () => {
        angle = Number(button.dataset.angle);
        area.querySelectorAll('[data-angle]').forEach((item) => item.classList.toggle('active', item === button));
        paintAll();
      });
    });
    area.querySelector('#rotate-all').addEventListener('click', () => {
      cards.forEach((card) => {
        selected.add(Number(card.dataset.page));
        card.classList.add('selected');
      });
      paintAll();
    });
    area.querySelector('#rotate-none').addEventListener('click', () => {
      selected.clear();
      cards.forEach((card) => card.classList.remove('selected'));
      paintAll();
    });
    await paintAll();
    getOptions = () => ({ angle, pages: [...selected].sort((a, b) => a - b) });
    validateOptions = () => {
      if (!selected.size) {
        toast('Selecione pelo menos uma página para girar.');
        return false;
      }
      return true;
    };
  },

  async crop(area) {
    const file = activeFile();
    const doc = await getPdfDoc(file);
    const total = doc.numPages;
    const crops = new Map();
    let currentPage = 1;
    let viewport = null;
    let dragging = null;
    area.innerHTML = `
      <div class="crop-toolbar">
        <div class="page-nav">
          <button type="button" class="icon-btn" id="crop-prev" title="Página anterior">←</button>
          <span>Página <strong id="crop-page">1</strong> de ${total}</span>
          <button type="button" class="icon-btn" id="crop-next" title="Próxima página">→</button>
        </div>
        <label class="check-row inline"><input type="checkbox" id="crop-apply-all"><span>Aplicar esta área a todas as páginas</span></label>
      </div>
      <div class="crop-stage" id="crop-stage">
        <canvas id="crop-canvas"></canvas>
        <div class="crop-overlay" id="crop-overlay">
          <div class="crop-selection" id="crop-selection" hidden><span class="crop-tag">Recorte</span></div>
        </div>
      </div>
      <div class="crop-footer">
        <span id="crop-status">Arraste sobre a página para marcar a área que deve permanecer.</span>
        <button type="button" class="ghost-btn small" id="crop-clear">Limpar seleção</button>
      </div>
      <p class="hint">A ferramenta recorta pela área visual selecionada, sem digitar coordenadas.</p>`;
    const stage = area.querySelector('#crop-stage');
    const canvas = area.querySelector('#crop-canvas');
    const overlayEl = area.querySelector('#crop-overlay');
    const selectionEl = area.querySelector('#crop-selection');
    const statusEl = area.querySelector('#crop-status');
    const pageLabel = area.querySelector('#crop-page');

    const updateStatus = () => {
      statusEl.textContent = crops.has(currentPage)
        ? 'Área selecionada nesta página.'
        : 'Arraste sobre a página para marcar a área que deve permanecer.';
      selectionEl.hidden = !crops.has(currentPage);
    };

    const drawSelection = () => {
      const crop = crops.get(currentPage);
      if (!crop || !viewport) {
        selectionEl.hidden = true;
        return;
      }
      const [x1, y1] = viewport.convertToViewportPoint(crop.x, crop.y);
      const [x2, y2] = viewport.convertToViewportPoint(crop.x + crop.width, crop.y + crop.height);
      const left = Math.min(x1, x2);
      const top = Math.min(y1, y2);
      const width = Math.abs(x2 - x1);
      const height = Math.abs(y2 - y1);
      selectionEl.style.left = `${left}px`;
      selectionEl.style.top = `${top}px`;
      selectionEl.style.width = `${width}px`;
      selectionEl.style.height = `${height}px`;
      selectionEl.hidden = false;
    };

    const renderPage = async () => {
      pageLabel.textContent = String(currentPage);
      const page = await doc.getPage(currentPage);
      const maxWidth = Math.min(840, Math.max(320, area.clientWidth - 8));
      const maxHeight = Math.max(360, Math.min(700, window.innerHeight * 0.66));
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(maxWidth / base.width, maxHeight / base.height);
      viewport = page.getViewport({ scale });
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(viewport.width * dpr);
      canvas.height = Math.round(viewport.height * dpr);
      canvas.style.width = `${Math.round(viewport.width)}px`;
      canvas.style.height = `${Math.round(viewport.height)}px`;
      stage.style.width = `${Math.round(viewport.width)}px`;
      stage.style.height = `${Math.round(viewport.height)}px`;
      overlayEl.style.width = `${Math.round(viewport.width)}px`;
      overlayEl.style.height = `${Math.round(viewport.height)}px`;
      const context = canvas.getContext('2d', { alpha: false });
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, viewport.width, viewport.height);
      await page.render({ canvasContext: context, viewport }).promise;
      drawSelection();
      updateStatus();
    };

    const finalizeSelection = (event, start) => {
      if (!viewport) return;
      const rect = overlayEl.getBoundingClientRect();
      const endX = clamp(event.clientX - rect.left, 0, viewport.width);
      const endY = clamp(event.clientY - rect.top, 0, viewport.height);
      const left = Math.min(start.x, endX);
      const top = Math.min(start.y, endY);
      const width = Math.abs(endX - start.x);
      const height = Math.abs(endY - start.y);
      if (width < 8 || height < 8) {
        crops.delete(currentPage);
        updateStatus();
        return;
      }
      const [pdfX1, pdfY1] = viewport.convertToPdfPoint(left, top);
      const [pdfX2, pdfY2] = viewport.convertToPdfPoint(left + width, top + height);
      crops.set(currentPage, {
        x: Math.min(pdfX1, pdfX2),
        y: Math.min(pdfY1, pdfY2),
        width: Math.abs(pdfX2 - pdfX1),
        height: Math.abs(pdfY2 - pdfY1),
      });
      drawSelection();
      updateStatus();
    };

    overlayEl.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      const rect = overlayEl.getBoundingClientRect();
      const x = clamp(event.clientX - rect.left, 0, viewport.width);
      const y = clamp(event.clientY - rect.top, 0, viewport.height);
      dragging = { x, y };
      overlayEl.setPointerCapture(event.pointerId);
      selectionEl.hidden = false;
      selectionEl.style.left = `${x}px`;
      selectionEl.style.top = `${y}px`;
      selectionEl.style.width = '0px';
      selectionEl.style.height = '0px';
    });
    overlayEl.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const rect = overlayEl.getBoundingClientRect();
      const x = clamp(event.clientX - rect.left, 0, viewport.width);
      const y = clamp(event.clientY - rect.top, 0, viewport.height);
      selectionEl.style.left = `${Math.min(x, dragging.x)}px`;
      selectionEl.style.top = `${Math.min(y, dragging.y)}px`;
      selectionEl.style.width = `${Math.abs(x - dragging.x)}px`;
      selectionEl.style.height = `${Math.abs(y - dragging.y)}px`;
    });
    overlayEl.addEventListener('pointerup', (event) => {
      if (!dragging) return;
      const start = dragging;
      dragging = null;
      finalizeSelection(event, start);
    });
    overlayEl.addEventListener('pointercancel', () => {
      dragging = null;
      updateStatus();
    });

    area.querySelector('#crop-clear').addEventListener('click', () => {
      crops.delete(currentPage);
      updateStatus();
    });
    area.querySelector('#crop-prev').addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage -= 1;
        renderPage();
      }
    });
    area.querySelector('#crop-next').addEventListener('click', () => {
      if (currentPage < total) {
        currentPage += 1;
        renderPage();
      }
    });
    await renderPage();
    getOptions = () => {
      const applyAll = area.querySelector('#crop-apply-all').checked;
      if (applyAll) {
        const crop = crops.get(currentPage) || [...crops.values()][0];
        if (!crop) return null;
        return { applyAll: true, all: crop };
      }
      return {
        crops: [...crops.entries()].map(([page, crop]) => ({ page, ...crop })),
      };
    };
    validateOptions = () => {
      if (!crops.size) {
        toast('Arraste sobre a página para selecionar a área de recorte.');
        return false;
      }
      return true;
    };
  },

  async sign(area) {
    const file = activeFile();
    const doc = await getPdfDoc(file);
    const total = doc.numPages;
    let currentPage = 1;
    let viewport = null;
    let signatureInk = false;
    let dragStart = null;
    let placement = null;
    let mode = 'draw';
    area.innerHTML = `
      <div class="sign-layout">
        <div class="sign-pad-card">
          <div class="sign-pad-head">
            <strong>Sua assinatura</strong>
            <div class="segmented small" id="sign-mode">
              <button type="button" data-mode="draw" class="active">Desenhar</button>
              <button type="button" data-mode="type">Digitar</button>
            </div>
          </div>
          <canvas id="sign-pad" width="600" height="180"></canvas>
          <input type="text" id="sign-name" placeholder="Digite seu nome" hidden>
          <div class="sign-pad-actions">
            <button type="button" class="ghost-btn small" id="sign-clear">Limpar assinatura</button>
            <span class="hint inline">Depois, arraste na página para posicionar.</span>
          </div>
        </div>
      </div>
      <div class="crop-toolbar">
        <div class="page-nav">
          <button type="button" class="icon-btn" id="sign-prev" title="Página anterior">←</button>
          <span>Página <strong id="sign-page">1</strong> de ${total}</span>
          <button type="button" class="icon-btn" id="sign-next" title="Próxima página">→</button>
        </div>
      </div>
      <div class="crop-stage" id="sign-stage">
        <canvas id="sign-canvas"></canvas>
        <div class="crop-overlay" id="sign-overlay">
          <div class="sign-selection" id="sign-selection" hidden></div>
        </div>
      </div>
      <p class="hint">A assinatura é inserida visualmente na posição escolhida. Ela não é uma assinatura digital certificada.</p>`;
    const pad = area.querySelector('#sign-pad');
    const padContext = pad.getContext('2d');
    const nameInput = area.querySelector('#sign-name');
    const stage = area.querySelector('#sign-stage');
    const canvas = area.querySelector('#sign-canvas');
    const overlayEl = area.querySelector('#sign-overlay');
    const selectionEl = area.querySelector('#sign-selection');
    const pageLabel = area.querySelector('#sign-page');

    const resetPad = () => {
      padContext.clearRect(0, 0, pad.width, pad.height);
      padContext.lineWidth = 5;
      padContext.lineCap = 'round';
      padContext.lineJoin = 'round';
      padContext.strokeStyle = '#17202a';
      signatureInk = false;
    };
    resetPad();

    let drawing = false;
    const padPoint = (event) => {
      const rect = pad.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) * (pad.width / rect.width),
        y: (event.clientY - rect.top) * (pad.height / rect.height),
      };
    };
    pad.addEventListener('pointerdown', (event) => {
      if (mode !== 'draw') return;
      drawing = true;
      const point = padPoint(event);
      padContext.beginPath();
      padContext.moveTo(point.x, point.y);
      pad.setPointerCapture(event.pointerId);
    });
    pad.addEventListener('pointermove', (event) => {
      if (!drawing || mode !== 'draw') return;
      const point = padPoint(event);
      padContext.lineTo(point.x, point.y);
      padContext.stroke();
      signatureInk = true;
    });
    pad.addEventListener('pointerup', () => {
      drawing = false;
      if (signatureInk) updateSelectionPreview();
    });
    pad.addEventListener('pointercancel', () => { drawing = false; });

    area.querySelectorAll('#sign-mode [data-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        mode = button.dataset.mode;
        area.querySelectorAll('#sign-mode [data-mode]').forEach((item) => item.classList.toggle('active', item === button));
        nameInput.hidden = mode !== 'type';
        pad.style.opacity = mode === 'type' ? '0.35' : '1';
        updateSelectionPreview();
      });
    });
    nameInput.addEventListener('input', updateSelectionPreview);
    area.querySelector('#sign-clear').addEventListener('click', () => {
      resetPad();
      nameInput.value = '';
      updateSelectionPreview();
    });

    const signatureData = () => (mode === 'draw' && signatureInk ? pad.toDataURL('image/png') : null);

    function updateSelectionPreview() {
      if (!placement) return;
      const name = nameInput.value.trim();
      const data = signatureData();
      if (mode === 'type' && name) {
        selectionEl.innerHTML = `<span class="typed-signature">${escapeHtml(name)}</span>`;
      } else if (data) {
        selectionEl.innerHTML = `<img src="${data}" alt="Assinatura">`;
      } else {
        selectionEl.innerHTML = '<span class="sign-placeholder">Arraste para posicionar</span>';
      }
    }

    const drawPlacement = () => {
      if (!placement || placement.page !== currentPage || !viewport) {
        selectionEl.hidden = true;
        return;
      }
      const [x1, y1] = viewport.convertToViewportPoint(placement.x, placement.y);
      const [x2, y2] = viewport.convertToViewportPoint(placement.x + placement.width, placement.y + placement.height);
      selectionEl.style.left = `${Math.min(x1, x2)}px`;
      selectionEl.style.top = `${Math.min(y1, y2)}px`;
      selectionEl.style.width = `${Math.abs(x2 - x1)}px`;
      selectionEl.style.height = `${Math.abs(y2 - y1)}px`;
      selectionEl.hidden = false;
      updateSelectionPreview();
    };

    const renderPage = async () => {
      pageLabel.textContent = String(currentPage);
      const page = await doc.getPage(currentPage);
      const maxWidth = Math.min(840, Math.max(320, area.clientWidth - 8));
      const maxHeight = Math.max(360, Math.min(700, window.innerHeight * 0.66));
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(maxWidth / base.width, maxHeight / base.height);
      viewport = page.getViewport({ scale });
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(viewport.width * dpr);
      canvas.height = Math.round(viewport.height * dpr);
      canvas.style.width = `${Math.round(viewport.width)}px`;
      canvas.style.height = `${Math.round(viewport.height)}px`;
      stage.style.width = `${Math.round(viewport.width)}px`;
      stage.style.height = `${Math.round(viewport.height)}px`;
      overlayEl.style.width = `${Math.round(viewport.width)}px`;
      overlayEl.style.height = `${Math.round(viewport.height)}px`;
      const context = canvas.getContext('2d', { alpha: false });
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, viewport.width, viewport.height);
      await page.render({ canvasContext: context, viewport }).promise;
      drawPlacement();
    };

    overlayEl.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      const rect = overlayEl.getBoundingClientRect();
      const x = clamp(event.clientX - rect.left, 0, viewport.width);
      const y = clamp(event.clientY - rect.top, 0, viewport.height);
      dragStart = { x, y };
      overlayEl.setPointerCapture(event.pointerId);
      selectionEl.hidden = false;
      updateSelectionPreview();
    });
    overlayEl.addEventListener('pointermove', (event) => {
      if (!dragStart) return;
      const rect = overlayEl.getBoundingClientRect();
      const x = clamp(event.clientX - rect.left, 0, viewport.width);
      const y = clamp(event.clientY - rect.top, 0, viewport.height);
      selectionEl.style.left = `${Math.min(x, dragStart.x)}px`;
      selectionEl.style.top = `${Math.min(y, dragStart.y)}px`;
      selectionEl.style.width = `${Math.abs(x - dragStart.x)}px`;
      selectionEl.style.height = `${Math.abs(y - dragStart.y)}px`;
    });
    overlayEl.addEventListener('pointerup', (event) => {
      if (!dragStart) return;
      const start = dragStart;
      dragStart = null;
      const rect = overlayEl.getBoundingClientRect();
      const endX = clamp(event.clientX - rect.left, 0, viewport.width);
      const endY = clamp(event.clientY - rect.top, 0, viewport.height);
      const width = Math.abs(endX - start.x);
      const height = Math.abs(endY - start.y);
      if (width < 12 || height < 8) {
        drawPlacement();
        return;
      }
      const left = Math.min(start.x, endX);
      const top = Math.min(start.y, endY);
      const [pdfX1, pdfY1] = viewport.convertToPdfPoint(left, top);
      const [pdfX2, pdfY2] = viewport.convertToPdfPoint(left + width, top + height);
      placement = {
        page: currentPage,
        x: Math.min(pdfX1, pdfX2),
        y: Math.min(pdfY1, pdfY2),
        width: Math.abs(pdfX2 - pdfX1),
        height: Math.abs(pdfY2 - pdfY1),
      };
      drawPlacement();
    });
    overlayEl.addEventListener('pointercancel', () => {
      dragStart = null;
      drawPlacement();
    });

    area.querySelector('#sign-prev').addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage -= 1;
        renderPage();
      }
    });
    area.querySelector('#sign-next').addEventListener('click', () => {
      if (currentPage < total) {
        currentPage += 1;
        renderPage();
      }
    });
    await renderPage();
    getOptions = () => {
      if (!placement) return null;
      return {
        page: placement.page,
        rect: { x: placement.x, y: placement.y, width: placement.width, height: placement.height },
        signature: signatureData(),
        name: nameInput.value.trim(),
        mode,
      };
    };
    validateOptions = () => {
      if (!placement) {
        toast('Arraste sobre a página para posicionar a assinatura.');
        return false;
      }
      if (mode === 'draw' && !signatureInk) {
        toast('Desenhe sua assinatura antes de continuar.');
        return false;
      }
      if (mode === 'type' && !nameInput.value.trim()) {
        toast('Digite seu nome para usar como assinatura.');
        return false;
      }
      return true;
    };
  },

  async watermark(area) {
    area.innerHTML = `
      <div class="watermark-grid">
        <div class="watermark-fields">
          ${field('Texto da marca d\'água', '<input type="text" id="wm-text" value="CONFIDENCIAL" maxlength="160">')}
          <div class="two-cols">
            ${field('Tamanho', numberField('wm-size', 48, 8, 200, 1, 'pt'))}
            ${field('Opacidade', '<input type="range" id="wm-opacity" min="0.03" max="1" step="0.01" value="0.25"><span class="range-value" id="wm-opacity-value">25%</span>')}
          </div>
          <div class="two-cols">
            ${field('Cor', '<input type="color" id="wm-color" value="#e5322d">')}
            ${field('Rotação', selectField('wm-rotation', [{ value: '45', label: 'Diagonal (45°)' }, { value: '0', label: 'Horizontal (0°)' }, { value: '-45', label: 'Diagonal inversa' }, { value: '90', label: 'Vertical (90°)' }], '45'))}
          </div>
          ${field('Posição', selectField('wm-position', [
            { value: 'center', label: 'Centro' },
            { value: 'top', label: 'Topo' },
            { value: 'bottom', label: 'Rodapé' },
            { value: 'top-left', label: 'Topo à esquerda' },
            { value: 'top-right', label: 'Topo à direita' },
            { value: 'bottom-left', label: 'Rodapé à esquerda' },
            { value: 'bottom-right', label: 'Rodapé à direita' },
            { value: 'tiled', label: 'Repetida (mosaico)' },
          ], 'center'))}
          ${field('Páginas (deixe vazio para todas)', '<input type="text" id="wm-pages" placeholder="todas">')}
        </div>
        <div class="watermark-preview" id="wm-preview">
          <span id="wm-preview-text">CONFIDENCIAL</span>
        </div>
      </div>`;
    const text = area.querySelector('#wm-text');
    const size = area.querySelector('#wm-size');
    const opacity = area.querySelector('#wm-opacity');
    const color = area.querySelector('#wm-color');
    const rotation = area.querySelector('#wm-rotation');
    const position = area.querySelector('#wm-position');
    const preview = area.querySelector('#wm-preview');
    const previewText = area.querySelector('#wm-preview-text');
    const opacityValue = area.querySelector('#wm-opacity-value');
    const refresh = () => {
      previewText.textContent = text.value || 'CONFIDENCIAL';
      previewText.style.color = color.value;
      previewText.style.opacity = opacity.value;
      previewText.style.fontWeight = '800';
      previewText.style.fontSize = `${clamp(Number(size.value) / 2.2, 14, 56)}px`;
      previewText.style.transform = `rotate(${rotation.value}deg)`;
      opacityValue.textContent = `${Math.round(Number(opacity.value) * 100)}%`;
      preview.className = `watermark-preview pos-${position.value === 'tiled' ? 'center' : position.value}`;
    };
    [text, size, opacity, color, rotation, position].forEach((input) => {
      input.addEventListener('input', refresh);
      input.addEventListener('change', refresh);
    });
    refresh();
    getOptions = () => ({
      text: text.value || 'CONFIDENCIAL',
      size: Number(size.value),
      opacity: Number(opacity.value),
      color: color.value,
      rotation: Number(rotation.value),
      position: position.value,
      pages: area.querySelector('#wm-pages').value.trim(),
    });
  },

  async pagenumbers(area) {
    area.innerHTML = `
      <div class="two-cols">
        ${field('Posição', selectField('pn-position', [
          { value: 'bottom-center', label: 'Rodapé centralizado' },
          { value: 'bottom-right', label: 'Rodapé à direita' },
          { value: 'bottom-left', label: 'Rodapé à esquerda' },
          { value: 'top-center', label: 'Topo centralizado' },
          { value: 'top-right', label: 'Topo à direita' },
          { value: 'top-left', label: 'Topo à esquerda' },
        ], 'bottom-center'))}
        ${field('Formato', selectField('pn-format', [
          { value: 'n', label: '1' },
          { value: 'n_de_total', label: '1 de 10' },
          { value: 'page_n', label: 'Página 1' },
          { value: 'page_n_de_total', label: 'Página 1 de 10' },
        ], 'n'))}
      </div>
      <div class="three-cols">
        ${field('Primeiro número', numberField('pn-start', 1, 0, 9999, 1))}
        ${field('Tamanho da fonte', numberField('pn-size', 12, 6, 48, 1, 'pt'))}
        ${field('Cor', '<input type="color" id="pn-color" value="#333333">')}
      </div>
      ${field('Páginas (deixe vazio para todas)', '<input type="text" id="pn-pages" placeholder="todas">')}`;
    getOptions = () => ({
      position: area.querySelector('#pn-position').value,
      format: area.querySelector('#pn-format').value,
      start: Number(area.querySelector('#pn-start').value),
      size: Number(area.querySelector('#pn-size').value),
      color: area.querySelector('#pn-color').value,
      pages: area.querySelector('#pn-pages').value.trim(),
    });
  },

  async compress(area) {
    area.innerHTML = `
      <div class="mode-grid three">
        <label class="mode-card"><input type="radio" name="compress-level" value="low"><span><strong>Menos compressão</strong><small>Qualidade máxima, arquivo maior.</small></span></label>
        <label class="mode-card"><input type="radio" name="compress-level" value="recommended" checked><span><strong>Recomendado</strong><small>Bom equilíbrio entre tamanho e qualidade.</small></span></label>
        <label class="mode-card"><input type="radio" name="compress-level" value="extreme"><span><strong>Compressão extrema</strong><small>Menor arquivo possível.</small></span></label>
      </div>
      ${checkbox('compress-gray', 'Converter páginas para escala de cinza', false)}`;
    getOptions = () => ({
      level: area.querySelector('input[name=compress-level]:checked').value,
      grayscale: area.querySelector('#compress-gray').checked,
    });
  },

  async pdf2jpg(area) {
    area.innerHTML = `
      <div class="three-cols">
        ${field('Resolução', selectField('jpg-dpi', [{ value: '72', label: '72 DPI (tela)' }, { value: '150', label: '150 DPI (recomendado)' }, { value: '300', label: '300 DPI (impressão)' }, { value: '400', label: '400 DPI (alta)' }], '150'))}
        ${field('Qualidade', '<input type="range" id="jpg-quality" min="30" max="100" step="1" value="90"><span class="range-value" id="jpg-quality-value">90</span>')}
        ${field('Páginas', '<input type="text" id="jpg-pages" placeholder="todas">')}
      </div>
      <p class="hint">Uma página gera um JPG. Várias páginas são entregues em um arquivo ZIP.</p>`;
    const quality = area.querySelector('#jpg-quality');
    quality.addEventListener('input', () => {
      area.querySelector('#jpg-quality-value').textContent = quality.value;
    });
    getOptions = () => ({
      dpi: Number(area.querySelector('#jpg-dpi').value),
      quality: Number(quality.value),
      pages: area.querySelector('#jpg-pages').value.trim(),
    });
  },

  async img2pdf(area) {
    area.innerHTML = `
      <div class="three-cols">
        ${field('Tamanho da página', selectField('img-size', [{ value: 'auto', label: 'Automático (tamanho da imagem)' }, { value: 'a4', label: 'A4' }, { value: 'letter', label: 'Carta' }], 'auto'))}
        ${field('Orientação', selectField('img-orientation', [{ value: 'auto', label: 'Automática' }, { value: 'portrait', label: 'Retrato' }, { value: 'landscape', label: 'Paisagem' }], 'auto'))}
        ${field('Margem', numberField('img-margin', 0, 0, 50, 1, 'mm'))}
      </div>
      <p class="hint">As imagens são adicionadas na ordem exibida acima. Use as setas para reordenar.</p>`;
    getOptions = () => ({
      size: area.querySelector('#img-size').value,
      orientation: area.querySelector('#img-orientation').value,
      margin: Number(area.querySelector('#img-margin').value),
    });
  },

  async ocr(area) {
    area.innerHTML = `
      <div class="two-cols">
        ${field('Idioma do documento', selectField('ocr-lang', [
          { value: 'por', label: 'Português' },
          { value: 'eng', label: 'Inglês' },
          { value: 'por+eng', label: 'Português + Inglês' },
        ], 'por'))}
        ${field('Páginas', '<input type="text" id="ocr-pages" placeholder="todas">')}
      </div>
      <p class="hint">O OCR reconhece texto em PDFs digitalizados e cria uma camada pesquisável mantendo a aparência original. Pode levar alguns minutos.</p>`;
    getOptions = () => ({
      lang: area.querySelector('#ocr-lang').value,
      pages: area.querySelector('#ocr-pages').value.trim(),
    });
  },

  async protect(area) {
    area.innerHTML = `
      <div class="two-cols">
        ${field('Senha para abrir o PDF', '<div class="password-wrap"><input type="password" id="protect-password" autocomplete="new-password" placeholder="mínimo 4 caracteres"><button type="button" class="show-pass" data-target="protect-password">mostrar</button></div>')}
        ${field('Confirmar senha', '<input type="password" id="protect-confirm" autocomplete="new-password" placeholder="repita a senha">')}
      </div>
      <fieldset class="perm-fieldset">
        <legend>Permissões</legend>
        ${checkbox('allow-print', 'Permitir impressão', true)}
        ${checkbox('allow-copy', 'Permitir copiar texto e imagens', false)}
        ${checkbox('allow-modify', 'Permitir edição do conteúdo', false)}
        ${checkbox('allow-annotate', 'Permitir comentários e preenchimento de formulários', false)}
      </fieldset>
      <p class="hint">A senha de abertura é necessária para visualizar o arquivo. Guarde-a com segurança: não é possível recuperá-la.</p>`;
    area.querySelectorAll('.show-pass').forEach((button) => {
      button.addEventListener('click', () => {
        const input = area.querySelector(`#${button.dataset.target}`);
        input.type = input.type === 'password' ? 'text' : 'password';
        button.textContent = input.type === 'password' ? 'mostrar' : 'ocultar';
      });
    });
    getOptions = () => ({
      password: area.querySelector('#protect-password').value,
      allowPrinting: area.querySelector('#allow-print').checked,
      allowCopying: area.querySelector('#allow-copy').checked,
      allowModifying: area.querySelector('#allow-modify').checked,
      allowAnnotations: area.querySelector('#allow-annotate').checked,
    });
    validateOptions = () => {
      const password = area.querySelector('#protect-password').value;
      const confirm = area.querySelector('#protect-confirm').value;
      if (password.length < 4) {
        toast('A senha deve ter pelo menos 4 caracteres.');
        return false;
      }
      if (password !== confirm) {
        toast('As senhas não coincidem.');
        return false;
      }
      return true;
    };
  },

  async unlock(area) {
    area.innerHTML = `
      ${field('Senha atual do PDF', '<div class="password-wrap"><input type="password" id="unlock-password" autocomplete="current-password" placeholder="deixe vazio se não pedir senha ao abrir"><button type="button" class="show-pass" id="unlock-show">mostrar</button></div>')}
      <p class="hint">Use somente em documentos que você tem autorização para acessar. O PDF resultante perde a criptografia.</p>`;
    const input = area.querySelector('#unlock-password');
    area.querySelector('#unlock-show').addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
      area.querySelector('#unlock-show').textContent = input.type === 'password' ? 'mostrar' : 'ocultar';
    });
    getOptions = () => ({ password: input.value });
  },

  async compare(area) {
    area.innerHTML = `
      ${field('Resolução da comparação', selectField('compare-dpi', [
        { value: '72', label: 'Rápida (72 DPI)' },
        { value: '96', label: 'Padrão (96 DPI)' },
        { value: '120', label: 'Detalhada (120 DPI)' },
        { value: '150', label: 'Máxima (150 DPI)' },
      ], '96'))}
      <p class="hint">As páginas são comparadas visualmente. O ZIP inclui um resumo e as imagens de diferença.</p>`;
    getOptions = () => ({ dpi: Number(area.querySelector('#compare-dpi').value) });
  },

  async repair(area) {
    area.innerHTML = infoBox('O PDF será reconstruído com o Ghostscript e, se necessário, com o QPDF para recuperar o máximo de conteúdo possível.');
  },
  async pdfa(area) {
    area.innerHTML = infoBox('O arquivo será convertido para o perfil PDF/A-2b usando Ghostscript. Ideal para arquivamento de longo prazo.');
  },
  async pdf2word(area) {
    area.innerHTML = infoBox('O texto do PDF será extraído e organizado em um documento .docx editável. PDFs digitalizados precisam de OCR antes.');
  },
  async pdf2excel(area) {
    area.innerHTML = infoBox('As linhas de texto serão distribuídas em colunas no Excel. PDFs com tabelas muito complexas podem precisar de ajustes manuais.');
  },
  async pdf2ppt(area) {
    area.innerHTML = infoBox('Cada página será transformada em um slide de PowerPoint com a página renderizada em alta qualidade.');
  },
  async office2pdf(area) {
    area.innerHTML = infoBox('A conversão usa o LibreOffice instalado no servidor local, preservando o layout do documento original.');
  },
};

async function processFile() {
  if (!isReady()) return;
  let options;
  try {
    if (!validateOptions()) return;
    options = getOptions();
  } catch (error) {
    toast(error.message);
    return;
  }
  if (options === null) return;
  const payloadFiles = tool.twoFiles
    ? compareFiles.map((file) => file.id)
    : files.map((file) => file.id);
  showProgress();
  try {
    const response = await fetch(`/api/process/${tool.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: payloadFiles, options }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Falha ao processar o arquivo.');
    finishProgress();
    showResult(data);
  } catch (error) {
    hideProgress();
    toast(error.message);
  }
}

function showProgress() {
  overlay.hidden = false;
  overlayTitle.textContent = tool.action.replace('PDF', 'arquivo') + '…';
  overlayDetail.textContent = 'Isso pode levar alguns segundos. O arquivo está sendo processado no seu computador.';
  progressBar.style.width = '4%';
  let value = 4;
  clearInterval(progressTimer);
  progressTimer = setInterval(() => {
    value = Math.min(90, value + Math.max(1, (90 - value) * 0.06));
    progressBar.style.width = `${value}%`;
  }, 500);
}

function finishProgress() {
  clearInterval(progressTimer);
  progressBar.style.width = '100%';
  setTimeout(() => {
    overlay.hidden = true;
  }, 350);
}

function hideProgress() {
  clearInterval(progressTimer);
  overlay.hidden = true;
}

function resultMeta(data) {
  const parts = [`Tamanho: ${formatBytes(data.size)}`];
  if (data.meta?.savedPercent !== undefined) {
    parts.push(`Redução: ${data.meta.savedPercent}%`);
    if (data.meta.originalSize) parts.push(`Antes: ${formatBytes(data.meta.originalSize)}`);
  }
  if (data.meta?.changedPages) {
    parts.push(data.meta.changedPages.length
      ? `Páginas diferentes: ${data.meta.changedPages.join(', ')}`
      : 'Nenhuma diferença visual encontrada');
    parts.push(`Comparadas: ${data.meta.compared} página(s)`);
  }
  if (data.meta?.pages) parts.push(`${data.meta.pages} página(s)`);
  if (data.meta?.slides) parts.push(`${data.meta.slides} slide(s)`);
  return parts.map((part) => `<span>${escapeHtml(part)}</span>`).join('');
}

function showResult(data) {
  resultShowing = true;
  document.getElementById('step-files').hidden = true;
  document.getElementById('step-options').hidden = true;
  const panel = document.getElementById('result-panel');
  panel.hidden = false;
  const changed = data.meta?.changedPages;
  panel.innerHTML = `
    <div class="result-success">
      <div class="result-check">✓</div>
      <h2>${changed && !changed.length ? 'Documentos idênticos' : 'Seu arquivo está pronto!'}</h2>
      <p class="result-name">${escapeHtml(data.filename)}</p>
      <div class="result-meta">${resultMeta(data)}</div>
      <a class="primary-btn" href="${data.download}" download="${escapeHtml(data.filename)}">Baixar arquivo</a>
      <button type="button" class="ghost-btn" id="process-again">Processar outro arquivo</button>
      <p class="hint">O arquivo fica disponível por algumas horas e depois é apagado automaticamente.</p>
    </div>`;
  panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.getElementById('process-again').addEventListener('click', () => location.reload());
}

init();
