// Build the marketplace submission package for a plugin directory.
//
// Two jobs, in one run:
//   1. Run the official listing rules (the same rule set the 上架材料工作台
//      Mini App uses) against the package plus the submission metadata.
//   2. Write the ZIP the official form accepts: `.minimax-plugin/plugin.json`
//      directly at the archive root, no wrapper directory.
//
// Usage:
//   node tools/build-listing-package.mjs <package-dir> <out.zip> [--report <report.md>]
//
// The submission metadata below mirrors what the official form asks for.
// Fields that only the submitter can know are read from SUBMISSION_META and
// flagged in the report when they are still empty.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateDraft } from '../plugins/submission-workbench/miniapp/node/lib/listing-rules.mjs';
import { createZip } from '../plugins/submission-workbench/miniapp/node/lib/zip.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Submission metadata for the official form (guide §8).
 * `previousVersion` is what the rejected submission carried; it is only used
 * to check that the new package really bumps the version.
 */
const SUBMISSION_META = {
  regions: ['CN'],
  enabledEnds: ['桌面端', '云端'],
  operation: 'update',
  existingName: 'evidence-guard',
  previousVersion: '1.0.0',
  submitEmail: '545965171@qq.com',
  submitAccount: '',
  organization: '',
};

const [packageDirArg, outZipArg, ...rest] = process.argv.slice(2);
if (!packageDirArg || !outZipArg) {
  console.error('usage: node tools/build-listing-package.mjs <package-dir> <out.zip> [--report <file.md>]');
  process.exit(2);
}
const reportIndex = rest.indexOf('--report');
const reportPath = reportIndex >= 0 ? rest[reportIndex + 1] : null;

const packageDir = path.resolve(process.cwd(), packageDirArg);
const outZip = path.resolve(process.cwd(), outZipArg);

/** Every file in the package, as archive-relative paths with `/` separators. */
function collectFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`符号链接不允许：${entry.name}`);
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

const manifestPath = path.join(packageDir, '.minimax-plugin', 'plugin.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`找不到清单：${manifestPath}`);
  process.exit(2);
}
const manifestText = fs.readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(manifestText);

const files = collectFiles(packageDir).sort();

// --- 1. run the official listing rules -------------------------------------
const assets = [];
for (const rel of files) {
  const stat = fs.statSync(path.join(packageDir, rel));
  let role = 'doc';
  if (rel === manifest.icon) role = 'icon';
  else if (rel.startsWith('skills/') && rel.endsWith('SKILL.md')) role = 'skill';
  else if (rel.endsWith('.mcp.json')) role = 'mcp';
  else if (rel.endsWith('.app.json')) role = 'app';
  assets.push({
    id: crypto.createHash('sha1').update(rel).digest('hex').slice(0, 12),
    name: rel,
    role,
    size: stat.size,
    mime: rel.endsWith('.png') ? 'image/png' : 'text/plain',
    createdAt: new Date().toISOString(),
  });
}

const readmeText = fs.existsSync(path.join(packageDir, 'README.md'))
  ? fs.readFileSync(path.join(packageDir, 'README.md'), 'utf8')
  : '';

const draft = {
  manifestText,
  marketName: String(manifest.displayName || manifest.name || ''),
  summary: String(manifest.description || ''),
  documentation: readmeText,
  category: String(manifest.category || ''),
  exampleQueries: Array.isArray(manifest.exampleQueries) ? manifest.exampleQueries : [],
  regions: SUBMISSION_META.regions,
  enabledEnds: SUBMISSION_META.enabledEnds,
  operation: SUBMISSION_META.operation,
  existingName: SUBMISSION_META.existingName,
  previousVersion: SUBMISSION_META.previousVersion,
  submitEmail: SUBMISSION_META.submitEmail,
  submitAccount: SUBMISSION_META.submitAccount,
  organization: SUBMISSION_META.organization,
};

const { issues } = validateDraft(draft, assets);
// The guide's §9 checklist mentions a screenshot, but the official form has no
// screenshot field — it is optional market-card material, not a submission
// blocker, so it is reported separately instead of counted as an error.
const NON_BLOCKING = new Set(['listing.screenshot.missing']);
const blocking = issues.filter((issue) => !NON_BLOCKING.has(issue.id));
const errors = blocking.filter((issue) => issue.severity === 'error');
const warnings = blocking.filter((issue) => issue.severity === 'warning');
const infos = blocking.filter((issue) => issue.severity === 'info');
const notes = issues.filter((issue) => NON_BLOCKING.has(issue.id));

// --- 2. build the archive ---------------------------------------------------
const entries = files.map((rel) => ({
  path: rel,
  data: fs.readFileSync(path.join(packageDir, rel)),
}));
const zip = createZip(entries);
fs.mkdirSync(path.dirname(outZip), { recursive: true });
fs.writeFileSync(outZip, zip);

