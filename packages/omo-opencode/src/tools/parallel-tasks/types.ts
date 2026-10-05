import type { DelegateTaskToolOptions, ToolContextWithMetadata } from "../delegate-task/types"
import type { WorktreeMergeResult } from "@oh-my-opencode/team-core/team-worktree/isolated-worktree"

export type ParallelTaskIsolation = "worktree" | "none"

export interface ParallelTaskItem {
  description: string
  prompt: string
  load_skills: string[]
  /** Provide EITHER category OR subagent_type (mutually exclusive, exactly one required). */
  subagent_type?: string
  /** Provide EITHER category OR subagent_type (mutually exclusive, exactly one required). */
  category?: string
  /** Per-item override of the call-level isolation. Ignored for research items. */
  isolation?: ParallelTaskIsolation
}

export interface ParallelTasksArgs {
  tasks: ParallelTaskItem[]
  isolation?: ParallelTaskIsolation
}

export interface TaskIsolationReport {
  mode: ParallelTaskIsolation
  /** Why isolation was skipped or failed to set up (e.g. research item, not a git repo). */
  note?: string
  worktreePath?: string
  merge?: WorktreeMergeResult
}

export interface TaskResult {
  index: number
  description: string
  output: string | null
  errorMessage: string | null
  emitted: boolean
  childSessionId: string | undefined
  agent: string
  isolation?: TaskIsolationReport
}

export type ParallelTasksToolOptions = DelegateTaskToolOptions & {
  /** Config default (`parallel_tasks.isolation`); "auto" applies the 2+ implementation items rule. */
  isolationDefault?: "auto" | ParallelTaskIsolation
}
export type { ToolContextWithMetadata }
