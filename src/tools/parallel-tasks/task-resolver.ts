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
  resolveSubagentExecution,
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
  const availableToolInfos: AvailableToolInfo[] = options.getAvailableToolInfos?.() ?? []

  return Promise.all(
    items.map(async (item, index) => {
      try {
        return await resolveSingleTask(
          item, index, options, parentContext, categoryExamples,
          availableCategories, availableSkills, availableToolInfos,
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
  availableToolInfos: AvailableToolInfo[],
): Promise<TaskResolutionResult> {
  if (!item.subagent_type) {
    return { index, error: "'subagent_type' is required (e.g., 'explore' or 'librarian')" }
  }

  const args: DelegateTaskArgs = {
    description: item.description,
    prompt: item.prompt,
    load_skills: item.load_skills,
    subagent_type: item.subagent_type,
    run_in_background: false,
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

  const resolution = await resolveSubagentExecution(args, options, parentContext.agent, categoryExamples)
  if (resolution.error) {
    return { index, error: resolution.error }
  }
  const agentToUse = resolution.agentToUse
  const categoryModel = resolution.categoryModel
  const fallbackChain = resolution.fallbackChain

  const systemContent = buildSystemContent({
    skillContent,
    skillContents,
    agentName: agentToUse,
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
    fallbackChain,
  }
}