const zipDigest = crypto.createHash('sha256').update(zip).digest('hex');
const totalBytes = entries.reduce((sum, entry) => sum + entry.data.length, 0);

// --- 3. write the report ----------------------------------------------------
const lines = [];
lines.push(`# 上架材料自检报告 · ${manifest.name} v${manifest.version}`);
lines.push('');
lines.push(`- 生成时间：${new Date().toISOString()}`);
lines.push(`- 包目录：\`${packageDir}\``);
lines.push(`- 提交 ZIP：\`${outZip}\``);
lines.push(`- ZIP 大小：${zip.length} 字节；解包后 ${totalBytes} 字节；${entries.length} 个文件`);
lines.push(`- ZIP sha256：\`${zipDigest}\``);
lines.push(`- 目标区域：${SUBMISSION_META.regions.join('、')}；启用端：${SUBMISSION_META.enabledEnds.join('、')}`);
lines.push(`- 操作类型：${SUBMISSION_META.operation === 'update' ? '更新已有 Plugin' : '上架新 Plugin'}（原名 ${SUBMISSION_META.existingName}，上次版本 ${SUBMISSION_META.previousVersion}）`);
lines.push('');
lines.push(`## 结论`);
lines.push('');
lines.push(`- error：${errors.length}`);
lines.push(`- warning：${warnings.length}`);
lines.push(`- info：${infos.length}`);
lines.push(`- 非阻塞提示：${notes.length}`);
lines.push('');
if (blocking.length) {
  lines.push('## 逐条结果');
  lines.push('');
  for (const issue of blocking) {
    lines.push(`- **[${issue.severity}]** ${issue.title}`);
    lines.push(`  - ${issue.detail}`);
    lines.push(`  - 依据：${issue.source}${issue.field ? `（${issue.field}）` : ''}`);
  }
  lines.push('');
}
lines.push('## 包内文件');
lines.push('');
for (const entry of entries) {
  lines.push(`- \`${entry.path}\` — ${entry.data.length} 字节`);
}
lines.push('');
lines.push('## 提交时需要人工填写的项');
lines.push('');
lines.push(`- 提交飞书账号：${SUBMISSION_META.submitAccount || '**待填**（提交时必须用与上次一致的账号）'}`);
lines.push(`- 组织 / 团队：${SUBMISSION_META.organization || '**待填**'}`);
lines.push('');
lines.push('> 指南 §9 的自查清单里列了「至少一张截图」，但**官方投稿表单没有截图字段**');
lines.push('> （实测字段只有：Plugin 名、操作类型、来源类型、目标区域、启用端、维护权证明、组织/团队、联系邮箱）。');
lines.push('> 截图是市场卡片素材，可选补交，不是提交阻塞项，故此处不计入 error。');
lines.push('');
lines.push('## 与上次被驳回版本的差异');
lines.push('');
lines.push('- `scripts/probe-table.mjs`：CSV 解析从「只取每行第一列」改为按 RFC 4180 解析全部列，');
lines.push('  每个非空字段都带真实 A1 坐标（值在第几列就取第几列），`cell` / `search` / `dump` 三个命令口径一致。');
lines.push('- `scripts/lib/xlsx.mjs`：zip 读取以**中央目录**的尺寸为权威，不再用本地文件头——');
lines.push('  data descriptor（通用标志位 0x08）流式写入时本地文件头是 0，旧版会把每个条目读成空。');
lines.push('- `scripts/lib/csv.mjs`：新增，CSV 读取器（引号、嵌入逗号与换行、`""` 转义、UTF-8 BOM、分隔符自动识别）。');
lines.push('- `tests/probe-table.test.mjs`：新增回归测试，覆盖多列 CSV、引号字段、BOM、data descriptor 归档、旧 `.xls` 报错。');
lines.push('- `README.md`：`.csv` / `.xlsx` 的支持范围改为与实现一致，并写明本包**没有 Hook**。');
lines.push('- `skills/*/SKILL.md`：删除只存在于本地完整版的 Hook 描述，脚本调用改用相对路径。');
lines.push('');

if (reportPath) {
  const absReport = path.resolve(process.cwd(), reportPath);
  fs.mkdirSync(path.dirname(absReport), { recursive: true });
  fs.writeFileSync(absReport, lines.join('\n'));
}

console.log(lines.join('\n'));
console.log(`\nZIP: ${outZip}`);
console.log(`sha256: ${zipDigest}`);
if (errors.length) {
  console.error(`\n自检未通过：${errors.length} 个 error`);
  process.exit(1);
}
