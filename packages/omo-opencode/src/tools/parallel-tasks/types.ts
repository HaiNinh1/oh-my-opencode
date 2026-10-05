import type { DelegateTaskToolOptions, ToolContextWithMetadata } from "../delegate-task/types"

export interface ParallelTaskItem {
  description: string
  prompt: string
  load_skills: string[]
  /** Provide EITHER category OR subagent_type (mutually exclusive, exactly one required). */
  subagent_type?: string
  /** Provide EITHER category OR subagent_type (mutually exclusive, exactly one required). */
  category?: string
}

export interface ParallelTasksArgs {
  tasks: ParallelTaskItem[]
}

export interface TaskResult {
  index: number
  description: string
  output: string | null
  errorMessage: string | null
  emitted: boolean
  childSessionId: string | undefined
  agent: string
}

export type ParallelTasksToolOptions = DelegateTaskToolOptions
export type { ToolContextWithMetadata }
