import type { TaskIsolationReport, TaskResult } from "./types"
import { formatDuration } from "../delegate-task/time-formatter"

const SUCCESS_PREFIX = "Task completed in "

export function classifyOutcome(result: Pick<TaskResult, "errorMessage" | "output">): "success" | "failed" | "error" {
  if (result.errorMessage !== null) return "error"
  if (result.output?.startsWith(SUCCESS_PREFIX)) return "success"
  return "failed"
}

function formatIsolation(isolation: TaskIsolationReport): string {
  if (isolation.mode === "none") {
    return `Isolation: none${isolation.note ? ` (${isolation.note})` : ""} | Merge: n/a (edits made directly in the parent checkout)`
  }
  const lines = [`Isolation: worktree${isolation.worktreePath ? ` ${isolation.worktreePath}` : ""}`]
  const merge = isolation.merge
  if (!merge) {
    lines.push(`Merge: not attempted${isolation.note ? ` (${isolation.note})` : ""}`)
    return lines.join("\n")
  }
  const files = merge.filesChanged.length > 0 ? merge.filesChanged.join(", ") : "(none)"
  lines.push(`Merge: ${merge.status}${isolation.note ? ` (${isolation.note})` : ""}`)
  lines.push(`Files changed: ${files}`)
  if (merge.conflictFiles.length > 0) lines.push(`Conflicting files: ${merge.conflictFiles.join(", ")}`)
  if (merge.retainedPath) {
    lines.push(`Worktree kept at ${merge.retainedPath}${merge.patchPath ? `; patch: ${merge.patchPath} (apply manually with \`git apply --3way\`)` : ""}`)
  }
  if (merge.error && merge.status !== "conflict") lines.push(`Merge error: ${merge.error}`)
  if (merge.cleanupError) lines.push(`Cleanup warning: ${merge.cleanupError}`)
  return lines.join("\n")
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

    if (result.isolation) {
      parts.push(formatIsolation(result.isolation))
    }
  }

  if (hasEmittedTasks) {
    parts.push("\n---\n\n> Detailed outputs are in the separate `task` tool results in this same assistant message.")
  }

  return parts.join("\n")
}
