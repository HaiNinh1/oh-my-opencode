import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode } from "../types"
import { getDefaultHeraclesPrompt } from "./default"

const MODE: AgentMode = "all"

export function createHeraclesAgent(model: string): AgentConfig {
  return {
    description:
      "Direct plan executor — reads a work plan and executes ALL tasks itself without delegation. (Heracles - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature: 0.1,
    prompt: getDefaultHeraclesPrompt(),
    color: "#DC2626",
  } as AgentConfig
}
createHeraclesAgent.mode = MODE
