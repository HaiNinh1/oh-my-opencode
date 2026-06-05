import { describe, expect, test } from "bun:test"
import { createHeraclesAgent } from "./agent"

describe("createHeraclesAgent", () => {
  test("creates a frozen copy of the current Sisyphus baseline without importing Sisyphus", async () => {
    // #given - the standalone Heracles factory source
    const source = await Bun.file(`${import.meta.dir}/agent.ts`).text()

    // #when - creating Heracles with the copied Sisyphus baseline
    const config = createHeraclesAgent("gpt-5.4")

    // #then - it keeps the copied runtime settings without a live Sisyphus dependency
    expect(source).not.toContain("createSisyphusAgent")
    expect(source).not.toContain("../sisyphus")
    expect(source).not.toContain("./sisyphus")
    expect(config.mode).toBe("all")
    expect(config.model).toBe("gpt-5.4")
    expect(config.maxTokens).toBe(64000)
    expect(config.color).toBe("#F97316")
    expect(config.reasoningEffort).toBe("high")
    expect(config.prompt).toContain("You are Sisyphus")
  })
})
