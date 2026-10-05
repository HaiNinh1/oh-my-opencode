import { describe, expect, test } from "bun:test"
import {
  buildClaudeOpus47SisyphusPrompt,
  buildGpt54SisyphusPrompt,
  buildGpt55SisyphusPrompt,
} from "./index"

const playwrightSkill = {
  name: "playwright",
  description: "Browser automation",
  location: "plugin" as const,
}

describe("Sisyphus browser verification guidance", () => {
  test("GPT 5.5 prompt makes browser automation opt-in and blocks default agent-browser on Windows", () => {
    // given
    const model = "openai/gpt-5.5"

    // when
    const prompt = buildGpt55SisyphusPrompt(model, [], [], [playwrightSkill], [])

    // then
    expect(prompt).toContain("Browser automation is opt-in verification")
    expect(prompt).toContain("Do not use `agent-browser` on Windows unless the user explicitly requested it")
    expect(prompt).not.toContain("MUST USE for any browser-related tasks")
  })

  test("GPT 5.4 prompt avoids routine browser automation", () => {
    // given
    const model = "openai/gpt-5.4"

    // when
    const prompt = buildGpt54SisyphusPrompt(model, [], [], [playwrightSkill], [])

    // then
    expect(prompt).toContain("Browser automation is opt-in verification")
    expect(prompt).toContain("do not use `agent-browser` on Windows unless explicitly requested")
  })

  test("Claude Opus prompt does not require a real browser for every browser task", () => {
    // given
    const model = "anthropic/claude-opus-4-7"

    // when
    const prompt = buildClaudeOpus47SisyphusPrompt(model, [], [], [playwrightSkill], [])

    // then
    expect(prompt).toContain("browser automation is opt-in QA")
    expect(prompt).toContain("Do not use `agent-browser` on Windows unless explicitly requested")
    expect(prompt).not.toContain("DRIVE A REAL BROWSER")
    expect(prompt).not.toContain("Visual changes NOT RENDERED in a browser are NOT VALIDATED")
  })
})
