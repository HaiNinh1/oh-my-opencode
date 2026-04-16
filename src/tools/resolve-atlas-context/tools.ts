import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { START_WORK_TEMPLATE } from "../../features/builtin-commands/templates/start-work"
import {
  readBoulderState,
  writeBoulderState,
  appendSessionId,
  findPrometheusPlans,
  getPlanProgress,
  createBoulderState,
  getPlanName,
  clearBoulderState,
} from "../../features/boulder-state"

export const createResolveAtlasContextTool = (
  directory: string,
  sessionId: string
): ToolDefinition =>
  tool({
    description: "Resolves dynamic context for starting work with Atlas. Handles Prometheus plan discovery, selection, and boulder state initialization. Use this when routing to Atlas with a plan request.",
    args: {
      planName: tool.schema.string().describe("Explicit plan name or keywords to search for (e.g., 'dark mode', 'payment gateway'). NOT a generic request sentence like 'Tell atlas to execute...'. Extract only the actual plan name/keywords."),
    },
    execute: async (args) => {
      try {
        const timestamp = new Date().toISOString()
        const existingState = readBoulderState(directory)
        
        let contextInfo = ""
        const explicitPlanName = extractUserRequestPlanName(args.planName)

        if (explicitPlanName) {
          const allPlans = findPrometheusPlans(directory)
          const matchedPlan = findPlanByName(allPlans, explicitPlanName)
          
          if (matchedPlan) {
            const progress = getPlanProgress(matchedPlan)
            
            if (progress.isComplete) {
              contextInfo = `
## Plan Already Complete

The requested plan "${getPlanName(matchedPlan)}" has been completed.
All ${progress.total} tasks are done. Create a new plan with: /plan "your task"`
            } else {
              if (existingState) {
                clearBoulderState(directory)
              }
              const newState = createBoulderState(matchedPlan, sessionId, "atlas")
              writeBoulderState(directory, newState)
              
              contextInfo = `
## Auto-Selected Plan

**Plan**: ${getPlanName(matchedPlan)}
**Path**: ${matchedPlan}
**Progress**: ${progress.completed}/${progress.total} tasks
**Session ID**: ${sessionId}
**Started**: ${timestamp}

boulder.json has been created. Read the plan and begin execution.`
            }
          } else {
            const incompletePlans = allPlans.filter(p => !getPlanProgress(p).isComplete)
            if (incompletePlans.length > 0) {
              const planList = incompletePlans.map((p, i) => {
                const prog = getPlanProgress(p)
                return `${i + 1}. [${getPlanName(p)}] - Progress: ${prog.completed}/${prog.total}`
              }).join("\n")
              
              contextInfo = `
## Plan Not Found

Could not find a plan matching "${explicitPlanName}".

Available incomplete plans:
${planList}

Ask the user which plan to work on.`
            } else {
              contextInfo = `
## Plan Not Found

Could not find a plan matching "${explicitPlanName}".
No incomplete plans available. Create a new plan with: /plan "your task"`
            }
          }
        } else if (existingState) {
          const progress = getPlanProgress(existingState.active_plan)
          
          if (!progress.isComplete) {
            appendSessionId(directory, sessionId)
            contextInfo = `
## Active Work Session Found

**Status**: RESUMING existing work
**Plan**: ${existingState.plan_name}
**Path**: ${existingState.active_plan}
**Progress**: ${progress.completed}/${progress.total} tasks completed
**Sessions**: ${existingState.session_ids.length + 1} (current session appended)
**Started**: ${existingState.started_at}

The current session (${sessionId}) has been added to session_ids.
Read the plan file and continue from the first unchecked task.`
          } else {
            contextInfo = `
## Previous Work Complete

The previous plan (${existingState.plan_name}) has been completed.
Looking for new plans...`
          }
        }

        if ((!existingState && !explicitPlanName) || (existingState && !explicitPlanName && getPlanProgress(existingState.active_plan).isComplete)) {
          const plans = findPrometheusPlans(directory)
          const incompletePlans = plans.filter(p => !getPlanProgress(p).isComplete)
          
          if (plans.length === 0) {
            contextInfo += `

## No Plans Found

No Prometheus plan files found at .sisyphus/plans/
Use Prometheus to create a work plan first: /plan "your task"`
          } else if (incompletePlans.length === 0) {
            contextInfo += `

## All Plans Complete

All ${plans.length} plan(s) are complete. Create a new plan with: /plan "your task"`
          } else if (incompletePlans.length === 1) {
            const planPath = incompletePlans[0]
            const progress = getPlanProgress(planPath)
            const newState = createBoulderState(planPath, sessionId, "atlas")
            writeBoulderState(directory, newState)

            contextInfo += `

## Auto-Selected Plan

**Plan**: ${getPlanName(planPath)}
**Path**: ${planPath}
**Progress**: ${progress.completed}/${progress.total} tasks
**Session ID**: ${sessionId}
**Started**: ${timestamp}

boulder.json has been created. Read the plan and begin execution.`
          } else {
            const planList = incompletePlans.map((p, i) => {
              const progress = getPlanProgress(p)
              const stat = require("node:fs").statSync(p)
              const modified = new Date(stat.mtimeMs).toISOString()
              return `${i + 1}. [${getPlanName(p)}] - Modified: ${modified} - Progress: ${progress.completed}/${progress.total}`
            }).join("\n")

            contextInfo += `

<system-reminder>
## Multiple Plans Found

Current Time: ${timestamp}
Session ID: ${sessionId}

${planList}

Ask the user which plan to work on. Present the options above and wait for their response.
</system-reminder>`
          }
        }

        // Return the combined prompt with injected context
        return `${START_WORK_TEMPLATE}\n\n---\n${contextInfo}`.replace(/\$SESSION_ID/g, sessionId).replace(/\$TIMESTAMP/g, timestamp)

      } catch (e) {
        return `Error resolving start-work context: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

// --- Helper Functions duplicated from start-work-hook.ts ---

const KEYWORD_PATTERN = /\b(ultrawork|ulw)\b/gi

function extractUserRequestPlanName(promptText: string): string | null {
  // If passed directly as user request text, treat the whole string as potential plan name
  // after cleaning keywords.
  if (!promptText) return null
  
  // Also try to find <user-request> tag if passed raw
  const userRequestMatch = promptText.match(/<user-request>\s*([\s\S]*?)\s*<\/user-request>/i)
  const rawArg = userRequestMatch ? userRequestMatch[1].trim() : promptText.trim()
  
  if (!rawArg) return null
  
  const cleanedArg = rawArg.replace(KEYWORD_PATTERN, "").trim()
  return cleanedArg || null
}

function findPlanByName(plans: string[], requestedName: string): string | null {
  const lowerName = requestedName.toLowerCase()
  
  const exactMatch = plans.find(p => getPlanName(p).toLowerCase() === lowerName)
  if (exactMatch) return exactMatch
  
  const partialMatch = plans.find(p => getPlanName(p).toLowerCase().includes(lowerName))
  return partialMatch || null
}
