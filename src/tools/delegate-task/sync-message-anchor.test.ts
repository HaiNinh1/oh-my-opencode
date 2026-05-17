const { describe, test, expect } = require("bun:test")

describe("sync-message-anchor", () => {
  test("returns messages after anchor id when transcript is append-only", () => {
    //#given
    const { getMessagesAfterAnchor } = require("./sync-message-anchor")

    const messages = [
      { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
      { info: { id: "msg_002", role: "assistant", time: { created: 2000 } } },
      { info: { id: "msg_003", role: "user", time: { created: 3000 } } },
      { info: { id: "msg_004", role: "assistant", time: { created: 4000 } } },
    ]

    //#when
    const result = getMessagesAfterAnchor(messages, {
      count: 2,
      lastMessageID: "msg_002",
      lastMessageCreatedAt: 2000,
    })

    //#then
    expect(result).toEqual(messages.slice(2))
  })

  test("falls back to created time when revert removed the anchor message", () => {
    //#given
    const { getMessagesAfterAnchor } = require("./sync-message-anchor")

    const messages = [
      { info: { id: "msg_010", role: "user", time: { created: 1000 } } },
      { info: { id: "msg_011", role: "assistant", time: { created: 2000 } } },
      { info: { id: "msg_020", role: "user", time: { created: 3000 } } },
      { info: { id: "msg_021", role: "assistant", time: { created: 4000 } } },
    ]

    //#when
    const result = getMessagesAfterAnchor(messages, {
      count: 6,
      lastMessageID: "msg_missing_after_revert",
      lastMessageCreatedAt: 2000,
    })

    //#then
    expect(result).toEqual(messages.slice(2))
  })
})

export {}
