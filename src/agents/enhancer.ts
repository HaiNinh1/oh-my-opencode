import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentMode } from "./types";
import { createAgentToolAllowlist } from "../shared/permission-compat";

const MODE: AgentMode = "subagent";

export const ENHANCER_PROMPT = `You are a prompt enhancement specialist.

You receive a draft prompt and return an improved version.

Rules:
- Preserve the original intent exactly
- Improve clarity, coherence, specificity, and structure
- Keep the enhanced prompt concise unless the original is detailed
- Do not add additional instructions about tools, workflows, or agent behavior or custom title to the prompt
- Return ONLY the improved prompt text, nothing else
- No preamble, no explanation, no markdown wrapping`;

export function createEnhancerAgent(model: string): AgentConfig {
  return {
    description:
      "Prompt enhancement agent. Rewrites user prompts for clarity and effectiveness. (Prompt Enhancer - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature: 0.3,
    prompt: ENHANCER_PROMPT,
    ...createAgentToolAllowlist([]),
  };
}
createEnhancerAgent.mode = MODE;
