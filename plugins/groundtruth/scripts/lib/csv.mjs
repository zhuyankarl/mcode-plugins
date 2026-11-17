// Dependency-free CSV reader that produces the same cell model as the xlsx
// reader, so `cell` / `search` / `dump` behave identically for both formats.
//
// The CSV rules follow RFC 4180:
//   - fields are separated by a delimiter (default `,`)
//   - a field may be wrapped in double quotes
//   - inside a quoted field, a delimiter or a line break is literal
//   - a doubled quote inside a quoted field is one literal quote
//   - a trailing line break does not create an extra empty row
//
// Every non-empty field becomes a cell with a real A1 coordinate, so a value
// in column D is addressable as D7 instead of being silently dropped.

import fs from 'node:fs';
import path from 'node:path';
import { colToLetters } from './xlsx.mjs';

/** Delimiters tried when the caller does not pin one explicitly. */
const CANDIDATE_DELIMITERS = [',', ';', '\t'];

/**
 * Pick the delimiter that actually separates the fields.
 *
 * Only characters outside quoted regions count, so a comma inside a quoted
 * text does not outvote the real delimiter. A file with no delimiter at all
 * falls back to `,`.
 *
 * @param {string} text
 * @returns {string}
 */
export function detectDelimiter(text) {
  const counts = new Map(CANDIDATE_DELIMITERS.map((d) => [d, 0]));
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (counts.has(ch)) counts.set(ch, counts.get(ch) + 1);
  }
  let best = ',';
  let bestCount = 0;
  for (const [delimiter, count] of counts) {
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Parse CSV text into an array of rows of raw string fields.
 *
 * @param {string} text
 * @param {string} [delimiter]
 * @returns {string[][]}
 */
export function parseCsv(text, delimiter = ',') {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let touched = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      // A quote only opens a quoted field at the start of a field; elsewhere
      // it is literal data.
      if (field === '') {
        inQuotes = true;
        touched = true;
      } else {
        field += ch;
      }
      i++;
      continue;
    }

    if (ch === delimiter) {
      row.push(field);
      field = '';
      touched = true;
      i++;
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      touched = false;
      i++;
      continue;
    }

    field += ch;
    touched = true;
    i++;
  }

  if (touched || row.length > 0 || field !== '') {
    row.push(field);
    rows.push(row);
  }

  // Drop trailing blank rows produced by trailing newlines.
  while (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last.some((value) => value !== '')) break;
    rows.pop();
  }
  return rows;
}

/**
 * Read a CSV file into the shared sheet model.
 *
 * Empty fields are omitted, exactly like the xlsx reader omits empty cells,
 * so `cell` reports "empty or missing" for both formats.
 *
 * @param {string} file
 * @param {{ delimiter?: string }} [options]
 * @returns {{ sheets: { name: string, cells: { ref: string, col: number, row: number, value: string }[], rows: Map<number, any[]> }[] }}
 */
export function readCsvSheet(file, options = {}) {
  const raw = fs.readFileSync(file);
  let text = raw.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const delimiter = options.delimiter || detectDelimiter(text);
  const rows = parseCsv(text, delimiter);

  const name = path.basename(file).replace(/\.csv$/i, '');
  const cells = [];
  const byRow = new Map();

  rows.forEach((fields, rowIndex) => {
    const rowNumber = rowIndex + 1;
    fields.forEach((value, colIndex) => {
      if (value === '') return;
      const cell = {
        ref: `${colToLetters(colIndex)}${rowNumber}`,
        col: colIndex,
        row: rowNumber,
        value,
      };
      cells.push(cell);
      if (!byRow.has(rowNumber)) byRow.set(rowNumber, []);
      byRow.get(rowNumber).push(cell);
    });
  });

  for (const list of byRow.values()) list.sort((a, b) => a.col - b.col);

  return { sheets: [{ name, cells, rows: byRow }] };
}
