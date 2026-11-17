// Minimal, dependency-free .xlsx reader.
// Supports the subset needed for ground-truth number verification:
// zip container, shared strings, inline strings, numeric cells, formulas with cached values.
// Legacy BIFF8 (.xls) is not supported and is reported as such.

import fs from 'node:fs';
import zlib from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

/** Read every entry of a zip archive into a Map<name, Buffer>. */
export function unzip(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  const min = Math.max(0, buf.length - 22 - 65536);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip container');

  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = new Map();

  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== CEN_SIG) break;
    const flags = buf.readUInt16LE(off + 8);
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);

    const lhNameLen = buf.readUInt16LE(localOff + 26);
    const lhExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lhNameLen + lhExtraLen;

    let size = compSize;
    if (flags & 0x08) {
      // Sizes live in the local header when a data descriptor is used.
      size = buf.readUInt32LE(localOff + 18);
    }
    const comp = buf.subarray(dataStart, dataStart + size);
    let data;
    if (method === 0) data = Buffer.from(comp);
    else if (method === 8) data = zlib.inflateRawSync(comp);
    else throw new Error(`unsupported zip compression method ${method}`);

    entries.set(name, data);
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function decodeXml(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

function parseSharedStrings(xml) {
  const out = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  let m;
  while ((m = siRe.exec(xml)) !== null) {
    const body = m[1] || '';
    let text = '';
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let t;
    while ((t = tRe.exec(body)) !== null) text += t[1];
    out.push(decodeXml(text));
  }
  return out;
}

/** Convert an A1 reference to a zero-based column index and 1-based row. */
export function refToRC(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(String(ref || '').toUpperCase());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(m[2]) };
}

/** Convert a zero-based column index to letters (0 -> A). */
export function colToLetters(col) {
  let n = col + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Read a workbook.
 * Returns { sheets: [{ name, cells: [{ ref, col, row, value }], rows: Map<row, cells[]> }] }.
 */
export function readWorkbook(file) {
  const entries = unzip(file);
  const shared = entries.has('xl/sharedStrings.xml')
    ? parseSharedStrings(entries.get('xl/sharedStrings.xml').toString('utf8'))
    : [];

  const workbookXml = entries.has('xl/workbook.xml')
    ? entries.get('xl/workbook.xml').toString('utf8')
    : '';
  const relsXml = entries.has('xl/_rels/workbook.xml.rels')
    ? entries.get('xl/_rels/workbook.xml.rels').toString('utf8')
    : '';

  const rels = new Map();
  const relRe = /<Relationship\b([^>]*)\/>/g;
  let rm;
  while ((rm = relRe.exec(relsXml)) !== null) {
    const attrs = rm[1];
    const id = /Id="([^"]+)"/.exec(attrs);
    const target = /Target="([^"]+)"/.exec(attrs);
    if (id && target) rels.set(id[1], target[1]);
  }

  const sheets = [];
  const sheetRe = /<sheet\b([^>]*)\/>/g;
  let sm;
  while ((sm = sheetRe.exec(workbookXml)) !== null) {
    const attrs = sm[1];
    const nameM = /name="([^"]*)"/.exec(attrs);
    const ridM = /r:id="([^"]*)"/.exec(attrs);
    const name = nameM ? decodeXml(nameM[1]) : `Sheet${sheets.length + 1}`;
    let target = ridM ? rels.get(ridM[1]) : null;
    if (!target) continue;
    target = target.replace(/^\//, '');
    if (!target.startsWith('xl/')) target = `xl/${target.replace(/^\.\//, '')}`;
    const data = entries.get(target);
    if (!data) continue;

    const xml = data.toString('utf8');
    const cells = [];
    const rows = new Map();

    const cellRe = /<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cm;
    while ((cm = cellRe.exec(xml)) !== null) {
      const attrs = cm[1] || cm[2] || '';
      const body = cm[3] || '';
      const refM = /r="([A-Z]+\d+)"/i.exec(attrs);
      if (!refM) continue;
      const ref = refM[1].toUpperCase();
      const tM = /t="([^"]+)"/.exec(attrs);
      const type = tM ? tM[1] : 'n';

      let value = '';
      if (type === 'inlineStr') {
        const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let t;
        while ((t = tRe.exec(body)) !== null) value += t[1];
        value = decodeXml(value);
      } else {
        const vM = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
        const raw = vM ? decodeXml(vM[1]) : '';
        if (type === 's') {
          const idx = Number(raw);
          value = Number.isFinite(idx) && shared[idx] !== undefined ? shared[idx] : '';
        } else if (type === 'b') {
          value = raw === '1' ? 'TRUE' : 'FALSE';
        } else if (type === 'e') {
          value = `#ERROR(${raw})`;
        } else {
          value = raw;
        }
      }
      if (value === '') continue;

      const rc = refToRC(ref);
      if (!rc) continue;
      const cell = { ref, col: rc.col, row: rc.row, value };
      cells.push(cell);
      if (!rows.has(rc.row)) rows.set(rc.row, []);
      rows.get(rc.row).push(cell);
    }
    for (const list of rows.values()) list.sort((a, b) => a.col - b.col);
    sheets.push({ name, cells, rows });
  }
  return { sheets };
}

/** Render one sheet as aligned rows with A1 coordinates. */
export function renderSheet(sheet, { maxRows = 200, grep = null } = {}) {
  const lines = [];
  const rowNumbers = [...sheet.rows.keys()].sort((a, b) => a - b);
  let shown = 0;
  for (const rowNum of rowNumbers) {
    if (shown >= maxRows) {
      lines.push(`... (truncated at ${maxRows} rows)`);
      break;
    }
    const cells = sheet.rows.get(rowNum);
    const parts = cells.map((c) => `${c.ref}=${c.value}`);
    const joined = parts.join(' | ');
    if (grep && !joined.toLowerCase().includes(String(grep).toLowerCase())) continue;
    lines.push(`${sheet.name}!${cells[0].ref.split(/\d+/)[0]}${rowNum}\t${joined}`);
    shown++;
  }
  return lines;
}
