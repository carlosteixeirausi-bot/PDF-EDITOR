import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TOOLS, TOOL_MAP, CATEGORIES } from './lib/tools.js';
import { PROCESSORS } from './lib/processors.js';
import { friendlyError, pdfPageCount, run } from './lib/pdfutil.js';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, 'data');
const UPLOADS = path.join(DATA, 'uploads');
const OUTPUTS = path.join(DATA, 'output');
const TEMP = path.join(DATA, 'tmp');

for (const dir of [UPLOADS, OUTPUTS, TEMP]) {
  fs.mkdirSync(dir, { recursive: true });
}

const PORT = Number(process.env.PORT || process.argv.find((arg) => /^\d+$/.test(arg)) || 3000);
const MAX_FILE_MB = 150;
const MAX_FILES = 20;
const RETENTION_MS = 12 * 60 * 60 * 1000;

const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.bmp', '.gif', '.avif', '.heic',
  '.doc', '.docx', '.odt', '.rtf', '.txt',
  '.xls', '.xlsx', '.ods', '.csv',
  '.ppt', '.pptx', '.odp',
]);

const fileRecords = new Map();
const outputRecords = new Map();

function fixOriginalName(name) {
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    return decoded.includes('\uFFFD') ? name : decoded;
  } catch {
    return name;
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, UPLOADS),
  filename: (_req, file, callback) => {
    const ext = path.extname(file.originalname).toLowerCase();
    callback(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: MAX_FILES },
  fileFilter: (_req, file, callback) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      const error = new Error(`Tipo de arquivo não suportado: ${ext || 'desconhecido'}`);
      error.status = 400;
      callback(error);
      return;
    }
    callback(null, true);
  },
});

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, _res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  }
  next();
});

app.get('/api/tools', (_req, res) => {
  res.json({
    tools: TOOLS,
    categories: CATEGORIES,
    limits: { maxFileMb: MAX_FILE_MB, maxFiles: MAX_FILES },
  });
});

app.get('/api/health', async (_req, res) => {
  const commands = ['qpdf', 'gs', 'pdftoppm', 'pdftotext', 'pdfunite', 'tesseract', 'soffice'];
  const checks = {};
  await Promise.all(commands.map(async (command) => {
    try {
      await run('which', [command]);
      checks[command] = true;
    } catch {
      checks[command] = false;
    }
  }));
  res.json({ ok: true, commands: checks, version: '1.0.0' });
});

app.post('/api/upload', upload.array('files', MAX_FILES), async (req, res, next) => {
  try {
    const files = [];
    for (const file of req.files || []) {
      const id = path.basename(file.filename, path.extname(file.filename));
      const name = fixOriginalName(file.originalname);
      const ext = path.extname(file.filename).toLowerCase();
      const record = {
        id,
        name,
        path: file.path,
        size: file.size,
        ext,
        mime: file.mimetype,
        pages: null,
        createdAt: Date.now(),
        kind: ext === '.pdf' ? 'pdf' : 'image',
      };
      if (ext === '.pdf') {
        try {
          record.pages = await pdfPageCount(file.path);
        } catch {
          record.pages = null;
        }
      } else if (file.mimetype.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.bmp', '.gif', '.avif', '.heic'].includes(ext)) {
        try {
          const meta = await sharp(file.path).metadata();
          record.width = meta.width;
          record.height = meta.height;
          if (meta.pages) record.pages = meta.pages;
        } catch {
          /* metadados opcionais */
        }
      } else {
        record.kind = 'office';
      }
      fileRecords.set(id, record);
      files.push({
        id,
        name,
        size: record.size,
        pages: record.pages,
        width: record.width,
        height: record.height,
        kind: record.kind,
        mime: record.mime,
      });
    }
    if (!files.length) {
      res.status(400).json({ error: 'Nenhum arquivo recebido.' });
      return;
    }
    res.json({ files });
  } catch (error) {
    next(error);
  }
});

app.get('/api/file/:id', async (req, res) => {
  const record = fileRecords.get(req.params.id);
  if (!record) {
    res.status(404).json({ error: 'Arquivo não encontrado ou expirado.' });
    return;
  }
  res.setHeader('Content-Type', record.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(record.name)}"`);
  res.setHeader('Cache-Control', 'private, max-age=600');
  res.sendFile(record.path);
});

