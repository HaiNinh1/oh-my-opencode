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

- **What to do**: Clear implementation steps + test cases
- **Must NOT do**: Specific exclusions from guardrails
- **References**: Exhaustive file paths with line ranges — the executor has NO interview context
- **Acceptance Criteria**: Every criterion verifiable by command or tool, zero human intervention
- **QA Scenarios**: Tool (Playwright/Bash/tmux), steps, expected result, evidence path (\`.sisyphus/evidence/task-{N}-{slug}.{ext}\`)
- **Commit**: YES/NO (groups with N), message format: \`type(scope): desc\`

### Final Verification Section

After all TODOs, include a self-executed checklist:
- Plan compliance (must-haves present, must-NOT-haves absent)
- Build & tests pass (\`tsc --noEmit\`, \`bun test\`, \`lsp_diagnostics\` clean)
- Code quality (no \`as any\`, \`@ts-ignore\`, empty catches, console.log in prod)
- QA evidence files exist
- Scope fidelity (each task's diff matches its spec)

---
`
