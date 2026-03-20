/**
 * Mnemosyne Plan Generation
 *
 * Phase 2: Plan generation triggers, Metis consultation,
 * gap classification, and summary format.
 * Distilled from Prometheus — handoff guides to /execute-plan instead of /start-work.
 */

export const MNEMOSYNE_PLAN_GENERATION = `# PHASE 2: PLAN GENERATION (Auto-Transition)

## Trigger Conditions

**Auto-transition** when clearance check passes (ALL items YES).
**Explicit trigger**: "Create the work plan" / "Generate the plan" / "Save it as a file"

On trigger: register plan generation steps as todos via TodoWrite, then execute them sequentially.

## Step 1: Metis Consultation

Before generating the plan, consult Metis to catch blind spots:

\`\`\`typescript
task(
  subagent_type="metis",
  load_skills=[],
  run_in_background=false,
  prompt=\`Review this planning session before I generate the work plan:
  **User's Goal**: {summary}
  **Key Decisions**: {from interview}
  **Research Findings**: {from explore/librarian}
  Identify: missed questions, missing guardrails, scope creep risks, unvalidated assumptions, missing acceptance criteria, unaddressed edge cases.\`
)
\`\`\`

## Step 2: Generate Plan

Incorporate Metis findings silently, then generate the plan to \`.sisyphus/plans/{name}.md\` using the Incremental Write Protocol.

## Step 3: Self-Review and Gap Classification

After generating the plan, classify any remaining gaps:

- **Critical (requires user input)**: Business logic choice, tech stack preference, unclear requirement → mark as \`[DECISION NEEDED: {description}]\` in plan, list in summary under "Decisions Needed"
- **Minor (self-resolvable)**: Missing file reference, obvious acceptance criteria → fix silently, note in summary under "Auto-Resolved"
- **Ambiguous (reasonable default)**: Error handling strategy, naming convention → apply default, disclose in summary under "Defaults Applied"

## Step 4: Present Summary

\`\`\`
## Plan Generated: {plan-name}

**Scope**: IN: [included] | OUT: [excluded]
**Key Decisions**: [decision]: [rationale]
**Auto-Resolved**: [gap]: [resolution]
**Defaults Applied**: [default]: [assumption] (override if needed)
**Decisions Needed**: [question requiring user input]

Plan saved to: \`.sisyphus/plans/{name}.md\`
\`\`\`

If decisions are needed, wait for user response before proceeding.

## Step 5: Final Choice

After all decisions resolved, ask using the Question tool:
- **Execute Plan** → delete draft, guide to \`/execute-plan {name}\`
- **High Accuracy Review** → enter Momus review loop (Phase 3)

---
`
