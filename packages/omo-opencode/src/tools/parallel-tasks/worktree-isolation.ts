import path from "node:path"
import { randomUUID } from "node:crypto"

import {
  createIsolatedWorktree,
  defaultIsolatedWorktreePath,
  mergeBackWorktree,
  snapshotWorkingTree,
  toForwardSlashes,
} from "@oh-my-opencode/team-core/team-worktree/isolated-worktree"
import type { ParallelTaskIsolation, ParallelTaskItem, TaskIsolationReport } from "./types"

const RESEARCH_AGENTS = new Set(["explore", "librarian"])

export function isResearchItem(item: Pick<ParallelTaskItem, "subagent_type" | "category">): boolean {
  return !item.category && item.subagent_type !== undefined && RESEARCH_AGENTS.has(item.subagent_type.toLowerCase())
}

/**
 * Per-item isolation mode. Precedence: item override > call arg > config default.
 * "auto" (default) isolates implementation items only when the call has 2+ of them.
 * Research items and sessions outside a git repo are never isolated.
 */
export function decideIsolation(input: {
  items: Pick<ParallelTaskItem, "subagent_type" | "category" | "isolation">[]
  callIsolation?: ParallelTaskIsolation
  configDefault?: "auto" | ParallelTaskIsolation
  inGitRepo: boolean
}): ParallelTaskIsolation[] {
  const implementationCount = input.items.filter((item) => !isResearchItem(item)).length
  const configMode = input.configDefault && input.configDefault !== "auto" ? input.configDefault : undefined
  const autoMode: ParallelTaskIsolation = implementationCount >= 2 ? "worktree" : "none"
  return input.items.map((item) => {
    if (!input.inGitRepo || isResearchItem(item)) return "none"
    return item.isolation ?? input.callIsolation ?? configMode ?? autoMode
  })
}

export interface PreparedWorktree {
  worktreePath: string
  /** Session directory inside the worktree (mirrors the parent's subdirectory, if any). */
  sessionDirectory: string
}

/** Creates worktrees sequentially (git worktree add is not concurrency-safe) from one parent snapshot. */
export async function prepareWorktrees(input: {
  repoRoot: string
  sessionDirectory: string
  indices: number[]
}): Promise<Map<number, PreparedWorktree | { error: string }>> {
  const prepared = new Map<number, PreparedWorktree | { error: string }>()
  if (input.indices.length === 0) return prepared
  const runId = randomUUID().slice(0, 8)
  const relativeSessionDir = toForwardSlashes(path.relative(input.repoRoot, input.sessionDirectory))
  let baseTree: string
  try {
    // Snapshot once so every item starts from the same parent state, uncommitted changes included.
    baseTree = await snapshotWorkingTree(input.repoRoot)
  } catch (error) {
    const message = `could not snapshot parent working tree: ${error instanceof Error ? error.message : String(error)}`
    for (const index of input.indices) prepared.set(index, { error: message })
    return prepared
  }
  for (const index of input.indices) {
    try {
      const { worktreePath } = await createIsolatedWorktree({
        repoRoot: input.repoRoot,
        worktreePath: defaultIsolatedWorktreePath(input.repoRoot, `pt-${runId}-${index + 1}`),
        baseTree,
      })
      const sessionDirectory = relativeSessionDir && !relativeSessionDir.startsWith("..")
        ? `${worktreePath}/${relativeSessionDir}`
        : worktreePath
      prepared.set(index, { worktreePath, sessionDirectory })
    } catch (error) {
      prepared.set(index, { error: error instanceof Error ? error.message : String(error) })
    }
  }
  return prepared
}

export function buildWorktreePreamble(worktreePath: string, repoRoot: string): string {
  return [
    `[Isolated git worktree] Your working directory is ${worktreePath}, a private worktree of ${repoRoot} (parent's uncommitted changes included).`,
    `Make ALL edits inside ${worktreePath}; any path under ${repoRoot} maps to the same relative path in your worktree. Do not edit ${repoRoot} directly.`,
    "Your changes are merged back into the parent checkout automatically when you finish; no need to commit.",
    "",
  ].join("\n")
}

/**
 * Merge back in item order; a failed or conflicting merge keeps its worktree and does not stop later items.
 * Work from tasks that did not succeed is never auto-merged: those worktrees are kept unless unchanged.
 */
export async function mergeBackInOrder(
  entries: { index: number; worktreePath: string; taskSucceeded: boolean }[],
): Promise<Map<number, TaskIsolationReport>> {
  const reports = new Map<number, TaskIsolationReport>()
  for (const entry of [...entries].sort((left, right) => left.index - right.index)) {
    const merge = await mergeBackWorktree(entry.worktreePath, { apply: entry.taskSucceeded })
    reports.set(entry.index, {
      mode: "worktree",
      worktreePath: entry.worktreePath,
      merge,
      ...(entry.taskSucceeded ? {} : { note: "task did not complete successfully; changes were not merged" }),
    })
  }
  return reports
}
