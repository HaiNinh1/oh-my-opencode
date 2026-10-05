import { getSessionAgent } from "../../features/claude-code-session-state"
import { isHermesAgent } from "./agent-matcher"
import { HermesProxyState } from "../../shared/hermes-proxy-state"
import { log } from "../../shared/logger"

type SessionAborter = {
  client?: {
    session?: {
      abort?: (input: { path: { id: string } }) => Promise<unknown>
    }
  }
}

/**
 * Hermes proxy: capture the child session ID from a completed task() call and pin it,
 * then abort the Hermes parent session so it cannot emit further text or tool calls.
 *
 * No-op unless the parent session is a Hermes proxy session with a target set.
 * Safe to call on every task tool.execute.after.
 */
export function pinHermesChildSession(
  ctx: SessionAborter,
  parentSessionID: string,
  metadataSessionId: string | undefined,
  outputText: string | undefined,
): void {
  const parentAgent = getSessionAgent(parentSessionID)
  const isHermesProxy = isHermesAgent(parentAgent) && HermesProxyState.hasTarget(parentSessionID)
  if (!isHermesProxy) {
    return
  }

  if (!HermesProxyState.isPinned(parentSessionID)) {
    // Try metadata first, then parse from output text
    let childSessionId = metadataSessionId

    if (!childSessionId && typeof outputText === "string") {
      const match = outputText.match(/session_id:\s*(ses_[a-zA-Z0-9]+)/)
      childSessionId = match?.[1]
    }

    if (childSessionId) {
      HermesProxyState.pinChildSession(parentSessionID, childSessionId)
      log("[hermes-proxy] Child session pinned via tool.execute.after", {
        parentSessionID,
        childSessionID: childSessionId,
        targetAgent: HermesProxyState.get(parentSessionID)?.targetAgent,
      })
    }
  }

  // Abort Hermes session after every task() completion — its job is done for this turn.
  // This prevents Hermes from generating further text or making additional tool calls.
  // Works on both turn 1 (after pinning) and turn 2+ (already pinned).
  ctx.client?.session?.abort?.({ path: { id: parentSessionID } })?.catch?.(() => {})
}
