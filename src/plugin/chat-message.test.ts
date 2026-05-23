import { describe, test, expect } from "bun:test"

import { createChatMessageHandler } from "./chat-message"

type ChatMessagePart = { type: string; text?: string; [key: string]: unknown }
type ChatMessageHandlerOutput = { message: Record<string, unknown>; parts: ChatMessagePart[] }

function createMockHandlerArgs(overrides?: {
  pluginConfig?: Record<string, unknown>
  shouldOverride?: boolean
}) {
  const appliedSessions: string[] = []
  return {
    ctx: { client: { tui: { showToast: async () => {} } } } as any,
    pluginConfig: (overrides?.pluginConfig ?? {}) as any,
    firstMessageVariantGate: {
      shouldOverride: () => overrides?.shouldOverride ?? false,
      markApplied: (sessionID: string) => { appliedSessions.push(sessionID) },
    },
    hooks: {
      stopContinuationGuard: null,
      backgroundNotificationHook: null,
      keywordDetector: null,
      claudeCodeHooks: null,
      autoSlashCommand: null,
      startWork: null,
      executePlan: null,
      ralphLoop: null,
    } as any,
    _appliedSessions: appliedSessions,
  }
}

function createMockInput(agent?: string, model?: { providerID: string; modelID: string }) {
  return {
    sessionID: "test-session",
    agent,
    model,
  }
}

function createMockOutput(variant?: string): ChatMessageHandlerOutput {
  const message: Record<string, unknown> = {}
  if (variant !== undefined) {
    message["variant"] = variant
  }
  return { message, parts: [] }
}

describe("createChatMessageHandler - TUI variant passthrough", () => {
  test("first message: does not override TUI variant when user has no selection", async () => {
    //#given - first message, no user-selected variant
    const args = createMockHandlerArgs({ shouldOverride: true })
    const handler = createChatMessageHandler(args)
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.3-codex" })
    const output = createMockOutput() // no variant set

    //#when
    await handler(input, output)

    //#then - TUI sent undefined, should stay undefined (no config override)
    expect(output.message["variant"]).toBeUndefined()
  })

  test("first message: preserves user-selected variant when already set", async () => {
    //#given - first message, user already selected "xhigh" variant in OpenCode UI
    const args = createMockHandlerArgs({ shouldOverride: true })
    const handler = createChatMessageHandler(args)
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.3-codex" })
    const output = createMockOutput("xhigh") // user selected xhigh

    //#when
    await handler(input, output)

    //#then - user's xhigh must be preserved
    expect(output.message["variant"]).toBe("xhigh")
  })

  test("subsequent message: preserves TUI variant", async () => {
    //#given - not first message, variant already set
    const args = createMockHandlerArgs({ shouldOverride: false })
    const handler = createChatMessageHandler(args)
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.3-codex" })
    const output = createMockOutput("xhigh")

    //#when
    await handler(input, output)

    //#then
    expect(output.message["variant"]).toBe("xhigh")
  })

  test("subsequent message: does not inject variant when TUI sends none", async () => {
    //#given - not first message, no variant from TUI
    const args = createMockHandlerArgs({ shouldOverride: false })
    const handler = createChatMessageHandler(args)
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.3-codex" })
    const output = createMockOutput() // no variant

    //#when
    await handler(input, output)

    //#then - should stay undefined, not auto-resolved from config
    expect(output.message["variant"]).toBeUndefined()
  })

  test("first message: marks gate as applied regardless of variant presence", async () => {
    //#given - first message with user-selected variant
    const args = createMockHandlerArgs({ shouldOverride: true })
    const handler = createChatMessageHandler(args)
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.3-codex" })
    const output = createMockOutput("xhigh")

    //#when
    await handler(input, output)

    //#then - gate should still be marked as applied
    expect(args._appliedSessions).toContain("test-session")
  })

  test("injects queued background notifications through chat.message hook", async () => {
    //#given
    const args = createMockHandlerArgs()
    args.hooks.backgroundNotificationHook = {
      "chat.message": async (
        _input: { sessionID: string },
        output: ChatMessageHandlerOutput,
      ): Promise<void> => {
        output.parts.push({
          type: "text",
          text: "<system-reminder>[BACKGROUND TASK COMPLETED]</system-reminder>",
        })
      },
    }
    const handler = createChatMessageHandler(args)
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.3-codex" })
    const output = createMockOutput()

    //#when
    await handler(input, output)

    //#then
    expect(output.parts).toHaveLength(1)
    expect(output.parts[0].text).toContain("[BACKGROUND TASK COMPLETED]")
  })

  test("routes execute-plan command output to executePlan hook only", async () => {
    //#given
    const args = createMockHandlerArgs()
    let startWorkCalls = 0
    let executePlanCalls = 0
    args.hooks.startWork = {
      "chat.message": async (): Promise<void> => {
        startWorkCalls += 1
      },
    }
    args.hooks.executePlan = {
      "chat.message": async (): Promise<void> => {
        executePlanCalls += 1
      },
    }
    const handler = createChatMessageHandler(args)
    const input = createMockInput("heracles", { providerID: "openai", modelID: "gpt-5.4" })
    const output = createMockOutput()
    output.parts.push({
      type: "text",
      text: `<command-instruction>
You are starting a Heracles direct execution session.
- \`/execute-plan [plan-name] [--worktree <path>]\`
</command-instruction>
<session-context></session-context>`,
    })

    //#when
    await handler(input, output)

    //#then
    expect(executePlanCalls).toBe(1)
    expect(startWorkCalls).toBe(0)
  })

  test("routes start-work command output to startWork hook only", async () => {
    //#given
    const args = createMockHandlerArgs()
    let startWorkCalls = 0
    let executePlanCalls = 0
    args.hooks.startWork = {
      "chat.message": async (): Promise<void> => {
        startWorkCalls += 1
      },
    }
    args.hooks.executePlan = {
      "chat.message": async (): Promise<void> => {
        executePlanCalls += 1
      },
    }
    const handler = createChatMessageHandler(args)
    const input = createMockInput("atlas", { providerID: "anthropic", modelID: "claude-sonnet-4-6" })
    const output = createMockOutput()
    output.parts.push({
      type: "text",
      text: `<command-instruction>
You are starting a Sisyphus work session.
- \`/start-work [plan-name] [--worktree <path>]\`
</command-instruction>
<session-context></session-context>`,
    })

    //#when
    await handler(input, output)

    //#then
    expect(startWorkCalls).toBe(1)
    expect(executePlanCalls).toBe(0)
  })

  test("does not route generic session context to plan execution hooks", async () => {
    //#given
    const args = createMockHandlerArgs()
    let startWorkCalls = 0
    let executePlanCalls = 0
    args.hooks.startWork = {
      "chat.message": async (): Promise<void> => {
        startWorkCalls += 1
      },
    }
    args.hooks.executePlan = {
      "chat.message": async (): Promise<void> => {
        executePlanCalls += 1
      },
    }
    const handler = createChatMessageHandler(args)
    const input = createMockInput("sisyphus", { providerID: "anthropic", modelID: "claude-opus-4-6" })
    const output = createMockOutput()
    output.parts.push({ type: "text", text: "<session-context></session-context>" })

    //#when
    await handler(input, output)

    //#then
    expect(startWorkCalls).toBe(0)
    expect(executePlanCalls).toBe(0)
  })
})
