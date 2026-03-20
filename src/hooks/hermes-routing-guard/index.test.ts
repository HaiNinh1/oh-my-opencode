import { describe, expect, test, afterEach, mock } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { clearSessionAgent } from "../../features/claude-code-session-state"

mock.module("../../shared/opencode-storage-detection", () => ({
  isSqliteBackend: () => false,
  resetSqliteBackendCache: () => {},
}))

const { createHermesRoutingGuardHook } = await import("./index")
const { MESSAGE_STORAGE } = await import("../../features/hook-message-injector")

describe("hermes-routing-guard", () => {
  const TEST_SESSION_ID = "ses_test_hermes_guard"
  let testMessageDir: string

  function createMockPluginInput() {
    return {
      client: {},
      directory: "/tmp/test",
    } as never
  }

  function setupMessageStorage(sessionID: string, agent: string | undefined): void {
    testMessageDir = join(MESSAGE_STORAGE, sessionID)
    mkdirSync(testMessageDir, { recursive: true })
    const messageContent = {
      ...(agent ? { agent } : {}),
      model: { providerID: "test", modelID: "test-model" },
    }
    writeFileSync(
      join(testMessageDir, "msg_001.json"),
      JSON.stringify(messageContent)
    )
  }

  afterEach(() => {
    clearSessionAgent(TEST_SESSION_ID)
    if (testMessageDir) {
      try {
        rmSync(testMessageDir, { recursive: true, force: true })
      } catch {
        // cleanup
      }
    }
  })

  describe("#given hermes agent session", () => {
    describe("#when calling task with allowed subagent_type", () => {
      test("#then should allow routing to atlas", async () => {
        setupMessageStorage(TEST_SESSION_ID, "hermes")
        const hook = createHermesRoutingGuardHook(createMockPluginInput())

        await expect(
          hook["tool.execute.before"](
            { tool: "task", sessionID: TEST_SESSION_ID, callID: "call-1" },
            { args: { subagent_type: "atlas", prompt: "Execute plan" } },
          )
        ).resolves.toBeUndefined()
      })

      test("#then should allow routing to prometheus", async () => {
        setupMessageStorage(TEST_SESSION_ID, "hermes")
        const hook = createHermesRoutingGuardHook(createMockPluginInput())

        await expect(
          hook["tool.execute.before"](
            { tool: "task", sessionID: TEST_SESSION_ID, callID: "call-1" },
            { args: { subagent_type: "prometheus", prompt: "Plan migration" } },
          )
        ).resolves.toBeUndefined()
      })

      test("#then should allow routing to hephaestus", async () => {
        setupMessageStorage(TEST_SESSION_ID, "hermes")
        const hook = createHermesRoutingGuardHook(createMockPluginInput())

        await expect(
          hook["tool.execute.before"](
            { tool: "task", sessionID: TEST_SESSION_ID, callID: "call-1" },
            { args: { subagent_type: "hephaestus", prompt: "Deep work" } },
          )
        ).resolves.toBeUndefined()
      })

      test("#then should allow routing to sisyphus", async () => {
        setupMessageStorage(TEST_SESSION_ID, "hermes")
        const hook = createHermesRoutingGuardHook(createMockPluginInput())

        await expect(
          hook["tool.execute.before"](
            { tool: "task", sessionID: TEST_SESSION_ID, callID: "call-1" },
            { args: { subagent_type: "sisyphus", prompt: "Ultrawork" } },
          )
        ).resolves.toBeUndefined()
      })

      test("#then should allow routing to mnemosyne", async () => {
        setupMessageStorage(TEST_SESSION_ID, "hermes")
        const hook = createHermesRoutingGuardHook(createMockPluginInput())

        await expect(
          hook["tool.execute.before"](
            { tool: "task", sessionID: TEST_SESSION_ID, callID: "call-1" },
            { args: { subagent_type: "mnemosyne", prompt: "Compact plan" } },
          )
        ).resolves.toBeUndefined()
      })

      test("#then should allow routing to heracles", async () => {
        setupMessageStorage(TEST_SESSION_ID, "hermes")
        const hook = createHermesRoutingGuardHook(createMockPluginInput())

        await expect(
          hook["tool.execute.before"](
            { tool: "task", sessionID: TEST_SESSION_ID, callID: "call-1" },
            { args: { subagent_type: "heracles", prompt: "Execute plan" } },
          )
        ).resolves.toBeUndefined()
      })
    })

    describe("#when calling task with category (forbidden for hermes)", () => {
      test("#then should block category-based routing", async () => {
        setupMessageStorage(TEST_SESSION_ID, "hermes")
        const hook = createHermesRoutingGuardHook(createMockPluginInput())

        await expect(
          hook["tool.execute.before"](
            { tool: "task", sessionID: TEST_SESSION_ID, callID: "call-1" },
            { args: { category: "quick", prompt: "Fix typo" } },
          )
        ).rejects.toThrow("Hermes CANNOT use category-based routing")
      })

      test("#then should include category name in error message", async () => {
        setupMessageStorage(TEST_SESSION_ID, "hermes")
        const hook = createHermesRoutingGuardHook(createMockPluginInput())

        await expect(
          hook["tool.execute.before"](
            { tool: "task", sessionID: TEST_SESSION_ID, callID: "call-1" },
            { args: { category: "visual-engineering", prompt: "Build UI" } },
          )
        ).rejects.toThrow("visual-engineering")
      })
    })

    describe("#when calling task with unauthorized subagent_type", () => {
      test("#then should block routing to oracle", async () => {
        setupMessageStorage(TEST_SESSION_ID, "hermes")
        const hook = createHermesRoutingGuardHook(createMockPluginInput())

        await expect(
          hook["tool.execute.before"](
            { tool: "task", sessionID: TEST_SESSION_ID, callID: "call-1" },
            { args: { subagent_type: "oracle", prompt: "Consult" } },
          )
        ).rejects.toThrow("NOT in your routing table")
      })

      test("#then should block routing to explore", async () => {
        setupMessageStorage(TEST_SESSION_ID, "hermes")
        const hook = createHermesRoutingGuardHook(createMockPluginInput())

        await expect(
          hook["tool.execute.before"](
            { tool: "task", sessionID: TEST_SESSION_ID, callID: "call-1" },
            { args: { subagent_type: "explore", prompt: "Search codebase" } },
          )
        ).rejects.toThrow("NOT in your routing table")
      })

      test("#then should block routing to librarian", async () => {
        setupMessageStorage(TEST_SESSION_ID, "hermes")
        const hook = createHermesRoutingGuardHook(createMockPluginInput())

        await expect(
          hook["tool.execute.before"](
            { tool: "task", sessionID: TEST_SESSION_ID, callID: "call-1" },
            { args: { subagent_type: "librarian", prompt: "Look up docs" } },
          )
        ).rejects.toThrow("NOT in your routing table")
      })

      test("#then should block routing to sisyphus-junior", async () => {
        setupMessageStorage(TEST_SESSION_ID, "hermes")
        const hook = createHermesRoutingGuardHook(createMockPluginInput())

        await expect(
          hook["tool.execute.before"](
            { tool: "task", sessionID: TEST_SESSION_ID, callID: "call-1" },
            { args: { subagent_type: "sisyphus-junior", prompt: "Do work" } },
          )
        ).rejects.toThrow("NOT in your routing table")
      })

      test("#then should include attempted agent name in error", async () => {
        setupMessageStorage(TEST_SESSION_ID, "hermes")
        const hook = createHermesRoutingGuardHook(createMockPluginInput())

        await expect(
          hook["tool.execute.before"](
            { tool: "task", sessionID: TEST_SESSION_ID, callID: "call-1" },
            { args: { subagent_type: "momus", prompt: "Review plan" } },
          )
        ).rejects.toThrow("momus")
      })
    })

    describe("#when calling non-task tools", () => {
      test("#then should not interfere with get_agent_prompts", async () => {
        setupMessageStorage(TEST_SESSION_ID, "hermes")
        const hook = createHermesRoutingGuardHook(createMockPluginInput())

        await expect(
          hook["tool.execute.before"](
            { tool: "get_agent_prompts", sessionID: TEST_SESSION_ID, callID: "call-1" },
            { args: { agent: "prometheus" } },
          )
        ).resolves.toBeUndefined()
      })

      test("#then should not interfere with resolve_atlas_context", async () => {
        setupMessageStorage(TEST_SESSION_ID, "hermes")
        const hook = createHermesRoutingGuardHook(createMockPluginInput())

        await expect(
          hook["tool.execute.before"](
            { tool: "resolve_atlas_context", sessionID: TEST_SESSION_ID, callID: "call-1" },
            { args: { planName: "add-dark-mode" } },
          )
        ).resolves.toBeUndefined()
      })
    })

    describe("#when subagent_type casing varies", () => {
      test("#then should allow case-insensitive matching for allowed agents", async () => {
        setupMessageStorage(TEST_SESSION_ID, "hermes")
        const hook = createHermesRoutingGuardHook(createMockPluginInput())

        await expect(
          hook["tool.execute.before"](
            { tool: "task", sessionID: TEST_SESSION_ID, callID: "call-1" },
            { args: { subagent_type: "ATLAS", prompt: "Execute" } },
          )
        ).resolves.toBeUndefined()
      })

      test("#then should block case-insensitive unauthorized agents", async () => {
        setupMessageStorage(TEST_SESSION_ID, "hermes")
        const hook = createHermesRoutingGuardHook(createMockPluginInput())

        await expect(
          hook["tool.execute.before"](
            { tool: "task", sessionID: TEST_SESSION_ID, callID: "call-1" },
            { args: { subagent_type: "ORACLE", prompt: "Consult" } },
          )
        ).rejects.toThrow("NOT in your routing table")
      })
    })
  })

  describe("#given non-hermes agent session", () => {
    test("#then should not interfere with sisyphus task calls", async () => {
      setupMessageStorage(TEST_SESSION_ID, "sisyphus")
      const hook = createHermesRoutingGuardHook(createMockPluginInput())

      await expect(
        hook["tool.execute.before"](
          { tool: "task", sessionID: TEST_SESSION_ID, callID: "call-1" },
          { args: { category: "quick", prompt: "Fix something" } },
        )
      ).resolves.toBeUndefined()
    })

    test("#then should not interfere with atlas task calls", async () => {
      setupMessageStorage(TEST_SESSION_ID, "atlas")
      const hook = createHermesRoutingGuardHook(createMockPluginInput())

      await expect(
        hook["tool.execute.before"](
          { tool: "task", sessionID: TEST_SESSION_ID, callID: "call-1" },
          { args: { subagent_type: "oracle", prompt: "Consult" } },
        )
      ).resolves.toBeUndefined()
    })
  })

  describe("#given no agent in session", () => {
    test("#then should not interfere when agent is undefined", async () => {
      setupMessageStorage(TEST_SESSION_ID, undefined)
      const hook = createHermesRoutingGuardHook(createMockPluginInput())

      await expect(
        hook["tool.execute.before"](
          { tool: "task", sessionID: TEST_SESSION_ID, callID: "call-1" },
          { args: { category: "ultrabrain", prompt: "Complex task" } },
        )
      ).resolves.toBeUndefined()
    })
  })

  describe("#given hermes display name variants", () => {
    test("#then should match Hermes (Task Router) display name", async () => {
      setupMessageStorage(TEST_SESSION_ID, "Hermes (Task Router)")
      const hook = createHermesRoutingGuardHook(createMockPluginInput())

      await expect(
        hook["tool.execute.before"](
          { tool: "task", sessionID: TEST_SESSION_ID, callID: "call-1" },
          { args: { category: "quick", prompt: "Route" } },
        )
      ).rejects.toThrow("Hermes CANNOT use category-based routing")
    })

    test("#then should match uppercase HERMES", async () => {
      setupMessageStorage(TEST_SESSION_ID, "HERMES")
      const hook = createHermesRoutingGuardHook(createMockPluginInput())

      await expect(
        hook["tool.execute.before"](
          { tool: "task", sessionID: TEST_SESSION_ID, callID: "call-1" },
          { args: { subagent_type: "metis", prompt: "Consult" } },
        )
      ).rejects.toThrow("NOT in your routing table")
    })
  })

  describe("#given task call with no subagent_type and no category", () => {
    test("#then should pass through (session_id continuation case)", async () => {
      setupMessageStorage(TEST_SESSION_ID, "hermes")
      const hook = createHermesRoutingGuardHook(createMockPluginInput())

      await expect(
        hook["tool.execute.before"](
          { tool: "task", sessionID: TEST_SESSION_ID, callID: "call-1" },
          { args: { session_id: "ses_existing", prompt: "Continue" } },
        )
      ).resolves.toBeUndefined()
    })
  })
})
