import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  PageBreak,
} from 'docx';
import * as XLSX from 'xlsx';
import PptxGenJS from 'pptxgenjs';
import sharp from 'sharp';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import {
  run,
  loadPdf,
  savePdf,
  parsePageList,
  parseRanges,
  hexColor,
  zipFiles,
  baseName,
  cleanName,
  decryptIfNeeded,
  fixRotation,
  fileSize,
  extension,
  pdfPageCount,
} from './pdfutil.js';

async function outputPdf(doc, ctx, name) {
  const target = path.join(ctx.outDir, name);
  await savePdf(doc, target);
  return { path: target, filename: name, mime: 'application/pdf' };
}

async function singleOrZip(entries, ctx, zipName) {
  if (entries.length === 1) return entries[0];
  const target = path.join(ctx.outDir, zipName);
  await zipFiles(entries, target);
  return { path: target, filename: zipName, mime: 'application/zip' };
}

async function renderPagePng(source, page, dpi, outBase) {
  await run('pdftoppm', [
    '-f', String(page),
    '-l', String(page),
    '-singlefile',
    '-r', String(dpi),
    '-png',
    source,
    outBase,
  ]);
  return `${outBase}.png`;
}

async function renderPageJpg(source, page, dpi, outBase, quality = 90) {
  await run('pdftoppm', [
    '-f', String(page),
    '-l', String(page),
    '-singlefile',
    '-r', String(dpi),
    '-jpeg',
    '-jpegopt', `quality=${quality}`,
    source,
    outBase,
  ]);
  return `${outBase}.jpg`;
}

