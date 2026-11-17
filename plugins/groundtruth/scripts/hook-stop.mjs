// Stop hook: graded enforcement.
//
// HARD block (deterministic only):
//   H1 cited file does not exist on disk
//   H2 cited line number is beyond the end of an existing file
//   H3 "tests/build/run passed" claimed with no command execution in the
//      session and no evidence quoted in the message
//
// SOFT (logged only, never blocks): completion claims without evidence,
// numeric conclusions without any source citation.
import {
  readStdin,
  emit,
  emitBlock,
  extractCitations,
  resolveRoots,
  resolveExisting,
  countLines,
  stripFencedBlocks,
  hasHardVerificationClaim,
  hasSoftCompletionClaim,
  hasInlineEvidence,
  analyzeTranscript,
  isFutureIntent,
  isHypothetical,
  reportsMissing,
  transcriptTouchesFile,
  harvestRoots,
  audit,
  guardHit,
} from './lib/core.mjs';

const input = readStdin();
const event = String(input.hook_event_name || 'Stop');
const message = String(input.last_assistant_message || '');
const roots = resolveRoots(input);
// Directories the message itself mentions count as resolution roots, so a path
// relative to another repository is not mistaken for a missing file.
for (const extra of harvestRoots(message)) roots.push(extra);

const hard = [];
const soft = [];

if (event === 'Stop' && message.trim()) {
  const prose = stripFencedBlocks(message);
  // A reply that reports a missing file is telling the truth, not fabricating.
  const missingReported = reportsMissing(message);

  for (const citation of extractCitations(prose)) {
    if (isFutureIntent(citation.context) || isHypothetical(citation.context)) continue;

    const absolute = /^[A-Za-z]:[\\/]/.test(citation.rel) || citation.rel.startsWith('/');
    const abs = resolveExisting(citation.rel, roots);

    if (!abs) {
      const strong = citation.strong || absolute;
      if (strong && !missingReported) {
        hard.push(`引用了不存在的文件：${citation.raw}（在当前工作目录与项目目录下都没有找到）`);
      } else {
        soft.push(`引用可能不存在的文件：${citation.raw}`);
      }
      continue;
    }

    if (citation.line) {
      const lines = countLines(abs);
      if (lines !== null && citation.line > lines) {
        hard.push(`引用行号越界：${citation.raw}（该文件实际只有 ${lines} 行）`);
      }
    }
  }

  if (hasHardVerificationClaim(message)) {
    const inline = hasInlineEvidence(message);
    const transcript = analyzeTranscript(input.transcript_path);
    if (!inline && transcript.available && transcript.execCalls === 0) {
      hard.push('声称"测试/构建/运行通过"，但本会话没有执行过任何命令，也没有贴出真实输出');
    }
  }

  // A number attributed to a table that was never opened is unbacked by
  // construction. This is the check that catches "写了个数字但根本没取数".
  {
    const transcript = analyzeTranscript(input.transcript_path);
    const numericClaim = /\d/.test(message) && /(表|数据|统计|数值|配置|上限|数量|条|等级|占比)/.test(message);
    if (transcript.available && numericClaim) {
      for (const citation of extractCitations(prose)) {
        if (!/\.(xlsx|xls|csv)$/i.test(citation.rel)) continue;
        const abs = resolveExisting(citation.rel, roots);
        if (!abs) continue;
        if (transcriptTouchesFile(transcript.text, citation.rel)) continue;
        hard.push(`引用了表 ${citation.raw} 的数值，但本会话没有任何读取该表的工具记录（该文件未出现在任何工具调用中）`);
        break;
      }
    }
  }

  if (hasSoftCompletionClaim(message) && !hasInlineEvidence(message)) {
    soft.push('出现完成类结论，但回复中没有贴出任何真实输出或出处');
  }

  const hasDigits = /\d/.test(message);
  const dataWords = /(数据|统计|数值|占比|数量|合计|总计|平均|比例|均值)/.test(message);
  const anyCitation = extractCitations(prose).length > 0;
  if (hasDigits && dataWords && !anyCitation) {
    soft.push('出现数值结论，但整段回复没有任何来源标注（表名/单元格/文件:行号）');
  }
}

if (hard.length > 0 || soft.length > 0) {
  audit({
    event,
    session: input.session_id || null,
    hard: hard.length,
    soft: soft.length,
    problems: hard,
    notices: soft,
  });
}

// Never loop: if the agent was already resumed by this Hook, or the same
// problem was reported recently, do not block again.
if (hard.length === 0 || input.stop_hook_active === true) {
  emit(null);
} else {
  const key = `stop:${input.session_id || 's'}:${hard.join('|')}`.slice(0, 180);
  if (guardHit(key)) {
    emit(null);
  } else {
    const lines = hard.map((p, i) => `${i + 1}) ${p}`).join('\n');
    emitBlock(
      `【Groundtruth 拦截｜结论与实际证据冲突】\n\n本次回复存在以下确定性问题：\n${lines}\n\n请二选一处理：\n` +
        `A. 现在就核实：读取真实文件 / 运行真实命令，并把真实输出贴出来；\n` +
        `B. 无法核实就把相关结论降级标注为【未验证】，并写明还缺什么证据。\n\n` +
        `不要在未核实的情况下重复同样的声明。`
    );
  }
}
