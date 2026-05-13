import type { PluginInput } from "@opencode-ai/plugin"
import { patchPart } from "../../shared/opencode-http-api"
import { normalizeSDKResponse } from "../../shared"
import { log } from "../../shared/logger"

type OpencodeClient = PluginInput["client"]

export interface PartContext {
  client: OpencodeClient
  sessionID: string
  messageID: string
}

interface TaskInput {
  description: string
  prompt: string
  subagent_type?: string
  category?: string
  load_skills?: string[]
}

let partCounter = 0

export function createPartId(): string {
  partCounter++
  const now = BigInt(Date.now()) * BigInt(0x1000) + BigInt(partCounter)
  const timeBytes = Buffer.alloc(6)
  for (let i = 0; i < 6; i++) {
    timeBytes[i] = Number((now >> BigInt(40 - 8 * i)) & BigInt(0xff))
  }
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
  let random = ""
  for (let i = 0; i < 14; i++) {
    random += chars[Math.floor(Math.random() * 62)]
  }
  return `prt_${timeBytes.toString("hex")}${random}`
}

interface SDKMessage {
  info?: { id?: string; role?: string }
}

export async function resolveMessageID(client: OpencodeClient, sessionID: string): Promise<string | null> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const messages = normalizeSDKResponse(response, [] as SDKMessage[], { preferResponseOnMissingData: true })
    if (messages.length === 0) return null

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg?.info?.role === "assistant" && msg.info.id) {
        return msg.info.id
      }
    }

    const lastMsg = messages[messages.length - 1]
    return lastMsg?.info?.id ?? null
  } catch (error) {
    log("[parallel_tasks] Failed to resolve messageID", { error: String(error) })
    return null
  }
}

function buildPartInput(input: TaskInput): Record<string, unknown> {
  return {
    description: input.description,
    prompt: input.prompt,
    subagent_type: input.subagent_type,
    category: input.category,
    run_in_background: false,
    load_skills: input.load_skills ?? [],
  }
}

export async function emitRunningPart(
  partCtx: PartContext,
  partId: string,
  input: TaskInput,
  childSessionId: string,
  model?: { providerID: string; modelID: string },
): Promise<boolean> {
  return patchPart(partCtx.client, partCtx.sessionID, partCtx.messageID, partId, {
    id: partId,
    sessionID: partCtx.sessionID,
    messageID: partCtx.messageID,
    type: "tool",
    callID: partId,
    tool: "task",
    state: {
      status: "running",
      input: buildPartInput(input),
      title: input.description,
      metadata: {
        sessionId: childSessionId,
        model,
        sync: true,
      },
      time: { start: Date.now() },
    },
  })
}

export async function emitCompletedPart(
  partCtx: PartContext,
  partId: string,
  input: TaskInput,
  childSessionId: string,
  output: string,
  startTime: number,
  model?: { providerID: string; modelID: string },
): Promise<boolean> {
  return patchPart(partCtx.client, partCtx.sessionID, partCtx.messageID, partId, {
    id: partId,
    sessionID: partCtx.sessionID,
    messageID: partCtx.messageID,
    type: "tool",
    callID: partId,
    tool: "task",
    state: {
      status: "completed",
      input: buildPartInput(input),
      title: input.description,
      output,
      metadata: {
        sessionId: childSessionId,
        model,
        sync: true,
      },
      time: { start: startTime, end: Date.now() },
    },
  })
}

export async function emitErrorPart(
  partCtx: PartContext,
  partId: string,
  input: TaskInput,
  error: string,
  startTime: number,
): Promise<boolean> {
  return patchPart(partCtx.client, partCtx.sessionID, partCtx.messageID, partId, {
    id: partId,
    sessionID: partCtx.sessionID,
    messageID: partCtx.messageID,
    type: "tool",
    callID: partId,
    tool: "task",
    state: {
      status: "error",
      input: buildPartInput(input),
      error,
      metadata: {},
      time: { start: startTime, end: Date.now() },
    },
  })
}
