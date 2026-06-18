import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode, AgentPromptMetadata } from "../types"
import { buildClaudeThinkingConfig, isGptModel } from "../types"
import { getMnemosynePrompt, MNEMOSYNE_PERMISSION } from "./system-prompt"

const MODE: AgentMode = "all"

/**
 * Mnemosyne - Compact Strategic Planner
 *
 * A cost-efficient alternative to Prometheus. Distilled from Prometheus and
 * optimized for per-request pricing providers: it interviews, researches via
 * `parallel_tasks`, and generates sequential work plans for Heracles to execute.
 *
 * Model-aware prompt selection mirrors the other planner/consultant agents:
 * GPT and Gemini models receive tailored prompt variants, while Claude models
 * receive explicit thinking configuration where applicable.
 */
export function createMnemosyneAgent(model: string): AgentConfig {
  const base = {
    description:
      "Compact strategic planner optimized for per-request pricing — interviews, researches, and generates work plans. (Mnemosyne - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature: 0.1,
    prompt: getMnemosynePrompt(model),
    permission: MNEMOSYNE_PERMISSION,
    color: "#9333EA",
  } as AgentConfig

  if (isGptModel(model)) {
    return {
      ...base,
      reasoningEffort: "medium",
      textVerbosity: "high",
    } as AgentConfig
  }

  return {
    ...base,
    ...buildClaudeThinkingConfig(model),
  } as AgentConfig
}
createMnemosyneAgent.mode = MODE

export const mnemosynePromptMetadata: AgentPromptMetadata = {
  category: "advisor",
  cost: "CHEAP",
  promptAlias: "Mnemosyne",
  triggers: [
    {
      domain: "Strategic planning",
      trigger:
        "Interview, research, and generate work plans on a per-request pricing budget",
    },
    {
      domain: "Cost-efficient planning",
      trigger:
        "Produce decision-complete sequential work plans when Prometheus is too expensive",
    },
  ],
  useWhen: [
    "When a work plan is needed but per-request pricing makes Prometheus too costly",
    "For cost-efficient interview-driven planning that hands off to /execute-plan",
    "When the user wants a compact planner that researches exclusively via parallel_tasks",
  ],
  avoidWhen: [
    "When maximum planning depth is required (prefer Prometheus)",
    "For direct implementation work (Mnemosyne plans, it does not implement)",
    "Simple, single-step requests that need no formal plan",
  ],
  keyTrigger:
    "User wants a cheaper planner → invoke Mnemosyne instead of Prometheus. It interviews, researches via `parallel_tasks`, writes a plan to `.omo/plans/*.md`, then hands off to `/execute-plan`.",
}
