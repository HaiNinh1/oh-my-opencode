import type { ParallelTaskItem, ParallelTasksToolOptions } from "./types"
import type { DelegateTaskArgs } from "../delegate-task/types"
import type { ParentContext } from "../delegate-task/executor-types"
import type {
  AvailableCategory,
  AvailableSkill,
} from "../../agents/dynamic-agent-prompt-builder"
import {
  resolveSkillContent,
  resolveSubagentExecution,
  resolveCategoryExecution,
} from "../delegate-task/executor"
import { buildSystemContent } from "../delegate-task/prompt-builder"
import { mergeCategories } from "../../shared/merge-categories"

export interface ResolvedTask {
  index: number
  item: ParallelTaskItem
  args: DelegateTaskArgs
  agentToUse: string
  categoryModel: { providerID: string; modelID: string; variant?: string } | undefined
  systemContent: string | undefined
  modelInfo?: import("../../features/task-toast-manager/types").ModelFallbackInfo
  fallbackChain?: import("../../shared/model-requirements").FallbackEntry[]
}

export interface TaskResolutionResult {
  index: number
  error?: string
  item?: ParallelTaskItem
  args?: DelegateTaskArgs
  agentToUse?: string
  categoryModel?: { providerID: string; modelID: string; variant?: string }
  systemContent?: string
  modelInfo?: import("../../features/task-toast-manager/types").ModelFallbackInfo
  fallbackChain?: import("../../shared/model-requirements").FallbackEntry[]
}

export async function resolveAllTasks(
  items: ParallelTaskItem[],
  options: ParallelTasksToolOptions,
  parentContext: ParentContext,
): Promise<TaskResolutionResult[]> {
  const allCategories = mergeCategories(options.userCategories)
  const categoryExamples = Object.keys(allCategories).join(", ")

  const availableCategories: AvailableCategory[] = options.availableCategories ?? []
  const availableSkills: AvailableSkill[] = options.availableSkills ?? []

  // Mirror delegate-task/tools.ts: resolve inherited + system-default models once
  // so category resolution can route model tiers like the `task` tool does.
  let systemDefaultModel: string | undefined
  try {
    const openCodeConfig = await options.client.config.get()
    systemDefaultModel = (openCodeConfig as { data?: { model?: string } })?.data?.model
  } catch (error) {
    if (!(error instanceof Error)) throw error
    systemDefaultModel = undefined
  }

  const inheritedModel = parentContext.model
    ? `${parentContext.model.providerID}/${parentContext.model.modelID}`
    : undefined

  return Promise.all(
    items.map(async (item, index) => {
      try {
        return await resolveSingleTask(
          item, index, options, parentContext, categoryExamples,
          availableCategories, availableSkills, inheritedModel, systemDefaultModel,
        )
      } catch (error) {
        return { index, error: error instanceof Error ? error.message : String(error) }
      }
    }),
  )
}

async function resolveSingleTask(
  item: ParallelTaskItem,
  index: number,
  options: ParallelTasksToolOptions,
  parentContext: ParentContext,
  categoryExamples: string,
  availableCategories: AvailableCategory[],
  availableSkills: AvailableSkill[],
  inheritedModel: string | undefined,
  systemDefaultModel: string | undefined,
): Promise<TaskResolutionResult> {
  // Mirror delegate-task: category and subagent_type are mutually exclusive, exactly one required.
  if (item.category && item.subagent_type) {
    return { index, error: "Provide either 'category' or 'subagent_type', not both." }
  }
  if (!item.category && !item.subagent_type) {
    return { index, error: "Must provide either 'category' or 'subagent_type'." }
  }

  const args: DelegateTaskArgs = {
    description: item.description,
    prompt: item.prompt,
    load_skills: item.load_skills,
    subagent_type: item.subagent_type,
    category: item.category,
    run_in_background: false,
  }

  const { content: skillContent, contents: skillContents, error: skillError } = await resolveSkillContent(
    item.load_skills,
    {
      gitMasterConfig: options.gitMasterConfig,
      browserProvider: options.browserProvider,
      disabledSkills: options.disabledSkills,
      teamModeEnabled: options.teamModeEnabled,
      directory: options.directory,
      targetAgent: item.subagent_type,
      nativeSkills: options.nativeSkills,
    },
  )
  if (skillError) {
    return { index, error: skillError }
  }

  let agentToUse: string
  let categoryModel: { providerID: string; modelID: string; variant?: string } | undefined
  let categoryPromptAppend: string | undefined
  let maxPromptTokens: number | undefined
  let modelInfo: import("../../features/task-toast-manager/types").ModelFallbackInfo | undefined
  let fallbackChain: import("../../shared/model-requirements").FallbackEntry[] | undefined

  if (item.category) {
    // Category path: mirror delegate-task/tools.ts category resolution.
    const resolution = await resolveCategoryExecution(args, options, inheritedModel, systemDefaultModel)
    if (resolution.error) {
      return { index, error: resolution.error }
    }
    agentToUse = resolution.agentToUse
    categoryModel = resolution.categoryModel
    categoryPromptAppend = resolution.categoryPromptAppend
    maxPromptTokens = resolution.maxPromptTokens
    modelInfo = resolution.modelInfo
    fallbackChain = resolution.fallbackChain
  } else {
    const resolution = await resolveSubagentExecution(args, options, parentContext.agent, categoryExamples)
    if (resolution.error) {
      return { index, error: resolution.error }
    }
    agentToUse = resolution.agentToUse
    categoryModel = resolution.categoryModel
    fallbackChain = resolution.fallbackChain
  }

  const systemContent = buildSystemContent({
    skillContent,
    skillContents,
    categoryPromptAppend,
    maxPromptTokens,
    agentName: agentToUse,
    model: categoryModel,
    availableCategories,
    availableSkills,
  })

  return {
    index,
    item,
    args,
    agentToUse,
    categoryModel,
    systemContent,
    modelInfo,
    fallbackChain,
  }
}
