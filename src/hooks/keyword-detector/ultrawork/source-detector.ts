/**
 * Agent/model detection utilities for ultrawork message routing.
 *
 * Routing logic:
 * 1. Mnemosyne → skip (has own planning instructions)
 * 2. Planner agents (prometheus, plan) → planner.ts
 * 3. GPT 5.2 models → gpt5.2.ts
 * 4. Gemini models → gemini.ts
 * 5. Everything else (Claude, etc.) → default.ts
 */

import { isGptModel, isGeminiModel } from "../../../agents/types"

/**
 * Checks if agent is a planner-type agent that uses wave-based parallel execution.
 * Mnemosyne is excluded — it plans for sequential execution (Heracles) and has its own instructions.
 */
export function isPlannerAgent(agentName?: string): boolean {
  if (!agentName) return false
  const lowerName = agentName.toLowerCase()
  if (isMnemosyneAgent(lowerName)) return false
  if (lowerName.includes("prometheus") || lowerName.includes("planner")) return true

  const normalized = lowerName.replace(/[_-]+/g, " ")
  return /\bplan\b/.test(normalized)
}

/**
 * Mnemosyne plans for sequential Heracles execution — ultrawork's wave/category
 * planner section contradicts its model. Its base prompt already handles planning.
 */
function isMnemosyneAgent(lowerName: string): boolean {
  return lowerName.includes("mnemosyne")
}

export { isGptModel, isGeminiModel }

/** Ultrawork message source type. "skip" = agent has its own planning instructions, no injection needed. */
export type UltraworkSource = "planner" | "gpt" | "gemini" | "default" | "skip"

export function getUltraworkSource(
  agentName?: string,
  modelID?: string
): UltraworkSource {
  if (agentName && isMnemosyneAgent(agentName.toLowerCase())) {
    return "skip"
  }

  if (isPlannerAgent(agentName)) {
    return "planner"
  }

  if (modelID && isGptModel(modelID)) {
    return "gpt"
  }

  if (modelID && isGeminiModel(modelID)) {
    return "gemini"
  }

  return "default"
}
