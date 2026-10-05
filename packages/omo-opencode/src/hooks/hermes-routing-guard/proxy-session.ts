import {
  HERMES_ALLOWED_AGENTS_SET,
  HERMES_ALLOWED_SUBAGENT_TYPES,
  resolveAgentAbbreviation,
} from "./constants"
import { isHermesAgent } from "./agent-matcher"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { HermesProxyState } from "../../shared/hermes-proxy-state"
import { log } from "../../shared/logger"

type ChatMessagePart = { type: string; name?: string; [key: string]: unknown }

type FirstMessageVariantGate = {
  shouldOverride: (sessionID: string) => boolean
  markApplied: (sessionID: string) => void
}

type ProxySessionInput = {
  sessionID: string
  agent?: string
}

type ProxySessionOutput = {
  message: Record<string, unknown>
  parts: ChatMessagePart[]
}

/**
 * Hermes proxy session bootstrapping for the chat.message lifecycle.
 *
 * Responsibilities (all no-ops for non-Hermes sessions):
 * - Reset the per-turn task-fired flag so the one-task-per-turn guard works.
 * - On the first root message, parse the @agent mention and pin the proxy target.
 *   When no @agent is present, default to "sisyphus" and inject an AgentPart so the
 *   TUI recognizes the Hermes proxy parent.
 *
 * Throws if more than one @agent is referenced or the referenced agent is not in the
 * Hermes routing table — surfacing a clear error to the user instead of mis-routing.
 */
export function applyHermesProxySessionBootstrap(
  input: ProxySessionInput,
  output: ProxySessionOutput,
  firstMessageVariantGate: FirstMessageVariantGate,
): void {
  if (!isHermesAgent(input.agent)) {
    return
  }

  // Hermes proxy: reset per-turn task limit flag
  HermesProxyState.resetTurnFlag(input.sessionID)

  if (HermesProxyState.hasTarget(input.sessionID)) {
    return
  }

  const isFirstRootMessage = firstMessageVariantGate.shouldOverride(input.sessionID)
  if (!isFirstRootMessage) {
    return
  }

  const agentParts = output.parts.filter(
    (p) => p.type === "agent" && typeof p.name === "string",
  )

  if (agentParts.length === 0) {
    // Default to Sisyphus when no @agent specified
    const defaultTarget = "sisyphus"
    HermesProxyState.setTarget(input.sessionID, defaultTarget)
    // Inject AgentPart so TUI can detect this as a Hermes proxy parent for auto-navigate.
    // Must include id/sessionID/messageID for OpenCode's persistence layer (SyncEvent).
    const messageID = (output.message as { id?: string }).id ?? ""
    output.parts.push({
      type: "agent",
      name: defaultTarget,
      id: `prt_hermes_default_agent_${input.sessionID}`,
      sessionID: input.sessionID,
      messageID,
    })
    log("[hermes-proxy] No @agent specified, defaulting to sisyphus", {
      sessionID: input.sessionID,
      targetAgent: defaultTarget,
    })
    firstMessageVariantGate.markApplied(input.sessionID)
    return
  }

  if (agentParts.length > 1) {
    throw new Error(
      "Only one @agent-name allowed per session. Choose a single target agent.",
    )
  }

  const rawAgentName = agentParts[0].name as string
  const normalizedName = getAgentConfigKey(resolveAgentAbbreviation(rawAgentName.trim()))

  if (!HERMES_ALLOWED_AGENTS_SET.has(normalizedName)) {
    const allowedList = HERMES_ALLOWED_SUBAGENT_TYPES.join(", ")
    throw new Error(
      `Agent '${rawAgentName}' is not available for Hermes proxy routing. Use one of: ${allowedList}`,
    )
  }

  HermesProxyState.setTarget(input.sessionID, normalizedName)
  log("[hermes-proxy] First message proxy target set", {
    sessionID: input.sessionID,
    targetAgent: normalizedName,
    rawAgentName,
  })
  firstMessageVariantGate.markApplied(input.sessionID)
}
