import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { ZipArchive } from 'archiver';
import { PDFDocument, degrees, rgb } from 'pdf-lib';

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        timeout: options.timeout ?? 180000,
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, ...(options.env || {}) },
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          error.command = `${command} ${args.join(' ')}`;
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

export async function exists(file) {
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}

export function cleanName(name) {
  return String(name || 'arquivo')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140) || 'arquivo';
}

export function baseName(file) {
  return cleanName(path.basename(file).replace(/\.[^.]+$/, ''));
}

export function extension(file) {
  return (path.extname(file) || '').toLowerCase();
}

export function isPdf(file) {
  return extension(file) === '.pdf';
}

export function isEncryptedQpdf(output) {
  return !/File is not encrypted/i.test(output) && /R\s*=\s*\d/i.test(output);
}

export async function decryptIfNeeded(source, workDir, password = '') {
  let info = '';
  try {
    const result = await run('qpdf', ['--show-encryption', source]);
    info = result.stdout;
  } catch (error) {
    info = `${error.stdout || ''}${error.stderr || ''}`;
  }
  if (!isEncryptedQpdf(info)) return source;
  const target = path.join(workDir, `decrypted-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`);
  const args = [];
  if (password) args.push(`--password=${password}`);
  args.push('--decrypt', source, target);
  try {
    await run('qpdf', args);
  } catch {
    const friendly = new Error('Este PDF está protegido por senha. Use a ferramenta Desbloquear PDF primeiro.');
    friendly.status = 400;
    throw friendly;
  }
  return target;
}

export async function loadPdf(source, workDir, password = '') {
  const file = await decryptIfNeeded(source, workDir, password);
  const bytes = await fsp.readFile(file);
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  } catch {
    const friendly = new Error('Não foi possível abrir este PDF. Verifique se o arquivo não está corrompido ou protegido.');
    friendly.status = 400;
    throw friendly;
  }
}

export async function savePdf(doc, target) {
  const bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false });
  await fsp.writeFile(target, bytes);
  return target;
}

export function parsePageList(spec, total, { allowEmpty = false } = {}) {
  const raw = String(spec ?? '').trim();
  if (!raw) {
    if (allowEmpty) return [];
    return Array.from({ length: total }, (_, index) => index + 1);
  }
  const pages = [];
  const parts = raw.split(/[,;\s]+/).filter(Boolean);
  if (!parts.length) return Array.from({ length: total }, (_, index) => index + 1);
  for (const part of parts) {
    if (part === '*' || part.toLowerCase() === 'todas') {
      for (let page = 1; page <= total; page += 1) pages.push(page);
      continue;
    }
    const match = part.match(/^(\d+)(?:\s*-\s*(\d+)?)?$/);
    if (!match) {
      const friendly = new Error(`Intervalo de páginas inválido: "${part}". Use, por exemplo, 1-3,5.`);
      friendly.status = 400;
      throw friendly;
    }
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : (part.endsWith('-') ? total : start);
    if (start < 1 || end < start || end > total) {
      const friendly = new Error(`Página fora do intervalo. Este PDF tem ${total} página(s).`);
      friendly.status = 400;
      throw friendly;
    }
    for (let page = start; page <= end; page += 1) pages.push(page);
  }
  return [...new Set(pages)].sort((a, b) => a - b);
}

export function parseRanges(spec, total) {
  const raw = String(spec ?? '').trim();
  if (!raw) {
    const friendly = new Error('Informe pelo menos um intervalo de páginas.');
    friendly.status = 400;
    throw friendly;
  }
  const groups = [];
  for (const part of raw.split(',').map((item) => item.trim()).filter(Boolean)) {
    const match = part.match(/^(\d+)(?:\s*-\s*(\d+)?)?$/);
    if (!match) {
      const friendly = new Error(`Intervalo inválido: "${part}". Use, por exemplo, 1-3,5-8.`);
      friendly.status = 400;
      throw friendly;
    }
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : (part.endsWith('-') ? total : start);
    if (start < 1 || end < start) {
      const friendly = new Error(`Intervalo inválido: "${part}".`);
      friendly.status = 400;
      throw friendly;
    }
    if (start > total) {
      const friendly = new Error(`A página ${start} não existe. Este PDF tem ${total} página(s).`);
      friendly.status = 400;
      throw friendly;
    }
    const clampedEnd = Math.min(end, total);
    groups.push(Array.from({ length: clampedEnd - start + 1 }, (_, index) => start + index));
  }
  return groups;
}

export function hexColor(hex, fallback = '#e5322d') {
  const value = /^#?[0-9a-f]{6}$/i.test(String(hex || '')) ? String(hex).replace('#', '') : fallback.replace('#', '');
  return rgb(
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
  );
}

export async function zipFiles(entries, target) {
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(target);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.on('warning', (error) => {
      if (error.code !== 'ENOENT') reject(error);
    });
    archive.pipe(output);
    for (const entry of entries) {
      archive.file(entry.path, { name: entry.name });
    }
    archive.finalize();
  });
  return target;
}

export async function pdfPageCount(file) {
  const bytes = await fsp.readFile(file);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  return doc.getPageCount();
}

export async function fileSize(file) {
  try {
    return (await fsp.stat(file)).size;
  } catch {
    return 0;
  }
}

export function fixRotation(existing, increment) {
  return degrees(((Number(existing) || 0) + (Number(increment) || 0) + 720) % 360);
}

export function friendlyError(error) {
  if (error?.status) return error.message;
  const message = String(error?.stderr || error?.message || 'Erro inesperado');
  if (/invalid password/i.test(message)) return 'Senha incorreta. Confira a senha e tente novamente.';
  if (/not a pdf|damaged|corrupt/i.test(message)) return 'O PDF parece estar danificado. Tente a ferramenta Reparar PDF.';
  if (/No such file|ENOENT/i.test(message)) return 'Arquivo temporário não encontrado. Envie o arquivo novamente.';
  return message.length > 300 ? `${message.slice(0, 300)}...` : message;
}
