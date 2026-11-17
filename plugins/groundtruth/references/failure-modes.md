# Failure Modes and Their Specific Fixes

Grounded in published agent-failure research (Cemri et al., NeurIPS 2025, arXiv:2503.13657,
MAD dataset) and production groundedness engineering. Each entry: how it looks, how this
Plugin detects it, what actually fixes it.

## Mode 3.3 — No or Incorrect Verification

**Share of failures:** 21.3% of multi-agent failures in "task verification & termination".

**Looks like:** "I've added comprehensive tests and verified they all pass" — with three
test files containing stubs and TODOs, and `npm test` reporting `0 tests ran`.

**Detected by:** Stop Hook, hard. A "tests/build/run passed" claim with zero command
executions recorded in the transcript and no output quoted in the reply is a contradiction,
not a heuristic.

**Fix:** Run the check, quote the real output, and if the check cannot run, write 未验证.
The fix is behavioural (rule 6), and the Hook only catches the residue.

## Grounding Failure

**Looks like:** The right evidence is in context, but the answer came from parametric
memory, or two sources were blended. The claim exceeds what the cited chunk says.

**Detected by:** evidence-contract Skill, claim-level grading against the specific cited
source. The Hook cannot detect it — it is a semantic error.

**Fix:** Grade each atomic claim against the one source it cites, never against the whole
context. Whole-context grading hides conflation.

## Knowledge Gap / Retrieval Miss

**Looks like:** The evidence was never retrieved. The answer carries no citation, or cites
an adjacent-but-wrong chunk.

**Detected by:** PostToolUse Hook injects a reminder after a failed or empty read/grep.
The audit log records numeric conclusions with no source citation at all.

**Fix:** Say "not found" plus the alternative lookup path. A refusal is a correct answer
here — and for high-abstention models like M3.1-Flash it is the failure mode that costs
the most, because the model almost never refuses.

## Instruction Drift

**Looks like:** Over-answering. Unrequested fields filled in, invented enum values,
"helpful" extras that were never in the source.

**Detected by:** not automatically detectable. Caught in review, or by the contract's
"no unrequested content" expectation.

**Fix:** Write the constraint down as an explicit contract before acting (this Skill and
the SessionStart injection), and validate boundaries after acting.

## Never-Read-Table Fabrication

**Looks like:** A specific number attributed to a spreadsheet, in a session where that
spreadsheet was never opened. The number may even look plausible. Nothing in the tool
log ever touched that file.

**Detected by:** Stop Hook, hard. The cited `.xlsx`/`.xls`/`.csv` exists on disk, the
message carries a numeric claim, and the file name appears in **no** tool call in the
whole session transcript.

**Fix:** Read the table, then quote `表名!Sheet!单元格`. The bundled `probe-table.mjs`
turns this into one command.

## Entity / Numeric Conflation

**Looks like:** Right tokens, wrong pairing. A value belonging to entity A is attributed
to entity B. The classic numeric hallucination: a real number from the right table, on the
wrong row.

**Detected by:** number-grounding Skill. Every value carries `表名!Sheet!单元格`.

**Fix:** Never transfer a number between tables, versions or rows without re-reading it.
Include the row and column titles next to the coordinate, because the coordinate alone
does not disambiguate meaning.

## Never-Abstaining (M3.1-Flash specific)

**Measured:** AA-Omniscience — 56% of questions answered correctly, but the model attempts
almost every question, so the benchmark records a ~92.8% hallucination rate (attempted but
wrong counts as hallucination). The model will not say "I don't know".

**Detected by:** not a detection problem. It is prevented by contract rule 3 and by the
three-state labelling convention existing at all.

**Fix:** Make abstention cheap and explicit. The deliverable format gives the model a
legitimate slot to write "未验证 / 无法验证" without that reading as a failure. Lower
`sampling` effort is a band-aid; a labelled slot is a structural fix.

## Identifier Fabrication

**Looks like:** Invented file paths, API names, field names, config keys, function
signatures. The most damaging variant, because the user cannot tell it is wrong.

**Detected by:** Stop Hook, hard. Cited paths that do not exist on disk, and cited line
numbers beyond the end of an existing file.

**Fix:** Look the identifier up before writing it. `grep`/`glob` first, then read.

## Stale-Context Fabrication

**Looks like:** After context compaction, the model asserts a constraint or a file state
from earlier in the session that it no longer actually holds.

**Detected by:** not directly. The PostCompact event exists for exactly this window.

**Fix:** Re-read the file instead of citing it from memory; prefer citing absolute
`file:line` over narrative summaries that degrade across compaction.

---

## Layer summary

| Layer | Mechanism | Catches | Misses |
| --- | --- | --- | --- |
| 0 SessionStart | Injected contract | Refuses to start without the rules | Semantic errors |
| 1 UserPromptSubmit | One-line reminder | Forgetting the rules on a data question | — |
| 2 PostToolUse | Failure reminder | Filling gaps after a failed tool call | Silent wrong results |
| 3 Stop | Deterministic contradiction check | Missing files, out-of-range lines, unbacked "tests pass" | Everything semantic |
| 4 Skill | Claim-to-proof procedure | Grounding, conflation, instruction drift | — |
| 5 Verifier subagent | Independent re-check | Self-verification blind spots | Cost |
