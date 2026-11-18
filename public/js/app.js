import { loadCatalog, setupHeaderMenus, iconSvg, escapeHtml } from './common.js';

const grid = document.getElementById('tool-grid');
const chips = document.getElementById('category-chips');
const search = document.getElementById('tool-search');
const empty = document.getElementById('empty-state');

let catalog = null;
let activeCategory = 'all';
let query = '';

function card(tool) {
  return `
    <a class="tool-card" href="/ferramenta/${tool.slug}" data-category="${tool.category}" data-search="${escapeHtml(`${tool.title} ${tool.desc}`.toLowerCase())}">
      <div class="tool-icon">${iconSvg(tool.icon.kind, tool.icon.color)}</div>
      <h3>${escapeHtml(tool.title)}</h3>
      <p>${escapeHtml(tool.desc)}</p>
      <span class="tool-arrow">→</span>
    </a>`;
}

function render() {
  const normalized = query.trim().toLowerCase();
  const visible = catalog.tools.filter((tool) => {
    const categoryOk = activeCategory === 'all' || tool.category === activeCategory;
    const searchOk = !normalized || `${tool.title} ${tool.desc} ${tool.long}`.toLowerCase().includes(normalized);
    return categoryOk && searchOk;
  });
  grid.innerHTML = visible.map(card).join('');
  empty.hidden = visible.length > 0;
}

function renderChips() {
  const items = [{ id: 'all', name: 'Todas' }, ...catalog.categories];
  chips.innerHTML = items.map((item) => `
    <button type="button" class="chip ${item.id === activeCategory ? 'active' : ''}" data-category="${item.id}">
      ${escapeHtml(item.name)}
    </button>`).join('');
  chips.querySelectorAll('.chip').forEach((button) => {
    button.addEventListener('click', () => {
      activeCategory = button.dataset.category;
      chips.querySelectorAll('.chip').forEach((item) => item.classList.toggle('active', item === button));
      render();
    });
  });
}

async function init() {
  try {
    catalog = await loadCatalog();
    setupHeaderMenus(catalog.tools);
    renderChips();
    render();
    search.addEventListener('input', () => {
      query = search.value;
      render();
    });
  } catch (error) {
    grid.innerHTML = `<p class="empty-state">Não foi possível carregar o catálogo. Verifique se o servidor está rodando.</p>`;
    console.error(error);
  }
}

init();
