import type { ParallelTaskItem, ParallelTasksToolOptions } from "./types"
import type { DelegateTaskArgs } from "../delegate-task/types"
import type { ParentContext } from "../delegate-task/executor-types"
import type {
  AvailableCategory,
  AvailableSkill,
  AvailableToolInfo,
} from "../../agents/dynamic-agent-prompt-builder"
import {
  resolveSkillContent,
  resolveCategoryExecution,
  resolveSubagentExecution,
} from "../delegate-task/executor"
import { buildSystemContent } from "../delegate-task/prompt-builder"
import { SISYPHUS_JUNIOR_AGENT } from "../delegate-task/sisyphus-junior-agent"
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

  const availableCategories: AvailableCategory[] = options.availableCategories ?? []
  const availableSkills: AvailableSkill[] = options.availableSkills ?? []
  const availableToolInfos: AvailableToolInfo[] = options.getAvailableToolInfos?.() ?? []

  return Promise.all(
    items.map(async (item, index) => {
      try {
        return await resolveSingleTask(
          item, index, options, parentContext, inheritedModel,
          systemDefaultModel, categoryExamples, availableCategories,
          availableSkills, availableToolInfos,
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
  inheritedModel: string | undefined,
  systemDefaultModel: string | undefined,
  categoryExamples: string,
  availableCategories: AvailableCategory[],
  availableSkills: AvailableSkill[],
  availableToolInfos: AvailableToolInfo[],
): Promise<TaskResolutionResult> {
  const args: DelegateTaskArgs = {
    description: item.description,
    prompt: item.prompt,
    load_skills: item.load_skills,
    category: item.category,
    subagent_type: item.subagent_type,
    run_in_background: false,
  }

  if (item.category) {
    args.subagent_type = SISYPHUS_JUNIOR_AGENT
  }

  if (!item.category && !item.subagent_type) {
    return { index, error: "Must provide either category or subagent_type" }
  }

  const { content: skillContent, contents: skillContents, error: skillError } = await resolveSkillContent(
    item.load_skills,
    {
      gitMasterConfig: options.gitMasterConfig,
      browserProvider: options.browserProvider,
      disabledSkills: options.disabledSkills,
      directory: options.directory,
    },
  )
  if (skillError) {
    return { index, error: skillError }
  }

  let agentToUse: string
  let categoryModel: { providerID: string; modelID: string; variant?: string } | undefined
  let categoryPromptAppend: string | undefined
  let modelInfo: import("../../features/task-toast-manager/types").ModelFallbackInfo | undefined
  let fallbackChain: import("../../shared/model-requirements").FallbackEntry[] | undefined
  let maxPromptTokens: number | undefined

  if (args.category) {
    const resolution = await resolveCategoryExecution(args, options, inheritedModel, systemDefaultModel)
    if (resolution.error) {
      return { index, error: resolution.error }
    }
    agentToUse = resolution.agentToUse
    categoryModel = resolution.categoryModel
    categoryPromptAppend = resolution.categoryPromptAppend
    modelInfo = resolution.modelInfo
    fallbackChain = resolution.fallbackChain
    maxPromptTokens = resolution.maxPromptTokens
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
    agentName: agentToUse,
    maxPromptTokens,
    model: categoryModel,
    availableCategories,
    availableSkills,
    availableToolInfos,
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
