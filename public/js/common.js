export async function loadCatalog() {
  const response = await fetch('/api/tools');
  if (!response.ok) throw new Error('Não foi possível carregar o catálogo.');
  return response.json();
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function toast(message, type = 'error') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.className = `toast show ${type}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    el.className = 'toast';
  }, 5200);
}

export function iconSvg(kind, color, size = 56) {
  const c = color || '#e5322d';
  const doc = (extra) => `<rect x="13" y="7" width="38" height="50" rx="5" fill="#fff" stroke="#e3e7ec" stroke-width="2"/>${extra}`;
  let body = '';
  switch (kind) {
    case 'merge':
      body = `<rect x="7" y="10" width="23" height="30" rx="5" fill="${c}" opacity=".92"/><rect x="34" y="24" width="23" height="30" rx="5" fill="${c}" opacity=".55"/><path d="M18 36h28" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/><path d="m40 30 7 6-7 6" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`;
      break;
    case 'split':
      body = `<rect x="7" y="10" width="22" height="28" rx="5" fill="${c}"/><rect x="35" y="26" width="22" height="28" rx="5" fill="${c}" opacity=".55"/><path d="M22 34h20" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/><path d="m16 28-7 6 7 6" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><path d="m48 22 7 6-7 6" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M42 34h13" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/>`;
      break;
    case 'compress':
      body = `<rect x="10" y="12" width="20" height="20" rx="5" fill="${c}" opacity=".9"/><rect x="34" y="34" width="20" height="20" rx="5" fill="${c}" opacity=".55"/><path d="m25 25 14 14M39 28v11H28M25 39V28h11" fill="none" stroke="${c}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`;
      break;
    case 'word':
    case 'word2pdf':
      body = `${doc(`<text x="32" y="45" font-family="Arial, sans-serif" font-size="25" font-weight="700" fill="#2b579a" text-anchor="middle">W</text>`)}<rect x="34" y="34" width="25" height="23" rx="4" fill="${c}"/><text x="46.5" y="50.5" font-family="Arial, sans-serif" font-size="10" font-weight="700" fill="#fff" text-anchor="middle">PDF</text>`;
      break;
    case 'excel':
    case 'excel2pdf':
      body = `${doc(`<text x="32" y="45" font-family="Arial, sans-serif" font-size="25" font-weight="700" fill="#217346" text-anchor="middle">X</text>`)}<rect x="34" y="34" width="25" height="23" rx="4" fill="${c}"/><text x="46.5" y="50.5" font-family="Arial, sans-serif" font-size="10" font-weight="700" fill="#fff" text-anchor="middle">PDF</text>`;
      break;
    case 'ppt':
    case 'ppt2pdf':
      body = `${doc(`<text x="32" y="45" font-family="Arial, sans-serif" font-size="25" font-weight="700" fill="#d04423" text-anchor="middle">P</text>`)}<rect x="34" y="34" width="25" height="23" rx="4" fill="${c}"/><text x="46.5" y="50.5" font-family="Arial, sans-serif" font-size="10" font-weight="700" fill="#fff" text-anchor="middle">PDF</text>`;
      break;
    case 'jpg':
      body = `<rect x="10" y="12" width="44" height="38" rx="6" fill="${c}" opacity=".92"/><circle cx="23" cy="25" r="5" fill="#fff" opacity=".85"/><path d="m14 45 12-13 9 8 7-6 9 11" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><text x="32" y="59" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="${c}" text-anchor="middle">JPG</text>`;
      break;
    case 'img2pdf':
      body = `<rect x="7" y="14" width="34" height="30" rx="5" fill="${c}" opacity=".8"/><path d="m12 39 9-10 7 6 5-4 6 8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><circle cx="18" cy="23" r="4" fill="#fff" opacity=".9"/><rect x="34" y="28" width="23" height="27" rx="4" fill="#e5322d"/><text x="45.5" y="45" font-family="Arial, sans-serif" font-size="10" font-weight="700" fill="#fff" text-anchor="middle">PDF</text>`;
      break;
    case 'rotate':
      body = `<path d="M46 20a22 22 0 1 0 6 21" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round"/><path d="m40 12 12 10-14 5z" fill="${c}"/>`;
      break;
    case 'organize':
      body = `<rect x="8" y="10" width="20" height="20" rx="4" fill="${c}"/><rect x="36" y="10" width="20" height="20" rx="4" fill="${c}" opacity=".4"/><rect x="8" y="36" width="20" height="20" rx="4" fill="${c}" opacity=".4"/><rect x="36" y="36" width="20" height="20" rx="4" fill="${c}"/>`;
      break;
    case 'crop':
      body = `<path d="M18 8v38h38M8 18h38v38" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"/><rect x="24" y="24" width="26" height="26" rx="3" fill="${c}" opacity=".18" stroke="${c}" stroke-width="2" stroke-dasharray="5 4"/>`;
      break;
    case 'numbers':
      body = `${doc(`<text x="32" y="40" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="${c}" text-anchor="middle">1 2 3</text><path d="M20 48h24" stroke="${c}" stroke-width="2" stroke-linecap="round"/>`)}`;
      break;
    case 'watermark':
      body = `<path d="M32 8c10 15 18 24 18 33a18 18 0 1 1-36 0c0-9 8-18 18-33z" fill="${c}" opacity=".2" stroke="${c}" stroke-width="2.5"/><text x="32" y="44" font-family="Arial, sans-serif" font-size="10" font-weight="700" fill="${c}" text-anchor="middle" transform="rotate(-35 32 40)">ÁGUA</text>`;
      break;
    case 'remove':
      body = `${doc(`<path d="M23 26h18M23 33h18M23 40h11" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`)}<circle cx="45" cy="44" r="13" fill="#fff" stroke="${c}" stroke-width="2"/><path d="M39 38l12 12M51 38 39 50" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`;
      break;
    case 'repair':
      body = `${doc(`<path d="M23 28h14M23 35h18" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`)}<path d="M44 32a12 12 0 0 1 11 16l8 8-6 6-8-8a12 12 0 0 1-16-11z" fill="${c}" opacity=".92"/><circle cx="48" cy="42" r="4" fill="#fff"/>`;
      break;
    case 'protect':
      body = `<rect x="16" y="26" width="32" height="30" rx="6" fill="${c}"/><path d="M23 26v-7a9 9 0 0 1 18 0v7" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"/><circle cx="32" cy="39" r="4" fill="#fff"/><path d="M32 42v7" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`;
      break;
    case 'unlock':
      body = `<rect x="16" y="26" width="32" height="30" rx="6" fill="${c}"/><path d="M23 26v-7a9 9 0 0 1 17-4" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"/><circle cx="32" cy="39" r="4" fill="#fff"/><path d="M32 42v7" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`;
      break;
    case 'sign':
      body = `${doc(`<path d="M20 42c8-14 12 4 18-8s7 8 10 2" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`)}<path d="m40 32 10-10 5 5-10 10-7 2z" fill="${c}"/><path d="m50 22 4-4a3 3 0 0 1 4 4l-3 5z" fill="${c}" opacity=".6"/>`;
      break;
    case 'compare':
      body = `<rect x="7" y="12" width="20" height="40" rx="4" fill="${c}" opacity=".45"/><rect x="37" y="12" width="20" height="40" rx="4" fill="${c}"/><path d="M29 30h8M33 26l4 4-4 4" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
      break;
    case 'pdfa':
      body = `${doc(`<text x="32" y="36" font-family="Arial, sans-serif" font-size="12" font-weight="700" fill="${c}" text-anchor="middle">PDF</text><path d="M20 43h24" stroke="${c}" stroke-width="2" stroke-linecap="round"/><text x="32" y="52" font-family="Arial, sans-serif" font-size="9" font-weight="700" fill="${c}" text-anchor="middle">A-2b</text>`)}<path d="M46 22l6 4-6 4" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
      break;
    case 'ocr':
      body = `${doc(`<path d="M20 19h24M20 25h19M20 31h24M20 37h14" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/>`)}<path d="M9 18V9h9M46 9h9v9M55 46v9h-9M18 55H9v-9" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`;
      break;
    default:
      body = `${doc('')}`;
  }
  return `<svg class="tool-icon-svg" viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-hidden="true">${body}</svg>`;
}

