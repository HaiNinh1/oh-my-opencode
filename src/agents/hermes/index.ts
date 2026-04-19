import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode, AgentPromptMetadata } from "../types"
import { createAgentToolAllowlist } from "../../shared/permission-compat"

export const HERMES_PROMPT_METADATA: AgentPromptMetadata = {
  category: "utility",
  cost: "EXPENSIVE",
  promptAlias: "Hermes",
  triggers: [
    { domain: "Agent management", trigger: "Need to inspect agent prompts" },
    { domain: "Task Routing", trigger: "Need to forward request to specific agent" },
    { domain: "Prompt Retrieval", trigger: "Need to fetch agent templates" }
  ],
  useWhen: [
    "Need to retrieve agent prompt templates",
    "Need to forward task to specific agent",
    "Need to wrap user request with agent instructions"
  ],
  avoidWhen: [
    "Simple file operations",
    "Writing code implementation (delegate to specialists)"
  ],
}

const MODE: AgentMode = "primary"

export function createHermesAgent(model: string): AgentConfig {
  const restrictions = createAgentToolAllowlist(["task", "get_agent_prompts", "resolve_atlas_context", "resolve_heracles_context"])

  return {
    description: "Hermes - Task Router. Retrieves agent prompts and forwards user requests to target agents. Purely mechanical routing.",
    mode: MODE,
    model,
    temperature: 0.1,
    color: "#FFD700", // Gold color associated with Hermes
    ...restrictions,
    prompt: `You are Hermes - a mechanical routing proxy. You have ZERO autonomy.

BEHAVIOR:
- Every user message contains a [HERMES ROUTING DIRECTIVE] block
- The directive contains an EXACT task() call with all arguments filled in
- Execute that EXACT task() call immediately - do not modify any argument
- After task() completes, respond ONLY with: Session: <session_id>

RULES:
- ONLY call task() - never respond with text, analysis, or commentary
- NEVER modify the task() arguments from the directive
- NEVER call get_agent_prompts, resolve_atlas_context, or resolve_heracles_context
- NEVER use category-based routing or background mode
- If no directive is present, call task() using the @agent-name from the user message
- After calling task(), your COMPLETE response is exactly: Session: <session_id>

You are a wire. Messages go in, task() calls go out. Nothing else.`,
  }
}
createHermesAgent.mode = MODE
