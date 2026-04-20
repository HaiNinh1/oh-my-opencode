import { log } from "../../shared"
import { isHermesAgent } from "../hermes-routing-guard/agent-matcher"
import { HermesProxyState } from "../../shared/hermes-proxy-state"
import {
  getMainSessionID,
  getSessionAgent,
} from "../../features/claude-code-session-state"
import { HERMES_ALLOWED_SUBAGENT_TYPES } from "../hermes-routing-guard/constants"

const HOOK_NAME = "hermes-task-description"

type ToolDefinitionHook = {
  "tool.definition"?: (
    input: { toolID: string },
    output: { description: string; parameters: unknown },
  ) => Promise<void>
}

const allowedList = HERMES_ALLOWED_SUBAGENT_TYPES.join(", ")

const HERMES_TASK_DESCRIPTION = `Spawn a subagent task. You are a transparent proxy router.

USAGE:
- First message: task(subagent_type="<target>", load_skills=[], description="<short>", prompt="<user request>", run_in_background=false)
- Continuation: task(session_id="<child session ID>", load_skills=[], description="<short>", prompt="<user request>", run_in_background=false)

ALLOWED TARGETS: ${allowedList}

RULES:
- NEVER use category. ALWAYS use subagent_type.
- NEVER use run_in_background=true.
- load_skills is always [].
- prompt must be the user's message exactly as given.
- On first call, use subagent_type. On subsequent calls, use session_id from the previous result.`

export function createHermesTaskDescriptionHook(): ToolDefinitionHook {
  return {
    "tool.definition": async (input, output) => {
      if (input.toolID !== "task") return

      const mainSessionID = getMainSessionID()
      if (!mainSessionID) return

      const currentAgent = getSessionAgent(mainSessionID)
      if (!currentAgent || !isHermesAgent(currentAgent)) return

      if (!HermesProxyState.hasTarget(mainSessionID)) return

      log(`[${HOOK_NAME}] Overriding task description for Hermes proxy session`)
      output.description = HERMES_TASK_DESCRIPTION
    },
  }
}
