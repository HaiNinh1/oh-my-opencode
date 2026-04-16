/**
 * Mnemosyne Plan System Prepend
 *
 * Distilled from Prometheus plan constants for Mnemosyne's execution model:
 * - Sequential task ordering instead of wave-based parallel execution
 * - No category/skill recommendations per task (Heracles executes directly)
 * - Skills table kept for reference (Heracles can load skills when invoked)
 */

import type { AvailableSkill, AvailableToolInfo } from "../../agents/dynamic-agent-prompt-builder"
import { truncateDescription } from "../../shared/truncate-description"

export const MNEMOSYNE_AGENT_NAMES = ["mnemosyne"]

export function isMnemosyneAgent(agentName: string | undefined): boolean {
  if (!agentName) return false
  const lowerName = agentName.toLowerCase().trim()
  return MNEMOSYNE_AGENT_NAMES.some(
    (name) => lowerName === name || lowerName.includes(name)
  )
}

export const MNEMOSYNE_SYSTEM_PREPEND_BEFORE_SKILLS = `<system>
<Execution_Model>
Heracles is the single executor for your plan. It:
- Reads the plan file directly
- Executes each task IN ORDER (sequential, no parallel waves)
- Uses \`task(subagent_type="explore/librarian")\` for research ONLY
- Does ALL implementation, testing, and verification itself
- NEVER delegates via \`task(category=...)\` — no categories in the plan

Structure your plan for one agent executing sequentially. No waves. No parallel groups. No category/skill recommendations per task.
</Execution_Model>

<Task_Dependencies>
For every task, specify execution order and dependencies:

| Task | Depends On | Reason |
|------|------------|--------|
| Task 1 | None | Starting point |
| Task 2 | Task 1 | Requires types from Task 1 |

Order tasks so dependencies come first. Heracles executes sequentially.
</Task_Dependencies>
</system>
`
export const MNEMOSYNE_SYSTEM_PREPEND_AFTER_SKILLS = `<Actionable_TODO_List>
End your plan with a condensed TODO summary for TodoWrite registration:

- [ ] **1. [Task Title]** — What: [steps] | Depends: None/Task N | QA: [verification]
- [ ] **2. [Task Title]** — What: [steps] | Depends: Task 1 | QA: [verification]

Run \`/execute-plan {name}\` to start Heracles direct execution.
</Actionable_TODO_List>
`

function renderMnemosyneSkillRows(skills: AvailableSkill[]): string[] {
  const sorted = [...skills].sort((a, b) => a.name.localeCompare(b.name))
  return sorted.map((skill) => {
    const domain = truncateDescription(skill.description).trim() || skill.name
    return `| \`${skill.name}\` | ${domain} |`
  })
}

export function buildMnemosyneSkillsSection(
  skills: AvailableSkill[] = []
): string {
  if (skills.length === 0) {
    return ""
  }

  const skillRows = renderMnemosyneSkillRows(skills)

  return `### AVAILABLE SKILLS (for reference in plan tasks)

Skills inject specialized expertise into the executor.
Note relevant skills in task descriptions so Heracles can load them if needed via \`/execute-plan\`.

| Skill | Domain |
|-------|--------|
${skillRows.join("\n")}`
}

const EXCLUDED_TOOL_NAMES = new Set([
  "resolve_atlas_context",
  "resolve_heracles_context",
  "background_output",
  "background_cancel",
  "task_create",
  "task_list",
  "task_get",
  "task_update",
  "call_omo_agent",
  "task",
])

function renderMnemosyneToolRows(tools: AvailableToolInfo[]): string[] {
  const filtered = tools.filter((t) => !EXCLUDED_TOOL_NAMES.has(t.name))
  const sorted = [...filtered].sort((a, b) => a.name.localeCompare(b.name))
  return sorted.map((t) => {
    const desc = truncateDescription(t.description).trim() || t.name
    return `| \`${t.name}\` | ${desc} |`
  })
}

export function buildMnemosyneToolsSection(
  tools: AvailableToolInfo[] = []
): string {
  if (tools.length === 0) {
    return ""
  }

  const toolRows = renderMnemosyneToolRows(tools)
  if (toolRows.length === 0) {
    return ""
  }

  return `### EXECUTOR TOOL REFERENCE

The executor (Heracles) has access to these tools. Reference them explicitly in task instructions when appropriate.
Use specific tool names instead of vague language (e.g. "Use \`lsp_find_references\` to locate call sites" not "find all usages").

| Tool | Description |
|------|-------------|
${toolRows.join("\n")}

**Note:** Heracles can also dispatch \`task(subagent_type="explore/librarian")\` for research only.`
}

export function buildMnemosyneSystemPrepend(
  skills: AvailableSkill[] = [],
  tools: AvailableToolInfo[] = [],
): string {
  return [
    MNEMOSYNE_SYSTEM_PREPEND_BEFORE_SKILLS,
    buildMnemosyneSkillsSection(skills),
    buildMnemosyneToolsSection(tools),
    MNEMOSYNE_SYSTEM_PREPEND_AFTER_SKILLS,
  ].join("\n\n")
}
