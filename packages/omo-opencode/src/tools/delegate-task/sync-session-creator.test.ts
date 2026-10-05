import { describe, expect, test } from "bun:test"

import { createSyncSession } from "./sync-session-creator"

describe("createSyncSession", () => {
  test("creates child session with question permission denied", async () => {
    // given
    const createCalls: Array<Record<string, unknown>> = []
    const client = {
      session: {
        get: async () => ({ data: { directory: "/parent" } }),
        create: async (input: Record<string, unknown>) => {
          createCalls.push(input)
          return { data: { id: "ses_child" } }
        },
      },
    }

    // when
    const result = await createSyncSession(client as never, {
      parentSessionID: "ses_parent",
      agentToUse: "explore",
      description: "test task",
      defaultDirectory: "/fallback",
    })

    // then
    expect(result).toEqual({ ok: true, sessionID: "ses_child", parentDirectory: "/parent" })
    expect(createCalls).toHaveLength(1)
    expect(createCalls[0]?.body).toEqual({
      parentID: "ses_parent",
      title: "test task (@explore subagent)",
      permission: [
        { permission: "question", action: "deny", pattern: "*" },
      ],
    })
  })

  test("routes the child session to the directory override instead of the parent's directory", async () => {
    // given
    const createCalls: Array<Record<string, unknown>> = []
    let getCalls = 0
    const client = {
      session: {
        get: async () => {
          getCalls += 1
          return { data: { directory: "/parent" } }
        },
        create: async (input: Record<string, unknown>) => {
          createCalls.push(input)
          return { data: { id: "ses_child" } }
        },
      },
    }

    // when
    const result = await createSyncSession(client as never, {
      parentSessionID: "ses_parent",
      agentToUse: "sisyphus-junior",
      description: "isolated task",
      defaultDirectory: "/fallback",
      directoryOverride: "C:/repo/.omo/worktrees/pt-1",
    })

    // then
    expect(result).toEqual({ ok: true, sessionID: "ses_child", parentDirectory: "C:/repo/.omo/worktrees/pt-1" })
    expect(getCalls).toBe(0)
    expect(createCalls[0]?.query).toEqual({ directory: "C:/repo/.omo/worktrees/pt-1" })
  })
})
