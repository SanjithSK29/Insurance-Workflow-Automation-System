// Dependency-free PDF 1.4 writer for text documents (policy schedules,
// invoices, settlement letters, reports). A4, Helvetica, automatic paging.

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 50;

const clean = (s) =>
  String(s ?? '')
    .replace(/₹/g, 'INR ')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');

// lines: strings or { text, size, bold, gap, rule }
function buildPdf({ title = 'Document', lines = [] }) {
  const pages = [];
  let ops = [];
  let y = PAGE_H - MARGIN;

  const newPage = () => {
    if (ops.length) pages.push(ops.join('\n'));
    ops = [];
    y = PAGE_H - MARGIN;
  };

  for (const raw of lines) {
    const line = typeof raw === 'string' ? { text: raw } : raw;
    const size = line.size || 10;
    const lead = size + 4 + (line.gap || 0);
    if (y - lead < MARGIN) newPage();
    y -= lead;
    if (line.rule) {
      ops.push(`0.6 w ${MARGIN} ${y + size / 2} m ${PAGE_W - MARGIN} ${y + size / 2} l S`);
      continue;
    }
    // Wrap long lines at ~ (usable width / avg glyph width).
    const maxChars = Math.floor((PAGE_W - 2 * MARGIN) / (size * 0.5));
    const chunks = [];
    let rest = String(line.text ?? '');
    while (rest.length > maxChars) {
      let cut = rest.lastIndexOf(' ', maxChars);
      if (cut <= 0) cut = maxChars;
      chunks.push(rest.slice(0, cut));
      rest = rest.slice(cut).trimStart();
    }
    chunks.push(rest);
    chunks.forEach((chunk, i) => {
      if (i > 0) {
        if (y - lead < MARGIN) newPage();
        y -= size + 4;
      }
      ops.push(`BT /${line.bold ? 'F2' : 'F1'} ${size} Tf ${MARGIN} ${y} Td (${clean(chunk)}) Tj ET`);
    });
  }
  newPage();
  if (!pages.length) pages.push('');

  // Objects: 1 catalog, 2 pages, 3 F1, 4 F2, 5 info, then (page, content) pairs.
  const objects = [];
  const pageIds = pages.map((_, i) => 6 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objects[5] = `<< /Title (${clean(title)}) /Producer (IWAS Document Service) >>`;
  pages.forEach((content, i) => {
    const pageId = pageIds[i];
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`;
  });

  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out, 'latin1');
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

module.exports = { buildPdf };
