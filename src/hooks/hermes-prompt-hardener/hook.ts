import { HermesProxyState } from "../../shared/hermes-proxy-state"
import { isHermesAgent } from "../hermes-routing-guard/agent-matcher"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { log } from "../../shared/logger"

const HOOK_NAME = "hermes-prompt-hardener"

type ChatMessagePart = { type: string; text?: string; [key: string]: unknown }

/**
 * Builds a task() call directive that tells Hermes exactly what to do.
 *
 * On turn 1 (no pinned child session): instructs Hermes to call
 * task(subagent_type="<target>", prompt="<user text>").
 *
 * On turn 2+ (pinned child session): instructs Hermes to call
 * task(session_id="<pinned>", prompt="<user text>").
 */
function buildTaskDirective(
  targetAgent: string,
  childSessionID: string | undefined,
  userText: string,
): string {
  const escapedPrompt = userText.replace(/"/g, '\\"')

  if (childSessionID) {
    return [
      `[HERMES ROUTING DIRECTIVE]`,
      `Execute this EXACT tool call now. Do not modify it. Do not respond with text.`,
      ``,
      `task(session_id="${childSessionID}", prompt="${escapedPrompt}")`,
      ``,
      `After the task completes, respond ONLY with: Session: ${childSessionID}`,
      `[END DIRECTIVE]`,
    ].join("\n")
  }

  return [
    `[HERMES ROUTING DIRECTIVE]`,
    `Execute this EXACT tool call now. Do not modify it. Do not respond with text.`,
    ``,
    `task(subagent_type="${targetAgent}", prompt="${escapedPrompt}")`,
    ``,
    `After the task completes, respond ONLY with: Session: <session_id from result>`,
    `[END DIRECTIVE]`,
  ].join("\n")
}

/**
 * Extracts the user's raw text from output.parts, filtering out:
 * - Synthetic parts (OpenCode's auto-generated delegation text)
 * - Agent parts
 * - @AgentName mentions left in text parts
 * Returns the clean user intent only.
 */
function extractUserText(parts: ChatMessagePart[]): string {
  return parts
    .filter((p) => p.type === "text" && typeof p.text === "string" && !p.synthetic)
    .map((p) => (p.text as string).replace(/@\S+(?:\s+\([^)]*\))?/g, ""))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Injects a precise task() call directive into the user message for Hermes sessions.
 *
 * This hook prepends a routing directive to the first text part, telling Hermes
 * exactly which task() call to make. The directive is authoritative - Hermes's
 * system prompt is tuned to follow it mechanically.
 */
export function createHermesPromptHardenerHook() {
  return {
    "chat.message": async (
      input: {
        sessionID: string
        agent?: string
      },
      output: {
        message: Record<string, unknown>
        parts: ChatMessagePart[]
      },
    ): Promise<void> => {
      const currentAgent = getSessionAgent(input.sessionID) ?? input.agent
      if (!isHermesAgent(currentAgent)) {
        return
      }

      const proxyState = HermesProxyState.get(input.sessionID)
      if (!proxyState) {
        return
      }

      const userText = extractUserText(output.parts)
      if (!userText) {
        log(`[${HOOK_NAME}] No user text found, skipping directive injection`, {
          sessionID: input.sessionID,
        })
        return
      }

      const directive = buildTaskDirective(
        proxyState.targetAgent,
        proxyState.childSessionID,
        userText,
      )

      // Prepend directive to the first non-synthetic text part
      const textPartIndex = output.parts.findIndex(
        (p) => p.type === "text" && p.text !== undefined && !p.synthetic,
      )
      if (textPartIndex === -1) {
        return
      }

      const originalText = output.parts[textPartIndex].text ?? ""
      output.parts[textPartIndex].text = `${directive}\n\n---\n\n${originalText}`

      log(`[${HOOK_NAME}] Injected task directive for Hermes proxy session`, {
        sessionID: input.sessionID,
        targetAgent: proxyState.targetAgent,
        hasPinnedSession: !!proxyState.childSessionID,
      })
    },
  }
}
