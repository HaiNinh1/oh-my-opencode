/**
 * Ultrawork message module - routes to appropriate message based on agent/model.
 *
 * Routing:
 * 1. Mnemosyne → skip (has own planning instructions, ultrawork would contradict)
 * 2. Planner agents (prometheus, plan) → planner.ts
 * 3. GPT 5.2 models → gpt5.2.ts
 * 4. Gemini models → gemini.ts
 * 5. Default (Claude, etc.) → default.ts (optimized for Claude series)
 */

export { isPlannerAgent, isGptModel, isGeminiModel, getUltraworkSource } from "./source-detector"
export type { UltraworkSource } from "./source-detector"
export { ULTRAWORK_PLANNER_SECTION, getPlannerUltraworkMessage } from "./planner"
export { ULTRAWORK_GPT_MESSAGE, getGptUltraworkMessage } from "./gpt5.2"
export { ULTRAWORK_GEMINI_MESSAGE, getGeminiUltraworkMessage } from "./gemini"
export { ULTRAWORK_DEFAULT_MESSAGE, getDefaultUltraworkMessage } from "./default"

import { getUltraworkSource } from "./source-detector"
import { getPlannerUltraworkMessage } from "./planner"
import { getGptUltraworkMessage } from "./gpt5.2"
import { getDefaultUltraworkMessage } from "./default"
import { getGeminiUltraworkMessage } from "./gemini"

/**
 * Gets the appropriate ultrawork message based on agent and model context.
 */
export function getUltraworkMessage(agentName?: string, modelID?: string): string {
  const source = getUltraworkSource(agentName, modelID)

  switch (source) {
    case "skip":
      return ""
    case "planner":
      return getPlannerUltraworkMessage()
    case "gpt":
      return getGptUltraworkMessage()
    case "gemini":
      return getGeminiUltraworkMessage()
    case "default":
    default:
      return getDefaultUltraworkMessage()
  }
}
