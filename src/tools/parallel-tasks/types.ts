import type { DelegateTaskToolOptions, ToolContextWithMetadata } from "../delegate-task/types"

export interface ParallelTaskItem {
  description: string
  prompt: string
  load_skills: string[]
  category?: string
  subagent_type?: string
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
