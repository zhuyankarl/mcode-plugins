#!/usr/bin/env node
// probe-table.mjs — locate and read real spreadsheet values so numeric claims
// can cite an exact cell instead of being guessed.
//
// Usage:
//   node probe-table.mjs find <keyword> [--root <dir>] [--limit <n>]
//   node probe-table.mjs sheets <file>
//   node probe-table.mjs dump <file> [--sheet <name>] [--max-rows <n>] [--grep <kw>] [--delimiter <c>]
//   node probe-table.mjs cell <file> <sheet> <ref>
//   node probe-table.mjs cell <file.csv> <ref>            (single-sheet CSV)
//   node probe-table.mjs search <file> <keyword> [--sheet <name>] [--limit <n>]
//
// Every printed value carries its coordinate, e.g.  A_产量明细.xlsx!Sheet1!C7 = 1200
import fs from 'node:fs';
import path from 'node:path';
import { readWorkbook, renderSheet, colToLetters } from './lib/xlsx.mjs';
import { readCsvSheet } from './lib/csv.mjs';

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

function listTables(root, keyword, limit) {
  const out = [];
  const needle = String(keyword || '').toLowerCase();
  const walk = (dir, depth) => {
    if (depth > 6 || out.length >= limit) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'Library') continue;
        walk(full, depth + 1);
      } else if (entry.isFile()) {
        if (entry.name.startsWith('~$')) continue;
        if (!/\.(xlsx|xls|csv)$/i.test(entry.name)) continue;
        const rel = path.relative(root, full);
        if (!needle || rel.toLowerCase().includes(needle)) out.push(rel);
      }
    }
  };
  walk(root, 0);
  out.sort();
  return out;
}

/**
 * Resolve a requested sheet name against the sheets a file actually has.
 * The exact name wins; a case difference or a `.csv` suffix is tolerated so
 * `cell data.csv data B2` and `cell data.csv data.csv B2` both work.
 */
function pickSheet(book, wanted) {
  if (wanted === undefined || wanted === null || wanted === '') return null;
  const target = String(wanted).trim();
  const lower = target.toLowerCase();
  return (
    book.sheets.find((s) => s.name === target) ||
    book.sheets.find((s) => s.name.toLowerCase() === lower) ||
    book.sheets.find((s) => s.name.toLowerCase().replace(/\.csv$/, '') === lower.replace(/\.csv$/, '')) ||
    null
  );
}

