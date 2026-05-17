import { HermesProxyState } from "../../shared/hermes-proxy-state"
import { isHermesAgent } from "../hermes-routing-guard/agent-matcher"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { log } from "../../shared/logger"
import { existsSync, mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { fileURLToPath } from "url"

const HOOK_NAME = "hermes-prompt-hardener"

type ChatMessagePart = { type: string; text?: string; url?: string; mime?: string; source?: { type?: string; path?: string; text?: { value?: string }; value?: string }; synthetic?: boolean; name?: string; [key: string]: unknown }

/**
 * Builds a task() call directive that tells Hermes exactly what to do.
 *
 * On turn 1 (no pinned child session): instructs Hermes to call
 * task(subagent_type="<target>", prompt="<user text>").
 *
 * On turn 2+ (pinned child session): instructs Hermes to call
 * task(session_id="<pinned>", prompt="<user text>").
 */
function buildTaskDirective(
  targetAgent: string,
  childSessionID: string | undefined,
  userText: string,
): string {
  const promptLiteral = JSON.stringify(userText)

  if (childSessionID) {
    return [
      `[HERMES ROUTING DIRECTIVE]`,
      `Execute this EXACT tool call now with proper description. Do not modify the prompt. Do not respond with text.`,
      ``,
      `task(session_id="${childSessionID}", prompt=${promptLiteral}, run_in_background=false, load_skills=[], description="<your description here>")`,
      ``,
      `[END DIRECTIVE]`,
    ].join("\n")
  }

  return [
    `[HERMES ROUTING DIRECTIVE]`,
    `Execute this EXACT tool call now with proper description. Do not modify the prompt. Do not respond with text.`,
    ``,
    `task(subagent_type="${targetAgent}", prompt=${promptLiteral}, run_in_background=false, load_skills=[], description="<your description here>")`,
    ``,
    `[END DIRECTIVE]`,
  ].join("\n")
}

const HERMES_TMP_DIR = join("/tmp", "hermes-attachments")

function mimeToExtension(mime: string): string {
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "application/json": ".json",
  }
  return map[mime] ?? ""
}

/**
 * Builds a map from file reference text (e.g., "@filename", "[Image 1]") to resolved
 * file paths. For data: URLs, saves content to /tmp and maps to the tmp path.
 * For file: URLs, extracts the local path.
 * Returns the map + any orphan paths (file parts without reference text in prompt).
 */
function buildFileReplacements(parts: ChatMessagePart[]): {
  replacements: Map<string, string>
  orphanPaths: string[]
} {
  const replacements = new Map<string, string>()
  const orphanPaths: string[] = []

  for (const part of parts) {
    if (part.type !== "file" || !part.url) continue

    // Get the reference text used in the prompt (e.g., "@filename" or "[Image 1]")
    const refText = part.source?.text?.value

    let resolvedPath: string | undefined

    if (part.url.startsWith("data:")) {
      try {
        if (!existsSync(HERMES_TMP_DIR)) {
          mkdirSync(HERMES_TMP_DIR, { recursive: true })
        }
        const base64Match = part.url.match(/^data:[^;]+;base64,(.+)$/)
        if (!base64Match) continue

        const ext = mimeToExtension(part.mime ?? "") || ".bin"
        const filename = `${Date.now()}-${part.source?.path || "attachment"}${ext.startsWith(".") ? "" : "."}${ext}`
          .replace(/[^a-zA-Z0-9._-]/g, "_")
        const filepath = join(HERMES_TMP_DIR, filename)
        writeFileSync(filepath, Buffer.from(base64Match[1], "base64"))
        resolvedPath = filepath
        log(`[${HOOK_NAME}] Saved pasted attachment to ${filepath}`)
      } catch (err) {
        log(`[${HOOK_NAME}] Failed to save attachment to /tmp: ${err}`)
      }
    } else if (part.url.startsWith("file://")) {
      try {
        resolvedPath = fileURLToPath(part.url)
      } catch {
        if (part.source?.path) resolvedPath = part.source.path
      }
    } else if (part.source?.path) {
      resolvedPath = part.source.path
    }

    if (resolvedPath) {
      if (refText) {
        replacements.set(refText, resolvedPath)
      } else {
        orphanPaths.push(resolvedPath)
      }
    }
  }

  return { replacements, orphanPaths }
}

