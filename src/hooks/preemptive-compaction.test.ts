/// <reference types="bun-types" />

import { describe, it, expect, mock, beforeEach } from "bun:test";

const logMock = mock(() => {});

mock.module("../shared/logger", () => ({
  log: logMock,
}));

const { createPreemptiveCompactionHook } =
  await import("./preemptive-compaction");

function createMockCtx() {
  return {
    client: {
      session: {
        summarize: mock(() => Promise.resolve({})),
      },
    },
    directory: "/tmp/test",
  };
}

function setupImmediateTimeouts(): () => void {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  globalThis.setTimeout = ((
    callback: (...args: unknown[]) => void,
    _delay?: number,
    ...args: unknown[]
  ) => {
    callback(...args);
    return 1 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  globalThis.clearTimeout = (() => {}) as typeof clearTimeout;

  return () => {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  };
}

// Helper: emit chat.params to cache model limits for a session
async function cacheModelLimits(
  hook: ReturnType<typeof createPreemptiveCompactionHook>,
  sessionID: string,
  limits: { input: number; output: number; context: number },
) {
  await hook["chat.params"]({ sessionID, model: { limit: limits } }, {});
}

// Helper: emit message.updated for a finished assistant message
async function emitAssistantFinished(
  hook: ReturnType<typeof createPreemptiveCompactionHook>,
  opts: {
    sessionID: string;
    providerID?: string;
    modelID?: string;
    tokens: {
      input: number;
      output: number;
      reasoning: number;
      cache: { read: number; write: number };
    };
  },
) {
  await hook.event({
    event: {
      type: "message.updated",
      properties: {
        info: {
          role: "assistant",
          sessionID: opts.sessionID,
          providerID: opts.providerID ?? "anthropic",
          modelID: opts.modelID ?? "claude-sonnet-4-6",
          finish: true,
          tokens: opts.tokens,
        },
      },
    },
  });
}

// Helper: emit session.idle
async function emitIdle(
  hook: ReturnType<typeof createPreemptiveCompactionHook>,
  sessionID: string,
) {
  await hook.event({
    event: {
      type: "session.idle",
      properties: { sessionID },
    },
  });
}

describe("preemptive-compaction", () => {
  let ctx: ReturnType<typeof createMockCtx>;

  beforeEach(() => {
    ctx = createMockCtx();
    logMock.mockClear();
  });

  // #given token count leaves less room than output limit
  // #when session.idle fires
  // #then should trigger summarize
  it("should trigger compaction when remaining context < output limit", async () => {
    const hook = createPreemptiveCompactionHook(ctx as never, {} as never);
    const sessionID = "ses_compact";

    await cacheModelLimits(hook, sessionID, {
      input: 200_000,
      output: 32_000,
      context: 200_000,
    });

    // 180K total tokens → remaining = 200K - 180K = 20K < 32K output
    await emitAssistantFinished(hook, {
      sessionID,
      tokens: {
        input: 160_000,
        output: 10_000,
        reasoning: 0,
        cache: { read: 10_000, write: 0 },
      },
    });

    await emitIdle(hook, sessionID);

    expect(ctx.client.session.summarize).toHaveBeenCalled();
  });

  // #given token count leaves enough room for output
  // #when session.idle fires
  // #then should NOT trigger summarize
  it("should not trigger compaction when remaining context >= output limit", async () => {
    const hook = createPreemptiveCompactionHook(ctx as never, {} as never);
    const sessionID = "ses_ok";

    await cacheModelLimits(hook, sessionID, {
      input: 200_000,
      output: 32_000,
      context: 200_000,
    });

    // 100K total → remaining = 200K - 100K = 100K >= 32K
    await emitAssistantFinished(hook, {
      sessionID,
      tokens: {
        input: 80_000,
        output: 10_000,
        reasoning: 0,
        cache: { read: 10_000, write: 0 },
      },
    });

    await emitIdle(hook, sessionID);

    expect(ctx.client.session.summarize).not.toHaveBeenCalled();
  });

  // #given no model limits cached (chat.params never fired)
  // #when session.idle fires
  // #then should skip without triggering
  it("should skip when no model limits are cached", async () => {
    const hook = createPreemptiveCompactionHook(ctx as never, {} as never);
    const sessionID = "ses_no_limits";

    await emitAssistantFinished(hook, {
      sessionID,
      tokens: {
        input: 190_000,
        output: 5_000,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    });

    await emitIdle(hook, sessionID);

    expect(ctx.client.session.summarize).not.toHaveBeenCalled();
  });

  // #given no token info cached (no assistant message finished)
  // #when session.idle fires
  // #then should skip
  it("should skip when no token info is cached", async () => {
    const hook = createPreemptiveCompactionHook(ctx as never, {} as never);
    const sessionID = "ses_no_tokens";

    await cacheModelLimits(hook, sessionID, {
      input: 200_000,
      output: 32_000,
      context: 200_000,
    });

    await emitIdle(hook, sessionID);

    expect(ctx.client.session.summarize).not.toHaveBeenCalled();
  });

  // #given session.compacted fires after compaction
  // #then token cache should be cleared, preventing double-trigger
  it("should clear token cache on session.compacted", async () => {
    const hook = createPreemptiveCompactionHook(ctx as never, {} as never);
    const sessionID = "ses_compacted";

    await cacheModelLimits(hook, sessionID, {
      input: 200_000,
      output: 32_000,
      context: 200_000,
    });

    await emitAssistantFinished(hook, {
      sessionID,
      tokens: {
        input: 170_000,
        output: 10_000,
        reasoning: 0,
        cache: { read: 10_000, write: 0 },
      },
    });

    // Simulate compaction completed
    await hook.event({
      event: { type: "session.compacted", properties: { sessionID } },
    });

    // session.idle should NOT trigger because token cache was cleared
    await emitIdle(hook, sessionID);

    expect(ctx.client.session.summarize).not.toHaveBeenCalled();
  });

  // #given session deleted
  // #then all caches should be cleaned up
  it("should clean up all caches on session.deleted", async () => {
    const hook = createPreemptiveCompactionHook(ctx as never, {} as never);
    const sessionID = "ses_del";

    await cacheModelLimits(hook, sessionID, {
      input: 200_000,
      output: 32_000,
      context: 200_000,
    });

    await emitAssistantFinished(hook, {
      sessionID,
      tokens: {
        input: 180_000,
        output: 10_000,
        reasoning: 0,
        cache: { read: 10_000, write: 0 },
      },
    });

    await hook.event({
      event: {
        type: "session.deleted",
        properties: { info: { id: sessionID } },
      },
    });

    await emitIdle(hook, sessionID);

    expect(ctx.client.session.summarize).not.toHaveBeenCalled();
  });

  // #given summarize fails
  // #then should log error and allow retry on next idle
  it("should log summarize errors and allow retry", async () => {
    const hook = createPreemptiveCompactionHook(ctx as never, {} as never);
    const sessionID = "ses_error";
    const error = new Error("summarize failed");
    ctx.client.session.summarize.mockRejectedValueOnce(error);

    await cacheModelLimits(hook, sessionID, {
      input: 200_000,
      output: 32_000,
      context: 200_000,
    });

    await emitAssistantFinished(hook, {
      sessionID,
      tokens: {
        input: 170_000,
        output: 10_000,
        reasoning: 0,
        cache: { read: 10_000, write: 0 },
      },
    });

    await emitIdle(hook, sessionID);

    expect(logMock).toHaveBeenCalledWith(
      "[preemptive-compaction] Compaction failed",
      {
        sessionID,
        error: String(error),
      },
    );

    // Should allow retry on next idle (compacting lock released)
    ctx.client.session.summarize.mockResolvedValueOnce({});
    await emitIdle(hook, sessionID);

    expect(ctx.client.session.summarize).toHaveBeenCalledTimes(2);
  });

  // #given first compaction succeeded and context grew again
  // #when new high-token message arrives and idle fires
  // #then should trigger compaction again
  it("should allow re-compaction when context grows after successful compaction", async () => {
    const hook = createPreemptiveCompactionHook(ctx as never, {} as never);
    const sessionID = "ses_recompact";

    await cacheModelLimits(hook, sessionID, {
      input: 200_000,
      output: 32_000,
      context: 200_000,
    });

    // First compaction cycle
    await emitAssistantFinished(hook, {
      sessionID,
      tokens: {
        input: 170_000,
        output: 5_000,
        reasoning: 0,
        cache: { read: 10_000, write: 0 },
      },
    });
    await emitIdle(hook, sessionID);
    expect(ctx.client.session.summarize).toHaveBeenCalledTimes(1);

    // session.compacted clears token cache
    await hook.event({
      event: { type: "session.compacted", properties: { sessionID } },
    });

    // Context grew again after compaction
    await emitAssistantFinished(hook, {
      sessionID,
      tokens: {
        input: 175_000,
        output: 3_000,
        reasoning: 0,
        cache: { read: 5_000, write: 0 },
      },
    });
    await emitIdle(hook, sessionID);

    expect(ctx.client.session.summarize).toHaveBeenCalledTimes(2);
  });

  // #given model with large output limit (100k)
  // #when remaining is 50k (less than output)
  // #then should trigger
  it("should respect model-specific output limit", async () => {
    const hook = createPreemptiveCompactionHook(ctx as never, {} as never);
    const sessionID = "ses_large_output";

    // o3-style model: 200K context, 100K output
    await cacheModelLimits(hook, sessionID, {
      input: 200_000,
      output: 100_000,
      context: 200_000,
    });

    // 160K total → remaining = 40K < 100K output
    await emitAssistantFinished(hook, {
      sessionID,
      tokens: {
        input: 140_000,
        output: 15_000,
        reasoning: 0,
        cache: { read: 5_000, write: 0 },
      },
    });

    await emitIdle(hook, sessionID);

    expect(ctx.client.session.summarize).toHaveBeenCalled();
  });

  // #given model with 1M context
  // #when remaining is well above output
  // #then should NOT trigger
  it("should work correctly with large context models", async () => {
    const hook = createPreemptiveCompactionHook(ctx as never, {} as never);
    const sessionID = "ses_1m";

    await cacheModelLimits(hook, sessionID, {
      input: 1_000_000,
      output: 32_000,
      context: 1_000_000,
    });

    // 200K total → remaining = 800K, well above 32K output
    await emitAssistantFinished(hook, {
      sessionID,
      tokens: {
        input: 180_000,
        output: 10_000,
        reasoning: 0,
        cache: { read: 10_000, write: 0 },
      },
    });

    await emitIdle(hook, sessionID);

    expect(ctx.client.session.summarize).not.toHaveBeenCalled();
  });

  // #given summary/compaction assistant message
  // #then should NOT cache its tokens (prevents compaction loop)
  it("should ignore summary assistant messages", async () => {
    const hook = createPreemptiveCompactionHook(ctx as never, {} as never);
    const sessionID = "ses_summary";

    await cacheModelLimits(hook, sessionID, {
      input: 200_000,
      output: 32_000,
      context: 200_000,
    });

    // Summary message with high tokens — should be ignored
    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            role: "assistant",
            sessionID,
            providerID: "anthropic",
            modelID: "claude-sonnet-4-6",
            finish: true,
            summary: true,
            tokens: {
              input: 195_000,
              output: 3_000,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
        },
      },
    });

    await emitIdle(hook, sessionID);

    expect(ctx.client.session.summarize).not.toHaveBeenCalled();
  });

  it("should clear in-progress lock when summarize times out", async () => {
    const restoreTimeouts = setupImmediateTimeouts();
    const hook = createPreemptiveCompactionHook(ctx as never, {} as never);
    const sessionID = "ses_timeout";

    ctx.client.session.summarize
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce({});

    try {
      await cacheModelLimits(hook, sessionID, {
        input: 200_000,
        output: 32_000,
        context: 200_000,
      });

      await emitAssistantFinished(hook, {
        sessionID,
        tokens: {
          input: 170_000,
          output: 10_000,
          reasoning: 0,
          cache: { read: 10_000, write: 0 },
        },
      });

      // First idle: summarize hangs → times out
      await emitIdle(hook, sessionID);

      // Second idle: lock released, should retry
      await emitIdle(hook, sessionID);

      expect(ctx.client.session.summarize).toHaveBeenCalledTimes(2);
      expect(logMock).toHaveBeenCalledWith(
        "[preemptive-compaction] Compaction failed",
        {
          sessionID,
          error: expect.stringContaining("Compaction timed out"),
        },
      );
    } finally {
      restoreTimeouts();
    }
  });

  // #given chat.params called with model missing limit.input
  // #then should not cache (user guarantees input exists, but defensive)
  it("should handle chat.params with missing model limits gracefully", async () => {
    const hook = createPreemptiveCompactionHook(ctx as never, {} as never);
    const sessionID = "ses_no_input";

    // Model without limit.input — should not cache
    await hook["chat.params"](
      { sessionID, model: { limit: { context: 200_000, output: 32_000 } } },
      {},
    );

    await emitAssistantFinished(hook, {
      sessionID,
      tokens: {
        input: 195_000,
        output: 3_000,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    });

    await emitIdle(hook, sessionID);

    expect(ctx.client.session.summarize).not.toHaveBeenCalled();
  });

  // #given tokens.total is present
  // #then should use it instead of summing components
  it("should prefer tokens.total when available", async () => {
    const hook = createPreemptiveCompactionHook(ctx as never, {} as never);
    const sessionID = "ses_total";

    await cacheModelLimits(hook, sessionID, {
      input: 200_000,
      output: 32_000,
      context: 200_000,
    });

    // Components sum to 100K, but total says 185K (provider-reported)
    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            role: "assistant",
            sessionID,
            providerID: "anthropic",
            modelID: "claude-sonnet-4-6",
            finish: true,
            tokens: {
              total: 185_000,
              input: 80_000,
              output: 10_000,
              reasoning: 0,
              cache: { read: 10_000, write: 0 },
            },
          },
        },
      },
    });

    await emitIdle(hook, sessionID);

    // remaining = 200K - 185K = 15K < 32K → should compact
    expect(ctx.client.session.summarize).toHaveBeenCalled();
  });
});
