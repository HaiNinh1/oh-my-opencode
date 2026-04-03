import type { ParallelTaskItem } from "./types"
import type { ResolvedTask } from "./task-resolver"
import { formatDuration } from "../delegate-task/time-formatter"

export function formatResults(
  items: ParallelTaskItem[],
  resolved: ResolvedTask[],
  results: PromiseSettledResult<string>[],
  resolutionErrors: string[],
  startTime: Date,
): string {
  const duration = formatDuration(startTime)
  const succeeded = results.filter((r) => r.status === "fulfilled").length
  const failed = results.filter((r) => r.status === "rejected").length + resolutionErrors.length

  const parts: string[] = [
    `Parallel execution completed: ${succeeded}/${items.length} tasks succeeded in ${duration}.`,
  ]

  if (failed > 0) {
    parts[0] += ` (${failed} failed)`
  }

  for (const err of resolutionErrors) {
    parts.push(`\n---\n\n**Resolution Error**: ${err}`)
  }

  for (let i = 0; i < resolved.length; i++) {
    const task = resolved[i]
    const result = results[i]

    parts.push(`\n---\n\n## Task ${task.index + 1}: ${task.item.description}`)

    if (result.status === "fulfilled") {
      parts.push(result.value)
    } else {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason)
      parts.push(`**Error**: ${reason}`)
    }
  }

  return parts.join("\n")
}
