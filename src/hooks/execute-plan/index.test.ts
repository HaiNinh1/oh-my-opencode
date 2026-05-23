import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { createExecutePlanHook } from "./index"
import { clearBoulderState, readBoulderState } from "../../features/boulder-state"
import * as sessionState from "../../features/claude-code-session-state"

describe("execute-plan hook", () => {
  let testDir: string

  function createMockPluginInput() {
    return {
      directory: testDir,
      client: {},
    } as Parameters<typeof createExecutePlanHook>[0]
  }

  function createExecutePlanPrompt(sessionContext = "<session-context></session-context>") {
    return `<command-instruction>
You are starting a Heracles direct execution session.
- \`/execute-plan [plan-name] [--worktree <path>]\`
</command-instruction>
${sessionContext}`
  }

  function createStartWorkPrompt(sessionContext = "<session-context></session-context>") {
    return `<command-instruction>
You are starting a Sisyphus work session.
- \`/start-work [plan-name] [--worktree <path>]\`
</command-instruction>
${sessionContext}`
  }

  beforeEach(() => {
    testDir = join(tmpdir(), `execute-plan-test-${randomUUID()}`)
    mkdirSync(join(testDir, ".sisyphus"), { recursive: true })
    clearBoulderState(testDir)
  })

  afterEach(() => {
    clearBoulderState(testDir)
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  test("should ignore generic session-context without execute-plan command markers", async () => {
    // given
    const updateSpy = spyOn(sessionState, "updateSessionAgent")
    const hook = createExecutePlanHook(createMockPluginInput())
    const output = {
      parts: [{ type: "text", text: "<session-context></session-context>" }],
    }

    // when
    await hook["chat.message"]({ sessionID: "session-123" }, output)

    // then
    expect(output.parts[0].text).toBe("<session-context></session-context>")
    expect(readBoulderState(testDir)).toBeNull()
    expect(updateSpy).not.toHaveBeenCalled()
    updateSpy.mockRestore()
  })

  test("should ignore start-work command markers", async () => {
    // given
    const updateSpy = spyOn(sessionState, "updateSessionAgent")
    const hook = createExecutePlanHook(createMockPluginInput())
    const output = {
      parts: [{ type: "text", text: createStartWorkPrompt() }],
    }

    // when
    await hook["chat.message"]({ sessionID: "session-123" }, output)

    // then
    expect(output.parts[0].text).toBe(createStartWorkPrompt())
    expect(readBoulderState(testDir)).toBeNull()
    expect(updateSpy).not.toHaveBeenCalled()
    updateSpy.mockRestore()
  })

  test("should create Heracles boulder state for execute-plan command", async () => {
    // given
    const plansDir = join(testDir, ".sisyphus", "plans")
    mkdirSync(plansDir, { recursive: true })
    writeFileSync(join(plansDir, "my-plan.md"), "# My Plan\n- [ ] Task 1")

    const updateSpy = spyOn(sessionState, "updateSessionAgent")
    const hook = createExecutePlanHook(createMockPluginInput())
    const output = {
      parts: [{ type: "text", text: createExecutePlanPrompt() }],
    }

    // when
    await hook["chat.message"]({ sessionID: "session-123" }, output)

    // then
    const state = readBoulderState(testDir)
    expect(output.parts[0].text).toContain("Auto-Selected Plan")
    expect(output.parts[0].text).toContain("direct execution")
    expect(state?.plan_name).toBe("my-plan")
    expect(state?.agent).toBe("heracles")
    expect(updateSpy).toHaveBeenCalledWith("session-123", "heracles")
    updateSpy.mockRestore()
  })
})
