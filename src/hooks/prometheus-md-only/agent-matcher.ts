import { PLANNER_AGENTS } from "./constants"

export function isPrometheusAgent(agentName: string | undefined): boolean {
  if (!agentName) return false
  const lower = agentName.toLowerCase()
  return PLANNER_AGENTS.some(name => lower.includes(name))
}
