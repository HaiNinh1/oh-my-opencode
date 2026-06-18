---
name: ultraqa
description: "Bounded QA-cycling workflow: run tests / manual QA, diagnose failures with oracle, fix via task workers, re-test, repeat until the quality goal is met. Hard cap of 5 cycles with a 'same failure 3x -> stop and escalate' early exit. MUST USE when the target behavior is already known and the remaining question is whether tests, build, lint, typecheck, or another explicit QA condition passes. Triggers: ultraqa, qa cycle, qa loop, keep testing until it passes, run tests and fix, cycle until green, make the tests pass, fix failing tests, verify until it works."
metadata:
  short-description: Bounded test/diagnose/fix QA loop with a hard cap and same-failure early exit
---

# ultraqa

You are running **ultraqa** - an autonomous, BOUNDED QA-cycling workflow that runs until a quality goal is met or a hard stop fires. You do not redesign the feature; you drive the existing target to a passing state and stop the moment it passes or is provably stuck.

**Cycle**: run QA -> diagnose failure -> fix -> re-test -> repeat (max 5 cycles).

## When to use vs not

- USE when the desired behavior is already known and the only open question is whether an explicit QA condition (tests / build / lint / typecheck / manual QA scenario) passes.
- USE as a verification/fix sub-loop under `start-work`, `ralph-loop`, or `ultrawork` when those need a tight test-fix cycle.
- DO NOT use to decide WHAT to build - that is `ulw-plan`. DO NOT use for open-ended exploration. DO NOT use for a single obvious one-line fix - just fix it directly.

## Relationship to ralph-loop, start-work, and ultrawork

ultraqa owns repeated quality-gate cycling only. If `ralph-loop` / `ultrawork` is active, ultraqa is a sub-loop under that authority - it produces the evidence those loops verify; it never competes with their session loop or clears their state. If `start-work` is active, ultraqa is the Phase 4 verify-and-fix engine for a single checkbox. ultraqa never marks plan checkboxes or edits product files itself - it delegates fixes to workers and reports the verdict up.

## Goal parsing

Parse the goal from the invocation arguments:

| Invocation | Goal type | What "pass" means |
| --- | --- | --- |
| `ultraqa --tests` | tests | the project's test command exits 0 with no failures |
| `ultraqa --build` | build | the project's build command exits 0 |
| `ultraqa --lint` | lint | the linter reports no errors |
| `ultraqa --typecheck` | typecheck | the type checker reports no errors |
| `ultraqa --custom "<pattern>"` | custom | the named command's output contains the success pattern |
| `ultraqa --visual` | visual | the `visual-qa` skill returns GOOD |
| `ultraqa --manual "<scenario>"` | manual | a real-surface QA scenario passes with a captured artifact |

If no structured flag is given, read the free-text argument as a custom goal and infer the matching command from the project (package.json scripts, Makefile, justfile, etc.). Detect the real commands from the repo - never guess `npm test` if the repo uses `bun test`.

## The cycle (max 5)

Run this loop. Track every failure signature so you can detect repeats.

### Cycle N

1. **RUN QA.** Execute the goal command(s). Capture exit code and the failing output. For `--manual` / `--visual`, dispatch a hands-on QA worker:

   ```
   task(
     category="unspecified-high",
     run_in_background=false,
     description="ultraqa manual QA cycle N",
     prompt="TASK: act as a QA engineer. DELIVERABLE: run the scenario and return PASS or FAIL with a captured artifact path. SCOPE: <scenario, how to start the app, exact tool + invocation - curl -i / tmux send-keys + capture-pane / page.click / agent-browser - and the binary observable that decides PASS/FAIL>. VERIFY: capture the real artifact, never a dry-run claim."
   )
   ```

   For `--visual`, invoke the `visual-qa` skill instead and treat its GOOD/NEEDS-WORK verdict as the cycle result.

