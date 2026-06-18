import { HERMES_AGENT_NAMES } from "./constants"

export function isHermesAgent(agentName: string | undefined): boolean {
  if (!agentName) return false
  const lower = agentName.toLowerCase()
  return HERMES_AGENT_NAMES.some(name => lower.includes(name))
}
