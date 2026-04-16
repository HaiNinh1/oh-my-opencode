import { describe, expect, test } from "bun:test"
import { get_agent_prompts } from "./tools"

describe("get_agent_prompts", () => {
  test("rejects atlas with redirect to resolve_atlas_context", async () => {
    const result = await get_agent_prompts.execute({ agent: "atlas" }, {} as any)
    expect(result).toContain("Direct Atlas routing is forbidden")
    expect(result).toContain("resolve_atlas_context()")
  })

  test("returns plan agent system prepend for prometheus", async () => {
    const result = await get_agent_prompts.execute({ agent: "prometheus" }, {} as any)
    expect(result).toContain("Context Gathering Protocol")
    expect(result).toContain("Task Dependency Graph")
    expect(result).toContain("Parallel Execution Graph")
  })
})
