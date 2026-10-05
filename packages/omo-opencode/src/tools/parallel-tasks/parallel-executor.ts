import { resolveGitRoot } from "@oh-my-opencode/team-core/team-worktree/isolated-worktree"
import type {
  ParallelTaskIsolation,
  ParallelTaskItem,
  ParallelTasksToolOptions,
  TaskIsolationReport,
  TaskResult,
  ToolContextWithMetadata,
} from "./types"
import type { ResolvedTask } from "./task-resolver"
import { resolveParentContext, executeSyncTask } from "../delegate-task/executor"
import { resolveAllTasks } from "./task-resolver"
import { classifyOutcome, formatResults } from "./result-formatter"
import {
  buildWorktreePreamble,
  decideIsolation,
  isResearchItem,
  mergeBackInOrder,
  prepareWorktrees,
  type PreparedWorktree,
} from "./worktree-isolation"
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
  taskInput: { description: string; prompt: string; subagent_type?: string; load_skills?: string[] },
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

function describeSkippedIsolation(item: ParallelTaskItem, inGitRepo: boolean): string | undefined {
  if (isResearchItem(item)) return "research item"
  if (!inGitRepo) return "session directory is not inside a git repository"
  return undefined
}

export async function executeParallelTasks(
  items: ParallelTaskItem[],
  ctx: ToolContextWithMetadata,
  options: ParallelTasksToolOptions,
  callIsolation?: ParallelTaskIsolation,
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

  const sessionDirectory = ctx.directory ?? options.directory
  const repoRoot = await resolveGitRoot(sessionDirectory)
  const modes = decideIsolation({
    items,
    callIsolation,
    configDefault: options.isolationDefault,
    inGitRepo: repoRoot !== null,
  })
  const reportIsolation = items.some((item) => !isResearchItem(item))
  const prepared = repoRoot
    ? await prepareWorktrees({
      repoRoot,
      sessionDirectory,
      indices: resolved.filter((task) => modes[task.index] === "worktree").map((task) => task.index),
    })
    : new Map<number, PreparedWorktree | { error: string }>()

  log("[parallel_tasks] Executing tasks in parallel", {
    total: items.length,
    resolved: resolved.length,
    failed: errors.length,
    isolated: prepared.size,
  })

  const taskResults: TaskResult[] = await Promise.all(
    resolved.map(async (task): Promise<TaskResult> => {
      const partId = createPartId()
      const taskStartTime = Date.now()
      let childSessionId: string | undefined
      const worktree = prepared.get(task.index)

      if (worktree && "error" in worktree) {
        // Running unisolated would reintroduce the concurrent-write race isolation exists to prevent.
        return {
          index: task.index,
          description: task.item.description,
          output: null,
          errorMessage: `Worktree isolation setup failed, task not started: ${worktree.error}`,
          emitted: false,
          childSessionId,
          agent: task.agentToUse,
          isolation: { mode: "worktree", note: "setup failed" },
        }
      }
      const isolation: TaskIsolationReport | undefined = worktree
        ? { mode: "worktree", worktreePath: worktree.worktreePath }
        : reportIsolation
          ? { mode: "none", note: describeSkippedIsolation(task.item, repoRoot !== null) }
          : undefined
      const taskArgs = worktree && repoRoot
        ? { ...task.args, prompt: `${buildWorktreePreamble(worktree.worktreePath, repoRoot)}\n${task.args.prompt}` }
        : task.args
      const executorCtx = worktree ? { ...options, sessionDirectory: worktree.sessionDirectory } : options

      const taskInput = {
        description: task.item.description,
        prompt: task.item.prompt,
        subagent_type: task.item.subagent_type,
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
          taskArgs,
          childCtx,
          executorCtx,
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
          isolation,
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
          isolation,
        }
      }
    }),
  )

  const mergeEntries = taskResults.flatMap((result) => {
    const worktreePath = result.isolation?.worktreePath
    return worktreePath
      ? [{ index: result.index, worktreePath, taskSucceeded: classifyOutcome(result) === "success" }]
      : []
  })
  if (mergeEntries.length > 0) {
    // Release OpenCode's per-directory instance (file watchers, LSP) so the worktree can be removed.
    for (const entry of prepared.values()) {
      if ("error" in entry) continue
      await options.client.instance?.dispose?.({ query: { directory: entry.sessionDirectory } })
        .catch((error: unknown) => log("[parallel_tasks] Failed to dispose worktree instance", { error: String(error) }))
    }
    const reports = await mergeBackInOrder(mergeEntries)
    for (const result of taskResults) {
      const report = reports.get(result.index)
      if (report) result.isolation = report
    }
  }

  return formatResults(taskResults, errors, startTime, items.length)
}
