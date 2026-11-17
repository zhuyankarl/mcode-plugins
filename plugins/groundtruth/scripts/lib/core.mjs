// Groundtruth shared detection core.
// Pure Node.js, no dependencies. All functions are tolerant: anything unexpected
// returns a neutral result so a Hook never crashes the turn.

import fs from 'node:fs';
import path from 'node:path';

/** Read one JSON object from stdin. Never throws. */
export function readStdin() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw || !raw.trim()) return {};
    // A leading BOM (U+FEFF) makes JSON.parse throw, and a thrown parse error
    // would silently reduce the whole Hook to an empty input. Strip it before
    // parsing: some shells and pipes deliver stdin as UTF-8 with BOM.
    const cleaned = raw.replace(/^\uFEFF/, '').trim();
    if (!cleaned) return {};
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Write the structured Hook response and exit cleanly. */
export function emit(obj) {
  if (obj) {
    try {
      process.stdout.write(JSON.stringify(obj));
    } catch {
      /* fail open */
    }
  }
  process.exit(0);
}

/** Write a structured Hook response and exit with the blocking code. */
export function emitBlock(reason) {
  try {
    process.stdout.write(JSON.stringify({ decision: 'block', reason: String(reason).slice(0, 4000) }));
  } catch {
    /* fail open */
  }
  process.exit(0);
}

const FILE_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|mdx|txt|csv|tsv|xls|xlsx|png|jpg|jpeg|gif|svg|webp|bmp|py|cs|lua|yml|yaml|xml|html|htm|css|scss|less|sh|bash|bat|ps1|cpp|cc|cxx|h|hpp|go|rs|java|kt|kts|sql|log|ini|toml|cfg|conf|asm|s|fbx|prefab|unity|asmdef|mat|asset|tga|dll|so|unitypackage|zip|rar|pdf|docx|pptx)$/i;

const FUTURE_INTENT =
  /(将要|准备|计划|新建|创建|生成|新增|写入|即将|待建|拟新增|建议新增|should create|will create|to be created)/;

const HYPOTHETICAL =
  /(例如|比如|假设|假如|示例|类似于|格式如|理论上|设想|举例|for example|e\.g\.|such as)/;

