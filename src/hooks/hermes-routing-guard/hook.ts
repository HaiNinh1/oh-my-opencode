import type { PluginInput } from "@opencode-ai/plugin"
import {
  HOOK_NAME,
  HERMES_ALLOWED_SUBAGENT_TYPES,
  buildCategoryViolationMessage,
  buildSubagentViolationMessage,
  resolveAgentAbbreviation,
} from "./constants"
import { isHermesAgent } from "./agent-matcher"
import { getAgentFromSession } from "../prometheus-md-only/agent-resolution"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { log } from "../../shared/logger"

export function createHermesRoutingGuardHook(ctx: PluginInput) {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> },
    ): Promise<void> => {
      if (input.tool !== "task") {
        return
      }

      const agentName = await getAgentFromSession(input.sessionID, ctx.directory, ctx.client)

      if (!isHermesAgent(agentName)) {
        return
      }

      const category = typeof output.args.category === "string" ? output.args.category : undefined
      const subagentType = typeof output.args.subagent_type === "string" ? output.args.subagent_type : undefined

      if (category) {
        log(`[${HOOK_NAME}] Blocked: Hermes attempted category-based routing`, {
          sessionID: input.sessionID,
          category,
          agent: agentName,
        })
        throw new Error(buildCategoryViolationMessage(category))
      }

      if (!subagentType) {
        return
      }

      const normalizedType = getAgentConfigKey(resolveAgentAbbreviation(subagentType.trim()))
      const isAllowed = HERMES_ALLOWED_SUBAGENT_TYPES.some(
        allowed => normalizedType === allowed
      )

      if (!isAllowed) {
        log(`[${HOOK_NAME}] Blocked: Hermes attempted routing to unauthorized agent`, {
          sessionID: input.sessionID,
          subagentType,
          agent: agentName,
        })
        throw new Error(buildSubagentViolationMessage(subagentType))
      }

      log(`[${HOOK_NAME}] Allowed: Hermes routing to ${subagentType}`, {
        sessionID: input.sessionID,
        subagentType,
        agent: agentName,
      })
    },
  }
}
