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
          {
            type: "agent",
            name: "Sisyphus (Ultraworker)",
            source: { value: "@Sisyphus (Ultraworker)" },
          },
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
      // synthetic parts are stripped from output
      const textPart = output.parts.find((p) => p.type === "text" && !p.synthetic)
      expect(textPart).toBeDefined()
      expect(textPart!.text).toContain('prompt="hi"')
      expect(textPart!.text).not.toContain("Use the above message and context")
      expect(textPart!.text).not.toContain("@Sisyphus")
      // synthetic parts should be removed
      expect(output.parts.filter((p) => p.synthetic)).toHaveLength(0)
    })

    test("strips @agent mention from user text using agent part source.value", async () => {
      // given - agent part has source.value for precise stripping
      HermesProxyState.setTarget("hermes_at_mention", "atlas")
      const input = { sessionID: "hermes_at_mention", agent: "Hermes \u2624 (Task Router)" }
      const output = {
        message: {},
        parts: [
          { type: "text", text: "@Atlas create a plan for this" },
          { type: "agent", name: "Atlas", source: { value: "@Atlas" } },
        ],
      }

      // when
      await hook["chat.message"](input, output)

      // then - the directive's prompt arg should not have @agent mention
      const injectedText = output.parts.find((p) => p.type === "text" && !p.synthetic)!.text!
      expect(injectedText).toContain('prompt="create a plan for this"')
      expect(injectedText).not.toContain("@Atlas")
    })

    test("strips @agent mention using name-based fallback when no source.value", async () => {
      // given - agent part without source.value, falls back to name pattern
      HermesProxyState.setTarget("hermes_name_fallback", "atlas")
      const input = { sessionID: "hermes_name_fallback", agent: "Hermes \u2624 (Task Router)" }
      const output = {
        message: {},
        parts: [
          { type: "text", text: "@atlas create a plan" },
          { type: "agent", name: "atlas" },
        ],
      }

      // when
      await hook["chat.message"](input, output)

      // then
      const injectedText = output.parts.find((p) => p.type === "text" && !p.synthetic)!.text!
      expect(injectedText).toContain('prompt="create a plan"')
      expect(injectedText).not.toContain("@atlas")
    })

    test("does not strip @filename references (only agent mentions)", async () => {
      // given - text has @filename reference and agent mention
      HermesProxyState.setTarget("hermes_file_mention", "sisyphus")
      const input = { sessionID: "hermes_file_mention", agent: "Hermes \u2624 (Task Router)" }
      const output = {
        message: {},
        parts: [
          { type: "text", text: "@Sisyphus (Ultraworker) read @src/index.ts" },
          {
            type: "agent",
            name: "Sisyphus (Ultraworker)",
            source: { value: "@Sisyphus (Ultraworker)" },
          },
          {
            type: "file",
            url: "file:///home/user/project/src/index.ts",
            mime: "text/plain",
            filename: "src/index.ts",
            source: { type: "file", path: "src/index.ts", text: { value: "@src/index.ts" } },
          },
        ],
      }

      // when
      await hook["chat.message"](input, output)

      // then - @agent is stripped, @filename is replaced with resolved path
      const injectedText = output.parts.find((p) => p.type === "text" && !p.synthetic)!.text!
      expect(injectedText).not.toContain("@Sisyphus")
      expect(injectedText).not.toContain("@src/index.ts")
      expect(injectedText).toContain("/home/user/project/src/index.ts")
    })

    test("replaces user text entirely with directive", async () => {
      // given
      HermesProxyState.setTarget("hermes_preserve", "atlas")
      const input = { sessionID: "hermes_preserve", agent: "Hermes \u2624 (Task Router)" }
      const output = {
        message: {},
        parts: [{ type: "text", text: "create a plan" }],
      }

      // when
      await hook["chat.message"](input, output)

      // then - text should be only the directive, no trailing user text
      const injectedText = output.parts[0].text!
      expect(injectedText).toContain("[HERMES ROUTING DIRECTIVE]")
      expect(injectedText).toContain('[END DIRECTIVE]')
      expect(injectedText).not.toContain("---")
      expect(injectedText).toEndWith("[END DIRECTIVE]")
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

    test("keeps pinned continuation directive without Session response text", async () => {
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
      expect(injectedText).toContain('task(session_id="ses_child_xyz"')
      expect(injectedText).not.toContain("Session: ses_child_xyz")
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

      // then - synthetic parts should not be treated as user text, no injection
      const syntheticParts = output.parts.filter((p) => p.type === "text" && p.synthetic)
      // synthetic parts may be stripped but there was no user text to inject into
      expect(output.parts.some((p) => p.type === "agent")).toBe(true)
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

    test("preserves multiline prompt content as escaped newlines", async () => {
      // given
      HermesProxyState.setTarget("hermes_multiline", "sisyphus")
      const input = { sessionID: "hermes_multiline", agent: "Hermes ☤ (Task Router)" }
      const output = {
        message: {},
        parts: [{ type: "text", text: "line 1\nline 2\nline 3" }],
      }

      // when
      await hook["chat.message"](input, output)

      // then
      const injectedText = output.parts[0].text!
      expect(injectedText).toContain('prompt="line 1\\nline 2\\nline 3"')
      expect(injectedText).not.toContain("prompt=\"line 1\nline 2\nline 3\"")
    })

    test("preserves literal backslash-n distinctly from real newlines", async () => {
      // given
      HermesProxyState.setTarget("hermes_literal_backslash_n", "sisyphus")
      const input = { sessionID: "hermes_literal_backslash_n", agent: "Hermes ☤ (Task Router)" }
      const output = {
        message: {},
        parts: [{ type: "text", text: String.raw`line 1\nline 2` }],
      }

      // when
      await hook["chat.message"](input, output)

      // then
      const injectedText = output.parts[0].text!
      expect(injectedText).toContain('prompt="line 1\\\\nline 2"')
    })
  })

  describe("#given a message with file parts", () => {
    test("strips file parts and appends orphan file paths to prompt", async () => {
      // given - file parts without source.text.value are orphan paths
      HermesProxyState.setTarget("hermes_files", "sisyphus")
      const input = { sessionID: "hermes_files", agent: "Hermes \u2624 (Task Router)" }
      const output = {
        message: {},
        parts: [
          { type: "text", text: "read these files" },
          {
            type: "file",
            url: "file:///home/user/project/src/index.ts",
            mime: "text/plain",
            filename: "index.ts",
            source: { type: "file", path: "src/index.ts" },
          },
          {
            type: "file",
            url: "file:///home/user/project/README.md",
            mime: "text/plain",
            filename: "README.md",
            source: { type: "file", path: "README.md" },
          },
        ],
      }

      // when
      await hook["chat.message"](input, output)

      // then - file parts should be stripped (in-place)
      expect(output.parts.filter((p) => p.type === "file")).toHaveLength(0)
      // prompt should contain file paths as "Referenced files"
      const textPart = output.parts.find((p) => p.type === "text" && !p.synthetic)
      expect(textPart).toBeDefined()
      expect(textPart!.text).toContain("Referenced files:")
      expect(textPart!.text).toContain("/home/user/project/src/index.ts")
      expect(textPart!.text).toContain("/home/user/project/README.md")
    })

    test("replaces @filename references inline with resolved paths", async () => {
      // given - file parts with source.text.value get inline replacement
      HermesProxyState.setTarget("hermes_inline_files", "sisyphus")
      const input = { sessionID: "hermes_inline_files", agent: "Hermes \u2624 (Task Router)" }
      const output = {
        message: {},
        parts: [
          { type: "text", text: "read @src/index.ts and explain it" },
          {
            type: "file",
            url: "file:///home/user/project/src/index.ts",
            mime: "text/plain",
            filename: "src/index.ts",
            source: { type: "file", path: "src/index.ts", text: { value: "@src/index.ts" } },
          },
        ],
      }

      // when
      await hook["chat.message"](input, output)

      // then - @filename replaced with resolved path inline, not in "Referenced files"
      const injectedText = output.parts.find((p) => p.type === "text" && !p.synthetic)!.text!
      expect(injectedText).toContain("/home/user/project/src/index.ts")
      expect(injectedText).not.toContain("@src/index.ts")
      expect(injectedText).not.toContain("Referenced files:")
    })

    test("replaces [Image N] placeholder with /tmp path", async () => {
      // given - pasted image with [Image 1] virtual text
      HermesProxyState.setTarget("hermes_image_replace", "sisyphus")
      const input = { sessionID: "hermes_image_replace", agent: "Hermes \u2624 (Task Router)" }
      const base64Content = Buffer.from("fake-png-data").toString("base64")
      const output = {
        message: {},
        parts: [
          { type: "text", text: "analyze this [Image 1] for me" },
          {
            type: "file",
            url: `data:image/png;base64,${base64Content}`,
            mime: "image/png",
            filename: "clipboard",
            source: { type: "file", path: "clipboard", text: { value: "[Image 1]" } },
          },
        ],
      }

      // when
      await hook["chat.message"](input, output)

      // then - [Image 1] replaced with /tmp path
      const injectedText = output.parts.find((p) => p.type === "text" && !p.synthetic)!.text!
      expect(injectedText).toContain("/tmp/hermes-attachments/")
      expect(injectedText).toContain(".png")
      expect(injectedText).not.toContain("[Image 1]")
      expect(injectedText).not.toContain("Referenced files:")
    })

    test("saves data: URL images to /tmp and includes path as orphan", async () => {
      // given - data: URL image without source.text.value
      HermesProxyState.setTarget("hermes_image", "sisyphus")
      const input = { sessionID: "hermes_image", agent: "Hermes \u2624 (Task Router)" }
      const base64Content = Buffer.from("fake-png-data").toString("base64")
      const output = {
        message: {},
        parts: [
          { type: "text", text: "analyze this image" },
          {
            type: "file",
            url: `data:image/png;base64,${base64Content}`,
            mime: "image/png",
            filename: "clipboard",
            source: { type: "file", path: "clipboard" },
          },
        ],
      }

      // when
      await hook["chat.message"](input, output)

      // then - file parts should be stripped
      expect(output.parts.filter((p) => p.type === "file")).toHaveLength(0)
      // prompt should reference a /tmp path
      const textPart = output.parts.find((p) => p.type === "text" && !p.synthetic)
      expect(textPart).toBeDefined()
      expect(textPart!.text).toContain("Referenced files:")
      expect(textPart!.text).toContain("/tmp/hermes-attachments/")
      expect(textPart!.text).toContain(".png")
    })

    test("strips synthetic text parts from file content resolution", async () => {
      // given - server resolves file:// URLs into synthetic text parts
      HermesProxyState.setTarget("hermes_synthetic_file", "sisyphus")
      const input = { sessionID: "hermes_synthetic_file", agent: "Hermes \u2624 (Task Router)" }
      const output = {
        message: {},
        parts: [
          { type: "text", text: "check this file" },
          {
            type: "text",
            text: "[file content injected by server: lots of code here]",
            synthetic: true,
          },
          {
            type: "file",
            url: "file:///home/user/project/main.ts",
            mime: "text/plain",
            source: { type: "file", path: "main.ts" },
          },
        ],
      }

      // when
      await hook["chat.message"](input, output)

      // then - both file and synthetic text parts should be stripped
      expect(output.parts.filter((p) => p.type === "file")).toHaveLength(0)
      expect(output.parts.filter((p) => p.synthetic)).toHaveLength(0)
      // only the directive text part and agent parts should remain
      const textPart = output.parts.find((p) => p.type === "text" && !p.synthetic)
      expect(textPart).toBeDefined()
      expect(textPart!.text).toContain("Referenced files:")
      expect(textPart!.text).not.toContain("file content injected by server")
    })

    test("handles mixed file and text parts without file references", async () => {
      // given - no file parts, should not add Referenced files section
      HermesProxyState.setTarget("hermes_no_files", "sisyphus")
      const input = { sessionID: "hermes_no_files", agent: "Hermes \u2624 (Task Router)" }
      const output = {
        message: {},
        parts: [{ type: "text", text: "just a normal message" }],
      }

      // when
      await hook["chat.message"](input, output)

      // then - no Referenced files section
      const textPart = output.parts.find((p) => p.type === "text" && !p.synthetic)
      expect(textPart).toBeDefined()
      expect(textPart!.text).not.toContain("Referenced files:")
    })

    test("handles mix of inline file references and orphan file paths", async () => {
      // given - one file with source.text.value, one without
      HermesProxyState.setTarget("hermes_mixed_files", "sisyphus")
      const input = { sessionID: "hermes_mixed_files", agent: "Hermes \u2624 (Task Router)" }
      const output = {
        message: {},
        parts: [
          { type: "text", text: "read @src/index.ts and also check this" },
          {
            type: "file",
            url: "file:///home/user/project/src/index.ts",
            mime: "text/plain",
            filename: "src/index.ts",
            source: { type: "file", path: "src/index.ts", text: { value: "@src/index.ts" } },
          },
          {
            type: "file",
            url: "file:///home/user/project/README.md",
            mime: "text/plain",
            filename: "README.md",
            source: { type: "file", path: "README.md" },
          },
        ],
      }

      // when
      await hook["chat.message"](input, output)

      // then - @src/index.ts replaced inline, README.md as orphan in "Referenced files"
      const injectedText = output.parts.find((p) => p.type === "text" && !p.synthetic)!.text!
      expect(injectedText).toContain("/home/user/project/src/index.ts")
      expect(injectedText).not.toContain("@src/index.ts")
      expect(injectedText).toContain("Referenced files:")
      expect(injectedText).toContain("/home/user/project/README.md")
    })
  })
})
