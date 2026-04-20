import type { Message, Part, Session } from "@opencode-ai/sdk/v2"

/**
 * Hermes transparent proxy detection helpers.
 *
 * These rely purely on existing session/message data — no plugin state needed.
 * A Hermes proxy parent is a root session whose first user message was sent by
 * the Hermes agent and contains an @agent AgentPart selecting the target.
 * A Hermes proxy child is a child session whose parent is a Hermes proxy parent.
 */

/** Check whether an agent name refers to Hermes. */
export function isHermesAgent(agentName: string): boolean {
  return agentName.toLowerCase().includes("hermes")
}

/** Extract the proxy target agent name from a session's first user message. */
export function getProxyTarget(
  sessionID: string,
  messageStore: Record<string, Message[]>,
  partStore: Record<string, Part[]>,
): string | undefined {
  const messages = messageStore[sessionID]
  if (!messages) return undefined
  const firstUser = messages.find((m) => m.role === "user")
  if (!firstUser) return undefined
  const parts = partStore[firstUser.id]
  if (!parts) return undefined
  const agentPart = parts.find((p) => p.type === "agent")
  if (agentPart && "name" in agentPart) return (agentPart as { type: "agent"; name: string }).name
  return undefined
}

/** Check whether a session is a Hermes proxy parent (root session, Hermes agent, has @agent target). */
export function isHermesProxyParent(
  session: Session | undefined,
  messageStore: Record<string, Message[]>,
  partStore: Record<string, Part[]>,
): boolean {
  if (!session) return false
  if (session.parentID) return false
  const messages = messageStore[session.id]
  if (!messages) return false
  const firstUser = messages.find((m) => m.role === "user")
  if (!firstUser) return false
  if (!isHermesAgent(firstUser.agent)) return false
  return getProxyTarget(session.id, messageStore, partStore) !== undefined
}

/** Check whether a session is a Hermes proxy child. Requires parent data to be synced. */
export function isHermesProxyChild(
  session: Session | undefined,
  messageStore: Record<string, Message[]>,
  partStore: Record<string, Part[]>,
  sessionGetter: (id: string) => Session | undefined,
): boolean {
  if (!session?.parentID) return false
  const parent = sessionGetter(session.parentID)
  return isHermesProxyParent(parent, messageStore, partStore)
}

/**
 * Find the best child session of a Hermes proxy parent.
 * Prefers the most recently created child that has messages.
 * Falls back to the most recently created child if none have messages.
 */
export function findHermesProxyChild(
  parentSessionID: string,
  sessions: Session[],
  messageStore?: Record<string, Message[]>,
): Session | undefined {
  const children = sessions
    .filter((s) => s.parentID === parentSessionID)
    .toSorted((a, b) => b.time.created - a.time.created) // newest first

  if (!children.length) return undefined

  // If we have message data, prefer the newest child that actually has messages
  if (messageStore) {
    const withMessages = children.find((c) => {
      const msgs = messageStore[c.id]
      return msgs && msgs.length > 0
    })
    if (withMessages) return withMessages
  }

  // Fallback: newest child (even if no messages loaded yet)
  return children[0]
}
