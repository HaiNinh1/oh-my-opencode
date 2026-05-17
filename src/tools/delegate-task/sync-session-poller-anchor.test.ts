declare const require: (name: string) => any
const { describe, test, expect, beforeEach, afterEach } = require("bun:test")
import { __setTimingConfig, __resetTimingConfig } from "./timing"

function createMockCtx() {
  return {
    sessionID: "parent-session",
    messageID: "parent-message",
    agent: "test-agent",
    abort: new AbortController().signal,
  }
}

describe("pollSyncSession with anchored continuations", () => {
  beforeEach(() => {
    __setTimingConfig({
      POLL_INTERVAL_MS: 10,
      MIN_STABILITY_TIME_MS: 0,
      STABILITY_POLLS_REQUIRED: 1,
      MAX_POLL_TIME_MS: 5000,
    })
  })

  afterEach(() => {
    __resetTimingConfig()
  })

  test("completes after revert when transcript no longer exceeds the old count anchor", async () => {
    //#given
    const { pollSyncSession } = require("./sync-session-poller")

    const messages = [
      { info: { id: "msg_010", role: "user", time: { created: 1000 } } },
      {
        info: { id: "msg_011", role: "assistant", time: { created: 2000 }, finish: "end_turn" },
        parts: [{ type: "text", text: "Old response" }],
      },
      { info: { id: "msg_020", role: "user", time: { created: 3000 } } },
      {
        info: { id: "msg_021", role: "assistant", time: { created: 4000 }, finish: "stop" },
        parts: [{ type: "text", text: "New response after revert" }],
      },
    ]

    const mockClient = {
      session: {
        messages: async () => ({ data: messages }),
        status: async () => ({ data: { ses_test: { type: "idle" } } }),
      },
    }

    //#when
    const result = await pollSyncSession(createMockCtx(), mockClient, {
      sessionID: "ses_test",
      agentToUse: "test-agent",
      toastManager: null,
      taskId: undefined,
      anchorMessage: {
        count: 6,
        lastMessageID: "msg_removed_by_revert",
        lastMessageCreatedAt: 2000,
      },
    })

    //#then
    expect(result).toBeNull()
  })

  test("does not complete from stale assistant text when no post-anchor messages exist", async () => {
    //#given
    const { pollSyncSession } = require("./sync-session-poller")

    const mockClient = {
      session: {
        abort: async () => {},
        messages: async () => ({
          data: [
            { info: { id: "msg_010", role: "user", time: { created: 1000 } } },
            {
              info: { id: "msg_011", role: "assistant", time: { created: 2000 }, finish: "end_turn" },
              parts: [{ type: "text", text: "Old response" }],
            },
          ],
        }),
        status: async () => ({ data: { ses_test: { type: "idle" } } }),
      },
    }

    //#when
    const result = await pollSyncSession(createMockCtx(), mockClient, {
      sessionID: "ses_test",
      agentToUse: "test-agent",
      toastManager: null,
      taskId: undefined,
      anchorMessage: {
        count: 6,
        lastMessageID: "msg_removed_by_revert",
        lastMessageCreatedAt: 2000,
      },
    }, 50)

    //#then
    expect(result).toBe("Poll timeout reached after 50ms for session ses_test")
  })

  test("completes when the resumed transcript exposes only a new assistant reply after the anchor", async () => {
    //#given
    const { pollSyncSession } = require("./sync-session-poller")

    const mockClient = {
      session: {
        messages: async () => ({
          data: [
            {
              info: { id: "msg_021", role: "assistant", time: { created: 4000 }, finish: "end_turn" },
              parts: [{ type: "text", text: "Assistant-only continuation reply" }],
            },
          ],
        }),
        status: async () => ({ data: { ses_test: { type: "idle" } } }),
      },
    }

    //#when
    const result = await pollSyncSession(createMockCtx(), mockClient, {
      sessionID: "ses_test",
      agentToUse: "test-agent",
      toastManager: null,
      taskId: undefined,
      anchorMessage: {
        count: 2,
        lastMessageID: "msg_002",
        lastMessageCreatedAt: 2000,
      },
    })

    //#then
    expect(result).toBeNull()
  })
})

export {}
