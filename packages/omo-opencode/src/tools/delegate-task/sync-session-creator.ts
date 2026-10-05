import type { OpencodeClient } from "./types"
import type { DelegatedModelConfig } from "../../shared/model-resolution-types"
import { QUESTION_DENIED_SESSION_PERMISSION } from "../../shared/question-denied-session-permission"

export async function createSyncSession(
  client: OpencodeClient,
  input: {
    parentSessionID: string
    agentToUse: string
    description: string
    defaultDirectory: string
    /** Forces the child session's working directory (e.g. an isolated git worktree) instead of inheriting the parent's. */
    directoryOverride?: string
    categoryModel?: DelegatedModelConfig
  }
): Promise<{ ok: true; sessionID: string; parentDirectory: string } | { ok: false; error: string }> {
  const parentSession = input.directoryOverride
    ? null
    : await client.session.get({ path: { id: input.parentSessionID } }).catch(() => null)
  const parentDirectory = input.directoryOverride ?? parentSession?.data?.directory ?? input.defaultDirectory

  const createResult = await client.session.create({
    body: {
      parentID: input.parentSessionID,
      title: `${input.description} (@${input.agentToUse} subagent)`,
      permission: QUESTION_DENIED_SESSION_PERMISSION,
      ...(input.categoryModel
        ? {
            model: {
              id: input.categoryModel.modelID,
              providerID: input.categoryModel.providerID,
              ...(input.categoryModel.variant ? { variant: input.categoryModel.variant } : {}),
            },
          }
        : {}),
    } as Record<string, unknown>,
    query: {
      directory: parentDirectory,
    },
  })

  if (createResult.error !== undefined) {
    return { ok: false, error: `Failed to create session: ${createResult.error}` }
  }
  if (createResult.data === undefined) {
    return { ok: false, error: "Failed to create session: missing session data" }
  }

  return { ok: true, sessionID: createResult.data.id, parentDirectory }
}
