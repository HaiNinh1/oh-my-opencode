/**
 * Mnemosyne Plan Template
 *
 * Adaptive section requirements for plan generation.
 * Scales with task complexity instead of enforcing a rigid template.
 */

export const MNEMOSYNE_PLAN_TEMPLATE = `## Plan Structure

Generate plan to: \`.sisyphus/plans/{name}.md\`

### Required Sections (ALL plans)

1. **TL;DR** — 1-2 sentence summary, bullet list of deliverables, estimated effort (Quick/Short/Medium/Large/XL), task count
2. **Context** — original request, interview summary, key decisions, research findings, Metis review gaps addressed
3. **Work Objectives** — core objective, concrete deliverables, definition of done (verifiable conditions), must-haves, must-NOT-haves (guardrails)
4. **Verification Strategy** — test decision (TDD/tests-after/none), QA policy (every task gets agent-executed QA scenarios)
5. **TODOs** — ordered by dependency, implementation + test = one task

### Per-Task Format

Each TODO must include:
> Implementation + Test = ONE Task. Never separate.
> Agent-Executed QA Scenarios are mandatory for all tasks.

- [ ] 1. [Task Title]
- **What to do**: Clear implementation steps + test cases
- **Must NOT do**: Specific exclusions from guardrails
- **References**: Exhaustive file paths with line ranges — the executor has NO interview context
- **Acceptance Criteria**: Every criterion verifiable by command or tool, zero human intervention
- **QA Scenarios**: Tool (Playwright/Bash/tmux), steps, expected result, evidence path (\`.sisyphus/evidence/task-{N}-{slug}.{ext}\`)
- **Commit**: YES/NO (groups with N), message format: \`type(scope): desc\`

### Final Verification Wave (MANDATORY — after ALL tasks)

> 4 review agents run in PARALLEL via \`parallel_tasks\`. ALL must APPROVE.
> Present results to user — wait for explicit "okay" before completing.
> Rejection → fix → re-run reviewer → present again → wait for okay.

- [ ] F1. **Plan Compliance Audit** — \`oracle\`
  Verify every must-have exists, every must-NOT-have is absent. Check evidence files in .sisyphus/evidence/.
  Output: \`Must Have [N/N] | Must NOT Have [N/N] | VERDICT: APPROVE/REJECT\`

- [ ] F2. **Code Quality Review** — \`unspecified-high\`
  Run \`tsc --noEmit\` + \`bun test\`. Check changed files for \`as any\`, \`@ts-ignore\`, empty catches, console.log, AI slop.
  Output: \`Build [PASS/FAIL] | Tests [N pass/N fail] | VERDICT\`

- [ ] F3. **QA Scenarios** — \`unspecified-high\`
  Execute ALL QA scenarios from every task. Test cross-task integration and edge cases. Save evidence to \`.sisyphus/evidence/final-qa/\`.
  Output: \`Scenarios [N/N pass] | Integration [N/N] | VERDICT\`

- [ ] F4. **Scope Fidelity** — \`deep\`
  Compare each task's spec vs actual diff. Flag missing implementations, scope creep, and cross-task contamination.
  Output: \`Tasks [N/N compliant] | Contamination [CLEAN/N issues] | VERDICT\`
---
`