app.post('/api/process/:slug', async (req, res, next) => {
  try {
    const tool = TOOL_MAP.get(req.params.slug);
    if (!tool) {
      res.status(404).json({ error: 'Ferramenta não encontrada.' });
      return;
    }
    const processor = PROCESSORS[tool.endpoint];
    if (!processor) {
      res.status(500).json({ error: 'Ferramenta indisponível no servidor.' });
      return;
    }
    const requested = Array.isArray(req.body?.files) ? req.body.files : [];
    const records = [];
    for (const entry of requested) {
      const id = typeof entry === 'string' ? entry : entry?.id;
      const record = fileRecords.get(id);
      if (record) records.push(record);
    }
    const minimum = tool.twoFiles ? 2 : (tool.minFiles || 1);
    if (records.length < minimum) {
      res.status(400).json({ error: minimum > 1 ? `Envie pelo menos ${minimum} arquivos.` : 'Envie um arquivo para continuar.' });
      return;
    }
    if (!tool.multiple && !tool.twoFiles && records.length > 1) records.length = 1;
    if (tool.twoFiles && records.length > 2) records.length = 2;
    if (tool.multiple && records.length > MAX_FILES) records.length = MAX_FILES;

    const jobId = crypto.randomUUID();
    const workDir = path.join(TEMP, jobId);
    const outDir = path.join(OUTPUTS, jobId);
    await fsp.mkdir(workDir, { recursive: true });
    await fsp.mkdir(outDir, { recursive: true });

    const options = (req.body && typeof req.body.options === 'object' && req.body.options) || {};
    const started = Date.now();
    const result = await processor({
      inputFiles: records,
      options,
      workDir,
      outDir,
    });
    const token = crypto.randomBytes(24).toString('base64url');
    outputRecords.set(token, {
      path: result.path,
      filename: result.filename,
      mime: result.mime || 'application/octet-stream',
      meta: result.meta || null,
      createdAt: Date.now(),
    });
    const stat = await fsp.stat(result.path);
    res.json({
      ok: true,
      download: `/api/download/${token}`,
      filename: result.filename,
      mime: result.mime || 'application/octet-stream',
      size: stat.size,
      meta: result.meta || null,
      elapsedMs: Date.now() - started,
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/download/:token', (req, res) => {
  const record = outputRecords.get(req.params.token);
  if (!record) {
    res.status(404).json({ error: 'Resultado não encontrado ou expirado. Processe o arquivo novamente.' });
    return;
  }
  res.setHeader('Content-Type', record.mime);
  res.download(record.path, record.filename, (error) => {
    if (error && !res.headersSent) res.status(500).end();
  });
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/ferramenta/:slug', (req, res) => {
  if (!TOOL_MAP.has(req.params.slug)) {
    res.redirect('/');
    return;
  }
  res.sendFile(path.join(__dirname, 'public', 'tool.html'));
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: 'Rota não encontrada.' });
    return;
  }
  res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((error, _req, res, _next) => {
  if (error?.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({ error: `O arquivo excede o limite de ${MAX_FILE_MB} MB.` });
    return;
  }
  if (error?.code === 'LIMIT_FILE_COUNT') {
    res.status(400).json({ error: `Envie no máximo ${MAX_FILES} arquivos por vez.` });
    return;
  }
  console.error(error?.stack || error);
  const status = Number(error?.status) || 500;
  res.status(status).json({ error: friendlyError(error) });
});

async function cleanup() {
  const now = Date.now();
  for (const [id, record] of fileRecords) {
    if (now - record.createdAt > RETENTION_MS) {
      fileRecords.delete(id);
      fsp.rm(record.path, { force: true }).catch(() => {});
    }
  }
  for (const [token, record] of outputRecords) {
    if (now - record.createdAt > RETENTION_MS) {
      outputRecords.delete(token);
    }
  }
  try {
    const dirs = await fsp.readdir(TEMP);
    for (const dir of dirs) {
      const full = path.join(TEMP, dir);
      const stat = await fsp.stat(full).catch(() => null);
      if (stat && now - stat.mtimeMs > RETENTION_MS) {
        await fsp.rm(full, { recursive: true, force: true });
      }
    }
    const outs = await fsp.readdir(OUTPUTS);
    for (const dir of outs) {
      const full = path.join(OUTPUTS, dir);
      const stat = await fsp.stat(full).catch(() => null);
      if (stat && now - stat.mtimeMs > RETENTION_MS) {
        await fsp.rm(full, { recursive: true, force: true });
      }
    }
  } catch {
    /* limpeza opcional */
  }
}

setInterval(cleanup, 60 * 60 * 1000).unref();

const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, async () => {
  console.log('');
  console.log('  PDF-Editor');
  console.log(`  http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  Arquivos temporários: ${DATA}`);
  const required = ['qpdf', 'gs', 'pdftoppm', 'pdftotext', 'tesseract', 'soffice'];
  const missing = [];
  await Promise.all(required.map(async (command) => {
    try {
      await run('which', [command]);
    } catch {
      missing.push(command);
    }
  }));
  if (missing.length) {
    console.log(`  Aviso: dependências ausentes: ${missing.join(', ')}`);
    console.log('  Instale-as para habilitar todas as ferramentas.');
  } else {
    console.log('  Dependências do sistema: OK');
  }
  console.log('');
});
