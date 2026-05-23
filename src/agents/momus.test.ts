import { describe, test, expect } from "bun:test"
import { MOMUS_SYSTEM_PROMPT, momusPromptMetadata } from "./momus"

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

describe("MOMUS_SYSTEM_PROMPT policy requirements", () => {
  test("should treat SYSTEM DIRECTIVE as ignorable/stripped", () => {
    // given
    const prompt = MOMUS_SYSTEM_PROMPT
    
    // when / #then
    // Should mention that system directives are ignored
    expect(prompt.toLowerCase()).toMatch(/system directive.*ignore|ignore.*system directive/)
    // Should give examples of system directive patterns
    expect(prompt).toMatch(/<system-reminder>|system-reminder/)
  })

  test("should extract paths containing .sisyphus/plans/ and ending in .md", () => {
    // given
    const prompt = MOMUS_SYSTEM_PROMPT

    // when / #then
    expect(prompt).toContain(".sisyphus/plans/")
    expect(prompt).toContain(".md")
    // New extraction policy should be mentioned
    expect(prompt.toLowerCase()).toMatch(/extract|search|find path/)
  })

  test("should NOT teach that 'Please review' is INVALID (conversational wrapper allowed)", () => {
    // given
    const prompt = MOMUS_SYSTEM_PROMPT

    // when / #then
    // In RED phase, this will FAIL because current prompt explicitly lists this as INVALID
    const invalidExample = "Please review .sisyphus/plans/plan.md"
    const rejectionTeaching = new RegExp(
      `reject.*${escapeRegExp(invalidExample)}`,
      "i",
    )
    
    // We want the prompt to NOT reject this anymore. 
    // If it's still in the "INVALID" list, this test should fail.
    expect(prompt).not.toMatch(rejectionTeaching)
  })

  test("should handle ambiguity (2+ paths) and 'no path found' rejection", () => {
    // given
    const prompt = MOMUS_SYSTEM_PROMPT

    // when / #then
    // Should mention what happens when multiple paths are found
    expect(prompt.toLowerCase()).toMatch(/multiple|ambiguous|2\+|two/)
    // Should mention rejection if no path found
    expect(prompt.toLowerCase()).toMatch(/no.*path.*found|reject.*no.*path/)
  })
})

describe("momusPromptMetadata routing", () => {
  test("should not trigger Momus for saved plans during execution", () => {
    // given
    const metadataText = JSON.stringify(momusPromptMetadata)

    // when / #then
    expect(metadataText).not.toContain("Before executing a complex todo list")
    expect(momusPromptMetadata.keyTrigger).not.toContain(
      "Work plan saved to `.sisyphus/plans/*.md`",
    )
    expect(momusPromptMetadata.keyTrigger).toContain("Do NOT invoke Momus")
    expect(momusPromptMetadata.keyTrigger).toContain("/execute-plan")
    expect(momusPromptMetadata.keyTrigger).toContain("/start-work")
  })

  test("should explicitly avoid Momus for active plan execution", () => {
    // given
    const avoidWhen = momusPromptMetadata.avoidWhen.join("\n")

    // when / #then
    expect(avoidWhen).toContain("/start-work")
    expect(avoidWhen).toContain("/execute-plan")
    expect(avoidWhen).toContain("Atlas")
    expect(avoidWhen).toContain("Heracles")
    expect(avoidWhen).toContain("boulder.json")
  })
})
