import type { TaskResult } from "./types"
import { formatDuration } from "../delegate-task/time-formatter"

const SUCCESS_PREFIX = "Task completed in "

function classifyOutcome(result: TaskResult): "success" | "failed" | "error" {
  if (result.errorMessage !== null) return "error"
  if (result.output?.startsWith(SUCCESS_PREFIX)) return "success"
  return "failed"
}

export function formatResults(
  taskResults: TaskResult[],
  resolutionErrors: string[],
  startTime: Date,
  totalTaskCount: number,
): string {
  const duration = formatDuration(startTime)
  const succeeded = taskResults.filter((r) => classifyOutcome(r) === "success").length
  const failed = taskResults.length - succeeded + resolutionErrors.length

  const parts: string[] = [
    `Parallel execution completed: ${succeeded}/${totalTaskCount} tasks succeeded in ${duration}.`,
  ]

  if (failed > 0) {
    parts[0] += ` (${failed} failed)`
  }

  for (const err of resolutionErrors) {
    parts.push(`\n---\n\n**Resolution Error**: ${err}`)
  }

  const hasEmittedTasks = taskResults.some((r) => r.emitted)

  for (const result of taskResults) {
    const outcome = classifyOutcome(result)

    parts.push(`\n---\n\n## Task ${result.index + 1}: ${result.description}`)

    if (result.emitted) {
      if (outcome === "success") {
        parts.push(`Completed successfully. Agent: ${result.agent}`)
        if (result.childSessionId) {
          parts.push(`Session: ${result.childSessionId}`)
        }
      } else if (outcome === "error") {
        parts.push(`**Error**: ${result.errorMessage}`)
      } else {
        parts.push(`**Failed**: Task returned non-success response.`)
      }
    } else {
      if (result.output) {
        parts.push(result.output)
      } else if (result.errorMessage) {
        parts.push(`**Error**: ${result.errorMessage}`)
      } else {
        parts.push("(No output)")
      }
    }
  }

  if (hasEmittedTasks) {
    parts.push("\n---\n\n> Detailed outputs are in the separate `task` tool results in this same assistant message.")
  }

  return parts.join("\n")
}
