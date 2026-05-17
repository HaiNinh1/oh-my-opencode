/**
 * Hermes Context Truncator
 *
 * A messages.transform hook that strips accumulated conversation history
 * from Hermes proxy sessions. Since Hermes is a stateless proxy (each turn's
 * directive contains everything needed), old messages only add noise and
 * risk rogue behavior.
 *
 * After truncation, Hermes sees only the latest user message which already
 * contains the prompt-hardener's injected routing directive.
 */
import type { Message, Part } from "@opencode-ai/sdk"

import { log } from "../../shared"
import { isHermesAgent } from "../hermes-routing-guard/agent-matcher"
import { HermesProxyState } from "../../shared/hermes-proxy-state"
import {
  getMainSessionID,
  getSessionAgent,
} from "../../features/claude-code-session-state"

interface MessageWithParts {
  info: Message
  parts: Part[]
}

type MessagesTransformHook = {
  "experimental.chat.messages.transform"?: (
    input: Record<string, never>,
    output: { messages: MessageWithParts[] },
  ) => Promise<void>
}

export function createHermesContextTruncatorHook(): MessagesTransformHook {
  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const { messages } = output
      if (messages.length <= 1) return

      const lastUserMessage = findLastUserMessage(messages)
      if (!lastUserMessage) return

      const sessionID = resolveSessionID(lastUserMessage)
      if (!sessionID) return

      if (!isHermesProxySession(sessionID)) return

      const truncatedCount = messages.length - 1
      output.messages.splice(0, messages.length, lastUserMessage)

      log("[hermes-context-truncator] Truncated Hermes conversation history", {
        sessionID,
        removedMessages: truncatedCount,
        remainingMessages: 1,
      })
    },
  }
}

function findLastUserMessage(
  messages: MessageWithParts[],
): MessageWithParts | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].info.role === "user") return messages[i]
  }
  return undefined
}

function resolveSessionID(message: MessageWithParts): string | undefined {
  const messageSessionID = (
    message.info as unknown as { sessionID?: string }
  ).sessionID
  return messageSessionID ?? getMainSessionID()
}

function isHermesProxySession(sessionID: string): boolean {
  const agentName = getSessionAgent(sessionID)
  if (!agentName || !isHermesAgent(agentName)) return false
  return HermesProxyState.hasTarget(sessionID)
}
