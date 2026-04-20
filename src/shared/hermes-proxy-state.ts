/**
 * Hermes Proxy State Registry
 *
 * Maintains a mapping of Hermes parent session IDs to their pinned proxy target
 * and child session ID. Used by:
 * - chat-message.ts: first-message AgentPart parsing to set proxy target
 * - hermes-routing-guard: enforce pinned session routing and rewrite task() args
 * - tool-execute-after.ts: capture child session ID on first successful task()
 * - event.ts: cleanup on session.deleted
 *
 * Survives across turns and compaction in-process. Does NOT survive plugin restart.
 */

import { log } from "./logger"

export interface HermesProxyMetadata {
  targetAgent: string
  childSessionID?: string
  taskFiredThisTurn?: boolean
}

const hermesProxyStore = new Map<string, HermesProxyMetadata>()
const turnFlags = new Map<string, boolean>()

export const HermesProxyState = {
  /**
   * Set the proxy target agent for a Hermes session (first turn).
   * Does not overwrite an existing target - call clear first if re-targeting.
   */
  setTarget: (sessionID: string, targetAgent: string): void => {
    if (hermesProxyStore.has(sessionID)) {
      log("[hermes-proxy-state] Target already set, ignoring duplicate", {
        sessionID,
        existingTarget: hermesProxyStore.get(sessionID)?.targetAgent,
        attemptedTarget: targetAgent,
      })
      return
    }

    hermesProxyStore.set(sessionID, { targetAgent })
    log("[hermes-proxy-state] Proxy target set", { sessionID, targetAgent })
  },

  /**
   * Pin the child session ID after first successful task() delegation.
   * Only pins if a target is already set and no child is pinned yet.
   */
  pinChildSession: (sessionID: string, childSessionID: string): void => {
    const existing = hermesProxyStore.get(sessionID)
    if (!existing) {
      log("[hermes-proxy-state] Cannot pin child: no proxy target set", {
        sessionID,
        childSessionID,
      })
      return
    }

    if (existing.childSessionID) {
      log("[hermes-proxy-state] Child already pinned, ignoring duplicate", {
        sessionID,
        existingChild: existing.childSessionID,
        attemptedChild: childSessionID,
      })
      return
    }

    existing.childSessionID = childSessionID
    log("[hermes-proxy-state] Child session pinned", {
      sessionID,
      targetAgent: existing.targetAgent,
      childSessionID,
    })
  },

  /**
   * Get the proxy state for a session. Returns undefined if not a proxy session.
   */
  get: (sessionID: string): HermesProxyMetadata | undefined => {
    return hermesProxyStore.get(sessionID)
  },

  /**
   * Check if a session has a proxy target set (with or without pinned child).
   */
  hasTarget: (sessionID: string): boolean => {
    return hermesProxyStore.has(sessionID)
  },

  /**
   * Check if a session has a pinned child session.
   */
  isPinned: (sessionID: string): boolean => {
    return hermesProxyStore.get(sessionID)?.childSessionID !== undefined
  },

  /**
   * Reset the per-turn task-fired flag. Call at the start of each chat.message.
   */
  resetTurnFlag: (sessionID: string): void => {
    turnFlags.delete(sessionID)
  },

  /**
   * Mark that a task() call has been fired this turn.
   */
  markTaskFired: (sessionID: string): void => {
    turnFlags.set(sessionID, true)
  },

  /**
   * Check whether a task() call has already been fired this turn.
   */
  hasTaskFiredThisTurn: (sessionID: string): boolean => {
    return turnFlags.get(sessionID) === true
  },

  /**
   * Clear proxy state for a session (cleanup on session.deleted).
   */
  clear: (sessionID: string): void => {
    const existed = hermesProxyStore.delete(sessionID)
    turnFlags.delete(sessionID)
    if (existed) {
      log("[hermes-proxy-state] Proxy state cleared", { sessionID })
    }
  },

  /**
   * Get the size of the registry (for debugging).
   */
  size: (): number => {
    return hermesProxyStore.size
  },

  /**
   * Clear all entries (use with caution, mainly for testing).
   */
  clearAll: (): void => {
    hermesProxyStore.clear()
    turnFlags.clear()
  },
}
