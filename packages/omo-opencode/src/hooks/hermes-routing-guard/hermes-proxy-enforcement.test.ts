import { describe, expect, test, afterEach, beforeEach, mock } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { clearSessionAgent } from "../../features/claude-code-session-state"
import { HermesProxyState } from "../../shared/hermes-proxy-state"

mock.module("../../shared/opencode-storage-detection", () => ({
  isSqliteBackend: () => false,
  resetSqliteBackendCache: () => {},
}))

const { createHermesRoutingGuardHook } = await import("./index")
const { MESSAGE_STORAGE } = await import("../../features/hook-message-injector")

describe("hermes-routing-guard proxy enforcement", () => {
  const SESSION_ID = "ses_test_hermes_proxy"
  let testMessageDir: string

  function createMockPluginInput() {
    return {
      client: {},
      directory: "/tmp/test",
    } as never
  }

  function setupHermesSession(sessionID: string): void {
    testMessageDir = join(MESSAGE_STORAGE, sessionID)
    mkdirSync(testMessageDir, { recursive: true })
    writeFileSync(
      join(testMessageDir, "msg_001.json"),
      JSON.stringify({
        agent: "hermes",
        model: { providerID: "test", modelID: "test-model" },
      })
    )
  }

  function makeBeforeInput(tool: string, sessionID?: string) {
    return {
      tool,
      sessionID: sessionID ?? SESSION_ID,
      callID: "call-proxy-test",
    }
  }

  beforeEach(() => {
    HermesProxyState.clearAll()
  })

  afterEach(() => {
    clearSessionAgent(SESSION_ID)
    HermesProxyState.clearAll()
    if (testMessageDir) {
      try {
        rmSync(testMessageDir, { recursive: true, force: true })
      } catch {
        // cleanup
      }
    }
  })

  describe("#given hermes session with proxy target set (pre-pin)", () => {
    describe("#when task() targets matching agent", () => {
      test("#then should allow routing", async () => {
        // given
        setupHermesSession(SESSION_ID)
        HermesProxyState.setTarget(SESSION_ID, "sisyphus")
        const hook = createHermesRoutingGuardHook(createMockPluginInput())

        // when / then
        await expect(
          hook["tool.execute.before"](
            makeBeforeInput("task"),
            { args: { subagent_type: "sisyphus", prompt: "Do something" } }
          )
        ).resolves.toBeUndefined()
      })
    })

    describe("#when task() targets mismatched agent", () => {
      test("#then should reject with mismatch error", async () => {
        // given
        setupHermesSession(SESSION_ID)
        HermesProxyState.setTarget(SESSION_ID, "sisyphus")
        const hook = createHermesRoutingGuardHook(createMockPluginInput())

        // when / then
        await expect(
          hook["tool.execute.before"](
            makeBeforeInput("task"),
            { args: { subagent_type: "atlas", prompt: "Execute plan" } }
          )
        ).rejects.toThrow("Cannot route to 'atlas'")
      })
    })

    describe("#when task() uses category routing", () => {
      test("#then should block category routing", async () => {
        // given
        setupHermesSession(SESSION_ID)
        HermesProxyState.setTarget(SESSION_ID, "sisyphus")
        const hook = createHermesRoutingGuardHook(createMockPluginInput())

        // when / then
        await expect(
          hook["tool.execute.before"](
            makeBeforeInput("task"),
            { args: { category: "quick", prompt: "Fix typo" } }
          )
        ).rejects.toThrow("category")
      })
    })

    describe("#when task() uses background mode", () => {
      test("#then should block background routing", async () => {
        // given
        setupHermesSession(SESSION_ID)
        HermesProxyState.setTarget(SESSION_ID, "sisyphus")
        const hook = createHermesRoutingGuardHook(createMockPluginInput())

        // when / then
        await expect(
          hook["tool.execute.before"](
            makeBeforeInput("task"),
            { args: { subagent_type: "sisyphus", run_in_background: true, prompt: "Do something" } }
          )
        ).rejects.toThrow("Background routing is not supported")
      })
    })

    describe("#when task() uses session_id continuation before pin", () => {
      test("#then should reject pre-pin session_id", async () => {
        // given
        setupHermesSession(SESSION_ID)
        HermesProxyState.setTarget(SESSION_ID, "sisyphus")
        const hook = createHermesRoutingGuardHook(createMockPluginInput())

        // when / then - session_id should be rejected before child is pinned
        await expect(
          hook["tool.execute.before"](
            makeBeforeInput("task"),
            { args: { session_id: "ses_child_123", prompt: "Continue" } }
          )
        ).rejects.toThrow("Cannot continue session")
      })
    })
  })

  describe("#given hermes session with proxy pinned (post-pin)", () => {
    describe("#when task() with no session_id", () => {
      test("#then should rewrite to pinned child session_id", async () => {
        // given
        setupHermesSession(SESSION_ID)
        HermesProxyState.setTarget(SESSION_ID, "sisyphus")
        HermesProxyState.pinChildSession(SESSION_ID, "ses_pinned_child")
        const hook = createHermesRoutingGuardHook(createMockPluginInput())
        const args: Record<string, unknown> = {
          subagent_type: "sisyphus",
          prompt: "Continue working",
        }

        // when
        await hook["tool.execute.before"](makeBeforeInput("task"), { args })

        // then
        expect(args.session_id).toBe("ses_pinned_child")
        expect(args.subagent_type).toBeUndefined()
        expect(args.category).toBeUndefined()
      })
    })

    describe("#when task() already targets pinned child session", () => {
      test("#then should allow without rewriting", async () => {
        // given
        setupHermesSession(SESSION_ID)
        HermesProxyState.setTarget(SESSION_ID, "sisyphus")
        HermesProxyState.pinChildSession(SESSION_ID, "ses_pinned_child")
        const hook = createHermesRoutingGuardHook(createMockPluginInput())
        const args: Record<string, unknown> = {
          session_id: "ses_pinned_child",
          prompt: "More work",
        }

        // when
        await hook["tool.execute.before"](makeBeforeInput("task"), { args })

        // then
        expect(args.session_id).toBe("ses_pinned_child")
      })
    })

    describe("#when task() targets wrong session_id", () => {
      test("#then should rewrite to pinned child session", async () => {
        // given
        setupHermesSession(SESSION_ID)
        HermesProxyState.setTarget(SESSION_ID, "sisyphus")
        HermesProxyState.pinChildSession(SESSION_ID, "ses_pinned_child")
        const hook = createHermesRoutingGuardHook(createMockPluginInput())
        const args: Record<string, unknown> = {
          session_id: "ses_wrong_session",
          prompt: "More work",
        }

        // when
        await hook["tool.execute.before"](makeBeforeInput("task"), { args })

        // then
        expect(args.session_id).toBe("ses_pinned_child")
      })
    })

    describe("#when task() uses category in pinned session", () => {
      test("#then should block category routing", async () => {
        // given
        setupHermesSession(SESSION_ID)
        HermesProxyState.setTarget(SESSION_ID, "sisyphus")
        HermesProxyState.pinChildSession(SESSION_ID, "ses_pinned_child")
        const hook = createHermesRoutingGuardHook(createMockPluginInput())

        // when / then
        await expect(
          hook["tool.execute.before"](
            makeBeforeInput("task"),
            { args: { category: "quick", prompt: "Fix typo" } }
          )
        ).rejects.toThrow("category")
      })
    })

    describe("#when task() uses background mode in pinned session", () => {
      test("#then should block background mode", async () => {
        // given
        setupHermesSession(SESSION_ID)
        HermesProxyState.setTarget(SESSION_ID, "sisyphus")
        HermesProxyState.pinChildSession(SESSION_ID, "ses_pinned_child")
        const hook = createHermesRoutingGuardHook(createMockPluginInput())

        // when / then
        await expect(
          hook["tool.execute.before"](
            makeBeforeInput("task"),
            { args: { subagent_type: "sisyphus", run_in_background: true, prompt: "Do something" } }
          )
        ).rejects.toThrow("Background routing is not supported")
      })
    })
  })


  describe("#given non-hermes session with proxy state", () => {
    describe("#when calling task", () => {
      test("#then should not apply proxy enforcement", async () => {
        // given
        const nonHermesDir = join(MESSAGE_STORAGE, "ses_non_hermes")
        mkdirSync(nonHermesDir, { recursive: true })
        writeFileSync(
          join(nonHermesDir, "msg_001.json"),
          JSON.stringify({
            agent: "sisyphus",
            model: { providerID: "test", modelID: "test-model" },
          })
        )
        // proxy state exists but agent is not hermes
        HermesProxyState.setTarget("ses_non_hermes", "atlas")
        const hook = createHermesRoutingGuardHook(createMockPluginInput())

        // when / then
        await expect(
          hook["tool.execute.before"](
            { tool: "task", sessionID: "ses_non_hermes", callID: "call-1" },
            { args: { subagent_type: "oracle", prompt: "Consult" } }
          )
        ).resolves.toBeUndefined()

        // cleanup
        try {
          rmSync(nonHermesDir, { recursive: true, force: true })
        } catch {
          // cleanup
        }
        HermesProxyState.clear("ses_non_hermes")
      })
    })
  })

  describe("#given hermes session without proxy target", () => {
    describe("#when calling task with allowed agent", () => {
      test("#then should fall through to original guard logic", async () => {
        // given
        setupHermesSession(SESSION_ID)
        // no proxy target set
        const hook = createHermesRoutingGuardHook(createMockPluginInput())

        // when / then - original guard allows this
        await expect(
          hook["tool.execute.before"](
            makeBeforeInput("task"),
            { args: { subagent_type: "sisyphus", prompt: "Do work" } }
          )
        ).resolves.toBeUndefined()
      })
    })

    describe("#when calling task with unauthorized agent", () => {
      test("#then should block via original guard logic", async () => {
        // given
        setupHermesSession(SESSION_ID)
        // no proxy target set
        const hook = createHermesRoutingGuardHook(createMockPluginInput())

        // when / then - original guard blocks oracle
        await expect(
          hook["tool.execute.before"](
            makeBeforeInput("task"),
            { args: { subagent_type: "oracle", prompt: "Consult" } }
          )
        ).rejects.toThrow("unauthorized agent")
      })
    })

    describe("#when calling task with session_id before child is pinned", () => {
      test("#then should reject the hallucinated session_id", async () => {
        // given
        setupHermesSession(SESSION_ID)
        HermesProxyState.setTarget(SESSION_ID, "sisyphus")
        // no child session pinned yet
        const hook = createHermesRoutingGuardHook(createMockPluginInput())

        // when / then
        await expect(
          hook["tool.execute.before"](
            makeBeforeInput("task"),
            { args: { session_id: "ses_hallucinated_123", prompt: "Do work" } }
          )
        ).rejects.toThrow("Cannot continue session")
      })

      test("#then should include target agent in error message", async () => {
        // given
        setupHermesSession(SESSION_ID)
        HermesProxyState.setTarget(SESSION_ID, "atlas")
        const hook = createHermesRoutingGuardHook(createMockPluginInput())

        // when / then
        await expect(
          hook["tool.execute.before"](
            makeBeforeInput("task"),
            { args: { session_id: "ses_fake", prompt: "Plan something" } }
          )
        ).rejects.toThrow('subagent_type="atlas"')
      })
    })
  })
})
