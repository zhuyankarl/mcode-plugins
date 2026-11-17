// UserPromptSubmit hook: one-line reminder for fact/data style prompts.
import { readStdin, emit } from './lib/core.mjs';
import { PROMPT_REMINDER } from './lib/contract.mjs';

const input = readStdin();
const prompt = String(input.prompt || '');

// Only prompts that are likely to produce factual or numeric answers.
const RISKY =
  /(数据|数值|统计|报表|多少|几个|数量|占比|比例|平均|合计|总计|汇总|清单|列表|对比|分析|总结|报告|出处|来源|核实|核对|依据|证据|现状|实际情况)/;

if (!prompt || !RISKY.test(prompt)) {
  emit(null);
} else {
  emit({ additionalContext: PROMPT_REMINDER });
}
