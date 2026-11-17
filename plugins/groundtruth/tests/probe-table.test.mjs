// Regression tests for the spreadsheet probe.
//
// These cover the two defects that got the marketplace submission rejected:
//
//   1. probe-table.mjs read only the first column of a CSV, so a value in any
//      other column was invisible to `cell` and `search` — the probe reported
//      "查无此值" for data that was really there.
//   2. lib/xlsx.mjs trusted the sizes in the zip local header. A zip written
//      with a data descriptor (general purpose flag 0x08) stores zeros there,
//      so every payload came back empty and the workbook could not be parsed.
//
// Run: node --test plugins/groundtruth/tests/

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const probe = path.join(here, '..', 'scripts', 'probe-table.mjs');

/** Run the probe and return its stdout, trimmed. */
function run(...args) {
  return execFileSync(process.execPath, [probe, ...args], { encoding: 'utf8' }).trim();
}

/** Run the probe and return the failure it printed. */
function runFail(...args) {
  assert.throws(() => run(...args));
  try {
    run(...args);
    throw new Error('expected the probe to fail');
  } catch (error) {
    return String(error.stderr || error.message);
  }
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'probe-table-test-'));
}

// --- a zip writer, so the tests can build the exact archives they need ------

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

/**
 * Build a zip archive.
 *
 * `stream: true` reproduces a data-descriptor archive: the local header
 * stores zero sizes, the real sizes follow the payload in a data descriptor,
 * and only the central directory carries the true sizes.
 */
function buildZip(files, { stream = false } = {}) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const payload = zlib.deflateRawSync(file.data);
    const crc = crc32(file.data);
    const flags = stream ? 0x08 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(stream ? 0 : crc, 14);
    local.writeUInt32LE(stream ? 0 : payload.length, 18);
    local.writeUInt32LE(stream ? 0 : file.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, payload);

    if (stream) {
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(payload.length, 8);
      descriptor.writeUInt32LE(file.data.length, 12);
      chunks.push(descriptor);
    }

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(flags, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(0, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(payload.length, 20);
    entry.writeUInt32LE(file.data.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt16LE(0, 30);
    entry.writeUInt16LE(0, 32);
    entry.writeUInt16LE(0, 34);
    entry.writeUInt16LE(0, 36);
    entry.writeUInt32LE(0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBuf);

    offset += 30 + nameBuf.length + payload.length + (stream ? 16 : 0);
  }

  const directory = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, directory, eocd]);
}

