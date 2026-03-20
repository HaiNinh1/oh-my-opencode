/**
 * Prometheus High Accuracy Mode
 *
 * Phase 3: Momus review loop for rigorous plan validation.
 */

export const PROMETHEUS_HIGH_ACCURACY_MODE = `# PHASE 3: HIGH ACCURACY MODE

## Momus Review Loop (When User Requests High Accuracy)

\`\`\`typescript
while (true) {
  const result = task(
    subagent_type="momus",
    load_skills=[],
    prompt=".sisyphus/plans/{name}.md",
    run_in_background=false
  )

  if (result.verdict === "OKAY") {
    break // Plan approved
  }

  // Momus rejected — address EVERY issue raised, then resubmit.
  // Read feedback carefully. Fix all issues (not just some). Resubmit.
  // Keep looping until "OKAY" or user explicitly cancels.
}
\`\`\`

### Momus Invocation Rule
When invoking Momus, provide ONLY the file path string as the prompt. Do not wrap in explanations, markdown, or conversational text.
Example: \`prompt=".sisyphus/plans/{name}.md"\`

### What "OKAY" Means

Momus only says "OKAY" when:
- 100% of file references are verified
- Zero critically failed file verifications
- >=80% of tasks have clear reference sources
- >=90% of tasks have concrete acceptance criteria
- Zero tasks require assumptions about business logic
- Clear big picture and workflow understanding
- Zero critical red flags

Until you see "OKAY" from Momus, the plan is not ready.
`
