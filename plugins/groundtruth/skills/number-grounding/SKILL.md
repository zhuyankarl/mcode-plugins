---
name: number-grounding
description: Trace every number back to the actual spreadsheet cell, code line, or command output it came from. Use whenever a task involves 数值/统计/表格/配置取值/配平校验, reading Excel or CSV data, or when a number appears in a report, plan, or comparison.
---

# Number Grounding

A number without a coordinate is a guess with a decimal point. Every figure that
reaches the user must be traceable to one exact location.

## The four steps

1. **Locate the real file.** Never trust a remembered table name. Search the
   filesystem and use the name that actually exists.
2. **Read the real content.** Read the file, do not recall what such a table usually
   contains.
3. **Extract the value with its coordinate.** Keep the sheet, row and column.
4. **Cite it.** `表名!Sheet!单元格 = 值`, alongside the raw value in the reply.

## Tooling

The Plugin ships a dependency-free reader:

```bash
# 1. find the real table (never guess the name)
node "${PLUGIN_ROOT}/scripts/probe-table.mjs" find 安全红线 --root J:/AOEM-X

# 2. list sheets
node "${PLUGIN_ROOT}/scripts/probe-table.mjs" sheets "J:/AOEM-X/common/excel/xls/Main/A_安全红线.xlsx"

# 3. dump rows with coordinates
node "${PLUGIN_ROOT}/scripts/probe-table.mjs" dump "J:/AOEM-X/.../A_安全红线.xlsx" --sheet Sheet1 --max-rows 60

# 4. read one exact cell
node "${PLUGIN_ROOT}/scripts/probe-table.mjs" cell "J:/AOEM-X/.../A_安全红线.xlsx" Sheet1 C7

# 5. find a keyword inside cells
node "${PLUGIN_ROOT}/scripts/probe-table.mjs" search "J:/AOEM-X/.../A_安全红线.xlsx" 钻石
```

If `probe-table.mjs` is not on PATH, read the `.xlsx` with the `xlsx` Skill instead —
but keep the coordinate discipline either way.

## Hard rules

- A number you did not read in this session is 未验证, even if you are certain.
- Never average, interpolate or round a source number without saying so.
- Never carry a number over from a similar-sounding table, an older version, or a
  previous task. Re-read it.
- If a table cannot be found or read, say "无法验证" and give the path that would
  settle it. Do not substitute an estimate.
- When a total is computed, show the formula and the cells it sums. A stated total
  with no derivation is unverifiable.

## Traps in real spreadsheets

- `~$xxx.xlsx` files are Excel lock files, not data. Skip them.
- A cell may hold a formula whose cached value is stale. If a value looks wrong
  against its neighbours, check whether it is a formula and say which.
- Dates are often serial numbers; check the cell format before quoting a date.
- The same column label can exist in several sheets with different meanings. Always
  name the sheet.
- The header may not be on row 1; confirm what a row means before counting rows.
- The table may be in the project's `common/excel/xls/` folder while the file
  extension is `.xlsx` — judge by content, not by folder name.
- Legacy `.xls` (BIFF) is not readable by the bundled probe. Convert it, or use the
  `xlsx` Skill, and say which path you took.

## Reporting format

```
【已验证】二级文明 3 级解锁消耗 = 500
  证据：A_文明等级.xlsx!Sheet1!C12 = 500（行标题「3级」，列标题「解锁消耗」）

【未验证】全表钻石产出合计
  缺证：另 6 张产出表未逐一回源；核实路径：对 common/excel/xls/Main 下 7 张含「产出」的表执行 cell 取值后求和
```

Never merge the two states into one paragraph. The reader must be able to see which
numbers were checked and which were not.
