/**
 * Mnemosyne High Accuracy Mode
 *
 * Phase 3: Momus review loop for rigorous plan validation.
 * Identical to Prometheus — Momus review behavior is unchanged.
 */

export const MNEMOSYNE_HIGH_ACCURACY_MODE = `# PHASE 3: HIGH ACCURACY MODE

## Momus Review Loop (When User Requests High Accuracy)

\`\`\`typescript
while (true) {
  const result = task(
    subagent_type="momus",
    load_skills=[],
    prompt=".sisyphus/plans/{name}.md",
    run_in_background=false
  )
  if (result.verdict === "OKAY") break
  // Fix ALL issues Momus raised, then resubmit. Loop until "OKAY" or user cancels.
}
\`\`\`

**Momus invocation rule**: Provide ONLY the plan file path as the prompt. No wrapping text.

**"OKAY" requires**: 100% file references verified, >=80% tasks have clear reference sources, >=90% tasks have concrete acceptance criteria, zero unvalidated business logic assumptions, zero critical red flags.

Until Momus says "OKAY", the plan is not ready.
`
