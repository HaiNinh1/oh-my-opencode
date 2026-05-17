import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { DelegateTaskArgs, ToolContextWithMetadata, DelegateTaskToolOptions } from "./types"
import { CATEGORY_DESCRIPTIONS } from "./constants"
import { SISYPHUS_JUNIOR_AGENT } from "./sisyphus-junior-agent"
import { mergeCategories } from "../../shared/merge-categories"
import { log } from "../../shared/logger"
import { buildSystemContent } from "./prompt-builder"
import type {
  AvailableCategory,
  AvailableSkill,
  AvailableToolInfo,
} from "../../agents/dynamic-agent-prompt-builder"
import {
  resolveSkillContent,
  resolveParentContext,
  executeBackgroundContinuation,
  executeSyncContinuation,
  resolveCategoryExecution,
  resolveSubagentExecution,
  executeUnstableAgentTask,
  executeBackgroundTask,
  executeSyncTask,
} from "./executor"

export { resolveCategoryConfig } from "./categories"
export type { SyncSessionCreatedEvent, DelegateTaskToolOptions, BuildSystemContentInput } from "./types"
export { buildSystemContent, buildTaskPrompt } from "./prompt-builder"
export { isMnemosyneAgent, buildMnemosyneSystemPrepend } from "./mnemosyne-plan-constants"