2. **CHECK RESULT.**
   - PASS -> exit with success (see Exit conditions).
   - FAIL -> record the failure signature (normalized: failing test name(s) / first error line / exit code), then continue.

3. **EARLY-EXIT CHECK.** If this exact failure signature has now occurred **3 times**, STOP - do not fix again. Emit the "same failure 3x" escalation. This guards against thrashing on a fundamental issue.

4. **DIAGNOSE.** Spawn `oracle` (read-only) to root-cause the failure. Oracle cannot read files, so paste the failing output, the relevant source, and the diff into the prompt:

   ```
   task(
     subagent_type="oracle",
     run_in_background=false,
     load_skills=[],
     description="ultraqa diagnose cycle N",
     prompt="DIAGNOSE FAILURE. GOAL: <goal type>. FAILING OUTPUT: <test/build output>. SOURCE: <relevant source + diff>. Return the root cause and a SPECIFIC, minimal fix recommendation (files + exact change). Do not propose scope expansion."
   )
   ```

   When the failure spans many files or the cause is structurally unclear, prefer `metis` for gap analysis or `momus` for an adversarial second opinion - but keep diagnosis read-only.

5. **FIX.** Delegate the fix to a worker - never edit product files from the orchestrator. Mechanical fixes go to a `quick`/`sisyphus`-class worker; reasoning fixes go to `hephaestus`/`unspecified-high`:

   ```
   task(
     category="unspecified-low",
     run_in_background=false,
     description="ultraqa fix cycle N",
     prompt="FIX. ROOT CAUSE: <oracle diagnosis>. FILES: <affected files>. Apply the minimal fix precisely as diagnosed - smallest viable diff, follow existing patterns, no scope creep, no test deletion to force a pass. After editing, run lsp_diagnostics on touched files."
   )
   ```

   Dispatch independent fixes in parallel with `parallel_tasks` when the diagnosis names disjoint files.

6. **RE-TEST.** Go back to step 1 with cycle N+1.

## Exit conditions

| Condition | Action |
| --- | --- |
| Goal met | Exit success: "ULTRAQA COMPLETE: goal met after N cycle(s)." Report what was failing and the final passing evidence (command + exit 0). |
| Cycle 5 reached without passing | Exit with diagnosis: "ULTRAQA STOPPED: max cycles reached. Remaining failures: ... Root-cause hypothesis: ..." Surface the oracle's last diagnosis. |
| Same failure 3x | Exit early: "ULTRAQA STOPPED: identical failure observed 3 times - fundamental issue, not a thrash-fixable one. Failure: ... Recommended next step: ..." |
| Environment error | Exit: "ULTRAQA ERROR: <missing dependency / port in use / tmux unavailable / cannot start app>." Do not count environment errors as QA failures. |
| User cancels | Stop on "stop" / "cancel" / "abort". |

## Observability

Print a one-line status per phase so the human always knows the cycle and state:

```
[ultraqa 1/5] tests -> FAIL (3 failing: auth.test.ts)
[ultraqa 1/5] oracle diagnosing...
[ultraqa 1/5] fix dispatched: auth.test.ts missing mock
[ultraqa 2/5] tests -> PASS (47/47)
[ultraqa COMPLETE] goal met after 2 cycles
```

## Hard rules

1. **BOUNDED.** Never exceed 5 cycles. Never loop past the same-failure-3x guard.
2. **DELEGATE.** The orchestrator diagnoses via oracle and fixes via workers - it does not edit product files itself.
3. **ROOT CAUSE, NOT THE TEST.** Fix production code. Never delete or weaken a test, never add `as any` / `@ts-ignore`, never relax an assertion to force green.
4. **TRACK SIGNATURES.** Normalize and record every failure so the 3x guard is reliable across cycles.
5. **REAL EVIDENCE.** Manual/visual passes need a captured artifact, never a dry-run or log-only claim. The final success report cites the fresh passing command output.
6. **NO SCOPE CREEP.** Fix only what makes the goal pass. Do not refactor adjacent code.
