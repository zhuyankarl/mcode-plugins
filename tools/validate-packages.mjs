// Package validator for the plugins in this repository.
//
// Checks every plugin package against the MiniMax Plugin V1 rules that matter
// for a package to install cleanly on another machine:
//   - all JSON parses (no BOM, no comments, no trailing commas)
//   - manifest required fields, SemVer, name/format, category, example queries
//   - every file referenced by the manifest exists inside the package
//   - the package directory name matches manifest.name
//   - hook documents use supported events, synchronous command handlers only,
//     timeouts in range, and reference scripts that exist
//   - Mini App declarations point at payloads and a runtime entry that exist
//   - no absolute paths, no home-relative paths, no symlinks, no node_modules
//   - no credential-looking strings
//
// Usage: node tools/validate-packages.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginsRoot = path.join(repoRoot, 'plugins');

const problems = [];
const notes = [];
const fail = (msg) => problems.push(msg);
const ok = (msg) => notes.push(msg);

const NAME_RE = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const HOOK_EVENTS = new Set([
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest',
  'PostToolUse', 'SubagentStart', 'SubagentStop', 'Stop', 'PreCompact', 'PostCompact',
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      fail(`symlink 不允许：${path.relative(repoRoot, full)}`);
      continue;
    }
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function readJson(file) {
  const raw = fs.readFileSync(file);
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    fail(`BOM: ${path.relative(repoRoot, file)}`);
    return null;
  }
  try {
    const value = JSON.parse(raw.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      fail(`根不是对象: ${path.relative(repoRoot, file)}`);
      return null;
    }
    return value;
  } catch (error) {
    fail(`JSON 解析失败 ${path.relative(repoRoot, file)}: ${error.message}`);
    return null;
  }
}

// --- 1. every JSON file parses -------------------------------------------
const allFiles = walk(pluginsRoot);
const jsonFiles = allFiles.filter((f) => f.endsWith('.json'));
for (const file of jsonFiles) readJson(file);
ok(`JSON 文件全部可解析：${jsonFiles.length} 个`);

// --- 2. per-package checks ------------------------------------------------
const packageDirs = fs
  .readdirSync(pluginsRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => path.join(pluginsRoot, d.name));

if (packageDirs.length === 0) fail('plugins/ 下没有包目录');

