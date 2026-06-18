import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { ParallelTasksArgs, ParallelTasksToolOptions, ToolContextWithMetadata } from "./types"
import { executeParallelTasks } from "./parallel-executor"
import { log } from "../../shared/logger"
import { mergeCategories } from "../../shared/merge-categories"

const MAX_PARALLEL_TASKS = 10

export function createParallelTasksTool(options: ParallelTasksToolOptions): ToolDefinition {
  const categoryExamples = Object.keys(mergeCategories(options.userCategories)).join(", ")
  const description = `General parallel-execution tool: run MULTIPLE agents concurrently in a single operation and get all results back together. Use it for both RESEARCH and IMPLEMENTATION waves.

Unlike individual task() calls which may execute sequentially across turns, this tool guarantees all tasks run concurrently.

⚠️ CRITICAL SAFETY RULE — ONLY parallelize INDEPENDENT tasks that touch DISJOINT files.
NEVER parallelize edits to the same file or overlapping region: concurrent writes race and corrupt the file. If two tasks could touch the same file, or any task depends on another's output, do NOT use parallel_tasks — run them sequentially with the \`task\` tool instead. When in doubt, prefer \`task\`.

Two kinds of agents you can run here (each task picks EXACTLY ONE of these per item):
- RESEARCH (read-only) — set subagent_type to "explore" (internal codebase analysis) or "librarian" (external docs / OSS / web research).
- IMPLEMENTATION — set category to a domain-routed executor category (available: ${categoryExamples || "see your configured categories"}) for model-tier/category routing, OR set subagent_type to an executor agent. Category routing selects the right model tier for the work (quick vs. deep) and applies that category's prompt behavior.

Each task in the array needs:
- description: Short task description (3-5 words)
- prompt: Full detailed prompt for the agent
- load_skills: Skill names to inject (pass [] if none)
- EITHER category OR subagent_type — mutually exclusive, EXACTLY ONE required per task. Provide one, never both, never neither.

Maximum ${MAX_PARALLEL_TASKS} tasks per call.

Backward compatible: research-only usage with subagent_type "explore"/"librarian" works exactly as before.

Example (research wave):
parallel_tasks({
  tasks: [
    { subagent_type: "explore", load_skills: [], description: "Find auth patterns", prompt: "Search for authentication..." },
    { subagent_type: "librarian", load_skills: [], description: "Research JWT docs", prompt: "Find official JWT..." }
  ]
})

Example (implementation wave — DISJOINT files only):
parallel_tasks({
  tasks: [
    { category: "quick", load_skills: [], description: "Update config loader", prompt: "Edit ONLY src/config/loader.ts to..." },
    { category: "deep", load_skills: [], description: "Refactor auth module", prompt: "Edit ONLY src/auth/** to..." }
  ]
})`

  return tool({
    description,
    args: {
      tasks: tool.schema.array(
        tool.schema.object({
          description: tool.schema.string().describe("Short task description (3-5 words)"),
          prompt: tool.schema.string().describe("Full detailed prompt for the agent"),
          load_skills: tool.schema.array(tool.schema.string()).describe("Skill names to inject. Pass [] if no skills needed."),
          subagent_type: tool.schema.string().optional().describe("Agent to run. REQUIRED if category not provided; do NOT provide both. Research: 'explore' (internal codebase) or 'librarian' (external docs / OSS / web). Implementation: an executor agent."),
          category: tool.schema.string().optional().describe("Domain-routed executor category for model-tier routing. REQUIRED if subagent_type not provided; do NOT provide both."),
        }),
      ).describe("Array of task definitions to execute in parallel"),
    },
    async execute(args: ParallelTasksArgs, toolContext) {
      const ctx = toolContext as ToolContextWithMetadata

      if (!args.tasks || !Array.isArray(args.tasks) || args.tasks.length === 0) {
        return "Invalid arguments: 'tasks' must be a non-empty array of task definitions."
      }

      if (args.tasks.length > MAX_PARALLEL_TASKS) {
        return `Too many tasks: ${args.tasks.length}. Maximum is ${MAX_PARALLEL_TASKS} parallel tasks per call.`
      }

      for (let i = 0; i < args.tasks.length; i++) {
        const task = args.tasks[i]
        if (!task.description || !task.prompt) {
          return `Task ${i + 1}: 'description' and 'prompt' are required.`
        }
        if (task.category && task.subagent_type) {
          return `Task ${i + 1} ("${task.description}"): provide either 'category' or 'subagent_type', not both.`
        }
        if (!task.category && !task.subagent_type) {
          return `Task ${i + 1} ("${task.description}"): must provide either 'category' or 'subagent_type'.`
        }
        if (task.load_skills === undefined || task.load_skills === null) {
          task.load_skills = []
        }
      }

      await ctx.metadata?.({ title: `Parallel: ${args.tasks.length} tasks` })

      log("[parallel_tasks] Starting parallel execution", {
        taskCount: args.tasks.length,
        tasks: args.tasks.map((t) => ({
          description: t.description,
          subagent_type: t.subagent_type,
          category: t.category,
        })),
      })

      return executeParallelTasks(args.tasks, ctx, options)
    },
  })
}
