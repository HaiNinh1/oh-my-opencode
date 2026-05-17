import type { OhMyOpenCodeConfig } from "../config"
import type { PluginContext } from "./types"

import { hasConnectedProvidersCache } from "../shared"
import { setSessionModel } from "../shared/session-model-state"
import { setSessionAgent } from "../features/claude-code-session-state"
import { applyUltraworkModelOverrideOnMessage } from "./ultrawork-model-override"
import { parseRalphLoopArguments } from "../hooks/ralph-loop/command-arguments"
import { enhancerSessions } from "../shared/enhancer-sessions"
import { isHermesAgent } from "../hooks/hermes-routing-guard/agent-matcher"
import {
  HERMES_ALLOWED_AGENTS_SET,
  HERMES_ALLOWED_SUBAGENT_TYPES,
  resolveAgentAbbreviation,
} from "../hooks/hermes-routing-guard/constants"
import { getAgentConfigKey } from "../shared/agent-display-names"
import { HermesProxyState } from "../shared/hermes-proxy-state"
import { log } from "../shared/logger"
import { createHermesPromptHardenerHook } from "../hooks/hermes-prompt-hardener"

import type { CreatedHooks } from "../create-hooks"

type FirstMessageVariantGate = {
  shouldOverride: (sessionID: string) => boolean
  markApplied: (sessionID: string) => void
}

type ChatMessagePart = { type: string; text?: string; [key: string]: unknown }
export type ChatMessageHandlerOutput = { message: Record<string, unknown>; parts: ChatMessagePart[] }
export type ChatMessageInput = {
  sessionID: string
  agent?: string
  model?: { providerID: string; modelID: string }
}
type StartWorkHookOutput = { parts: Array<{ type: string; text?: string }> }

function isStartWorkHookOutput(value: unknown): value is StartWorkHookOutput {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  const partsValue = record["parts"]
  if (!Array.isArray(partsValue)) return false
  return partsValue.every((part) => {
    if (typeof part !== "object" || part === null) return false
    const partRecord = part as Record<string, unknown>
    return typeof partRecord["type"] === "string"
  })
}

