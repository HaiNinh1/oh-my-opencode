import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { START_WORK_TEMPLATE } from "../../features/builtin-commands/templates/start-work"
import { PLAN_AGENT_SYSTEM_PREPEND_STATIC_BEFORE_SKILLS, PLAN_AGENT_SYSTEM_PREPEND_STATIC_AFTER_SKILLS } from "../../tools/delegate-task/constants"
import { ULTRAWORK_DEFAULT_MESSAGE } from "../../hooks/keyword-detector/ultrawork/default"
import { ULTRAWORK_GPT_MESSAGE } from "../../hooks/keyword-detector/ultrawork/gpt5.2"
import { ULTRAWORK_PLANNER_SECTION } from "../../hooks/keyword-detector/ultrawork/planner"
import { HERACLES_SYSTEM_PROMPT } from "../../agents/heracles/default"

export const get_agent_prompts: ToolDefinition = tool({
  description: "Get the system prompts and templates for specific agents (Prometheus, Heracles, Sisyphus Ultrawork) to manually inject them into task delegation.",
  args: {
    agent: tool.schema.enum([
      "prometheus",
      "heracles",
      "sisyphus-ultrawork-default",
      "sisyphus-ultrawork-gpt",
      "sisyphus-ultrawork-planner",
    ]).describe("The agent to get the prompt for"),
  },
  execute: async (args) => {
    try {
      // Force type assertion to allow checking for excluded 'atlas' value
      if ((args.agent as string) === "atlas") {
        throw new Error("Direct Atlas routing is forbidden. Use resolve_atlas_context() to invoke Atlas with a plan.")
      }
      
      if (args.agent === "prometheus") {
        return [
          PLAN_AGENT_SYSTEM_PREPEND_STATIC_BEFORE_SKILLS,
          "\n--- [SKILLS SECTION WOULD GO HERE] ---\n",
          PLAN_AGENT_SYSTEM_PREPEND_STATIC_AFTER_SKILLS
        ].join("\n")
      }

      if (args.agent === "heracles") {
        return HERACLES_SYSTEM_PROMPT
      }

      if (args.agent === "sisyphus-ultrawork-default") {
        return ULTRAWORK_DEFAULT_MESSAGE
      }

      if (args.agent === "sisyphus-ultrawork-gpt") {
        return ULTRAWORK_GPT_MESSAGE
      }

      if (args.agent === "sisyphus-ultrawork-planner") {
        return ULTRAWORK_PLANNER_SECTION
      }

      return "Unknown agent"
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})