for (const pkgDir of packageDirs) {
  const pkgName = path.basename(pkgDir);
  const rel = path.relative(repoRoot, pkgDir);
  const manifestPath = path.join(pkgDir, '.minimax-plugin', 'plugin.json');
  if (!fs.existsSync(manifestPath)) {
    fail(`${rel}: 缺少 .minimax-plugin/plugin.json`);
    continue;
  }
  const manifest = readJson(manifestPath);
  if (!manifest) continue;

  if (manifest.schemaVersion !== 1) fail(`${rel}: schemaVersion 必须为 1`);
  if (!NAME_RE.test(String(manifest.name || ''))) fail(`${rel}: name 不符合机器名规则: ${manifest.name}`);
  if (manifest.name !== pkgName) fail(`${rel}: 目录名 "${pkgName}" 与 manifest.name "${manifest.name}" 不一致`);
  if (!SEMVER_RE.test(String(manifest.version || ''))) fail(`${rel}: version 不是 SemVer: ${manifest.version}`);
  if (!String(manifest.displayName || '').trim()) fail(`${rel}: displayName 为空`);
  if (!String(manifest.description || '').trim()) fail(`${rel}: description 为空`);
  if (!String(manifest.author || '').trim()) fail(`${rel}: author 为空`);
  if (!String(manifest.category || '').trim()) fail(`${rel}: category 为空`);
  const queries = manifest.exampleQueries;
  if (!Array.isArray(queries) || queries.length === 0) fail(`${rel}: exampleQueries 为空`);
  else if (queries.some((q) => !String(q || '').trim())) fail(`${rel}: exampleQueries 存在空项`);

  for (const key of ['apps', 'mcpServers', 'skills']) {
    if (!Array.isArray(manifest[key])) fail(`${rel}: ${key} 必须是数组`);
  }
  if (manifest.hooks !== undefined && !Array.isArray(manifest.hooks)) fail(`${rel}: hooks 必须是数组`);

  // icon
  if (!manifest.icon) fail(`${rel}: 缺少 icon 字段`);
  else {
    const iconPath = path.join(pkgDir, manifest.icon);
    if (!fs.existsSync(iconPath)) fail(`${rel}: icon 文件不存在: ${manifest.icon}`);
    else if (!/\.(png|jpe?g|webp)$/i.test(manifest.icon)) fail(`${rel}: icon 格式不支持: ${manifest.icon}`);
  }
  if (manifest.darkIcon) {
    const darkPath = path.join(pkgDir, manifest.darkIcon);
    if (!fs.existsSync(darkPath)) fail(`${rel}: darkIcon 文件不存在: ${manifest.darkIcon}`);
  }

  // referenced skills / hooks files
  for (const skill of manifest.skills || []) {
    const p = path.join(pkgDir, skill);
    if (!fs.existsSync(p)) fail(`${rel}: 引用了不存在的 skill 文件: ${skill}`);
    else {
      const text = fs.readFileSync(p, 'utf8');
      const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fm) fail(`${rel}: ${skill} 缺少 YAML frontmatter`);
      else {
        const name = fm[1].match(/^name:\s*(.+)$/m);
        const desc = fm[1].match(/^description:\s*([\s\S]+?)(?=\r?\n[a-zA-Z-]+:|$)/m);
        if (!name) fail(`${rel}: ${skill} frontmatter 缺少 name`);
        else {
          const expected = path.basename(path.dirname(p));
          if (name[1].trim() !== expected) fail(`${rel}: ${skill} frontmatter name "${name[1].trim()}" 与目录名 "${expected}" 不一致`);
        }
        if (!desc || !desc[1].trim()) fail(`${rel}: ${skill} frontmatter description 为空`);
      }
    }
  }

  // hook documents
  for (const hookDoc of manifest.hooks || []) {
    const docPath = path.join(pkgDir, hookDoc);
    if (!fs.existsSync(docPath)) {
      fail(`${rel}: 引用了不存在的 hook 文档: ${hookDoc}`);
      continue;
    }
    const doc = readJson(docPath);
    if (!doc?.hooks) continue;
    for (const [event, groups] of Object.entries(doc.hooks)) {
      if (!HOOK_EVENTS.has(event)) fail(`${rel}: 不支持的事件 ${event}`);
      for (const group of groups) {
        for (const handler of group.hooks || []) {
          if (handler.type !== 'command') fail(`${rel}: ${event} 处理器 type 必须为 command，实际 ${handler.type}`);
          if (!String(handler.command || '').trim()) fail(`${rel}: ${event} 缺少 command`);
          if (handler.timeout !== undefined && (handler.timeout < 1 || handler.timeout > 10)) {
            fail(`${rel}: ${event} timeout 必须在 1-10 之间，实际 ${handler.timeout}`);
          }
          for (const key of ['command', 'commandWindows']) {
            const cmd = handler[key];
            if (!cmd) continue;
            const scripts = cmd.match(/\$\{PLUGIN_ROOT\}[\\/]?([\w./\\-]+)/g) || [];
            for (const ref of scripts) {
              const relRef = ref.replace(/\$\{PLUGIN_ROOT\}[\\/]?/, '').replace(/\\/g, '/');
              const target = path.join(pkgDir, relRef);
              if (!fs.existsSync(target)) fail(`${rel}: ${event}.${key} 引用了不存在的脚本: ${relRef}`);
            }
            if (/[A-Za-z]:\\/.test(cmd) && !/run-hook\.cmd/.test(cmd)) {
              fail(`${rel}: ${event}.${key} 含硬编码绝对路径，换机器会失效: ${cmd}`);
            }
          }
        }
      }
    }
  }

  // --- Mini App package ---
  const packageJsonPath = path.join(pkgDir, 'package.json');
  const miniappJsonPath = path.join(pkgDir, 'miniapp', 'miniapp.json');
  if (fs.existsSync(miniappJsonPath) || fs.existsSync(packageJsonPath)) {
    if (!fs.existsSync(miniappJsonPath)) fail(`${rel}: 有 package.json 但缺 miniapp/miniapp.json`);
    if (!fs.existsSync(packageJsonPath)) fail(`${rel}: 有 miniapp.json 但缺 package.json`);
    if (fs.existsSync(packageJsonPath)) {
      const pkg = readJson(packageJsonPath);
      const declared = pkg?.mcode?.miniApp;
      if (!declared) fail(`${rel}: package.json 缺 mcode.miniApp 声明`);
      else if (!fs.existsSync(path.join(pkgDir, declared))) fail(`${rel}: mcode.miniApp 指向的文件不存在: ${declared}`);
    }
    if (fs.existsSync(miniappJsonPath)) {
      const ma = readJson(miniappJsonPath);
      if (ma?.schemaVersion !== 1) fail(`${rel}: miniapp.json schemaVersion 必须为 1`);
      const client = ma?.artifacts?.client || [];
      const node = ma?.artifacts?.node || [];
      if (client.length === 0) fail(`${rel}: miniapp.json 缺 artifacts.client`);
      if (node.length === 0) fail(`${rel}: miniapp.json 缺 artifacts.node`);
      for (const relPath of [...client, ...node]) {
        const p = path.join(pkgDir, relPath);
        if (!fs.existsSync(p)) fail(`${rel}: miniapp.json 指向的载荷不存在: ${relPath}`);
        const stat = fs.statSync(p);
        if (stat.isDirectory()) {
          const nested = fs.readdirSync(p);
          if (nested.includes('node_modules')) fail(`${rel}: 载荷内含 node_modules`);
        }
      }
      const entry = ma?.runtime?.entry;
      if (!entry) fail(`${rel}: miniapp.json 缺 runtime.entry`);
      else if (!fs.existsSync(path.join(pkgDir, entry))) fail(`${rel}: runtime.entry 不存在: ${entry}`);
      if (!ma?.surface?.path) fail(`${rel}: miniapp.json 缺 surface.path`);
    }
  }

  // --- portability ---
  for (const file of walk(pkgDir)) {
    const relFile = path.relative(repoRoot, file);
    if (/node_modules/.test(relFile)) fail(`${rel}: 含 node_modules`);
    if (!/\.(mjs|js|json|md|txt|cmd|ps1|sh|html|css|ts)$/i.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (/C:\\Users\\|C:\/Users\/|\/home\/[a-z0-9_]+\//i.test(text)) {
      fail(`${relFile}: 含机器专属绝对路径`);
    }
    if (/(ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/.test(text)) {
      fail(`${relFile}: 疑似含凭据`);
    }
  }

  ok(`包校验完成: ${rel} v${manifest.version} (${manifest.name})`);
}

// --- 3. syntax check for every Node script --------------------------------
import { execFileSync } from 'node:child_process';
const scripts = allFiles.filter((f) => f.endsWith('.mjs') || f.endsWith('.js'));
let syntaxOk = 0;
for (const file of scripts) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    syntaxOk += 1;
  } catch (error) {
    fail(`语法错误 ${path.relative(repoRoot, file)}: ${String(error.stderr || error.message).slice(0, 200)}`);
  }
}
ok(`Node 脚本语法检查通过：${syntaxOk}/${scripts.length}`);

// --- report ---------------------------------------------------------------
console.log(notes.map((n) => `  [OK]   ${n}`).join('\n'));
if (problems.length) {
  console.error(problems.map((p) => `  [FAIL] ${p}`).join('\n'));
  console.error(`\n校验失败：${problems.length} 个问题`);
  process.exit(1);
}
console.log('\n全部校验通过。');
