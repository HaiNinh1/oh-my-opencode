import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createWikiTools } from "./tools"
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
  projectDir = mkdtempSync(join(tmpdir(), "omo-wiki-"))
})

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

describe("wiki tools", () => {
  test("add -> query -> read round-trip", async () => {
    const { wiki_add, wiki_query, wiki_read } = createWikiTools(makeCtx())

    const addResult = await wiki_add.execute(
      {
        title: "Auth Architecture",
        tags: ["auth", "architecture"],
        body: "The system uses OAuth2 with refresh token rotation handled in auth/service.ts.",
      },
      mockContext,
    )
    expect(addResult).toContain("auth-architecture")

    const queryResult = await wiki_query.execute({ query: "refresh token", tags: ["auth"] }, mockContext)
    expect(queryResult).toContain("Auth Architecture")
    expect(queryResult).toContain("refresh token")

    const readResult = await wiki_read.execute({ slug: "auth-architecture" }, mockContext)
    expect(readResult).toContain("OAuth2")
    expect(readResult).toContain("auth, architecture")
  })

  test("query filters by tag", async () => {
    const { wiki_add, wiki_query } = createWikiTools(makeCtx())
    await wiki_add.execute({ title: "Page A", tags: ["alpha"], body: "shared keyword content" }, mockContext)
    await wiki_add.execute({ title: "Page B", tags: ["beta"], body: "shared keyword content" }, mockContext)

    const result = await wiki_query.execute({ query: "shared", tags: ["beta"] }, mockContext)
    expect(result).toContain("Page B")
    expect(result).not.toContain("Page A")
  })

  test("wiki_list reports pages", async () => {
    const { wiki_add, wiki_list } = createWikiTools(makeCtx())
    await wiki_add.execute({ title: "Listed Page", tags: ["x"], body: "body" }, mockContext)
    const result = await wiki_list.execute({}, mockContext)
    expect(result).toContain("listed-page")
    expect(result).toContain("Listed Page")
  })

  test("wiki_lint finds an empty page", async () => {
    const { wiki_add, wiki_lint } = createWikiTools(makeCtx())
    await wiki_add.execute({ title: "Empty Page", tags: ["x"], body: "   " }, mockContext)
    const result = await wiki_lint.execute({}, mockContext)
    expect(result).toContain("empty")
    expect(result).toContain("empty-page")
  })

  test("wiki_lint finds an orphan cross-reference", async () => {
    const { wiki_add, wiki_lint } = createWikiTools(makeCtx())
    await wiki_add.execute(
      { title: "Linker", tags: ["x"], body: "See [[nonexistent-page]] for details." },
      mockContext,
    )
    const result = await wiki_lint.execute({}, mockContext)
    expect(result).toContain("orphan")
    expect(result).toContain("nonexistent-page")
  })

  test("wiki_read returns not found for unknown slug", async () => {
    const { wiki_read } = createWikiTools(makeCtx())
    const result = await wiki_read.execute({ slug: "does-not-exist" }, mockContext)
    expect(result).toContain("not found")
  })
})
