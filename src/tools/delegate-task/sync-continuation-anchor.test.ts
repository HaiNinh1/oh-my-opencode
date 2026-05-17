const { describe, test, expect } = require("bun:test")

describe("executeSyncContinuation anchor capture", () => {
  test("passes a message anchor to the poller and fetcher for resumed sessions", async () => {
    //#given
    const { executeSyncContinuation } = require("./sync-continuation")

    const capturedAnchors = []
    const mockClient = {
      session: {
        messages: async () => ({
          data: [
            { info: { id: "msg_001", role: "user", time: { created: 1000 }, agent: "oracle" } },
            {
              info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "end_turn", agent: "oracle" },
              parts: [{ type: "text", text: "Old response" }],
            },
          ],
        }),
        promptAsync: async () => ({}),
      },
    }

    const deps = {
      pollSyncSession: async (_ctx: any, _client: any, input: any) => {
        capturedAnchors.push(input.anchorMessage)
        return null
      },
      fetchSyncResult: async (_client: any, _sessionID: string, anchorMessage: any) => {
        capturedAnchors.push(anchorMessage)
        return { ok: true as const, textContent: "Result" }
      },
    }

    const mockCtx = {
      sessionID: "parent-session",
      callID: "call-123",
      metadata: () => {},
    }

    const mockExecutorCtx = {
      client: mockClient,
    }

    const args = {
      session_id: "ses_test_12345678",
      prompt: "continue working",
      description: "resume task",
      load_skills: [],
      run_in_background: false,
    }

    //#when
    const result = await executeSyncContinuation(args, mockCtx, mockExecutorCtx, undefined, deps)

    //#then
    expect(capturedAnchors).toHaveLength(2)
    expect(capturedAnchors[0]).toEqual({
      count: 2,
      lastMessageID: "msg_002",
      lastMessageCreatedAt: 2000,
    })
    expect(capturedAnchors[1]).toEqual(capturedAnchors[0])
    expect(result).toContain("Task continued and completed")
  })
})

export {}
