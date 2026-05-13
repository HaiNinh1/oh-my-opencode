/**
 * Tracks session IDs created by the prompt enhancer agent.
 * Used to identify enhancer sessions in hooks that lack agent context
 * (e.g. experimental.chat.system.transform only receives sessionID).
 */
export const enhancerSessions = new Set<string>();
