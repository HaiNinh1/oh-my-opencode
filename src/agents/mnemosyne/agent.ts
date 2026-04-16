import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode } from "../types"
import { MNEMOSYNE_SYSTEM_PROMPT, MNEMOSYNE_PERMISSION } from "./system-prompt"

const MODE: AgentMode = "all"

export function createMnemosyneAgent(model: string): AgentConfig {
  return {
    description:
      "Compact strategic planner optimized for per-request pricing — interviews, researches, and generates work plans. (Mnemosyne - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature: 0.1,
    prompt: MNEMOSYNE_SYSTEM_PROMPT,
    permission: MNEMOSYNE_PERMISSION,
    color: "#9333EA",
  } as AgentConfig
}
createMnemosyneAgent.mode = MODE
