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
import { HermesProxyState } from "../../shared/hermes-proxy-state"


export function createHermesRoutingGuardHook(ctx: PluginInput) {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> },
    ): Promise<void> => {
      const agentName = await getAgentFromSession(input.sessionID, ctx.directory, ctx.client)

      if (!isHermesAgent(agentName)) {
        return
      }


      if (input.tool !== "task") {
        return
      }

      // One task per turn enforcement: block if Hermes already fired a task() this turn.
      // This only triggers after the first task completed and Hermes tries to call again.
      // Tell Hermes to output the session ID from the completed result instead.
      if (HermesProxyState.hasTaskFiredThisTurn(input.sessionID)) {
        const proxyState = HermesProxyState.get(input.sessionID)
        const childID = proxyState?.childSessionID ?? "<session_id from the task result>"
        log(`[${HOOK_NAME}] Blocked: Hermes already fired task() this turn`, {
          sessionID: input.sessionID,
        })
        throw new Error(
          `[${HOOK_NAME}] You already completed a task() call this turn response with the session ID and stop immediately. ` +
          `Do NOT call task() again. Respond ONLY with: Session: ${childID}`
        )
      }

      const proxyState = HermesProxyState.get(input.sessionID)

      // Proxy enforcement for task() calls when proxy target is set
      if (proxyState) {
        // Block background mode in proxy sessions
        if (output.args.run_in_background === true) {
          log(`[${HOOK_NAME}] Blocked: background mode in proxy session`, {
            sessionID: input.sessionID,
          })
          throw new Error(
            `[${HOOK_NAME}] Background routing is not supported in proxy mode. ` +
            `Use synchronous task() calls to route to '${proxyState.targetAgent}'.`
          )
        }

        // Block category routing (existing behavior, reinforced)
        const category = typeof output.args.category === "string" ? output.args.category : undefined
        if (category) {
          log(`[${HOOK_NAME}] Blocked: category routing in proxy session`, {
            sessionID: input.sessionID,
            category,
          })
          throw new Error(buildCategoryViolationMessage(category))
        }

        if (proxyState.childSessionID) {
          // Post-pin: rewrite all task() calls to use the pinned child session
          const existingSessionId = typeof output.args.session_id === "string"
            ? output.args.session_id
            : undefined

          // Allow if task already targets the correct child session
          if (existingSessionId === proxyState.childSessionID) {
            log(`[${HOOK_NAME}] Allowed: task() targeting pinned child session`, {
              sessionID: input.sessionID,
              childSessionID: proxyState.childSessionID,
            })
            HermesProxyState.markTaskFired(input.sessionID)
            return
          }

          // Rewrite task() to target pinned child session
          output.args.session_id = proxyState.childSessionID
          delete output.args.category
          delete output.args.subagent_type
          log(`[${HOOK_NAME}] Rewrote: task() args to pinned child session`, {
            sessionID: input.sessionID,
            childSessionID: proxyState.childSessionID,
            targetAgent: proxyState.targetAgent,
          })
          HermesProxyState.markTaskFired(input.sessionID)
          return
        }

        // Pre-pin: validate that the first task() call matches the declared target
      const subagentType = typeof output.args.subagent_type === "string" ? output.args.subagent_type : undefined

        if (subagentType) {
          const normalizedType = getAgentConfigKey(resolveAgentAbbreviation(subagentType.trim()))
          if (normalizedType !== proxyState.targetAgent) {
            log(`[${HOOK_NAME}] Blocked: task() target mismatch with proxy target`, {
              sessionID: input.sessionID,
              declaredTarget: proxyState.targetAgent,
              attemptedTarget: subagentType,
            })
            throw new Error(
              `[${HOOK_NAME}] Cannot route to '${subagentType}'. ` +
              `Session is pinned to '${proxyState.targetAgent}'. ` +
              `Use task(subagent_type="${proxyState.targetAgent}", prompt="...") instead.`
            )
          }

          log(`[${HOOK_NAME}] Allowed: first task() matches proxy target`, {
            sessionID: input.sessionID,
            targetAgent: proxyState.targetAgent,
          })
          HermesProxyState.markTaskFired(input.sessionID)
          return
        }

        // Pre-pin: reject session_id since no child session has been created yet.
        // Hermes should not have a valid session_id to continue before the first successful task().
        const sessionId = typeof output.args.session_id === "string"
          ? output.args.session_id
          : undefined
        if (sessionId) {
          log(`[${HOOK_NAME}] Blocked: task() with session_id before child session is pinned`, {
            sessionID: input.sessionID,
            attemptedSessionID: sessionId,
            targetAgent: proxyState.targetAgent,
          })
          throw new Error(
            `[${HOOK_NAME}] Cannot continue session '${sessionId}' before first task completion. ` +
            `Call task(subagent_type="${proxyState.targetAgent}", prompt="...") to start the proxy session.`
          )
        }

        // No subagent_type and no session_id - allow through (Hermes may still be deciding)
        HermesProxyState.markTaskFired(input.sessionID)
        return
      }

      // Original guard logic for non-proxy Hermes sessions
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
        HermesProxyState.markTaskFired(input.sessionID)
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
      HermesProxyState.markTaskFired(input.sessionID)
    },
  }
}
