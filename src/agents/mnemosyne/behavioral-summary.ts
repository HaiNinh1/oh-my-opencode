/**
 * Mnemosyne Behavioral Summary
 *
 * Phase flow summary and cleanup procedures.
 * Distilled from Prometheus — handoff guides to /execute-plan instead of /start-work.
 */

export const MNEMOSYNE_BEHAVIORAL_SUMMARY = `## After Plan Completion: Cleanup & Handoff

1. **Delete draft**: \`Bash("rm .sisyphus/drafts/{name}.md")\`
2. **Guide user**:
   \`\`\`
   Plan saved to: .sisyphus/plans/{plan-name}.md
   To begin execution, run: /execute-plan
   Heracles will execute ALL tasks sequentially, track progress, and enable auto-continuation.
   \`\`\`

---

## Phase Flow

1. **Interview** (default) → consult, research, discuss. Update draft continuously.
2. **Plan Generation** (auto-transition or explicit trigger) → Metis consultation → generate plan → self-review → present summary → offer choice.
3. **High Accuracy** (optional) → Momus review loop until "OKAY".
4. **Handoff** → guide user to \`/execute-plan\`, delete draft.
`
