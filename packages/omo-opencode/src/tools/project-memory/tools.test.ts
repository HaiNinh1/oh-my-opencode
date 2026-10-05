import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createProjectMemoryTools } from "./tools"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { PluginInput } from "@opencode-ai/plugin"

let projectDir: string

function makeCtx(): PluginInput {
  return { directory: projectDir } as PluginInput
}

const mockContext: ToolContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  directory: "/tmp",
  worktree: "/tmp",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "omo-pmem-"))
})

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

describe("project-memory tools", () => {
  test("add_note / add_directive -> read round-trip", async () => {
    const { project_memory_add_note, project_memory_add_directive, project_memory_read } =
      createProjectMemoryTools(makeCtx())

    await project_memory_add_directive.execute({ text: "Always run the linter before committing" }, mockContext)
    await project_memory_add_note.execute({ text: "API base URL lives in config/env.ts" }, mockContext)

    const result = await project_memory_read.execute({}, mockContext)
    expect(result).toContain("Always run the linter before committing")
    expect(result).toContain("API base URL lives in config/env.ts")
    expect(result).toContain("Directives (1)")
    expect(result).toContain("Notes (1)")
  })

  test("read on empty memory reports empty", async () => {
    const { project_memory_read } = createProjectMemoryTools(makeCtx())
    const result = await project_memory_read.execute({}, mockContext)
    expect(result).toContain("empty")
  })

  test("write overwrites and read parses it back", async () => {
    const { project_memory_add_note, project_memory_write, project_memory_read } =
      createProjectMemoryTools(makeCtx())

    await project_memory_add_note.execute({ text: "old note" }, mockContext)
    await project_memory_write.execute(
      {
        content: ["# Project Memory", "", "## Directives", "", "- (t) fresh directive", "", "## Notes", ""].join("\n"),
      },
      mockContext,
    )

    const result = await project_memory_read.execute({}, mockContext)
    expect(result).toContain("fresh directive")
    expect(result).not.toContain("old note")
  })

  test("multiple notes accumulate", async () => {
    const { project_memory_add_note, project_memory_read } = createProjectMemoryTools(makeCtx())
    await project_memory_add_note.execute({ text: "note one" }, mockContext)
    await project_memory_add_note.execute({ text: "note two" }, mockContext)
    const result = await project_memory_read.execute({}, mockContext)
    expect(result).toContain("note one")
    expect(result).toContain("note two")
    expect(result).toContain("Notes (2)")
  })
})