/**
 * Extracts the user's raw text from output.parts, with:
 * - File references ([Image N], @filename) replaced by resolved file paths
 * - Agent mentions stripped using agent part source.value (precise, no false positives on @filename)
 * - Synthetic parts filtered out
 */
function extractUserText(
  parts: ChatMessagePart[],
  fileReplacements: Map<string, string>,
): string {
  let text = parts
    .filter((p) => p.type === "text" && typeof p.text === "string" && !p.synthetic)
    .map((p) => p.text as string)
    .join("\n")

  // Replace file/image references with resolved paths
  for (const [ref, path] of fileReplacements) {
    text = text.replaceAll(ref, path)
  }

  // Strip agent mentions using agent part source.value (precise match)
  const agentMentionTexts = parts
    .filter((p) => p.type === "agent" && p.source?.value)
    .map((p) => p.source!.value as string)

  for (const mention of agentMentionTexts) {
    text = text.replaceAll(mention, "")
  }

  // Fallback: if agent parts exist but have no source.value, use name-based pattern
  if (agentMentionTexts.length === 0) {
    const agentNames = parts
      .filter((p) => p.type === "agent" && p.name)
      .map((p) => p.name as string)
    for (const name of agentNames) {
      // Strip @Name and optional (Label) suffix
      const pattern = new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s+\\([^)]*\\))?`, "gi")
      text = text.replace(pattern, "")
    }
  }

  return text.trim()
}

/**
 * Replaces the user message text with a precise task() call directive for Hermes sessions.
 *
 * The directive contains the user's text embedded in the task() prompt argument,
 * with file references replaced by resolved paths. File parts and synthetic parts
 * are stripped in-place to keep Hermes context lean.
 */
export function createHermesPromptHardenerHook() {
  return {
    "chat.message": async (
      input: {
        sessionID: string
        agent?: string
      },
      output: {
        message: Record<string, unknown>
        parts: ChatMessagePart[]
      },
    ): Promise<void> => {
      const currentAgent = getSessionAgent(input.sessionID) ?? input.agent
      if (!isHermesAgent(currentAgent)) {
        return
      }

      const proxyState = HermesProxyState.get(input.sessionID)
      if (!proxyState) {
        return
      }

      // Build file reference replacements (saves data: URLs to /tmp)
      const { replacements, orphanPaths } = buildFileReplacements(output.parts)

      const userText = extractUserText(output.parts, replacements)
      if (!userText) {
        log(`[${HOOK_NAME}] No user text found, skipping directive injection`, {
          sessionID: input.sessionID,
        })
        return
      }

      // Append orphan file paths that had no reference text in the prompt
      const promptWithFiles = orphanPaths.length > 0
        ? `${userText}\n\nReferenced files:\n${orphanPaths.map((p) => `- ${p}`).join("\n")}`
        : userText

      const directive = buildTaskDirective(
        proxyState.targetAgent,
        proxyState.childSessionID,
        promptWithFiles,
      )

      // Replace the text part with only the directive (user text is already embedded in task(...prompt="..."))
      const textPartIndex = output.parts.findIndex(
        (p) => p.type === "text" && p.text !== undefined && !p.synthetic,
      )
      if (textPartIndex === -1) {
        return
      }

      output.parts[textPartIndex].text = directive

      // Strip file parts and synthetic text parts in-place (splice, not filter)
      // Filter reassignment doesn't affect persistence because OpenCode uses the
      // original local `parts` variable, not `output.parts`.
      for (let i = output.parts.length - 1; i >= 0; i--) {
        const p = output.parts[i]
        if (p.type === "file" || (p.type === "text" && p.synthetic)) {
          output.parts.splice(i, 1)
        }
      }

      log(`[${HOOK_NAME}] Injected task directive for Hermes proxy session`, {
        sessionID: input.sessionID,
        targetAgent: proxyState.targetAgent,
        hasPinnedSession: !!proxyState.childSessionID,
        fileReplacementCount: replacements.size,
        orphanPathCount: orphanPaths.length,
      })
    },
  }
}