function load(file, delimiter) {
  if (/\.xls$/i.test(file)) {
    throw new Error('legacy .xls (BIFF) is not supported by this probe; convert to .xlsx or use the xlsx skill');
  }
  if (/\.csv$/i.test(file)) {
    return readCsvSheet(file, { delimiter });
  }
  return readWorkbook(file);
}

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const cmd = positional[0];

  if (!cmd) {
    process.stderr.write('probe-table.mjs: missing command (find|sheets|dump|cell|search)\n');
    process.exit(2);
  }

  if (cmd === 'find') {
    const keyword = positional[1] || '';
    const root = path.resolve(String(flags.root || process.cwd()));
    const limit = Number(flags.limit || 60);
    const files = listTables(root, keyword, limit);
    if (!files.length) {
      process.stdout.write(`no table matched "${keyword}" under ${root}\n`);
      return;
    }
    process.stdout.write(`# ${files.length} match(es) under ${root}\n`);
    for (const f of files) process.stdout.write(`${f}\n`);
    return;
  }

  const file = positional[1];
  if (!file) {
    process.stderr.write('probe-table.mjs: missing file argument\n');
    process.exit(2);
  }
  if (!fs.existsSync(file)) {
    process.stderr.write(`probe-table.mjs: file not found: ${file}\n`);
    process.exit(2);
  }

  const book = load(file, flags.delimiter ? String(flags.delimiter) : undefined);
  const base = path.basename(file);

  if (cmd === 'sheets') {
    process.stdout.write(`# ${base}: ${book.sheets.length} sheet(s)\n`);
    for (const s of book.sheets) process.stdout.write(`${s.name}\t${s.cells.length} cells\n`);
    return;
  }

  if (cmd === 'dump') {
    const wanted = flags.sheet ? String(flags.sheet) : null;
    const maxRows = Number(flags.maxrows || flags['max-rows'] || 200);
    const grep = flags.grep ? String(flags.grep) : null;
    let sheets = book.sheets;
    if (wanted) {
      const picked = pickSheet(book, wanted);
      if (!picked) {
        process.stderr.write(
          `probe-table.mjs: sheet "${wanted}" not found in ${base} (available: ${book.sheets.map((s) => s.name).join(', ')})\n`
        );
        process.exit(2);
      }
      sheets = [picked];
    }
    process.stdout.write(`# ${base}\n`);
    for (const s of sheets) {
      const lines = renderSheet(s, { maxRows, grep });
      if (!lines.length) continue;
      process.stdout.write(`## sheet: ${s.name}\n`);
      for (const line of lines) process.stdout.write(`${line}\n`);
    }
    return;
  }

  if (cmd === 'cell') {
    // `cell <file> <sheet> <ref>` for multi-sheet workbooks,
    // `cell <file> <ref>` for a file with a single sheet (any .csv).
    const hasSheetArg = positional.length >= 4;
    const sheetName = hasSheetArg ? positional[2] : null;
    const ref = String((hasSheetArg ? positional[3] : positional[2]) || '').toUpperCase();
    if (!ref) {
      process.stderr.write('probe-table.mjs: missing cell reference\n');
      process.exit(2);
    }
    let sheet = null;
    if (sheetName) {
      sheet = pickSheet(book, sheetName);
      if (!sheet) {
        process.stderr.write(
          `probe-table.mjs: sheet "${sheetName}" not found in ${base} (available: ${book.sheets.map((s) => s.name).join(', ')})\n`
        );
        process.exit(2);
      }
    } else if (book.sheets.length === 1) {
      sheet = book.sheets[0];
    } else {
      process.stderr.write(
        `probe-table.mjs: ${base} has ${book.sheets.length} sheets, name one of: ${book.sheets.map((s) => s.name).join(', ')}\n`
      );
      process.exit(2);
    }
    const cell = sheet.cells.find((c) => c.ref === ref);
    if (!cell) {
      process.stderr.write(`probe-table.mjs: cell ${sheet.name}!${ref} is empty or missing in ${base}\n`);
      process.exit(2);
    }
    process.stdout.write(`${base}!${sheet.name}!${cell.ref} = ${cell.value}\n`);
    return;
  }

  if (cmd === 'search') {
    const keyword = String(positional[2] || '').toLowerCase();
    const limit = Number(flags.limit || 60);
    const wanted = flags.sheet ? String(flags.sheet) : null;
    let sheets = book.sheets;
    if (wanted) {
      const picked = pickSheet(book, wanted);
      if (!picked) {
        process.stderr.write(
          `probe-table.mjs: sheet "${wanted}" not found in ${base} (available: ${book.sheets.map((s) => s.name).join(', ')})\n`
        );
        process.exit(2);
      }
      sheets = [picked];
    }
    let hits = 0;
    for (const s of sheets) {
      for (const c of s.cells) {
        if (!String(c.value).toLowerCase().includes(keyword)) continue;
        process.stdout.write(`${base}!${s.name}!${c.ref} = ${c.value}\n`);
        hits++;
        if (hits >= limit) return;
      }
    }
    if (!hits) process.stdout.write(`no cell in ${base} contains "${keyword}"\n`);
    return;
  }

  process.stderr.write(`probe-table.mjs: unknown command "${cmd}"\n`);
  process.exit(2);
}

try {
  main();
} catch (err) {
  process.stderr.write(`probe-table.mjs: ${err && err.message ? err.message : String(err)}\n`);
  process.exit(2);
}
