/**
 * Metis nested-subagent reminder.
 *
 * Defense-in-depth for the Metis "no questions" guarantee. The Metis prompt
 * already instructs advisory-only output (questions with recommended defaults),
 * but when Metis is invoked as a nested subagent under another agent we inject
 * an extra system reminder so the model has zero ambiguity that there is no
 * human in the turn.
 *
 * Primary callers (no parentAgent) are NOT affected.
 */

const METIS_AGENT_NAME = "metis"

const NESTED_REMINDER_TEMPLATE = (parentAgent: string) => `<nested-subagent-reminder>
You are running as a nested subagent under "${parentAgent}". There is NO human
in this turn. NEVER ask follow-up questions that block the parent flow. List
any clarifications under "Advisory Questions for Planner" with your recommended
default answer. The parent agent will proceed using your defaults.
</nested-subagent-reminder>`

/**
 * Returns a system-content string augmented with a nested-subagent reminder
 * when the target is Metis and a parent agent is present. Otherwise returns
 * the original system content unchanged.
 */
export function withMetisNestedReminder(
  agentToUse: string,
  parentAgent: string | undefined,
  systemContent: string | undefined
): string | undefined {
  if (agentToUse.toLowerCase() !== METIS_AGENT_NAME) return systemContent
  if (!parentAgent || !parentAgent.trim()) return systemContent

  const reminder = NESTED_REMINDER_TEMPLATE(parentAgent.trim())
  if (!systemContent || !systemContent.trim()) return reminder
  return `${reminder}\n\n${systemContent}`
}
