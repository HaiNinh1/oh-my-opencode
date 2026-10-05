import { randomUUID } from "node:crypto"
import { rm } from "node:fs/promises"

import {
  mergeBackWorktree,
  readIsolationMetadata,
  removeDirectoryIfDisposable,
  type WorktreeMergeResult,
} from "@oh-my-opencode/team-core/team-worktree/isolated-worktree"

import type { Message, RuntimeState } from "../types"

export const DELETABLE_MEMBER_STATUSES = new Set<RuntimeState["members"][number]["status"]>([
  "completed",
  "shutdown_approved",
  "errored",
])

export function createShutdownMessage(from: string, to: string, kind: Message["kind"], body: string): Message {
  return {
    version: 1,
    messageId: randomUUID(),
    from,
    to,
    kind,
    body,
    timestamp: Date.now(),
  }
}

export function getRuntimeMember(runtimeState: RuntimeState, memberName: string): RuntimeState["members"][number] {
  const member = runtimeState.members.find((candidate) => candidate.name === memberName)
  if (!member) {
    throw new Error(`unknown member '${memberName}'`)
  }

  return member
}

export function getLeadMemberName(runtimeState: RuntimeState): string {
  const leadMember = runtimeState.members.find((member) => member.agentType === "leader")
  if (!leadMember) {
    throw new Error(`team '${runtimeState.teamRunId}' is missing a lead member`)
  }

  return leadMember.name
}

export function createSendContext(
  runtimeState: RuntimeState,
  senderName: string,
): { isLead: boolean; activeMembers: string[] } {
  const sender = getRuntimeMember(runtimeState, senderName)
  return {
    isLead: sender.agentType === "leader",
    activeMembers: runtimeState.members.map((member) => member.name),
  }
}

export function findLatestShutdownRequestIndex(
  runtimeState: RuntimeState,
  memberName: string,
  requesterName?: string,
): number {
  for (let index = runtimeState.shutdownRequests.length - 1; index >= 0; index -= 1) {
    const shutdownRequest = runtimeState.shutdownRequests[index]
    if (shutdownRequest.memberId !== memberName) continue
    if (requesterName !== undefined && shutdownRequest.requesterName !== requesterName) continue
    return index
  }

  return -1
}

/**
 * Merge each isolated git worktree back into its parent checkout (sequentially, member order),
 * removing it only when merged or unchanged. Conflicting/failed worktrees are kept and reported.
 * Directories without isolation metadata are removed only when empty; otherwise kept and reported.
 */
export async function integrateAndRemoveWorktrees(memberPaths: Array<string | undefined>): Promise<{
  removedWorktrees: string[]
  worktreeMerges: WorktreeMergeResult[]
}> {
  const removedWorktrees: string[] = []
  const worktreeMerges: WorktreeMergeResult[] = []

  for (const memberPath of new Set(memberPaths)) {
    if (!memberPath) continue
    if (await readIsolationMetadata(memberPath)) {
      const merge = await mergeBackWorktree(memberPath)
      worktreeMerges.push(merge)
      if (!merge.retainedPath && !merge.cleanupError) removedWorktrees.push(memberPath)
      continue
    }
    // No metadata (non-git project, or git could not vouch for it): only an empty directory may go.
    const disposal = await removeDirectoryIfDisposable(memberPath)
    if (disposal.removed) {
      removedWorktrees.push(memberPath)
      continue
    }
    worktreeMerges.push({
      status: "failed",
      worktreePath: memberPath,
      filesChanged: [],
      conflictFiles: [],
      retainedPath: memberPath,
      error: disposal.error,
    })
  }

  return { removedWorktrees, worktreeMerges }
}

export async function removeWorktrees(memberPaths: Array<string | undefined>): Promise<string[]> {
  const removedWorktrees: string[] = []

  for (const memberPath of new Set(memberPaths)) {
    if (!memberPath) continue
    await rm(memberPath, { recursive: true, force: true })
    removedWorktrees.push(memberPath)
  }

  return removedWorktrees
}
