export const HOOK_NAME = "hermes-routing-guard"

export const HERMES_AGENT_NAMES = ["hermes"]

/**
 * Hermes's allowed routing table: subagent_type values it can legitimately call.
 * Derived from the Hermes agent prompt's AVAILABLE AGENTS table.
 */
export const HERMES_ALLOWED_SUBAGENT_TYPES = [
  "atlas",
  "prometheus",
  "mnemosyne",
  "heracles",
  "hephaestus",
  "sisyphus",
] as const

export function buildCategoryViolationMessage(category: string): string {
  const allowedList = HERMES_ALLOWED_SUBAGENT_TYPES.join(", ")
  return `[${HOOK_NAME}] Hermes CANNOT use category-based routing (attempted category: "${category}").

Hermes is a TASK ROUTER, not an orchestrator. Category routing spawns Sisyphus-Junior, which is NOT in your routing table.

You MUST use subagent_type to route to a SPECIFIC agent. Your allowed targets:
${allowedList}

HOW TO FIX:
1. Identify the correct target agent from your AVAILABLE AGENTS table
2. Use subagent_type="<agent>" instead of category="<category>"
3. For Sisyphus Default, Mnemosyne, or Hephaestus: just forward directly — task(subagent_type="<agent>", prompt="<user request>")
4. For other agents: fetch the agent's prompt template with get_agent_prompts() first

Example: task(subagent_type="sisyphus", prompt="...")`
}

export function buildSubagentViolationMessage(subagentType: string): string {
  const allowedList = HERMES_ALLOWED_SUBAGENT_TYPES.join(", ")
  return `[${HOOK_NAME}] Hermes attempted to route to unauthorized agent: "${subagentType}".

"${subagentType}" is NOT in your routing table. You can ONLY route to these agents:
${allowedList}

HOW TO FIX:
1. Re-read the user's request to identify which AVAILABLE AGENT they want
2. Use one of the allowed subagent_type values listed above
3. If the user asked for "${subagentType}", route to the closest match from your table:
   - For orchestration/execution: atlas or heracles
   - For planning: prometheus or mnemosyne
   - For deep work: hephaestus
   - For general work: sisyphus`
}