function uniqueName(base, ext, taken) {
  let name = `${base}${ext}`;
  let index = 2;
  while (taken.has(name)) {
    name = `${base}-${index}${ext}`;
    index += 1;
  }
  taken.add(name);
  return name;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function merge(ctx) {
  const out = await PDFDocument.create();
  let added = 0;
  for (let index = 0; index < ctx.inputFiles.length; index += 1) {
    const file = ctx.inputFiles[index];
    const source = await loadPdf(file.path, ctx.workDir);
    const total = source.getPageCount();
    const ranges = Array.isArray(ctx.options.ranges) ? ctx.options.ranges[index] : '';
    const pages = parsePageList(ranges, total);
    const copied = await out.copyPages(source, pages.map((page) => page - 1));
    for (const page of copied) {
      out.addPage(page);
      added += 1;
    }
  }
  if (!added) {
    const error = new Error('Nenhuma página foi selecionada para juntar.');
    error.status = 400;
    throw error;
  }
  return outputPdf(out, ctx, `${baseName(ctx.inputFiles[0].name)}-juntado.pdf`);
}

async function split(ctx) {
  const source = await loadPdf(ctx.inputFiles[0].path, ctx.workDir);
  const total = source.getPageCount();
  const mode = ctx.options.mode || 'ranges';
  let groups = [];
  if (mode === 'each') {
    groups = Array.from({ length: total }, (_, index) => [index + 1]);
  } else if (mode === 'every') {
    const every = clamp(Number(ctx.options.every) || 1, 1, total);
    for (let start = 1; start <= total; start += every) {
      groups.push(
        Array.from({ length: Math.min(every, total - start + 1) }, (_, index) => start + index),
      );
    }
  } else if (mode === 'selected') {
    groups = [parsePageList(ctx.options.pages, total)];
  } else {
    groups = parseRanges(ctx.options.ranges, total);
  }
  if (!groups.length) {
    const error = new Error('Informe pelo menos um intervalo de páginas.');
    error.status = 400;
    throw error;
  }
  const base = baseName(ctx.inputFiles[0].name);
  const taken = new Set();
  const entries = [];
  for (const group of groups) {
    const doc = await PDFDocument.create();
    const copied = await doc.copyPages(source, group.map((page) => page - 1));
    for (const page of copied) doc.addPage(page);
    const suffix = group.length === 1
      ? `pagina-${group[0]}`
      : `paginas-${group[0]}-${group[group.length - 1]}`;
    const name = uniqueName(`${base}-${suffix}`, '.pdf', taken);
    const target = path.join(ctx.outDir, name);
    await savePdf(doc, target);
    entries.push({ path: target, filename: name, mime: 'application/pdf' });
  }
  return singleOrZip(entries, ctx, `${base}-dividido.zip`);
}

async function organize(ctx) {
  const source = await loadPdf(ctx.inputFiles[0].path, ctx.workDir);
  const total = source.getPageCount();
  let order = Array.isArray(ctx.options.order) ? ctx.options.order : [];
  if (!order.length) order = Array.from({ length: total }, (_, index) => ({ page: index, rotate: 0 }));
  if (order.length > total) {
    const error = new Error('A ordem enviada contém páginas demais.');
    error.status = 400;
    throw error;
  }
  const seen = new Set();
  for (const item of order) {
    const page = Number(item.page);
    if (!Number.isInteger(page) || page < 0 || page >= total) {
      const error = new Error('A ordem das páginas é inválida. Atualize a página e tente novamente.');
      error.status = 400;
      throw error;
    }
    if (seen.has(page)) {
      const error = new Error('A mesma página não pode aparecer duas vezes.');
      error.status = 400;
      throw error;
    }
    seen.add(page);
  }
  const out = await PDFDocument.create();
  const copied = await out.copyPages(source, order.map((item) => Number(item.page)));
  copied.forEach((page, index) => {
    const rotate = Number(order[index].rotate) || 0;
    if (rotate) page.setRotation(fixRotation(page.getRotation().angle, rotate));
    out.addPage(page);
  });
  return outputPdf(out, ctx, `${baseName(ctx.inputFiles[0].name)}-organizado.pdf`);
}

async function removePages(ctx) {
  const source = await loadPdf(ctx.inputFiles[0].path, ctx.workDir);
  const total = source.getPageCount();
  const remove = parsePageList(ctx.options.pages, total, { allowEmpty: true });
  if (!remove.length) {
    const error = new Error('Selecione pelo menos uma página para remover.');
    error.status = 400;
    throw error;
  }
  const keep = Array.from({ length: total }, (_, index) => index + 1).filter(
    (page) => !remove.includes(page),
  );
  if (!keep.length) {
    const error = new Error('Não é possível remover todas as páginas do PDF.');
    error.status = 400;
    throw error;
  }
  const out = await PDFDocument.create();
  const copied = await out.copyPages(source, keep.map((page) => page - 1));
  for (const page of copied) out.addPage(page);
  return outputPdf(out, ctx, `${baseName(ctx.inputFiles[0].name)}-sem-paginas.pdf`);
}

async function rotate(ctx) {
  const source = await loadPdf(ctx.inputFiles[0].path, ctx.workDir);
  const total = source.getPageCount();
  const angle = Number(ctx.options.angle);
  if (![90, 180, 270].includes(angle)) {
    const error = new Error('Escolha um ângulo válido: 90°, 180° ou 270°.');
    error.status = 400;
    throw error;
  }
  const pages = parsePageList(ctx.options.pages, total);
  for (const pageNumber of pages) {
    const page = source.getPage(pageNumber - 1);
    page.setRotation(fixRotation(page.getRotation().angle, angle));
  }
  return outputPdf(source, ctx, `${baseName(ctx.inputFiles[0].name)}-girado.pdf`);
}

async function crop(ctx) {
  const source = await loadPdf(ctx.inputFiles[0].path, ctx.workDir);
  const total = source.getPageCount();
  const crops = Array.isArray(ctx.options.crops) ? ctx.options.crops : [];
  const applyAll = Boolean(ctx.options.applyAll) && ctx.options.all;
  let applied = 0;
  for (let index = 0; index < total; index += 1) {
    let rect = applyAll ? ctx.options.all : crops.find((item) => Number(item.page) === index + 1);
    if (!rect) continue;
    const page = source.getPage(index);
    const media = page.getMediaBox();
    const width = Number(rect.width);
    const height = Number(rect.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) continue;
    let x = Number(rect.x);
    let y = Number(rect.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const pageX = media.x;
    const pageY = media.y;
    x = clamp(x, pageX, pageX + media.width - 1);
    y = clamp(y, pageY, pageY + media.height - 1);
    const w = clamp(width, 1, pageX + media.width - x);
    const h = clamp(height, 1, pageY + media.height - y);
    page.setCropBox(x, y, w, h);
    applied += 1;
  }
  if (!applied) {
    const error = new Error('Nenhuma área de recorte foi selecionada. Arraste sobre a página para recortar.');
    error.status = 400;
    throw error;
  }
  return outputPdf(source, ctx, `${baseName(ctx.inputFiles[0].name)}-recortado.pdf`);
}

async function watermark(ctx) {
  const source = await loadPdf(ctx.inputFiles[0].path, ctx.workDir);
  const total = source.getPageCount();
  const font = await source.embedFont(StandardFonts.HelveticaBold);
  const text = String(ctx.options.text || 'CONFIDENCIAL').slice(0, 160);
  const size = clamp(Number(ctx.options.size) || 48, 8, 200);
  const opacity = clamp(Number(ctx.options.opacity ?? 0.25), 0.03, 1);
  const color = hexColor(ctx.options.color, '#e5322d');
  const angle = clamp(Number(ctx.options.rotation ?? 45), -90, 90);
  const position = ctx.options.position || 'center';
  const pages = parsePageList(ctx.options.pages, total);
  for (const pageNumber of pages) {
    const page = source.getPage(pageNumber - 1);
    const width = page.getWidth();
    const height = page.getHeight();
    const textWidth = font.widthOfTextAtSize(text, size);
    const textHeight = font.heightAtSize(size);
    const options = { size, font, color, opacity, rotate: degrees(angle) };
    if (position === 'tiled') {
      const stepX = Math.max(textWidth + 70, 160);
      const stepY = Math.max(textHeight + 90, 130);
      for (let y = 20; y < height + stepY; y += stepY) {
        for (let x = -40; x < width + stepX; x += stepX) {
          page.drawText(text, { ...options, x, y });
        }
      }
    } else {
      let x = (width - textWidth) / 2;
      let y = (height - textHeight) / 2;
      if (position === 'top') y = height - textHeight - 36;
      if (position === 'bottom') y = 36;
      if (position === 'top-left') {
        x = 36;
        y = height - textHeight - 36;
      }
      if (position === 'top-right') {
        x = width - textWidth - 36;
        y = height - textHeight - 36;
      }
      if (position === 'bottom-left') {
        x = 36;
        y = 36;
      }
      if (position === 'bottom-right') {
        x = width - textWidth - 36;
        y = 36;
      }
      if (angle !== 0) {
        const radians = (angle * Math.PI) / 180;
        x -= (textHeight / 2) * Math.sin(radians);
        y += (textHeight / 2) * Math.cos(radians);
      }
      page.drawText(text, { ...options, x, y });
    }
  }
  return outputPdf(source, ctx, `${baseName(ctx.inputFiles[0].name)}-marca-dagua.pdf`);
}

async function pagenumbers(ctx) {
  const source = await loadPdf(ctx.inputFiles[0].path, ctx.workDir);
  const total = source.getPageCount();
  const pages = parsePageList(ctx.options.pages, total);
  const font = await source.embedFont(
    ctx.options.bold === false ? StandardFonts.Helvetica : StandardFonts.HelveticaBold,
  );
  const size = clamp(Number(ctx.options.size) || 12, 6, 48);
  const margin = clamp(Number(ctx.options.margin) || 24, 4, 140);
  const color = hexColor(ctx.options.color, '#333333');
  const start = Math.max(0, Math.floor(Number(ctx.options.start) || 1));
  const format = ctx.options.format || 'n';
  const position = ctx.options.position || 'bottom-center';
  pages.forEach((pageNumber, index) => {
    const page = source.getPage(pageNumber - 1);
    const number = start + index;
    let label = String(number);
    if (format === 'n_de_total') label = `${number} de ${total}`;
    if (format === 'page_n') label = `Página ${number}`;
    if (format === 'page_n_de_total') label = `Página ${number} de ${total}`;
    const width = page.getWidth();
    const height = page.getHeight();
    const textWidth = font.widthOfTextAtSize(label, size);
    const textHeight = font.heightAtSize(size);
    let x = (width - textWidth) / 2;
    let y = margin;
    if (position.includes('left')) x = margin;
    if (position.includes('right')) x = width - textWidth - margin;
    if (position.startsWith('top')) y = height - textHeight - margin;
    page.drawText(label, { x, y, size, font, color });
  });
  return outputPdf(source, ctx, `${baseName(ctx.inputFiles[0].name)}-numerado.pdf`);
}

async function compress(ctx) {
  const source = await decryptIfNeeded(ctx.inputFiles[0].path, ctx.workDir);
  const level = ctx.options.level || 'recommended';
  const preset = level === 'extreme' ? 'screen' : level === 'low' ? 'printer' : 'ebook';
  const target = path.join(ctx.outDir, `${baseName(ctx.inputFiles[0].name)}-comprimido.pdf`);
  const args = [
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.7',
    '-dNOPAUSE',
    '-dBATCH',
    '-dQUIET',
    '-dSAFER',
    `-dPDFSETTINGS=/${preset}`,
    '-dDetectDuplicateImages=true',
    '-dCompressFonts=true',
    '-dSubsetFonts=true',
  ];
  if (ctx.options.grayscale) {
    args.push('-sColorConversionStrategy=Gray', '-dProcessColorModel=/DeviceGray');
  }
  args.push(`-sOutputFile=${target}`, source);
  await run('gs', args, { timeout: 300000 });
  const originalSize = await fileSize(ctx.inputFiles[0].path);
  const outputSize = await fileSize(target);
  return {
    path: target,
    filename: path.basename(target),
    mime: 'application/pdf',
    meta: { originalSize, outputSize, savedPercent: originalSize ? Math.max(0, Math.round((1 - outputSize / originalSize) * 100)) : 0 },
  };
}

async function repair(ctx) {
  const source = await decryptIfNeeded(ctx.inputFiles[0].path, ctx.workDir);
  const target = path.join(ctx.outDir, `${baseName(ctx.inputFiles[0].name)}-reparado.pdf`);
  try {
    await run('gs', [
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.7',
      '-dNOPAUSE',
      '-dBATCH',
      '-dQUIET',
      '-dSAFER',
      '-dPDFSETTINGS=/prepress',
      `-sOutputFile=${target}`,
      source,
    ], { timeout: 300000 });
    await pdfPageCount(target);
  } catch {
    try {
      await run('qpdf', [source, target]);
      await pdfPageCount(target);
    } catch {
      const error = new Error('Não foi possível reparar este PDF. O arquivo pode estar severamente danificado.');
      error.status = 400;
      throw error;
    }
  }
  return {
    path: target,
    filename: path.basename(target),
    mime: 'application/pdf',
    meta: { originalSize: await fileSize(ctx.inputFiles[0].path), outputSize: await fileSize(target) },
  };
}

async function pdf2jpg(ctx) {
  const source = await decryptIfNeeded(ctx.inputFiles[0].path, ctx.workDir);
  const total = await pdfPageCount(source);
  const pages = parsePageList(ctx.options.pages, total);
  const dpi = clamp(Math.round(Number(ctx.options.dpi) || 150), 72, 400);
  const quality = clamp(Math.round(Number(ctx.options.quality) || 90), 30, 100);
  const base = baseName(ctx.inputFiles[0].name);
  const entries = [];
  for (const page of pages) {
    const outBase = path.join(ctx.workDir, `pagina-${String(page).padStart(4, '0')}`);
    const rendered = await renderPageJpg(source, page, dpi, outBase, quality);
    const name = `${base}-pagina-${String(page).padStart(3, '0')}.jpg`;
    const target = path.join(ctx.outDir, name);
    await fsp.copyFile(rendered, target);
    entries.push({ path: target, filename: name, mime: 'image/jpeg' });
  }
  if (!entries.length) {
    const error = new Error('Nenhuma página selecionada.');
    error.status = 400;
    throw error;
  }
  return singleOrZip(entries, ctx, `${base}-jpg.zip`);
}

async function img2pdf(ctx) {
  const out = await PDFDocument.create();
  const sizeMode = ctx.options.size || 'auto';
  const orientation = ctx.options.orientation || 'auto';
  const marginMm = clamp(Number(ctx.options.margin) || 0, 0, 50);
  const margin = (marginMm * 72) / 25.4;
  const taken = new Set();
  const entries = [];
  for (const file of ctx.inputFiles) {
    let pipeline = sharp(file.path, { failOn: 'none' }).rotate();
    const meta = await pipeline.metadata();
    const hasAlpha = Boolean(meta.hasAlpha);
    const buffer = hasAlpha
      ? await pipeline.png().toBuffer()
      : await pipeline.jpeg({ quality: 92, mozjpeg: true }).toBuffer();
    const image = hasAlpha ? await out.embedPng(buffer) : await out.embedJpg(buffer);
    let pageWidth;
    let pageHeight;
    if (sizeMode === 'a4') {
      pageWidth = 595.28;
      pageHeight = 841.89;
    } else if (sizeMode === 'letter') {
      pageWidth = 612;
      pageHeight = 792;
    } else {
      pageWidth = (image.width * 72) / 96 + margin * 2;
      pageHeight = (image.height * 72) / 96 + margin * 2;
    }
    let landscape = false;
    if (orientation === 'landscape') landscape = true;
    if (orientation === 'portrait') landscape = false;
    if (orientation === 'auto' && image.width > image.height) landscape = true;
    if (landscape && pageWidth < pageHeight) [pageWidth, pageHeight] = [pageHeight, pageWidth];
    if (!landscape && pageWidth > pageHeight && sizeMode !== 'auto') [pageWidth, pageHeight] = [pageHeight, pageWidth];
    const page = out.addPage([pageWidth, pageHeight]);
    page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: hexColor('#ffffff') });
    const contentWidth = Math.max(1, pageWidth - margin * 2);
    const contentHeight = Math.max(1, pageHeight - margin * 2);
    const scale = Math.min(contentWidth / image.width, contentHeight / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    page.drawImage(image, {
      x: (pageWidth - drawWidth) / 2,
      y: (pageHeight - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
    });
    const name = uniqueName(`${baseName(file.name)}-pdf`, '.pdf', taken);
    entries.push({ name });
  }
  const name = `${baseName(ctx.inputFiles[0].name)}-imagens.pdf`;
  const target = path.join(ctx.outDir, name);
  await savePdf(out, target);
  return { path: target, filename: name, mime: 'application/pdf', meta: { pages: ctx.inputFiles.length } };
}

async function extractText(ctx) {
  const source = await decryptIfNeeded(ctx.inputFiles[0].path, ctx.workDir);
  const { stdout } = await run('pdftotext', ['-layout', '-enc', 'UTF-8', source, '-']);
  return stdout;
}

async function pdf2word(ctx) {
  const text = await extractText(ctx);
  if (!text.replace(/\f/g, '').trim()) {
    const error = new Error('Este PDF não possui texto pesquisável. Use a ferramenta OCR PDF antes de converter.');
    error.status = 400;
    throw error;
  }
  const pages = text.split('\f');
  const children = [];
  pages.forEach((page, pageIndex) => {
    const lines = page.replace(/\r/g, '').split('\n');
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (!lines.length) lines.push('');
    for (const line of lines) {
      children.push(new Paragraph({
        children: [new TextRun({ text: line.replace(/\s+$/, ''), font: 'Arial', size: 22 })],
        spacing: { after: 40 },
      }));
    }
    if (pageIndex < pages.length - 1) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
  });
  const doc = new Document({
    styles: { default: { document: { run: { font: 'Arial', size: 22 } } } },
    sections: [{ properties: {}, children }],
  });
  const buffer = await Packer.toBuffer(doc);
  const name = `${baseName(ctx.inputFiles[0].name)}.docx`;
  const target = path.join(ctx.outDir, name);
  await fsp.writeFile(target, buffer);
  return { path: target, filename: name, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', meta: { pages: pages.length } };
}

async function pdf2excel(ctx) {
  const text = await extractText(ctx);
  if (!text.replace(/\f/g, '').trim()) {
    const error = new Error('Este PDF não possui texto pesquisável. Use a ferramenta OCR PDF antes de converter.');
    error.status = 400;
    throw error;
  }
  const pages = text.split('\f');
  const workbook = XLSX.utils.book_new();
  pages.forEach((page, index) => {
    const rows = [];
    for (const line of page.replace(/\r/g, '').split('\n')) {
      if (!line.trim()) continue;
      const cells = line.split(/\s{2,}/).map((cell) => cell.trim());
      rows.push(cells.length ? cells : [line.trim()]);
    }
    if (!rows.length) rows.push(['']);
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const widths = [];
    const maxCols = Math.max(...rows.map((row) => row.length));
    for (let col = 0; col < maxCols; col += 1) {
      const longest = Math.max(...rows.map((row) => String(row[col] ?? '').length));
      widths.push({ wch: Math.min(60, Math.max(10, longest + 2)) });
    }
    sheet['!cols'] = widths;
    XLSX.utils.book_append_sheet(workbook, sheet, `Página ${index + 1}`);
  });
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const name = `${baseName(ctx.inputFiles[0].name)}.xlsx`;
  const target = path.join(ctx.outDir, name);
  await fsp.writeFile(target, buffer);
  return { path: target, filename: name, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', meta: { pages: pages.length } };
}

async function pdf2ppt(ctx) {
  const source = await decryptIfNeeded(ctx.inputFiles[0].path, ctx.workDir);
  const total = await pdfPageCount(source);
  const dpi = 150;
  const images = [];
  for (let page = 1; page <= total; page += 1) {
    const outBase = path.join(ctx.workDir, `slide-${String(page).padStart(4, '0')}`);
    images.push(await renderPageJpg(source, page, dpi, outBase, 92));
  }
  const firstMeta = await sharp(images[0]).metadata();
  const widthIn = Math.max(1, firstMeta.width / dpi);
  const heightIn = Math.max(1, firstMeta.height / dpi);
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'PAGINA_PDF', width: widthIn, height: heightIn });
  pptx.layout = 'PAGINA_PDF';
  pptx.author = 'PDF-Editor';
  pptx.title = baseName(ctx.inputFiles[0].name);
  for (const image of images) {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addImage({ path: image, x: 0, y: 0, w: widthIn, h: heightIn });
  }
  const buffer = await pptx.write({ outputType: 'nodebuffer' });
  const name = `${baseName(ctx.inputFiles[0].name)}.pptx`;
  const target = path.join(ctx.outDir, name);
  await fsp.writeFile(target, buffer);
  return { path: target, filename: name, mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', meta: { slides: total } };
}

async function office2pdf(ctx) {
  const base = baseName(ctx.inputFiles[0].name);
  const entries = [];
  const taken = new Set();
  for (const file of ctx.inputFiles) {
    const targetDir = path.join(ctx.workDir, `office-${crypto.randomUUID()}`);
    await fsp.mkdir(targetDir, { recursive: true });
    const profileDir = path.join(ctx.workDir, `lo-profile-${crypto.randomUUID()}`);
    await fsp.mkdir(profileDir, { recursive: true });
    try {
      await run('soffice', [
        '--headless',
        '--norestore',
        '--invisible',
        '--nodefault',
        '--nolockcheck',
        `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
        '--convert-to', 'pdf',
        '--outdir', targetDir,
        file.path,
      ], { timeout: 300000 });
    } catch (error) {
      const friendly = new Error('Não foi possível converter este arquivo Office. Verifique se ele não está corrompido.');
      friendly.status = 400;
      throw friendly;
    }
    const files = await fsp.readdir(targetDir);
    const pdfFile = files.find((name) => name.toLowerCase().endsWith('.pdf'));
    if (!pdfFile) {
      const error = new Error(`Não foi possível converter "${file.name}" para PDF.`);
      error.status = 400;
      throw error;
    }
    const name = uniqueName(`${baseName(file.name)}`, '.pdf', taken);
    const target = path.join(ctx.outDir, name);
    await fsp.copyFile(path.join(targetDir, pdfFile), target);
    entries.push({ path: target, filename: name, mime: 'application/pdf' });
  }
  return singleOrZip(entries, ctx, `${base}-convertidos.zip`);
}

async function ocr(ctx) {
  const source = await decryptIfNeeded(ctx.inputFiles[0].path, ctx.workDir);
  const total = await pdfPageCount(source);
  const pages = parsePageList(ctx.options.pages, total);
  const lang = ctx.options.lang || 'por';
  const allowed = new Set(['por', 'eng', 'por+eng']);
  const language = allowed.has(lang) ? lang : 'por';
  const pieces = [];
  for (const page of pages) {
    const outBase = path.join(ctx.workDir, `ocr-${String(page).padStart(4, '0')}`);
    const image = await renderPagePng(source, page, 300, outBase);
    const resultBase = path.join(ctx.workDir, `ocr-result-${String(page).padStart(4, '0')}`);
    try {
      await run('tesseract', [image, resultBase, '-l', language, '--dpi', '300', 'pdf'], { timeout: 300000 });
    } catch (error) {
      const friendly = new Error('O OCR falhou ao processar uma das páginas. Tente novamente com outra resolução ou idioma.');
      friendly.status = 400;
      throw friendly;
    }
    pieces.push(`${resultBase}.pdf`);
  }
  const out = await PDFDocument.create();
  for (const piece of pieces) {
    const doc = await PDFDocument.load(await fsp.readFile(piece), { ignoreEncryption: true });
    const copied = await out.copyPages(doc, doc.getPageIndices());
    for (const page of copied) out.addPage(page);
  }
  return outputPdf(out, ctx, `${baseName(ctx.inputFiles[0].name)}-ocr.pdf`);
}

async function protect(ctx) {
  const userPassword = String(ctx.options.password || '');
  if (userPassword.length < 4) {
    const error = new Error('A senha deve ter pelo menos 4 caracteres.');
    error.status = 400;
    throw error;
  }
  const ownerPassword = String(ctx.options.ownerPassword || crypto.randomBytes(18).toString('base64url'));
  const target = path.join(ctx.outDir, `${baseName(ctx.inputFiles[0].name)}-protegido.pdf`);
  const args = [
    '--encrypt', userPassword, ownerPassword, '256',
    `--print=${ctx.options.allowPrinting ? 'full' : 'none'}`,
    `--modify=${ctx.options.allowModifying ? 'all' : 'none'}`,
    `--extract=${ctx.options.allowCopying ? 'y' : 'n'}`,
    `--annotate=${ctx.options.allowAnnotations ? 'y' : 'n'}`,
    '--',
    ctx.inputFiles[0].path,
    target,
  ];
  try {
    await run('qpdf', args);
  } catch (error) {
    const friendly = new Error('Não foi possível proteger este PDF. Verifique se ele já não está criptografado.');
    friendly.status = 400;
    throw friendly;
  }
  return { path: target, filename: path.basename(target), mime: 'application/pdf' };
}

async function unlock(ctx) {
  const password = String(ctx.options.password || '');
  const target = path.join(ctx.outDir, `${baseName(ctx.inputFiles[0].name)}-desbloqueado.pdf`);
  const args = [];
  if (password) args.push(`--password=${password}`);
  args.push('--decrypt', ctx.inputFiles[0].path, target);
  try {
    await run('qpdf', args);
  } catch (error) {
    const message = `${error.stdout || ''}${error.stderr || ''}`;
    const friendly = new Error(
      /invalid password/i.test(message)
        ? 'Senha incorreta. Confira a senha e tente novamente.'
        : 'Não foi possível desbloquear este PDF. Verifique a senha informada.',
    );
    friendly.status = 400;
    throw friendly;
  }
  return { path: target, filename: path.basename(target), mime: 'application/pdf' };
}

async function sign(ctx) {
  const source = await loadPdf(ctx.inputFiles[0].path, ctx.workDir);
  const total = source.getPageCount();
  const pageIndex = clamp(Math.floor(Number(ctx.options.page) || 1) - 1, 0, total - 1);
  const page = source.getPage(pageIndex);
  const media = page.getMediaBox();
  const rect = ctx.options.rect || {};
  let x = Number(rect.x);
  let y = Number(rect.y);
  let width = Number(rect.width);
  let height = Number(rect.height);
  if (![x, y, width, height].every(Number.isFinite) || width < 5 || height < 5) {
    const error = new Error('Posicione a assinatura sobre a página antes de continuar.');
    error.status = 400;
    throw error;
  }
  x = clamp(x, media.x, media.x + media.width - width);
  y = clamp(y, media.y, media.y + media.height - height);
  const dataUrl = String(ctx.options.signature || '');
  const match = dataUrl.match(/^data:image\/png;base64,(.+)$/);
  if (match) {
    const buffer = Buffer.from(match[1], 'base64');
    if (buffer.length > 15 * 1024 * 1024) {
      const error = new Error('A imagem da assinatura é muito grande.');
      error.status = 400;
      throw error;
    }
    const image = await source.embedPng(buffer);
    page.drawImage(image, { x, y, width, height });
  } else {
    const name = String(ctx.options.name || '').trim();
    if (!name) {
      const error = new Error('Desenhe ou digite uma assinatura antes de continuar.');
      error.status = 400;
      throw error;
    }
    const font = await source.embedFont(StandardFonts.HelveticaOblique);
    const size = Math.max(10, Math.min(height * 0.7, width / Math.max(1, name.length) * 1.7));
    page.drawText(name, { x: x + 4, y: y + height * 0.2, size, font, color: hexColor('#1b1b1b') });
  }
  return outputPdf(source, ctx, `${baseName(ctx.inputFiles[0].name)}-assinado.pdf`);
}

function composeOnWhite(png, width, height) {
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (width * y + x) * 4;
      if (x < png.width && y < png.height) {
        const src = (png.width * y + x) * 4;
        out.data[offset] = png.data[src];
        out.data[offset + 1] = png.data[src + 1];
        out.data[offset + 2] = png.data[src + 2];
        out.data[offset + 3] = 255;
      } else {
        out.data[offset] = 255;
        out.data[offset + 1] = 255;
        out.data[offset + 2] = 255;
        out.data[offset + 3] = 255;
      }
    }
  }
  return out;
}

async function compare(ctx) {
  if (ctx.inputFiles.length !== 2) {
    const error = new Error('Envie exatamente dois PDFs para comparar.');
    error.status = 400;
    throw error;
  }
  const first = await decryptIfNeeded(ctx.inputFiles[0].path, ctx.workDir);
  const second = await decryptIfNeeded(ctx.inputFiles[1].path, ctx.workDir);
  const totalA = await pdfPageCount(first);
  const totalB = await pdfPageCount(second);
  const total = Math.max(totalA, totalB);
  if (total > 200) {
    const error = new Error('A comparação é limitada a 200 páginas. Divida os PDFs e compare por partes.');
    error.status = 400;
    throw error;
  }
  const dpi = clamp(Math.round(Number(ctx.options.dpi) || 96), 72, 150);
  const changed = [];
  const diffs = [];
  let compared = 0;
  for (let page = 1; page <= total; page += 1) {
    const baseA = path.join(ctx.workDir, `diff-a-${String(page).padStart(4, '0')}`);
    const baseB = path.join(ctx.workDir, `diff-b-${String(page).padStart(4, '0')}`);
    const hasA = page <= totalA;
    const hasB = page <= totalB;
    let pngA = null;
    let pngB = null;
    let width = 0;
    let height = 0;
    if (hasA) {
      pngA = PNG.sync.read(await fsp.readFile(await renderPagePng(first, page, dpi, baseA)));
      width = Math.max(width, pngA.width);
      height = Math.max(height, pngA.height);
    }
    if (hasB) {
      pngB = PNG.sync.read(await fsp.readFile(await renderPagePng(second, page, dpi, baseB)));
      width = Math.max(width, pngB.width);
      height = Math.max(height, pngB.height);
    }
    const canvasA = pngA ? composeOnWhite(pngA, width, height) : composeOnWhite(new PNG({ width: 1, height: 1 }), width, height);
    const canvasB = pngB ? composeOnWhite(pngB, width, height) : composeOnWhite(new PNG({ width: 1, height: 1 }), width, height);
    const diff = new PNG({ width, height });
    const pixels = pixelmatch(canvasA.data, canvasB.data, diff.data, width, height, {
      threshold: 0.12,
      includeAA: false,
      alpha: 0.25,
      diffColor: [229, 50, 45],
    });
    compared += 1;
    const different = pixels > 0 || !hasA || !hasB;
    if (different) changed.push(page);
    const name = `diferenca-pagina-${String(page).padStart(3, '0')}.png`;
    const target = path.join(ctx.workDir, name);
    await fsp.writeFile(target, PNG.sync.write(diff));
    diffs.push({ path: target, name });
  }
  const summary = [
    `Comparação de PDFs - PDF-Editor`,
    `Arquivo A: ${ctx.inputFiles[0].name} (${totalA} página(s))`,
    `Arquivo B: ${ctx.inputFiles[1].name} (${totalB} página(s))`,
    `Páginas comparadas: ${compared}`,
    `Páginas com diferenças: ${changed.length ? changed.join(', ') : 'nenhuma'}`,
    '',
  ].join('\n');
  const summaryPath = path.join(ctx.workDir, 'resumo.txt');
  await fsp.writeFile(summaryPath, summary);
  const zipName = `comparacao-${baseName(ctx.inputFiles[0].name)}.zip`;
  const zipPath = path.join(ctx.outDir, zipName);
  await zipFiles([{ path: summaryPath, name: 'resumo.txt' }, ...diffs], zipPath);
  return {
    path: zipPath,
    filename: zipName,
    mime: 'application/zip',
    meta: { changedPages: changed, compared, pagesA: totalA, pagesB: totalB },
  };
}

async function pdfa(ctx) {
  const source = await decryptIfNeeded(ctx.inputFiles[0].path, ctx.workDir);
  const target = path.join(ctx.outDir, `${baseName(ctx.inputFiles[0].name)}-pdfa.pdf`);
  try {
    await run('gs', [
      '-dPDFA=2',
      '-dBATCH',
      '-dNOPAUSE',
      '-dQUIET',
      '-dSAFER',
      '-sColorConversionStrategy=UseDeviceIndependentColor',
      '-sDEVICE=pdfwrite',
      '-dPDFACompatibilityPolicy=1',
      '-dCompatibilityLevel=1.7',
      `-sOutputFile=${target}`,
      source,
    ], { timeout: 300000 });
  } catch {
    const error = new Error('Não foi possível converter este PDF para PDF/A.');
    error.status = 400;
    throw error;
  }
  return { path: target, filename: path.basename(target), mime: 'application/pdf' };
}

export const PROCESSORS = {
  merge,
  split,
  organize,
  remove: removePages,
  rotate,
  crop,
  watermark,
  pagenumbers,
  compress,
  repair,
  pdf2jpg,
  img2pdf,
  pdf2word,
  pdf2excel,
  pdf2ppt,
  office2pdf,
  ocr,
  protect,
  unlock,
  sign,
  compare,
  pdfa,
};
