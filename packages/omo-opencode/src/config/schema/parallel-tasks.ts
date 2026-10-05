import { z } from "zod"

export const ParallelTasksConfigSchema = z.object({
  /**
   * Default worktree isolation for `parallel_tasks` implementation items.
   * "auto" (default): isolate when a call has 2+ implementation items in a git repo.
   */
  isolation: z.enum(["auto", "worktree", "none"]).optional(),
})

export type ParallelTasksConfig = z.infer<typeof ParallelTasksConfigSchema>
