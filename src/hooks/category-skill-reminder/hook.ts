import type { PluginInput } from "@opencode-ai/plugin"
import type { AvailableSkill } from "../../agents/dynamic-agent-prompt-builder"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { log } from "../../shared"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { buildReminderMessage } from "./formatter"

const TARGET_AGENTS = new Set([
  "sisyphus",
  "sisyphus-junior",
  "atlas",
])

const SEARCH_TOOLS = new Set([
  "grep",
  "glob",
  "webfetch",
])

const EXPLORE_LIBRARIAN_TOOLS = new Set([
  "task",
  "call_omo_agent",
])

interface ToolExecuteInput {
  tool: string
  sessionID: string
  callID: string
  agent?: string
}

interface ToolExecuteOutput {
  title: string
  output: string
  metadata: unknown
}

interface SessionState {
  exploreLibrarianUsed: boolean
  reminderShown: boolean
  searchToolCount: number
}

export function createCategorySkillReminderHook(
  _ctx: PluginInput,
  availableSkills: AvailableSkill[] = []
) {
  const sessionStates = new Map<string, SessionState>()
  const reminderMessage = buildReminderMessage(availableSkills)

  function getOrCreateState(sessionID: string): SessionState {
    if (!sessionStates.has(sessionID)) {
      sessionStates.set(sessionID, {
        exploreLibrarianUsed: false,
        reminderShown: false,
        searchToolCount: 0,
      })
    }
    return sessionStates.get(sessionID)!
  }

  function isTargetAgent(sessionID: string, inputAgent?: string): boolean {
    const agent = getSessionAgent(sessionID) ?? inputAgent
    if (!agent) return false
    const agentKey = getAgentConfigKey(agent)
    return (
      TARGET_AGENTS.has(agentKey) ||
      agentKey.includes("sisyphus") ||
      agentKey.includes("atlas")
    )
  }

  const toolExecuteAfter = async (input: ToolExecuteInput, output: ToolExecuteOutput) => {
    const { tool, sessionID } = input
    const toolLower = tool.toLowerCase()

    if (!isTargetAgent(sessionID, input.agent)) {
      return
    }

    const state = getOrCreateState(sessionID)

    if (EXPLORE_LIBRARIAN_TOOLS.has(toolLower)) {
      state.exploreLibrarianUsed = true
      log("[category-skill-reminder] Agent delegation used", { sessionID, tool })
      return
    }

    if (!SEARCH_TOOLS.has(toolLower)) {
      return
    }

    state.searchToolCount++

    if (state.searchToolCount >= 3 && !state.exploreLibrarianUsed && !state.reminderShown) {
      output.output += reminderMessage
      state.reminderShown = true
      log("[category-skill-reminder] Explore/librarian reminder injected", {
        sessionID,
        searchToolCount: state.searchToolCount,
      })
    }
  }

  const eventHandler = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        sessionStates.delete(sessionInfo.id)
      }
    }

    if (event.type === "session.compacted") {
      const sessionID = (props?.sessionID ??
        (props?.info as { id?: string } | undefined)?.id) as string | undefined
      if (sessionID) {
        sessionStates.delete(sessionID)
      }
    }
  }

  return {
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  }
}
