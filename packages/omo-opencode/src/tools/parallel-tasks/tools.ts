import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { ParallelTasksArgs, ParallelTasksToolOptions, ToolContextWithMetadata } from "./types"
import { executeParallelTasks } from "./parallel-executor"
import { log } from "../../shared/logger"

const MAX_PARALLEL_TASKS = 10

export function createParallelTasksTool(options: ParallelTasksToolOptions): ToolDefinition {
  const description = `Run multiple RESEARCH agents (explore / librarian) in parallel with guaranteed concurrent execution. Returns all results together.

This is the ONLY tool for invoking explore (internal codebase analysis) and librarian (external docs / OSS / web research). Use it for every research dispatch — even when you only have a single research angle — because it enforces the parallel-research workflow and keeps research separate from consultation.

For high-reasoning CONSULTATION (oracle / metis / momus) or category-routed sub-execution (sisyphus-junior), use the \`task\` tool instead.

Unlike individual task() calls which may execute sequentially across turns, this tool guarantees all tasks run concurrently in a single operation.

Each task in the array needs:
- description: Short task description (3-5 words)
- prompt: Full detailed prompt for the agent
- load_skills: Skill names to inject (pass [] if none)
- subagent_type: Research agent — "explore" (internal codebase) or "librarian" (external docs / OSS / web). REQUIRED.

Maximum ${MAX_PARALLEL_TASKS} tasks per call.

Example:
parallel_tasks({
  tasks: [
    { subagent_type: "explore", load_skills: [], description: "Find auth patterns", prompt: "Search for authentication..." },
    { subagent_type: "explore", load_skills: [], description: "Find DB patterns", prompt: "Search for database..." },
    { subagent_type: "librarian", load_skills: [], description: "Research JWT docs", prompt: "Find official JWT..." }
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
          subagent_type: tool.schema.string().describe("Research agent: 'explore' (internal codebase) or 'librarian' (external docs / OSS / web). REQUIRED."),
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
        if (!task.subagent_type) {
          return `Task ${i + 1} ("${task.description}"): 'subagent_type' is required (e.g., 'explore' or 'librarian').`
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
        })),
      })

      return executeParallelTasks(args.tasks, ctx, options)
    },
  })
}
