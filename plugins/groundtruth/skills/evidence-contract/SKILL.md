---
name: evidence-contract
description: Apply the ground-truth evidence contract to any deliverable that states facts, numbers, file states, or completion status. Use when asked to analyze, report, audit, summarize, or declare work complete—especially when the answer must cite sources, when the subject is a large codebase or many spreadsheets, or when the user asks to check whether something is made up.
---

# Evidence Contract

Turn "I think this is right" into "this is what I actually checked, and here is the proof".

## When this applies

Any reply that asserts a fact, a number, a file/function/field name, a code state, or a
completion status. It is mandatory before: declaring a task done, writing a report,
answering "how many / what is / where is", and summarizing content that was not read
in this session.

## The seven rules

1. **Three-state labelling.** Every conclusion is 【已验证】【未验证】 or 【无法验证】.
   Never write an unverified claim in the verified voice.
2. **Source mandatory.** A factual claim carries its source: `file:line`, the real
   output of a tool/command, or the user's own words. No source → downgrade to 未验证.
3. **Abstain loudly.** When you do not know, say so and give the exact way to find out
   (which file, which command, which question). Never substitute "通常/大致/应该是".
4. **Never invent identifiers.** File paths, API names, field names, function
   signatures, config keys, sheet names, row/column counts — look them up, do not
   guess. A plausible-looking invented path is the most damaging failure mode.
5. **Numbers go back to source.** Every number is read from a real location and cited
   as `表名!Sheet!单元格` or `file:line`. See the `number-grounding` Skill.
6. **Completion requires a run.** Before saying 完成/已修复/测试通过/构建成功, the
   verification must have actually run in this session and its real output must be
   quoted. Otherwise write 未验证 and state what is still missing.
7. **Report failures plainly.** Command errors, missing files and unreadable sources
   get a direct explanation and an impact statement — not a plausible substitute.

## The claim-to-proof loop

For every claim you are about to make:

1. **State the claim.** One fact per claim. "Page 2 returns rows 11–20" is one claim.
2. **Decide what would prove it.** The smallest check that settles it: one `grep`, one
   targeted test, one file read, one cell lookup.
3. **Run it.** Then *read the actual result*. Do not assume the command did what you
   meant.
4. **Grade it.** supported / partial / unsupported. Partial counts as unsupported.
5. **Report it.** Verified with the quoted output, or explicitly not verified.

Grade each claim **against the specific source it cites**, never against your whole
context. Whole-answer grading hides conflation: an answer that misattributes one
attribute out of five still reads as "mostly correct".

## Output shape

```
结论：【已验证】离线包的冷启动时间从 1.2s 降到 0.4s
  证据：bench/offline_bench.py:88 实测 output="cold_start=0.41s"
结论：【未验证】线上灰度期间无回退
  缺证：未拿到线上监控数据；核实路径：查 metric `offline_cold_start` P95
```

## When a tool call fails

A failed read, an empty grep, a non-zero exit, a missing file: say so. Do not fill the
gap with what the file "probably" contains. Downgrade dependent claims to 未验证 and
name the alternative lookup path.

## When to escalate to a verifier

Use the `verifier` sub-agent (or a fresh-context worker) when the deliverable is
high-stakes or the evidence set is large — a full-repo audit, a cross-table
reconciliation, or a claim you cannot cheaply disprove yourself. A fresh context
catches what self-verification misses.

## What the Hook will do to you

This Plugin ships deterministic checks that run when you finish a turn. They block
only provable contradictions:

- a cited file that does not exist on disk,
- a cited line number beyond the end of an existing file,
- a "tests/build/run passed" claim with no command executed in the session and no
  output quoted.

Everything else is a reminder, not a block. Do not try to satisfy the checker by
restating the claim; either produce the evidence or downgrade the claim.

## Reference

`references/failure-modes.md` maps each known hallucination mode to its specific fix.
Read it when a task is unusually error-prone (numeric work, long refactors, multi-table
analysis).
