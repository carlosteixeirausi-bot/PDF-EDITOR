import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';
import { makeFixtures, FIXTURES_DIR } from './fixtures.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const FIX = FIXTURES_DIR;
const OUT = '/tmp/editor-out';
await fsp.mkdir(OUT, { recursive: true });

let pass = 0;
let fail = 0;
const failures = [];

function check(name, condition, extra = '') {
  if (condition) {
    pass += 1;
    console.log(`  ok  ${name}`);
  } else {
    fail += 1;
    failures.push(`${name} ${extra}`);
    console.log(`FAIL  ${name} ${extra}`);
  }
}

async function upload(...names) {
  const form = new FormData();
  for (const name of names) {
    const full = name.startsWith('/') ? name : path.join(FIX, name);
    const buffer = await fsp.readFile(full);
    form.append('files', new Blob([buffer]), path.basename(full));
  }
  const response = await fetch(`${BASE}/api/upload`, { method: 'POST', body: form });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'upload failed');
  return data.files;
}

async function callTool(slug, fileIds, options = {}) {
  const response = await fetch(`${BASE}/api/process/${slug}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: fileIds, options }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${slug}: ${data.error || 'process failed'}`);
  return data;
}

async function download(result, name) {
  const response = await fetch(BASE + result.download);
  if (!response.ok) throw new Error(`download failed ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const target = path.join(OUT, name || result.filename);
  await fsp.writeFile(target, buffer);
  return { buffer, target };
}

async function pages(file) {
  const doc = await PDFDocument.load(await fsp.readFile(file), { ignoreEncryption: true });
  return doc.getPageCount();
}

async function pdfDoc(file) {
  return PDFDocument.load(await fsp.readFile(file), { ignoreEncryption: true });
}

function zipList(file) {
  return execFileSync('python3', ['-m', 'zipfile', '-l', file], { encoding: 'utf8' });
}

function qpdf(file, args) {
  return execFileSync('qpdf', [file, ...args], { encoding: 'utf8' }).toString();
}

async function main() {
  await makeFixtures();
  const [a, b] = await upload('sample.pdf', 'sample2.pdf');
  check('upload pdf metadata', a.pages === 5 && b.pages === 3, JSON.stringify([a.pages, b.pages]));

  let result = await callTool('juntar_pdf', [a.id, b.id]);
  let file = await download(result, 'merged.pdf');
  check('merge pages', await pages(file.target) === 8, String(await pages(file.target)));

  result = await callTool('dividir_pdf', [a.id], { mode: 'ranges', ranges: '1-2,3-5' });
  file = await download(result, 'split.zip');
  check('split ranges zip', /paginas-1-2\.pdf/.test(zipList(file.target)) && /paginas-3-5\.pdf/.test(zipList(file.target)));

  result = await callTool('dividir_pdf', [a.id], { mode: 'selected', pages: '1,3,5' });
  file = await download(result, 'extract.pdf');
  check('split selected pages', await pages(file.target) === 3);

  result = await callTool('organizar-pdf', [a.id], { order: [{ page: 1, rotate: 0 }, { page: 0, rotate: 0 }, { page: 2, rotate: 90 }] });
  file = await download(result, 'organized.pdf');
  const organized = await pdfDoc(file.target);
  check('organize pages', organized.getPageCount() === 3);
  check('organize rotate', organized.getPage(2).getRotation().angle === 90);

  result = await callTool('excluir-paginas-do-pdf', [a.id], { pages: [2, 4] });
  file = await download(result, 'removed.pdf');
  check('remove pages', await pages(file.target) === 3);

  result = await callTool('rodar_pdf', [a.id], { angle: 90, pages: [1] });
  file = await download(result, 'rotated.pdf');
  const rotated = await pdfDoc(file.target);
  check('rotate page', rotated.getPage(0).getRotation().angle === 90 && rotated.getPage(1).getRotation().angle === 0);

  result = await callTool('recortar-pdf', [a.id], { crops: [{ page: 1, x: 50, y: 50, width: 200, height: 300 }] });
  file = await download(result, 'cropped.pdf');
  const cropped = await pdfDoc(file.target);
  const box = cropped.getPage(0).getCropBox();
  check('crop box', Math.abs(box.x - 50) < 1 && Math.abs(box.width - 200) < 1, JSON.stringify(box));

  result = await callTool('pdf_inserir_marca_daigua', [a.id], { text: 'TESTE', size: 40, opacity: 0.3, color: '#e5322d', rotation: 45, position: 'center' });
  file = await download(result, 'watermark.pdf');
  check('watermark pdf', await pages(file.target) === 5);

  result = await callTool('pdf_inserir_numeros_de_paginas', [a.id], { position: 'bottom-center', format: 'n_de_total', start: 1, size: 12, color: '#333333' });
  file = await download(result, 'numbered.pdf');
  check('page numbers pdf', await pages(file.target) === 5);

  result = await callTool('comprimir_pdf', [a.id], { level: 'recommended' });
  file = await download(result, 'compressed.pdf');
  check('compress pdf', await pages(file.target) === 5 && result.meta && typeof result.meta.outputSize === 'number');

  result = await callTool('reparar-pdf', [a.id], {});
  file = await download(result, 'repaired.pdf');
  check('repair pdf', await pages(file.target) === 5);

  result = await callTool('pdf_para_jpg', [a.id], { pages: '1-2', dpi: 150, quality: 85 });
  file = await download(result, 'pages.zip');
  check('pdf2jpg zip', /pagina-001\.jpg/.test(zipList(file.target)) && /pagina-002\.jpg/.test(zipList(file.target)));

  result = await callTool('pdf_para_jpg', [a.id], { pages: '1', dpi: 100 });
  file = await download(result, 'page.jpg');
  check('pdf2jpg single', file.buffer[0] === 0xff && file.buffer[1] === 0xd8);

  const imgs = await upload('scan.png', 'foto.jpg');
  result = await callTool('jpg_para_pdf', imgs.map((item) => item.id), { size: 'a4', orientation: 'auto', margin: 5 });
  file = await download(result, 'images.pdf');
  check('img2pdf', await pages(file.target) === 2);

  result = await callTool('pdf_para_word', [a.id], {});
  file = await download(result, 'sample.docx');
  check('pdf2word docx', file.buffer.subarray(0, 2).toString() === 'PK');

  result = await callTool('pdf_para_excel', [a.id], {});
  file = await download(result, 'sample.xlsx');
  check('pdf2excel xlsx', file.buffer.subarray(0, 2).toString() === 'PK');

  result = await callTool('pdf_para_powerpoint', [a.id], {});
  file = await download(result, 'sample.pptx');
  check('pdf2ppt pptx', file.buffer.subarray(0, 2).toString() === 'PK');

  for (const [slug, name] of [['word_para_pdf', 'documento.docx'], ['excel_para_pdf', 'planilha.xlsx'], ['powerpoint_para_pdf', 'apresentacao.pptx']]) {
    const [office] = await upload(name);
    result = await callTool(slug, [office.id], {});
    file = await download(result, `${slug}.pdf`);
    check(`${slug} pdf`, (await pages(file.target)) >= 1);
  }

  const [scan] = await upload('scanned.pdf');
  result = await callTool('ocr-pdf', [scan.id], { lang: 'por' });
  file = await download(result, 'ocr.pdf');
  const text = execFileSync('pdftotext', [file.target, '-'], { encoding: 'utf8' });
  check('ocr searchable text', /ESCANEADO|DOCUMENTO/i.test(text), text.slice(0, 60));
  check('ocr pages', await pages(file.target) === 1);

  result = await callTool('proteger-pdf', [a.id], { password: 'teste123', allowPrinting: true, allowCopying: false, allowModifying: false, allowAnnotations: false });
  file = await download(result, 'protected.pdf');
  check('protect encrypted', /R = 6/.test(qpdf(file.target, ['--show-encryption'])));
  const [protectedFile] = await upload(file.target);
  result = await callTool('desbloquear_pdf', [protectedFile.id], { password: 'teste123' });
  file = await download(result, 'unlocked.pdf');
  check('unlock pdf', /File is not encrypted/.test(qpdf(file.target, ['--show-encryption'])));

  const signature = (await fsp.readFile(path.join(FIX, 'assinatura.png'))).toString('base64');
  result = await callTool('assinar-pdf', [a.id], { page: 1, rect: { x: 100, y: 100, width: 180, height: 60 }, signature: `data:image/png;base64,${signature}`, mode: 'draw' });
  file = await download(result, 'signed.pdf');
  check('sign pdf', await pages(file.target) === 5);

  result = await callTool('comparar-pdf', [a.id, b.id], { dpi: 72 });
  file = await download(result, 'compare.zip');
  check('compare zip', /diferenca-pagina-/.test(zipList(file.target)));
  check('compare meta', Array.isArray(result.meta.changedPages) && result.meta.changedPages.length > 0, JSON.stringify(result.meta));

  result = await callTool('pdf_para_pdfa', [a.id], {});
  file = await download(result, 'pdfa.pdf');
  check('pdfa valid', await pages(file.target) === 5);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log(failures.join('\n'));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