export function createChatMessageHandler(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  firstMessageVariantGate: FirstMessageVariantGate
  hooks: CreatedHooks
}): (
  input: ChatMessageInput,
  output: ChatMessageHandlerOutput
) => Promise<void> {
  const { ctx, pluginConfig, firstMessageVariantGate, hooks } = args
  const hermesPromptHardener = createHermesPromptHardenerHook()
  const pluginContext = ctx as {
    client: {
      tui: {
        showToast: (input: {
          body: {
            title: string
            message: string
            variant: "warning"
            duration: number
          }
        }) => Promise<unknown>
      }
    }
  }
  const isRuntimeFallbackEnabled =
    hooks.runtimeFallback !== null &&
    hooks.runtimeFallback !== undefined &&
    (typeof pluginConfig.runtime_fallback === "boolean"
      ? pluginConfig.runtime_fallback
      : (pluginConfig.runtime_fallback?.enabled ?? false))

  return async (
    input: ChatMessageInput,
    output: ChatMessageHandlerOutput
  ): Promise<void> => {
    if (input.agent === "enhancer") {
      enhancerSessions.add(input.sessionID)
      return
    }

    // Hermes proxy: reset per-turn task limit flag
    if (isHermesAgent(input.agent)) {
      HermesProxyState.resetTurnFlag(input.sessionID)
    }

    // Hermes proxy: parse @agent-name from first message and pin session target
    if (isHermesAgent(input.agent) && !HermesProxyState.hasTarget(input.sessionID)) {
      const isFirstRootMessage = firstMessageVariantGate.shouldOverride(input.sessionID)
      if (isFirstRootMessage) {
        const agentParts = output.parts.filter(
          (p: ChatMessagePart) => p.type === "agent" && typeof p.name === "string"
        )

        if (agentParts.length === 0) {
          // Default to Sisyphus when no @agent specified
          const defaultTarget = "sisyphus"
          HermesProxyState.setTarget(input.sessionID, defaultTarget)
          // Inject AgentPart so TUI can detect this as a Hermes proxy parent for auto-navigate
          // Must include id/sessionID/messageID for OpenCode's persistence layer (SyncEvent)
          const messageID = (output.message as { id?: string }).id ?? ""
          output.parts.push({
            type: "agent",
            name: defaultTarget,
            id: `prt_hermes_default_agent_${input.sessionID}`,
            sessionID: input.sessionID,
            messageID,
          })
          log("[hermes-proxy] No @agent specified, defaulting to sisyphus", {
            sessionID: input.sessionID,
            targetAgent: defaultTarget,
          })
          firstMessageVariantGate.markApplied(input.sessionID)
        } else if (agentParts.length > 1) {
          throw new Error(
            "Only one @agent-name allowed per session. Choose a single target agent."
          )
        } else {
          const rawAgentName = agentParts[0].name as string
          const normalizedName = getAgentConfigKey(resolveAgentAbbreviation(rawAgentName.trim()))

          if (!HERMES_ALLOWED_AGENTS_SET.has(normalizedName)) {
            const allowedList = HERMES_ALLOWED_SUBAGENT_TYPES.join(", ")
            throw new Error(
              `Agent '${rawAgentName}' is not available for Hermes proxy routing. Use one of: ${allowedList}`
            )
          }

          HermesProxyState.setTarget(input.sessionID, normalizedName)
          log("[hermes-proxy] First message proxy target set", {
            sessionID: input.sessionID,
            targetAgent: normalizedName,
            rawAgentName,
          })
          firstMessageVariantGate.markApplied(input.sessionID)
        }
      }
    }

    // Hermes prompt hardener: inject exact task() call directive into user message
    await hermesPromptHardener["chat.message"](input, output)

    if (input.agent) {
      setSessionAgent(input.sessionID, input.agent)
    }

    if (firstMessageVariantGate.shouldOverride(input.sessionID)) {
      firstMessageVariantGate.markApplied(input.sessionID)
    }

    if (!isRuntimeFallbackEnabled) {
      await hooks.modelFallback?.["chat.message"]?.(input, output)
    }
    const modelOverride = output.message["model"]
    if (
      modelOverride &&
      typeof modelOverride === "object" &&
      "providerID" in modelOverride &&
      "modelID" in modelOverride
    ) {
      const providerID = (modelOverride as { providerID?: string }).providerID
      const modelID = (modelOverride as { modelID?: string }).modelID
      if (typeof providerID === "string" && typeof modelID === "string") {
        setSessionModel(input.sessionID, { providerID, modelID })
      }
    } else if (input.model) {
      setSessionModel(input.sessionID, input.model)
    }
    await hooks.stopContinuationGuard?.["chat.message"]?.(input)
    await hooks.backgroundNotificationHook?.["chat.message"]?.(input, output)
    await hooks.runtimeFallback?.["chat.message"]?.(input, output)
    await hooks.keywordDetector?.["chat.message"]?.(input, output)
    await hooks.thinkMode?.["chat.message"]?.(input, output)
    await hooks.claudeCodeHooks?.["chat.message"]?.(input, output)
    await hooks.autoSlashCommand?.["chat.message"]?.(input, output)
    await hooks.noSisyphusGpt?.["chat.message"]?.(input, output)
    await hooks.noHephaestusNonGpt?.["chat.message"]?.(input, output)
    if (hooks.startWork && isStartWorkHookOutput(output)) {
      await hooks.startWork["chat.message"]?.(input, output)
    }

    if (!hasConnectedProvidersCache()) {
      pluginContext.client.tui
        .showToast({
          body: {
            title: "⚠️ Provider Cache Missing",
            message:
              "Model filtering disabled. RESTART OpenCode to enable full functionality.",
            variant: "warning" as const,
            duration: 6000,
          },
        })
        .catch(() => {})
    }

    if (hooks.ralphLoop) {
      const parts = output.parts
      const promptText =
        parts
          ?.filter((p) => p.type === "text" && p.text)
          .map((p) => p.text)
          .join("\n")
          .trim() || ""

      const isRalphLoopTemplate =
        promptText.includes("You are starting a Ralph Loop") &&
        promptText.includes("<user-task>")
      const isUlwLoopTemplate =
        promptText.includes("You are starting an ULTRAWORK Loop") &&
        promptText.includes("<user-task>")
      const isCancelRalphTemplate = promptText.includes(
        "Cancel the currently active Ralph Loop",
      )

      if (isRalphLoopTemplate || isUlwLoopTemplate) {
        const taskMatch = promptText.match(/<user-task>\s*([\s\S]*?)\s*<\/user-task>/i)
        const rawTask = taskMatch?.[1]?.trim() || ""
        const parsedArguments = parseRalphLoopArguments(rawTask)

        hooks.ralphLoop.startLoop(input.sessionID, parsedArguments.prompt, {
          ultrawork: isUlwLoopTemplate,
          maxIterations: parsedArguments.maxIterations,
          completionPromise: parsedArguments.completionPromise,
          strategy: parsedArguments.strategy,
        })
      } else if (isCancelRalphTemplate) {
        hooks.ralphLoop.cancelLoop(input.sessionID)
      }
    }

    await applyUltraworkModelOverrideOnMessage(
      pluginConfig,
      input.agent,
      output,
      pluginContext.client.tui,
      input.sessionID,
      pluginContext.client,
    )
  }
}
