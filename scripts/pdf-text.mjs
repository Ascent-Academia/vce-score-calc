// Extracts the text items of a PDF, in content-stream order, one string per item.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFile } from 'node:fs/promises';

export async function pdfItems(path) {
  const data = new Uint8Array(await readFile(path));
  const doc = await getDocument({ data, verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((it) => it.str).map((s) => s.trim()).filter(Boolean));
  }
  await doc.cleanup?.();
  return pages;
}

// Rebuilds visual rows from item positions (content-stream order is not reliable
// in some VTAC reports). Returns pages -> rows -> cell strings, left to right.
// Items closer than `gap` points horizontally are merged into one cell.
export async function pdfRows(path, { gap = 1.5, tolerance = 2 } = {}) {
  const data = new Uint8Array(await readFile(path));
  const doc = await getDocument({ data, verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items = content.items
      .filter((it) => it.str.trim())
      .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    for (const it of items) {
      const row = rows.find((r) => Math.abs(r.y - it.y) <= tolerance);
      if (row) row.items.push(it);
      else rows.push({ y: it.y, items: [it] });
    }
    rows.sort((a, b) => b.y - a.y);
    pages.push(
      rows.map((r) => {
        const cells = [];
        let last = null;
        for (const it of r.items.sort((a, b) => a.x - b.x)) {
          if (last && it.x - (last.x + last.w) < gap) {
            last.str += it.str;
            last.w = it.x + it.w - last.x;
          } else {
            last = { ...it };
            cells.push(last);
          }
        }
        return cells.map((c) => c.str.trim()).filter(Boolean);
      }),
    );
  }
  await doc.cleanup?.();
  return pages;
}
