import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import * as XLSX from 'xlsx';
import PptxGenJS from 'pptxgenjs';

export const FIXTURES_DIR = '/tmp/editor-pdf-fixtures';

async function makePdf(name, pages, label) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let index = 1; index <= pages; index += 1) {
    const page = doc.addPage([595, 842]);
    page.drawText(`${label} - Página ${index}`, { x: 60, y: 760, size: 26, font: bold, color: rgb(0.12, 0.16, 0.2) });
    page.drawText(`Este é o documento de teste ${label}.`, { x: 60, y: 710, size: 14, font });
    page.drawText(`Linha 1  Página ${index}  Valor ${index * 10}`, { x: 60, y: 660, size: 12, font });
    page.drawText(`Linha 2  Página ${index}  Valor ${index * 20}`, { x: 60, y: 640, size: 12, font });
    page.drawRectangle({ x: 60, y: 520, width: 475, height: 70, borderColor: rgb(0.9, 0.2, 0.18), borderWidth: 3, color: rgb(1, 0.94, 0.94) });
    page.drawText(`Bloco de destaque da página ${index}`, { x: 80, y: 555, size: 16, font: bold, color: rgb(0.9, 0.2, 0.18) });
  }
  await fs.writeFile(`${FIXTURES_DIR}/${name}`, await doc.save());
}

export async function makeFixtures() {
  await fs.mkdir(FIXTURES_DIR, { recursive: true });
  await makePdf('sample.pdf', 5, 'Contrato');
  await makePdf('sample2.pdf', 3, 'Anexo');

  const scanPng = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600"><rect width="100%" height="100%" fill="#ffffff"/><text x="80" y="180" font-family="Arial" font-size="58" fill="#111">DOCUMENTO ESCANEADO</text><text x="80" y="280" font-family="Arial" font-size="38" fill="#222">Texto para reconhecimento OCR</text><text x="80" y="360" font-family="Arial" font-size="34" fill="#222">Segunda linha do documento</text><text x="80" y="440" font-family="Arial" font-size="34" fill="#222">Numero 12345</text><rect x="80" y="520" width="900" height="300" fill="none" stroke="#e5322d" stroke-width="8"/></svg>`)).png().toBuffer();
  await fs.writeFile(`${FIXTURES_DIR}/scan.png`, scanPng);

  const scanPdf = await PDFDocument.create();
  const scanImage = await scanPdf.embedPng(scanPng);
  const scanPage = scanPdf.addPage([595.28, 841.89]);
  scanPage.drawImage(scanImage, { x: 0, y: 0, width: 595.28, height: 841.89 });
  await fs.writeFile(`${FIXTURES_DIR}/scanned.pdf`, await scanPdf.save());

  const photo = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="100%" height="100%" fill="#f7e9c8"/><circle cx="400" cy="300" r="180" fill="#4a90c2"/><text x="400" y="320" text-anchor="middle" font-family="Arial" font-size="70" fill="#ffffff">IMAGEM 2</text></svg>`)).jpeg({ quality: 90 }).toBuffer();
  await fs.writeFile(`${FIXTURES_DIR}/foto.jpg`, photo);

  const word = new Document({ sections: [{ children: [
    new Paragraph({ children: [new TextRun({ text: 'Documento Word de teste', bold: true, size: 32 })] }),
    new Paragraph({ children: [new TextRun({ text: 'Parágrafo de exemplo para conversão em PDF.' })] }),
  ] }] });
  await fs.writeFile(`${FIXTURES_DIR}/documento.docx`, await Packer.toBuffer(word));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Nome', 'Valor'], ['Produto A', 120], ['Produto B', 340]]), 'Planilha1');
  await fs.writeFile(`${FIXTURES_DIR}/planilha.xlsx`, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'T', width: 10, height: 7.5 });
  pptx.layout = 'T';
  const slide = pptx.addSlide();
  slide.addText('Apresentação de teste', { x: 0.6, y: 2.2, w: 8.8, h: 1.2, fontSize: 32, bold: true });
  await fs.writeFile(`${FIXTURES_DIR}/apresentacao.pptx`, await pptx.write({ outputType: 'nodebuffer' }));

  const signature = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="140"><path d="M20 100 C80 20, 120 130, 180 60 S300 20, 380 90" fill="none" stroke="#17202a" stroke-width="7" stroke-linecap="round"/></svg>`)).png().toBuffer();
  await fs.writeFile(`${FIXTURES_DIR}/assinatura.png`, signature);
  return FIXTURES_DIR;
}
