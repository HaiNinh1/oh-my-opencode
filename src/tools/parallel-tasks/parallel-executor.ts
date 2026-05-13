import type { ParallelTaskItem, ParallelTasksToolOptions, TaskResult, ToolContextWithMetadata } from "./types"
import type { ResolvedTask } from "./task-resolver"
import { resolveParentContext, executeSyncTask } from "../delegate-task/executor"
import { resolveAllTasks } from "./task-resolver"
import { formatResults } from "./result-formatter"
import { log } from "../../shared/logger"
import {
  resolveMessageID,
  createPartId,
  emitRunningPart,
  emitCompletedPart,
  emitErrorPart,
  type PartContext,
} from "./tui-part-emitter"

interface ChildMetadata {
  metadata?: {
    sessionId?: string
    model?: { providerID: string; modelID: string }
  }
}

function createChildContext(
  ctx: ToolContextWithMetadata,
  partCtx: PartContext | null,
  partId: string,
  taskInput: { description: string; prompt: string; subagent_type?: string; category?: string; load_skills?: string[] },
  onSessionCreated: (sessionId: string, model?: { providerID: string; modelID: string }) => void,
): ToolContextWithMetadata {
  return {
    ...ctx,
    metadata: async (input: Record<string, unknown>) => {
      const meta = input as ChildMetadata
      const childSessionId = meta.metadata?.sessionId
      if (childSessionId) {
        onSessionCreated(childSessionId, meta.metadata?.model)
        if (partCtx) {
          await emitRunningPart(partCtx, partId, taskInput, childSessionId, meta.metadata?.model)
            .catch((err) => log("[parallel_tasks] Failed to emit running part", { error: String(err) }))
        }
      }
    },
  }
}

export async function executeParallelTasks(
  items: ParallelTaskItem[],
  ctx: ToolContextWithMetadata,
  options: ParallelTasksToolOptions,
): Promise<string> {
  const startTime = new Date()
  const parentContext = await resolveParentContext(ctx, options.client)

  const resolutions = await resolveAllTasks(items, options, parentContext)
  const resolved: ResolvedTask[] = []
  const errors: string[] = []

  for (const result of resolutions) {
    if (result.error) {
      errors.push(`Task ${result.index + 1} ("${items[result.index].description}"): ${result.error}`)
    } else if (result.args && result.agentToUse) {
      resolved.push(result as ResolvedTask)
    }
  }

  if (resolved.length === 0) {
    return `All ${items.length} tasks failed resolution:\n${errors.join("\n")}`
  }

  const messageID = await resolveMessageID(options.client, ctx.sessionID)
  const partCtx: PartContext | null = messageID
    ? { client: options.client, sessionID: ctx.sessionID, messageID }
    : null

  if (partCtx) {
    log("[parallel_tasks] TUI part emission enabled", { messageID })
  } else {
    log("[parallel_tasks] TUI part emission disabled — could not resolve messageID")
  }

  log("[parallel_tasks] Executing tasks in parallel", {
    total: items.length,
    resolved: resolved.length,
    failed: errors.length,
  })

  const taskResults: TaskResult[] = await Promise.all(
    resolved.map(async (task): Promise<TaskResult> => {
      const partId = createPartId()
      const taskStartTime = Date.now()
      let childSessionId: string | undefined

      const taskInput = {
        description: task.item.description,
        prompt: task.item.prompt,
        subagent_type: task.item.subagent_type,
        category: task.item.category,
        load_skills: task.item.load_skills,
      }

      const childCtx = createChildContext(
        ctx,
        partCtx,
        partId,
        taskInput,
        (sessionId) => { childSessionId = sessionId },
      )

      try {
        const result = await executeSyncTask(
          task.args,
          childCtx,
          options,
          parentContext,
          task.agentToUse,
          task.categoryModel,
          task.systemContent,
          task.modelInfo,
          task.fallbackChain,
        )

        let emitted = false
        if (partCtx && childSessionId) {
          emitted = await emitCompletedPart(
            partCtx,
            partId,
            taskInput,
            childSessionId,
            result,
            taskStartTime,
            task.categoryModel,
          ).catch((err) => {
            log("[parallel_tasks] Failed to emit completed part", { error: String(err) })
            return false
          })
        }

        return {
          index: task.index,
          description: task.item.description,
          output: result,
          errorMessage: null,
          emitted,
          childSessionId,
          agent: task.agentToUse,
        }
      } catch (error) {
        let emitted = false
        if (partCtx) {
          const errorMsg = error instanceof Error ? error.message : String(error)
          emitted = await emitErrorPart(partCtx, partId, taskInput, errorMsg, taskStartTime)
            .catch((err) => {
              log("[parallel_tasks] Failed to emit error part", { error: String(err) })
              return false
            })
        }

        return {
          index: task.index,
          description: task.item.description,
          output: null,
          errorMessage: error instanceof Error ? error.message : String(error),
          emitted,
          childSessionId,
          agent: task.agentToUse,
        }
      }
    }),
  )

  return formatResults(taskResults, errors, startTime, items.length)
}
