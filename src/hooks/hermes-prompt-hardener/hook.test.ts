import { describe, test, expect, beforeEach, mock } from "bun:test"
import { createHermesPromptHardenerHook } from "./hook"
import { HermesProxyState } from "../../shared/hermes-proxy-state"

// mock session state to control isHermesAgent check
mock.module("../../features/claude-code-session-state", () => ({
  getSessionAgent: (sessionID: string) => {
    if (sessionID.startsWith("hermes_")) return "Hermes \u2624 (Task Router)"
    return "Sisyphus (Ultraworker)"
  },
}))

describe("hermes-prompt-hardener", () => {
  beforeEach(() => {
    HermesProxyState.clearAll()
  })

  const hook = createHermesPromptHardenerHook()

  describe("#given a non-Hermes session", () => {
    test("skips directive injection", async () => {
      // given
      const input = { sessionID: "other_session", agent: "build" }
      const output = {
        message: {},
        parts: [{ type: "text", text: "Hello world" }],
      }

      // when
      await hook["chat.message"](input, output)

      // then
      expect(output.parts[0].text).toBe("Hello world")
    })
  })

  describe("#given a Hermes session without proxy target", () => {
    test("skips directive injection when no proxy state exists", async () => {
      // given
      const input = { sessionID: "hermes_no_target", agent: "Hermes \u2624 (Task Router)" }
      const output = {
        message: {},
        parts: [{ type: "text", text: "do something" }],
      }

      // when
      await hook["chat.message"](input, output)

      // then
      expect(output.parts[0].text).toBe("do something")
    })
  })

  describe("#given a Hermes session with proxy target but no pinned child", () => {
    test("injects subagent_type directive on turn 1", async () => {
      // given
      HermesProxyState.setTarget("hermes_turn1", "sisyphus")
      const input = { sessionID: "hermes_turn1", agent: "Hermes \u2624 (Task Router)" }
      const output = {
        message: {},
        parts: [
          { type: "agent", name: "sisyphus" },
          { type: "text", text: "implement the feature" },
        ],
      }

      // when
      await hook["chat.message"](input, output)

      // then
      const injectedText = output.parts[1].text!
      expect(injectedText).toContain("[HERMES ROUTING DIRECTIVE]")
      expect(injectedText).toContain('task(subagent_type="sisyphus"')
      expect(injectedText).toContain('prompt="implement the feature"')
      expect(injectedText).toContain("[END DIRECTIVE]")
      expect(injectedText).toContain("implement the feature")
    })

    test("strips synthetic delegation text from extracted prompt", async () => {
      // given - this is the real-world part layout from OpenCode:
      // [agent part, synthetic text part with delegation, user text part]
      HermesProxyState.setTarget("hermes_synthetic", "sisyphus")
      const input = { sessionID: "hermes_synthetic", agent: "Hermes \u2624 (Task Router)" }
      const output = {
        message: {},
        parts: [
          { type: "text", text: "@Sisyphus (Ultraworker) hi" },
          { type: "agent", name: "Sisyphus (Ultraworker)" },
          {
            type: "text",
            text: " Use the above message and context to generate a prompt and call the task tool with subagent: Sisyphus (Ultraworker)",
            synthetic: true,
          },
        ],
      }

      // when
      await hook["chat.message"](input, output)

      // then - the directive's prompt arg should contain only clean user text
      const injectedText = output.parts[0].text!
      const directiveSection = injectedText.split("---")[0]
      expect(directiveSection).toContain('prompt="hi"')
      expect(directiveSection).not.toContain("Use the above message and context")
      expect(directiveSection).not.toContain("generate a prompt and call the task tool")
      expect(directiveSection).not.toContain("@Sisyphus")
    })

    test("strips @agent mention from user text in prompt arg", async () => {
      // given
      HermesProxyState.setTarget("hermes_at_mention", "atlas")
      const input = { sessionID: "hermes_at_mention", agent: "Hermes \u2624 (Task Router)" }
      const output = {
        message: {},
        parts: [{ type: "text", text: "@Atlas create a plan for this" }],
      }

      // when
      await hook["chat.message"](input, output)

      // then - the directive's prompt arg should not have @agent mention
      const injectedText = output.parts[0].text!
      const directiveSection = injectedText.split("---")[0]
      expect(directiveSection).toContain('prompt="create a plan for this"')
      expect(directiveSection).not.toContain("@Atlas")
    })

    test("preserves original user text after directive", async () => {
      // given
      HermesProxyState.setTarget("hermes_preserve", "atlas")
      const input = { sessionID: "hermes_preserve", agent: "Hermes \u2624 (Task Router)" }
      const output = {
        message: {},
        parts: [{ type: "text", text: "create a plan" }],
      }

      // when
      await hook["chat.message"](input, output)

      // then
      const injectedText = output.parts[0].text!
      expect(injectedText).toEndWith("---\n\ncreate a plan")
    })
  })

  describe("#given a Hermes session with pinned child session", () => {
    test("injects session_id directive on turn 2+", async () => {
      // given
      HermesProxyState.setTarget("hermes_pinned", "sisyphus")
      HermesProxyState.pinChildSession("hermes_pinned", "ses_child_abc123")
      const input = { sessionID: "hermes_pinned", agent: "Hermes \u2624 (Task Router)" }
      const output = {
        message: {},
        parts: [{ type: "text", text: "now fix the bug" }],
      }

      // when
      await hook["chat.message"](input, output)

      // then
      const injectedText = output.parts[0].text!
      expect(injectedText).toContain("[HERMES ROUTING DIRECTIVE]")
      expect(injectedText).toContain('task(session_id="ses_child_abc123"')
      expect(injectedText).toContain('prompt="now fix the bug"')
      expect(injectedText).not.toContain("subagent_type")
    })

    test("includes continuation session_id in response format", async () => {
      // given
      HermesProxyState.setTarget("hermes_format", "atlas")
      HermesProxyState.pinChildSession("hermes_format", "ses_child_xyz")
      const input = { sessionID: "hermes_format", agent: "Hermes \u2624 (Task Router)" }
      const output = {
        message: {},
        parts: [{ type: "text", text: "continue" }],
      }

      // when
      await hook["chat.message"](input, output)

      // then
      const injectedText = output.parts[0].text!
      expect(injectedText).toContain("Session: ses_child_xyz")
    })
  })

  describe("#given a message with no text parts", () => {
    test("skips injection when only agent and synthetic parts exist", async () => {
      // given
      HermesProxyState.setTarget("hermes_no_text", "sisyphus")
      const input = { sessionID: "hermes_no_text", agent: "Hermes \u2624 (Task Router)" }
      const output = {
        message: {},
        parts: [
          { type: "agent", name: "sisyphus" },
          {
            type: "text",
            text: " Use the above message and call the task tool with subagent: sisyphus",
            synthetic: true,
          },
        ],
      }

      // when
      await hook["chat.message"](input, output)

      // then - synthetic parts should not be treated as user text
      expect(output.parts.length).toBe(2)
      expect(output.parts[1].text).toContain("Use the above message")
    })
  })

  describe("#given user text with quotes", () => {
    test("escapes quotes in the prompt argument", async () => {
      // given
      HermesProxyState.setTarget("hermes_quotes", "sisyphus")
      const input = { sessionID: "hermes_quotes", agent: "Hermes \u2624 (Task Router)" }
      const output = {
        message: {},
        parts: [{ type: "text", text: 'fix the "broken" test' }],
      }

      // when
      await hook["chat.message"](input, output)

      // then
      const injectedText = output.parts[0].text!
      expect(injectedText).toContain('fix the \\"broken\\" test')
    })
  })
})
