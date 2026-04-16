import type { DelegateTaskArgs, OpencodeClient } from "./types"
import { buildTaskPrompt } from "./prompt-builder"
import { shouldAllowQuestion } from "./constants"
import {
  promptSyncWithModelSuggestionRetry,
  promptWithModelSuggestionRetry,
} from "../../shared/model-suggestion-retry"
import { formatDetailedError } from "./error-formatting"
import { getAgentToolRestrictions } from "../../shared/agent-tool-restrictions"
import { setSessionTools } from "../../shared/session-tools-store"
import { createInternalAgentTextPart } from "../../shared/internal-initiator-marker"
import { isHermesAgent } from "../../hooks/hermes-routing-guard/agent-matcher"

type SendSyncPromptDeps = {
  promptWithModelSuggestionRetry: typeof promptWithModelSuggestionRetry
  promptSyncWithModelSuggestionRetry: typeof promptSyncWithModelSuggestionRetry
}

const sendSyncPromptDeps: SendSyncPromptDeps = {
  promptWithModelSuggestionRetry,
  promptSyncWithModelSuggestionRetry,
}

function isOracleAgent(agentToUse: string): boolean {
  return agentToUse.toLowerCase() === "oracle"
}

function isUnexpectedEofError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const lowered = message.toLowerCase()
  return lowered.includes("unexpected eof") || lowered.includes("json parse error")
}

export async function sendSyncPrompt(
  client: OpencodeClient,
  input: {
    sessionID: string
    agentToUse: string
    args: DelegateTaskArgs
    systemContent: string | undefined
    categoryModel: { providerID: string; modelID: string; variant?: string } | undefined
    toastManager: { removeTask: (id: string) => void } | null | undefined
    taskId: string | undefined
    parentAgent?: string
  },
  deps: SendSyncPromptDeps = sendSyncPromptDeps
): Promise<string | null> {
  const effectivePrompt = buildTaskPrompt(input.args.prompt, input.agentToUse)
  const agentRestrictions = getAgentToolRestrictions(input.agentToUse)
  const allowQuestion = shouldAllowQuestion(input.agentToUse)
  const tools = {
    task: agentRestrictions.task ?? true,
    call_omo_agent: true,
    question: allowQuestion,
    ...agentRestrictions,
  }
  setSessionTools(input.sessionID, tools)

  const promptArgs = {
    path: { id: input.sessionID },
    body: {
      agent: input.agentToUse,
      system: input.systemContent,
      tools,
      parts: [isHermesAgent(input.parentAgent)
        ? { type: "text" as const, text: effectivePrompt }
        : createInternalAgentTextPart(effectivePrompt)],
      ...(input.categoryModel
        ? { model: { providerID: input.categoryModel.providerID, modelID: input.categoryModel.modelID } }
        : {}),
      ...(input.categoryModel?.variant ? { variant: input.categoryModel.variant } : {}),
    },
  }

  try {
    await deps.promptWithModelSuggestionRetry(client, promptArgs)
  } catch (promptError) {
    if (isOracleAgent(input.agentToUse) && isUnexpectedEofError(promptError)) {
      try {
        await deps.promptSyncWithModelSuggestionRetry(client, promptArgs)
        return null
      } catch (oracleRetryError) {
        promptError = oracleRetryError
      }
    }

    if (input.toastManager && input.taskId !== undefined) {
      input.toastManager.removeTask(input.taskId)
    }
    const errorMessage = promptError instanceof Error ? promptError.message : String(promptError)
    if (errorMessage.includes("agent.name") || errorMessage.includes("undefined")) {
      return formatDetailedError(new Error(`Agent "${input.agentToUse}" not found. Make sure the agent is registered in your opencode.json or provided by a plugin.`), {
        operation: "Send prompt to agent",
        args: input.args,
        sessionID: input.sessionID,
        agent: input.agentToUse,
        category: input.args.category,
      })
    }
    return formatDetailedError(promptError, {
      operation: "Send prompt",
      args: input.args,
      sessionID: input.sessionID,
      agent: input.agentToUse,
      category: input.args.category,
    })
  }

  return null
}