/** The smallest workbook the probe can read. */
function xlsxFiles(sheetRows) {
  const rows = sheetRows
    .map(
      (row, index) =>
        `<row r="${index + 1}">${row
          .map((value, col) => {
            const ref = `${String.fromCharCode(65 + col)}${index + 1}`;
            if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
            return `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
          })
          .join('')}</row>`
    )
    .join('');
  return [
    {
      name: '[Content_Types].xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
        'utf8'
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
        'utf8'
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '</Relationships>',
        'utf8'
      ),
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
          `<sheetData>${rows}</sheetData></worksheet>`,
        'utf8'
      ),
    },
  ];
}

// --- CSV --------------------------------------------------------------------

test('CSV: a value in a column other than the first is readable', () => {
  const dir = tempDir();
  const file = path.join(dir, '产出表.csv');
  fs.writeFileSync(file, '名称,等级,数量\n产品甲,3,1200\n产品乙,2,340\n', 'utf8');

  assert.match(run('cell', file, 'C2'), /产出表\.csv!产出表!C2 = 1200/);
  assert.match(run('cell', file, 'B3'), /产出表\.csv!产出表!B3 = 2/);
});

test('CSV: search finds a value that only exists outside the first column', () => {
  const dir = tempDir();
  const file = path.join(dir, '产出表.csv');
  fs.writeFileSync(file, '名称,等级,数量\n产品甲,3,1200\n产品乙,2,340\n', 'utf8');

  const out = run('search', file, '1200');
  assert.match(out, /产出表\.csv!产出表!C2 = 1200/);
  assert.doesNotMatch(out, /no cell/);
});

test('CSV: search reports a miss honestly instead of silently dropping columns', () => {
  const dir = tempDir();
  const file = path.join(dir, '产出表.csv');
  fs.writeFileSync(file, '名称,等级,数量\n产品甲,3,1200\n', 'utf8');

  assert.match(run('search', file, '不存在的东西'), /no cell in .* contains "不存在的东西"/);
});

test('CSV: dump shows every column of a row', () => {
  const dir = tempDir();
  const file = path.join(dir, '产出表.csv');
  fs.writeFileSync(file, '名称,等级,数量\n产品甲,3,1200\n', 'utf8');

  const out = run('dump', file);
  assert.match(out, /A1=名称 \| B1=等级 \| C1=数量/);
  assert.match(out, /A2=产品甲 \| B2=3 \| C2=1200/);
});

test('CSV: quoted fields keep commas, doubled quotes and line breaks', () => {
  const dir = tempDir();
  const file = path.join(dir, '备注.csv');
  fs.writeFileSync(
    file,
    '名称,备注\n"含,逗号","他说了""你好"""\n"跨行","第一行\n第二行"\n',
    'utf8'
  );

  assert.match(run('cell', file, 'B2'), /备注\.csv!备注!B2 = 他说了"你好"/);
  assert.match(run('cell', file, 'B3'), /备注\.csv!备注!B3 = 第一行\n第二行/);
});

test('CSV: a UTF-8 BOM does not leak into the first cell', () => {
  const dir = tempDir();
  const file = path.join(dir, '带BOM.csv');
  fs.writeFileSync(file, '﻿名称,数量\n产品甲,1200\n', 'utf8');

  assert.match(run('cell', file, 'A2'), /带BOM\.csv!带BOM!A2 = 产品甲/);
});

test('CSV: sheets reports one sheet named after the file', () => {
  const dir = tempDir();
  const file = path.join(dir, '产出表.csv');
  fs.writeFileSync(file, 'a,b\n1,2\n', 'utf8');

  assert.match(run('sheets', file), /# 产出表\.csv: 1 sheet\(s\)/);
});

// --- xlsx -------------------------------------------------------------------

test('xlsx: a workbook stored with a zip data descriptor is readable', () => {
  const dir = tempDir();
  const file = path.join(dir, '数据.xlsx');
  fs.writeFileSync(file, buildZip(xlsxFiles([['指标', '数值'], ['产品甲', 1200]]), { stream: true }));

  assert.match(run('sheets', file), /# 数据\.xlsx: 1 sheet\(s\)/);
  assert.match(run('cell', file, 'Sheet1', 'B2'), /数据\.xlsx!Sheet1!B2 = 1200/);
  assert.match(run('search', file, '产品甲'), /数据\.xlsx!Sheet1!A2 = 产品甲/);
});

test('xlsx: a normal workbook without a data descriptor still works', () => {
  const dir = tempDir();
  const file = path.join(dir, '常规.xlsx');
  fs.writeFileSync(file, buildZip(xlsxFiles([['指标', '数值'], ['产品甲', 1200]]), { stream: false }));

  assert.match(run('cell', file, 'Sheet1', 'B2'), /常规\.xlsx!Sheet1!B2 = 1200/);
});

test('xlsx: a missing sheet is reported with the names that do exist', () => {
  const dir = tempDir();
  const file = path.join(dir, '数据.xlsx');
  fs.writeFileSync(file, buildZip(xlsxFiles([['指标', '数值']]), { stream: false }));

  const stderr = runFail('cell', file, 'Nope', 'A1');
  assert.match(stderr, /sheet "Nope" not found/);
  assert.match(stderr, /available: Sheet1/);
});

// --- legacy .xls ------------------------------------------------------------

test('legacy .xls is refused with a clear message', () => {
  const dir = tempDir();
  const file = path.join(dir, '旧表.xls');
  fs.writeFileSync(file, 'not really a spreadsheet', 'utf8');

  assert.match(runFail('cell', file, 'Sheet1', 'A1'), /legacy \.xls \(BIFF\) is not supported/);
});