export function createDelegateTask(options: DelegateTaskToolOptions): ToolDefinition {
  const { userCategories } = options

  const allCategories = mergeCategories(userCategories)
  const categoryNames = Object.keys(allCategories)
  const categoryExamples = categoryNames.join(", ")

  const availableCategories: AvailableCategory[] = options.availableCategories
    ?? Object.entries(allCategories).map(([name, categoryConfig]) => {
      const userDesc = userCategories?.[name]?.description
      const builtinDesc = CATEGORY_DESCRIPTIONS[name]
      const description = userDesc || builtinDesc || "General tasks"
      return {
        name,
        description,
        model: categoryConfig.model,
      }
    })

  const availableSkills: AvailableSkill[] = options.availableSkills ?? []

  const description = `Start or continue a CONSULTANT agent task.

  Use this tool ONLY for high-reasoning consultation, plan review, and category-routed sub-execution. Allowed targets:
  - subagent_type: "oracle" (architecture/debugging/security second opinion), "metis" (pre-planning intent analysis), "momus" (plan critique against saved .sisyphus/plans/*.md files), "sisyphus-junior" (focused sub-executor when no delegation is needed).
  - category: any configured category (routes to sisyphus-junior with the category's model — used for explicit category-based execution workflows).

  DO NOT use this tool for research / codebase exploration / external doc lookup. For "explore" and "librarian" agents, use the \`parallel_tasks\` tool (it supports a single task as well and guarantees the parallel-research workflow).

  ⚠️  CRITICAL: For a new task, provide EITHER subagent_type OR category. For a continuation, provide session_id. Omitting all three will FAIL.

  **COMMON MISTAKE (DO NOT DO THIS):**
  \`\`\`
  task(description="...", prompt="...", run_in_background=false)  // ❌ FAILS - missing subagent_type/category/session_id
  task(subagent_type="explore", ...)                              // ❌ WRONG TOOL - use parallel_tasks for explore/librarian
  \`\`\`

  **CORRECT - Oracle consultation:**
  \`\`\`
  task(subagent_type="oracle", load_skills=[], description="Review auth design", prompt="...", run_in_background=false)
  \`\`\`

  **CORRECT - Category-routed sub-execution:**
  \`\`\`
  task(category="quick", load_skills=[], description="Rename symbol", prompt="...", run_in_background=false)
  \`\`\`

  **CORRECT - Continue existing consultant session:**
  \`\`\`
  task(session_id="ses_abc123", load_skills=[], description="Follow up", prompt="...", run_in_background=false)
  \`\`\`

  New-task targets:
  - subagent_type: One of "oracle" | "metis" | "momus". Do NOT pass "explore" or "librarian" here — use parallel_tasks instead.
  - category: Routes to sisyphus-junior with the category's model/config. Use for explicit category-based execution workflows.

  **DO NOT provide both category and subagent_type.** If category is provided, subagent_type is overridden to sisyphus-junior.

  - load_skills: ALWAYS REQUIRED. Pass [] if no skills are needed.
  - subagent_type: Consultant agent to invoke (oracle / metis / momus).
  - category: Category name for category-routed sub-execution.
  - run_in_background: REQUIRED. false=sync (waits — default for blocking consultation), true=async.
  - session_id: Existing task session to continue. Continues with FULL CONTEXT PRESERVED and saves tokens.
  - command: The command that triggered this task (optional, for slash command tracking).

  **WHEN TO USE session_id:**
  - Task failed/incomplete → session_id with "fix: [specific issue]"
  - Need follow-up on previous result → session_id with additional question
  - Multi-turn conversation with same agent → always session_id instead of new task

  Prompts MUST be in English.`
  + (options.forceSyncEnabled
    ? `\n\n  **NOTE: force_sync is ENABLED.** All tasks run synchronously regardless of run_in_background value. Background tools are disabled. For parallel execution of multiple tasks, use the \`parallel_tasks\` tool instead.`
    : "")

  return tool({
    description,
    args: {
      load_skills: tool.schema.array(tool.schema.string()).describe("Skill names to inject. REQUIRED - pass [] if no skills needed."),
      description: tool.schema.string().describe("Short task description (3-5 words)"),
      prompt: tool.schema.string().describe("Full detailed prompt for the agent"),
      run_in_background: tool.schema.boolean().describe("REQUIRED. false=sync (waits — default for blocking consultation), true=async. Use parallel_tasks for explore/librarian research."),
      category: tool.schema.string().optional().describe(`Category name for category-routed sub-execution (routes to sisyphus-junior). Do NOT provide with subagent_type.`),
      subagent_type: tool.schema.string().optional().describe("Consultant agent: one of 'oracle' | 'metis' | 'momus' | 'sisyphus-junior'. Do NOT pass 'explore' or 'librarian' — use parallel_tasks for those. Required unless category or session_id is provided. Do NOT provide with category."),
      session_id: tool.schema.string().optional().describe("Existing Task session to continue"),
      command: tool.schema.string().optional().describe("The command that triggered this task"),
    },
    async execute(args: DelegateTaskArgs, toolContext) {
      const ctx = toolContext as ToolContextWithMetadata

      if (args.category) {
        if (args.subagent_type && args.subagent_type !== SISYPHUS_JUNIOR_AGENT) {
          log("[task] category provided - overriding subagent_type to sisyphus-junior", {
            category: args.category,
            subagent_type: args.subagent_type,
          })
        }
        args.subagent_type = SISYPHUS_JUNIOR_AGENT
      }
      await ctx.metadata?.({
        title: args.description,
      })

      if (args.run_in_background === undefined) {
        throw new Error(`Invalid arguments: 'run_in_background' parameter is REQUIRED. Use run_in_background=false for blocking specialist consultation; use parallel_tasks for multiple research agents.`)
      }
      if (typeof args.load_skills === "string") {
        try {
          const parsed = JSON.parse(args.load_skills)
          args.load_skills = Array.isArray(parsed) ? parsed : []
        } catch {
          args.load_skills = []
        }
      }
      if (args.load_skills === undefined) {
        throw new Error(`Invalid arguments: 'load_skills' parameter is REQUIRED. Pass [] if no skills needed.`)
      }
      if (args.load_skills === null) {
        throw new Error(`Invalid arguments: load_skills=null is not allowed. Pass [] if no skills needed.`)
      }

      const forceSyncOverride = options.forceSyncEnabled && args.run_in_background === true
      if (forceSyncOverride) {
        log("[task] force_sync enabled - overriding run_in_background=true to false", {
          description: args.description,
          category: args.category,
          subagent_type: args.subagent_type,
        })
      }
      const runInBackground = forceSyncOverride ? false : args.run_in_background === true

      const { content: skillContent, contents: skillContents, error: skillError } = await resolveSkillContent(args.load_skills, {
        gitMasterConfig: options.gitMasterConfig,
        browserProvider: options.browserProvider,
        disabledSkills: options.disabledSkills,
        directory: options.directory,
      })
      if (skillError) {
        return skillError
      }

      const parentContext = await resolveParentContext(ctx, options.client)

      if (args.session_id) {
        if (runInBackground) {
          return executeBackgroundContinuation(args, ctx, options, parentContext)
        }
        return executeSyncContinuation(args, ctx, options, parentContext)
      }

      if (!args.category && !args.subagent_type) {
        return `Invalid arguments: Must provide either category or subagent_type.`
      }

      let systemDefaultModel: string | undefined
      try {
        const openCodeConfig = await options.client.config.get()
        systemDefaultModel = (openCodeConfig as { data?: { model?: string } })?.data?.model
      } catch {
        systemDefaultModel = undefined
      }

      const inheritedModel = parentContext.model
        ? `${parentContext.model.providerID}/${parentContext.model.modelID}`
        : undefined

      let agentToUse: string
      let categoryModel: { providerID: string; modelID: string; variant?: string } | undefined
      let categoryPromptAppend: string | undefined
      let modelInfo: import("../../features/task-toast-manager/types").ModelFallbackInfo | undefined
      let actualModel: string | undefined
      let isUnstableAgent = false
      let fallbackChain: import("../../shared/model-requirements").FallbackEntry[] | undefined
      let maxPromptTokens: number | undefined

      if (args.category) {
        const resolution = await resolveCategoryExecution(args, options, inheritedModel, systemDefaultModel)
        if (resolution.error) {
          return resolution.error
        }
        agentToUse = resolution.agentToUse
        categoryModel = resolution.categoryModel
        categoryPromptAppend = resolution.categoryPromptAppend
        modelInfo = resolution.modelInfo
        actualModel = resolution.actualModel
        isUnstableAgent = resolution.isUnstableAgent
        fallbackChain = resolution.fallbackChain
        maxPromptTokens = resolution.maxPromptTokens

        const isRunInBackgroundExplicitlyFalse = args.run_in_background === false || args.run_in_background === "false" as unknown as boolean

        log("[task] unstable agent detection", {
          category: args.category,
          actualModel,
          isUnstableAgent,
          run_in_background_value: args.run_in_background,
          run_in_background_type: typeof args.run_in_background,
          isRunInBackgroundExplicitlyFalse,
          willForceBackground: isUnstableAgent && isRunInBackgroundExplicitlyFalse,
        })

        if (isUnstableAgent && isRunInBackgroundExplicitlyFalse) {
          const availableToolInfos: AvailableToolInfo[] = options.getAvailableToolInfos?.() ?? []
          const systemContent = buildSystemContent({
            skillContent,
            skillContents,
            categoryPromptAppend,
            agentName: agentToUse,
            maxPromptTokens,
            model: categoryModel,
            availableCategories,
            availableSkills,
            availableToolInfos,
          })
          return executeUnstableAgentTask(args, ctx, options, parentContext, agentToUse, categoryModel, systemContent, actualModel)
        }
      } else {
        const resolution = await resolveSubagentExecution(args, options, parentContext.agent, categoryExamples)
        if (resolution.error) {
          return resolution.error
        }
        agentToUse = resolution.agentToUse
        categoryModel = resolution.categoryModel
        fallbackChain = resolution.fallbackChain
      }

      const availableToolInfos: AvailableToolInfo[] = options.getAvailableToolInfos?.() ?? []
      const systemContent = buildSystemContent({
        skillContent,
        skillContents,
        categoryPromptAppend,
        agentName: agentToUse,
        maxPromptTokens,
        model: categoryModel,
        availableCategories,
        availableSkills,
        availableToolInfos,
      })

      if (runInBackground) {
        return executeBackgroundTask(args, ctx, options, parentContext, agentToUse, categoryModel, systemContent, fallbackChain)
      }

      return executeSyncTask(args, ctx, options, parentContext, agentToUse, categoryModel, systemContent, modelInfo, fallbackChain)
    },
  })
}
