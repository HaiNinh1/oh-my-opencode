import { getAgentConfigKey } from "./agent-display-names"

// Pure router agents excluded from prompt-injecting hooks (keyword-detector, think-mode, todo-continuation)
const PASSTHROUGH_AGENTS = ["hermes"] as const

export type PassthroughAgent = (typeof PASSTHROUGH_AGENTS)[number]

export function isPassthroughAgent(agentName: string | undefined | null): boolean {
  if (!agentName) return false
  const key = getAgentConfigKey(agentName)
  return PASSTHROUGH_AGENTS.some((a) => getAgentConfigKey(a) === key)
}