const MISSING_REPORT =
  /(不存在|找不到|没有(这个|该|此)?(文件|表|目录|路径)|未找到|没有找到|无法访问|无法读取|打不开|读不到|ENOENT|no such file|not found|cannot find|could not find|doesn't exist|does not exist|无法打开)/;

/** Remove fenced code blocks so sample code inside them is not read as a citation. */
export function stripFencedBlocks(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ');
}

/**
 * Extract file-path citations from free text.
 * Returns [{ raw, rel, line, strong, context }].
 * `strong` citations came from inline code spans or carry a :line suffix.
 */
export function extractCitations(text) {
  const src = String(text || '');
  const out = [];
  const seen = new Set();

  const push = (raw, strong) => {
    let value = String(raw || '').trim();
    // Strip markup prefixes such as src="path" that would otherwise be glued
    // onto the path and break the existence check.
    value = value.replace(/^(?:src|path|file|url|href|name)\s*[=:]\s*["']?/i, '');
    value = value.replace(/^[\s"'`([{<]+/, '').replace(/[\s"'`)\]}>.,;:!?，。；：！？]+$/, '');
    if (!value) return;

    let line = null;
    const lineMatch = value.match(/^(.*?):(\d+)$/);
    if (lineMatch) {
      value = lineMatch[1];
      line = Number(lineMatch[2]);
    }
    if (!FILE_EXT.test(value)) return;
    if (!/[\\/]/.test(value) && !/^[A-Za-z]:/.test(value)) {
      // Bare filename without a directory: only accept it when it is a strong citation.
      if (!strong) return;
    }
    const key = `${value}|${line}`;
    if (seen.has(key)) return;
    seen.add(key);

    const index = src.indexOf(String(raw || '').trim());
    const context = index >= 0 ? src.slice(Math.max(0, index - 16), index) : '';
    out.push({ raw: String(raw || '').trim(), rel: value, line, strong, context });
  };

  // Strong signal 1: inline code spans.
  const codeRe = /`([^`\n]{2,240})`/g;
  let m;
  while ((m = codeRe.exec(src)) !== null) {
    const inner = m[1];
    // A code span may hold several space separated paths.
    for (const piece of inner.split(/[\s,，]+/)) push(piece, true);
  }

  // Strong signal 2: bare path with :line suffix.
  const lineRe = /([A-Za-z]:[\\/][^\s"'`()<>]{2,240}|[\w.\-./\\一-龥]{2,240}\.[A-Za-z0-9]{1,8}):(\d{1,7})/g;
  while ((m = lineRe.exec(src)) !== null) {
    const whole = m[0];
    const rel = m[1];
    if (!FILE_EXT.test(rel)) continue;
    const key = `${rel}|${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const index = src.indexOf(whole);
    const context = index >= 0 ? src.slice(Math.max(0, index - 16), index) : '';
    out.push({ raw: whole, rel, line: Number(m[2]), strong: true, context });
  }

  // Weak signal 3: whitespace separated tokens that look like paths.
  const plain = src.replace(/`[^`\n]{2,240}`/g, ' ');
  for (const token of plain.split(/[\s,，;；]+/)) {
    const trimmed = token.replace(/^[\s"'([{<]+/, '').replace(/[\s"')\]}>.,;:!?，。；：！？]+$/, '');
    if (!trimmed || !FILE_EXT.test(trimmed)) continue;
    if (!/[\\/]/.test(trimmed) && !/^[A-Za-z]:/.test(trimmed)) continue;
    push(trimmed, false);
  }

  return out;
}

/**
 * Harvest absolute directories mentioned in the message and use them as extra
 * resolution roots. Without this, a citation that is relative to another
 * repository the message also mentions would look like a missing file.
 */
export function harvestRoots(text) {
  const roots = [];
  const src = String(text || '');
  const re = /([A-Za-z]:[\\/](?:[^\s"'`()<>，。；：、]{1,120})?)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const original = m[1].replace(/[.,;:!?)\]}]+$/, '');
    if (!original) continue;
    // Trim a trailing file name so the directory itself is also a root.
    let candidate = original;
    for (let i = 0; i < 2; i++) {
      const trimmed = candidate.replace(/[\\/][^\\/]+$/, '');
      if (trimmed && trimmed !== candidate && trimmed.length > 2) {
        roots.push(trimmed);
        candidate = trimmed;
      } else {
        break;
      }
    }
    roots.push(original);
  }
  return roots.filter(Boolean);
}

/** Candidate roots used to resolve relative citations. */
export function resolveRoots(input) {
  const roots = [];
  const add = (p) => {
    if (p && typeof p === 'string') {
      try {
        const abs = path.resolve(p);
        if (!roots.includes(abs)) roots.push(abs);
      } catch {
        /* ignore */
      }
    }
  };
  add(input?.cwd);
  add(process.env.MINIMAX_PROJECT_DIR);
  add(process.cwd());
  return roots;
}

/** Resolve a citation to an existing absolute path, or null. */
export function resolveExisting(rel, roots) {
  const clean = String(rel || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const candidates = [];
  if (/^[A-Za-z]:/.test(clean) || clean.startsWith('/')) {
    candidates.push(clean);
  } else {
    for (const root of roots) {
      candidates.push(path.join(root, clean));
      candidates.push(path.join(root, clean.replace(/\//g, path.sep)));
    }
  }
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Count lines in a text file, capped for size. */
export function countLines(absPath) {
  try {
    const stat = fs.statSync(absPath);
    if (stat.size > 4 * 1024 * 1024) return null;
    const text = fs.readFileSync(absPath, 'utf8');
    if (text.includes('\u0000')) return null;
    return text.split('\n').length;
  } catch {
    return null;
  }
}

const HARD_VERIFICATION_CLAIM =
  /(测试(全部)?通过|单元测试通过|回归通过|编译通过|构建成功|运行成功|执行成功|全部通过|校验通过并|已通过测试|tests?\s+(all\s+)?pass(ed)?|build\s+succeeded|successfully\s+built|successfully\s+built)/i;

const SOFT_CLAIM =
  /(已完成|完成了|全部完成|搞定了|修好了|已修复|修复完毕|已验证|验证通过|校验通过|已部署|已提交|已保存|写入成功|输出正确|结果正确|一切正常|无误|已生成|\bverified\b|\bworks now\b|\ball done\b)/i;

/** Detect a hard verification claim (a command was proven to pass). */
export function hasHardVerificationClaim(text) {
  return HARD_VERIFICATION_CLAIM.test(String(text || ''));
}

/** Detect a softer completion claim. */
export function hasSoftCompletionClaim(text) {
  return SOFT_CLAIM.test(String(text || ''));
}

const EVIDENCE_MARKER =
  /(exit\s*code|退出码|工具输出|命令输出|实际输出|输出如下|输出[:：]|结果[:：]|stdout|stderr|已运行|运行结果|执行结果|verified by|traceback)/i;

/** Detect evidence that a claim was actually checked inside the message itself. */
export function hasInlineEvidence(text) {
  const src = String(text || '');
  if (/```[\s\S]{1,4000}?```/.test(src)) return true;
  if (EVIDENCE_MARKER.test(src)) return true;
  return false;
}

/** Read the tail of a transcript file, capped to keep the Hook fast. */
export function readTranscriptTail(absPath, maxBytes = 2 * 1024 * 1024) {
  try {
    const stat = fs.statSync(absPath);
    const size = stat.size;
    const length = Math.min(size, maxBytes);
    const start = Math.max(0, size - length);
    const fd = fs.openSync(absPath, 'r');
    try {
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, start);
      return buffer.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/**
 * Look for command-execution evidence inside a transcript.
 * Returns { available, execCalls, failures, text }.
 */
export function analyzeTranscript(absPath) {
  if (!absPath) return { available: false, execCalls: 0, failures: 0, text: '' };
  const text = readTranscriptTail(absPath);
  if (text === null) return { available: false, execCalls: 0, failures: 0, text: '' };

  const execRe = /"(?:tool_?name|name|type)"\s*:\s*"(bash|shell|run_command|run_terminal_cmd|terminal|exec|execute)"/gi;
  const execCalls = (text.match(execRe) || []).length;

  const failRe = /"(?:is_error|isError)"\s*:\s*true|"exit_?code"\s*:\s*[1-9]\d*|command failed|Command failed|命令失败/g;
  const failures = (text.match(failRe) || []).length;

  return { available: true, execCalls, failures, text };
}

/**
 * True when the transcript shows any tool activity touching the given file.
 * Matching is done on the file name so that different spellings of the same
 * path (absolute vs relative) still count.
 */
export function transcriptTouchesFile(transcriptText, relPath) {
  const text = String(transcriptText || '');
  if (!text) return false;
  const base = String(relPath || '').split(/[\\/]/).pop();
  if (!base || base.length < 4) return false;
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'i').test(text);
}

/** True when a citation is clearly about a future artifact, not a real one. */
export function isFutureIntent(context) {
  return FUTURE_INTENT.test(String(context || ''));
}

/** True when a citation is clearly hypothetical. */
export function isHypothetical(context) {
  return HYPOTHETICAL.test(String(context || ''));
}

/**
 * True when the message is reporting that something is missing rather than
 * asserting it exists. A correct "该文件不存在" must not be treated as a
 * fabricated path. Path tokens are removed first, so a file whose *name*
 * contains such wording cannot silence the check.
 */
export function reportsMissing(message) {
  const cleaned = String(message || '')
    .replace(/`[^`\n]{2,240}`/g, ' ')
    .replace(/[A-Za-z]:[\\/][^\s，。、；：'"]{2,200}/g, ' ')
    .replace(/[^\s，。、；：'"`]{0,120}\.(?:xlsx|xls|csv|cs|lua|prefab|asset|json|ts|js|py)\b/gi, ' ');
  return MISSING_REPORT.test(cleaned);
}

/** Append one JSON line to the audit log under PLUGIN_DATA. */
export function audit(entry) {
  const dir = process.env.PLUGIN_DATA || process.env.MINIMAX_PLUGIN_DATA;
  if (!dir) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
    fs.appendFileSync(path.join(dir, 'audit.jsonl'), line, 'utf8');
  } catch {
    /* fail open */
  }
}

/** One-shot guard: returns true when the same reason was already used recently. */
export function guardHit(key, ttlMs = 10 * 60 * 1000) {
  const dir = process.env.PLUGIN_DATA || process.env.MINIMAX_PLUGIN_DATA;
  if (!dir) return false;
  const file = path.join(dir, 'guard.json');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const now = Date.now();
    let state = {};
    try {
      state = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    } catch {
      state = {};
    }
    const prev = state[key];
    if (prev && now - Number(prev.ts) < ttlMs) return true;
    state[key] = { ts: now };
    const keys = Object.keys(state);
    if (keys.length > 50) {
      for (const k of keys.sort((a, b) => Number(state[a].ts) - Number(state[b].ts)).slice(0, keys.length - 50)) {
        delete state[k];
      }
    }
    fs.writeFileSync(file, JSON.stringify(state), 'utf8');
    return false;
  } catch {
    return false;
  }
}
