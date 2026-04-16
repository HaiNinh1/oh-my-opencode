import { describe, expect, it, mock } from "bun:test"

import { applyProviderConfig } from "../plugin-handlers/provider-config-handler"
import { createModelCacheState } from "../plugin-state"

const logMock = mock(() => {})

mock.module("../shared/logger", () => ({
  log: logMock,
}))

const { createPreemptiveCompactionHook } = await import("./preemptive-compaction")

function createMockCtx() {
  return {
    client: {
      session: {
        summarize: mock(() => Promise.resolve({})),
      },
    },
    directory: "/tmp/test",
  }
}

describe("preemptive-compaction context-limit cache invalidation", () => {
  it("skips compaction after provider config removes a cached model limit", async () => {
    // given
    const ctx = createMockCtx()
    const modelCacheState = createModelCacheState()
    const sessionID = "ses_removed_limit"

    applyProviderConfig({
      config: {
        provider: {
          opencode: {
            models: {
              "kimi-k2.5-free": {
                limit: { context: 200000 },
              },
            },
          },
        },
      },
      modelCacheState,
    })

    const hook = createPreemptiveCompactionHook(ctx as never, {} as never, modelCacheState)

    // set model limits via chat.params
    await hook["chat.params"]({
      sessionID,
      model: {
        limit: { input: 200000, output: 8192, context: 200000 },
      },
    }, undefined)

    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            role: "assistant",
            sessionID,
            providerID: "opencode",
            modelID: "kimi-k2.5-free",
            finish: true,
            tokens: {
              input: 170000,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
        },
      },
    })

    applyProviderConfig({
      config: {
        provider: {
          opencode: {
            models: {},
          },
        },
      },
      modelCacheState,
    })

    // when - trigger compaction check via session.idle
    await hook.event({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })

    // then
    expect(ctx.client.session.summarize).not.toHaveBeenCalled()
  })
})
