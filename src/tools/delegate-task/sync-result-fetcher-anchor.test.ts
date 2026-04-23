const { describe, test, expect } = require("bun:test")

describe("fetchSyncResult with anchored continuations", () => {
  test("returns the post-revert assistant response when the old anchor message was removed", async () => {
    //#given
    const { fetchSyncResult } = require("./sync-result-fetcher")

    const mockClient = {
      session: {
        messages: async () => ({
          data: [
            { info: { id: "msg_010", role: "user", time: { created: 1000 } } },
            {
              info: { id: "msg_011", role: "assistant", time: { created: 2000 } },
              parts: [{ type: "text", text: "Old response" }],
            },
            { info: { id: "msg_020", role: "user", time: { created: 3000 } } },
            {
              info: { id: "msg_021", role: "assistant", time: { created: 4000 } },
              parts: [{ type: "text", text: "New response after revert" }],
            },
          ],
        }),
      },
    }

    //#when
    const result = await fetchSyncResult(mockClient, "ses_test", {
      count: 6,
      lastMessageID: "msg_removed_by_revert",
      lastMessageCreatedAt: 2000,
    })

    //#then
    expect(result).toEqual({ ok: true, textContent: "New response after revert" })
  })

  test("returns an explicit error instead of stale pre-anchor text when no new assistant replied", async () => {
    //#given
    const { fetchSyncResult } = require("./sync-result-fetcher")

    const mockClient = {
      session: {
        messages: async () => ({
          data: [
            { info: { id: "msg_010", role: "user", time: { created: 1000 } } },
            {
              info: { id: "msg_011", role: "assistant", time: { created: 2000 } },
              parts: [{ type: "text", text: "Old response" }],
            },
          ],
        }),
      },
    }

    //#when
    const result = await fetchSyncResult(mockClient, "ses_test", {
      count: 6,
      lastMessageID: "msg_removed_by_revert",
      lastMessageCreatedAt: 2000,
    })

    //#then
    expect(result.ok).toBe(false)
    expect(result.error).toContain("no new response was generated")
  })
})

export {}