export function setupHeaderMenus(tools) {
  const convertIds = [
    'pdf_para_word', 'pdf_para_powerpoint', 'pdf_para_excel',
    'word_para_pdf', 'powerpoint_para_pdf', 'excel_para_pdf',
    'pdf_para_jpg', 'jpg_para_pdf', 'ocr-pdf',
  ];
  const convert = convertIds.map((slug) => tools.find((tool) => tool.slug === slug)).filter(Boolean);
  const convertMenu = document.getElementById('convert-menu');
  if (convertMenu) {
    convertMenu.innerHTML = convert.map((tool) => `
      <a href="/ferramenta/${tool.slug}" class="menu-link">
        <span class="menu-dot" style="background:${tool.icon.color}"></span>
        <span>${escapeHtml(tool.title)}</span>
      </a>`).join('');
  }
  const allMenu = document.getElementById('all-menu');
  if (allMenu) {
    allMenu.innerHTML = tools.map((tool) => `
      <a href="/ferramenta/${tool.slug}" class="menu-link">
        <span class="menu-dot" style="background:${tool.icon.color}"></span>
        <span>${escapeHtml(tool.title)}</span>
      </a>`).join('');
  }
  const toggle = (button, panel) => {
    if (!button || !panel) return;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const wasOpen = panel.classList.contains('open');
      document.querySelectorAll('.dropdown-panel.open').forEach((item) => item.classList.remove('open'));
      if (!wasOpen) panel.classList.add('open');
    });
  };
  toggle(document.getElementById('convert-toggle'), convertMenu);
  toggle(document.getElementById('all-toggle'), allMenu);
  document.addEventListener('click', () => {
    document.querySelectorAll('.dropdown-panel.open').forEach((item) => item.classList.remove('open'));
  });
  const menuToggle = document.getElementById('menu-toggle');
  const nav = document.querySelector('.main-nav');
  if (menuToggle && nav) {
    menuToggle.addEventListener('click', () => nav.classList.toggle('open'));
  }
}
