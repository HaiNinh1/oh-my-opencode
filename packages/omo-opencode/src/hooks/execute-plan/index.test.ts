/// <reference types="bun-types" />

import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { createExecutePlanHook } from "./index"
import { clearBoulderState, readBoulderState } from "../../features/boulder-state"
import * as sessionState from "../../features/claude-code-session-state"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

describe("execute-plan hook", () => {
  let testDir: string
  let omoDir: string

  function createMockPluginInput() {
    return unsafeTestValue<Parameters<typeof createExecutePlanHook>[0]>({
      directory: testDir,
      client: {},
    })
  }

  function createExecutePlanPrompt(userRequest = ""): string {
    return `<command-instruction>
You are starting a Heracles direct execution session.
- \`/execute-plan [plan-name] [--worktree <path>]\`
</command-instruction>

<session-context></session-context>${userRequest ? `

<user-request>${userRequest}</user-request>` : ""}`
  }

  function createStartWorkPrompt(): string {
    return `<command-instruction>
You are starting a Sisyphus work session.
</command-instruction>

<session-context></session-context>`
  }

  beforeEach(() => {
    sessionState._resetForTesting()
    sessionState.registerAgentName("heracles")
    testDir = join(tmpdir(), `execute-plan-test-${randomUUID()}`)
    omoDir = join(testDir, ".omo")
    mkdirSync(omoDir, { recursive: true })
    clearBoulderState(testDir)
  })

  afterEach(() => {
    sessionState._resetForTesting()
    clearBoulderState(testDir)
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  test("should ignore generic session-context without execute-plan command markers", async () => {
    const updateSpy = spyOn(sessionState, "updateSessionAgent")
    const hook = createExecutePlanHook(createMockPluginInput())
    const output = {
      parts: [{ type: "text", text: "<session-context></session-context>" }],
    }

    await hook["chat.message"]({ sessionID: "session-123" }, output)

    expect(output.parts[0].text).toBe("<session-context></session-context>")
    expect(readBoulderState(testDir)).toBeNull()
    expect(updateSpy).not.toHaveBeenCalled()
    updateSpy.mockRestore()
  })

  test("should ignore start-work command markers", async () => {
    const updateSpy = spyOn(sessionState, "updateSessionAgent")
    const hook = createExecutePlanHook(createMockPluginInput())
    const output = {
      parts: [{ type: "text", text: createStartWorkPrompt() }],
    }

    await hook["chat.message"]({ sessionID: "session-123" }, output)

    expect(output.parts[0].text).toBe(createStartWorkPrompt())
    expect(readBoulderState(testDir)).toBeNull()
    expect(updateSpy).not.toHaveBeenCalled()
    updateSpy.mockRestore()
  })

  test("should create Heracles boulder state for execute-plan command", async () => {
    const plansDir = join(omoDir, "plans")
    mkdirSync(plansDir, { recursive: true })
    writeFileSync(join(plansDir, "my-plan.md"), "# My Plan\n- [ ] Task 1")

    const updateSpy = spyOn(sessionState, "updateSessionAgent")
    const hook = createExecutePlanHook(createMockPluginInput())
    const output = {
      parts: [{ type: "text", text: createExecutePlanPrompt() }],
    }

    await hook["chat.message"]({ sessionID: "session-123" }, output)

    const state = readBoulderState(testDir)
    expect(output.parts[0].text).toContain("Auto-Selected Plan")
    expect(output.parts[0].text).toContain("direct execution")
    expect(state?.plan_name).toBe("my-plan")
    expect(state?.agent).toBe("heracles")
    expect(updateSpy).toHaveBeenCalledWith("session-123", "heracles")
    updateSpy.mockRestore()
  })

  test("should be idempotent across re-firing for the same session", async () => {
    const plansDir = join(omoDir, "plans")
    mkdirSync(plansDir, { recursive: true })
    writeFileSync(join(plansDir, "my-plan.md"), "# My Plan\n- [ ] Task 1")

    const hook = createExecutePlanHook(createMockPluginInput())
    const output = {
      parts: [{ type: "text", text: createExecutePlanPrompt() }],
    }

    await hook["chat.message"]({ sessionID: "session-123" }, output)
    const firstText = output.parts[0].text
    await hook["chat.message"]({ sessionID: "session-123" }, output)

    expect(output.parts[0].text).toBe(firstText)
  })
})
