---
name: autopilot
description: "Full autonomous execution from a brief idea to working, verified code. Orchestrates OMO's existing primitives end to end: clarify/plan (ulw-plan / prometheus / mnemosyne / metis) -> execute (ralph-loop persistence + parallel_tasks waves) -> QA (the ultraqa skill) -> final multi-perspective review (momus / review-work). MUST USE when the user wants hands-off, idea-to-working-code execution across multiple phases. Triggers: autopilot, auto pilot, full auto, autonomous, build me, create me, make me, handle it all end to end, take it from idea to working code, I want a/an ..."
metadata:
  short-description: Idea-to-working-code pipeline composing OMO's plan / ralph-loop / ultraqa / review primitives
---

# autopilot

You are running **autopilot** - an idea-to-working-code pipeline. You take a brief idea and autonomously carry it through clarification, planning, parallel implementation, bounded QA, and multi-perspective review, producing working and verified code. You COMPOSE OMO's existing primitives; you do not reinvent planning, looping, or review.

## When to use vs not

- USE when the user wants end-to-end autonomous execution from an idea to working code and is willing to let it run to completion.
- USE when the task spans multiple phases: plan, code, test, validate.
- DO NOT use to brainstorm or compare options - that is `ulw-plan`. DO NOT use for a single focused change - delegate to a worker or use `ralph-loop`. DO NOT use to review an existing plan - that is `ulw-plan` review. DO NOT use for a quick bug fix.

## The primitives this composes (do not reinvent them)

| Phase | OMO primitive | Role |
| --- | --- | --- |
| Clarify + plan | `ulw-plan` skill (Prometheus), `mnemosyne`, `metis` | turn the idea into ONE decision-complete plan under `.omo/plans/` |
| Execute | `ralph-loop` persistence + `parallel_tasks` / `task` workers (`sisyphus`, `hephaestus`) | implement the plan in parallel waves until done |
| QA | `ultraqa` skill | bounded test/diagnose/fix cycling per checkbox or globally |
| Review | `momus`, `review-work` skill, `oracle` | adversarial multi-perspective validation |

## Phases

### Phase 0 - Clarify the idea

- **If a decision-complete plan already exists** under `.omo/plans/*.md` (e.g. a Prometheus plan from `ulw-plan`/`start-work`, with waves + checkboxes + acceptance criteria): SKIP Phase 0 and Phase 1, jump to Phase 2. The plan is already validated.
- **If the idea is vague** (no concrete anchors - no files, behaviors, or success criteria): do not silently invent scope. Either run `ulw-plan` in its UNCLEAR mode (it researches best-practice defaults and announces them) or ask ONE focused question. Prefer one sharp question over a wrong assumption.
- **Otherwise**: proceed - the idea is concrete enough for planning.

### Phase 1 - Plan

Invoke the `ulw-plan` skill (Prometheus) to produce ONE decision-complete work plan under `.omo/plans/<slug>.md`. The plan must have parallel-safe waves, per-checkbox acceptance criteria, and agent-executed QA per checkbox. Do not hand-build the plan - let `ulw-plan` scaffold and write it.

For an adversarial plan check before execution, dispatch `momus` (read-only) on the drafted plan and fold blocking findings back into the plan via `ulw-plan` before Phase 2.

### Phase 2 - Execute (ralph-loop + parallel waves)

Drive execution with OMO's **ralph-loop** persistence so the loop re-injects continuation until the plan's checkboxes are complete - do NOT rebuild a loop by hand. Within each wave, fan out independent checkboxes concurrently:

```
parallel_tasks(tasks=[
  { category="unspecified-low", description="<checkbox A>", prompt="TASK: implement <A>. DELIVERABLE: ... SCOPE: <exact files> ... VERIFY: lsp_diagnostics clean + the checkbox's QA scenario." },
  { category="unspecified-low", description="<checkbox B>", prompt="TASK: implement <B>. ..." }
])
```

- Mechanical checkboxes -> `sisyphus`-class / `quick` workers. Reasoning-heavy checkboxes -> `hephaestus` / `unspecified-high`.
- Serialize only named dependencies (same-file writes, shared state); everything else runs in parallel.
- The orchestrator never edits product files itself - every implementation unit is delegated. It marks plan checkboxes only after the checkbox's QA passes.

### Phase 3 - QA (ultraqa)

After a wave's implementation lands, run the **`ultraqa`** skill to drive the relevant goal(s) to green:

- `ultraqa --tests`, `--build`, `--lint`, `--typecheck` for the automated gates.
- `ultraqa --manual "<scenario>"` or `--visual` for real-surface behavior (use the `visual-qa` skill for UI).

ultraqa is bounded (max 5 cycles, same-failure-3x early exit). If ultraqa stops without passing, treat its escalation as a blocker for Phase 4 and surface it - do not paper over it.

### Phase 4 - Review (multi-perspective)

Run the **`review-work`** skill (5 parallel reviewers: goal/constraint, hands-on QA, code quality, security, context mining) OR, for a lighter pass, dispatch `momus` plus `oracle` in parallel. ALL reviewers must pass:

- Any FAIL -> fix the specific findings (back through Phase 2/3 for that scope), then re-review only the failed lanes.
- INCONCLUSIVE lanes are not a pass - resolve or explicitly surface them.

### Phase 5 - Finalize

When every plan checkbox is complete, all QA gates are green, and all reviewers approve:

1. Run the plan's final verification commands once more and capture fresh passing output.
2. Clear autopilot/loop state (and `ralph-loop` state if this session owns it).
3. Report to the user: what was built, the plan path, the passing evidence (commands + exit 0 + artifacts), and any accepted non-blocking suggestions.

## Execution policy

- Each phase completes before the next begins; parallelism lives WITHIN Phase 2 (waves) and Phase 4 (reviewers).
- QA is bounded by `ultraqa`'s caps. Review requires unanimous approval; rejected items get fixed and re-validated.
- Stop and report when `ultraqa` hits its same-failure-3x or 5-cycle stop, when review keeps failing after 3 re-validation rounds, or when the user says stop/cancel/abort.

## Hard rules

1. **COMPOSE, DON'T REINVENT.** Use `ulw-plan`, `ralph-loop`, `parallel_tasks`, `ultraqa`, `review-work`/`momus` - never hand-roll planning, the persistence loop, or review.
2. **ORCHESTRATE, DON'T IMPLEMENT.** The autopilot root never edits product files or runs implementation commands itself - it dispatches workers and records verdicts.
3. **PLAN IS THE SOURCE OF TRUTH.** Drive off the `.omo/plans/` plan and its checkboxes; do not execute from stale memory.
4. **REAL EVIDENCE BEFORE DONE.** No completion claim without fresh passing command output and, where a surface exists, a captured manual/visual artifact. No `--dry-run` as evidence.
5. **VERIFICATION IS INDEPENDENT.** The reviewer/QA lane must be a different context from the implementer - never self-approve in the same pass.
6. **SMALLEST VIABLE SCOPE.** Build exactly what the plan specifies; flag over-engineering as scope creep.
