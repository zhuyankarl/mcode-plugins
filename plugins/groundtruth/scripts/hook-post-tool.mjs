// PostToolUse hook: after a tool that produced no usable result, remind the
// agent not to fill the gap with invented content.
//
// Failure detection is per tool type on purpose. File tools (read/edit/write)
// echo file content back, and that content may legitimately contain words like
// "找不到" or "No matches found" — scanning their text would fire on perfectly
// successful calls. Only tools whose output is command/result text are
// scanned, and only at the head of the response where the runtime puts its
// own error metadata.
import { readStdin, emit } from './lib/core.mjs';
import { TOOL_FAILURE_REMINDER } from './lib/contract.mjs';

const input = readStdin();
const event = String(input.hook_event_name || 'PostToolUse');
const toolName = String(input.tool_name || '');
const response = input.tool_response;

let text = '';
if (typeof response === 'string') text = response;
else {
  try {
    text = JSON.stringify(response ?? '');
  } catch {
    text = '';
  }
}

const HEAD = 300;

function structuralFailure() {
  if (response && typeof response === 'object') {
    if (response.error) return true;
    if (response.is_error === true || response.isError === true) return true;
    if (response.success === false) return true;
  }
  return false;
}

function headFailure(head) {
  const patterns = [
    /^\s*Error\b/i,
    /\bENOENT\b/,
    /\bno such file or directory\b/i,
    /\bcommand failed\b/i,
    /\bfailed with exit code [1-9]/i,
    /\bexit code [1-9]\d*\b/i,
    /\bNo matches found\b/i,
    /\bTraceback \(most recent call last\)/,
    /\bpermission denied\b/i,
    /\bnpm ERR!/i,
    /\bModuleNotFoundError\b/,
    /^\s*(错误|失败|找不到|未找到|不存在|文件不存在|路径不存在|无法读取|读取失败|执行失败|命令失败)/i,
  ];
  for (const re of patterns) {
    if (re.test(head)) return true;
  }
  return false;
}

function looksFailed(name, body) {
  if (!body) return false;
  if (structuralFailure()) return true;

  // Only result-text tools get scanned, and only at the head.
  if (name === 'bash' || name === 'shell' || name === 'run_command' || name === 'terminal') {
    return headFailure(body.slice(0, HEAD));
  }
  if (name === 'grep' || name === 'search') {
    return headFailure(body.slice(0, HEAD));
  }

  // read / edit / write / glob / web_* : trust the structural signal only.
  // An empty glob result is not a failure.
  return false;
}

if (event !== 'PostToolUse' || !looksFailed(toolName, text)) {
  emit(null);
} else {
  emit({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: TOOL_FAILURE_REMINDER,
    },
  });
}
