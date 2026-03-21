import type { AgentPromptMetadata } from "./types"

export interface AvailableAgent {
  name: string
  description: string
  metadata: AgentPromptMetadata
}

export interface AvailableTool {
  name: string
  category: "lsp" | "ast" | "search" | "session" | "command" | "other"
}

export interface AvailableSkill {
  name: string
  description: string
  location: "user" | "project" | "plugin"
}

export interface AvailableCategory {
  name: string
  description: string
  model?: string
}

export interface AvailableToolInfo {
  name: string
  description: string
}

export function categorizeTools(toolNames: string[]): AvailableTool[] {
  return toolNames.map((name) => {
    let category: AvailableTool["category"] = "other"
    if (name.startsWith("lsp_")) {
      category = "lsp"
    } else if (name.startsWith("ast_grep")) {
      category = "ast"
    } else if (name === "grep" || name === "glob") {
      category = "search"
    } else if (name.startsWith("session_")) {
      category = "session"
    } else if (name === "skill") {
      category = "command"
    }
    return { name, category }
  })
}

function formatToolsForPrompt(tools: AvailableTool[]): string {
  const lspTools = tools.filter((t) => t.category === "lsp")
  const astTools = tools.filter((t) => t.category === "ast")
  const searchTools = tools.filter((t) => t.category === "search")

  const parts: string[] = []

  if (searchTools.length > 0) {
    parts.push(...searchTools.map((t) => `\`${t.name}\``))
  }

  if (lspTools.length > 0) {
    parts.push("`lsp_*`")
  }

  if (astTools.length > 0) {
    parts.push("`ast_grep`")
  }

  return parts.join(", ")
}

export function buildKeyTriggersSection(agents: AvailableAgent[], _skills: AvailableSkill[] = []): string {
  const keyTriggers = agents
    .filter((a) => a.metadata.keyTrigger)
    .map((a) => `- ${a.metadata.keyTrigger}`)

  if (keyTriggers.length === 0) return ""

  return `### Key Triggers (check BEFORE classification):

${keyTriggers.join("\n")}
- **"Look into" + "create PR"** → Not just research. Full implementation cycle expected.`
}

export function buildToolSelectionTable(
  agents: AvailableAgent[],
  tools: AvailableTool[] = [],
  _skills: AvailableSkill[] = []
): string {
  const rows: string[] = [
    "### Tool & Agent Selection:",
    "",
  ]

  if (tools.length > 0) {
    const toolsDisplay = formatToolsForPrompt(tools)
    rows.push(`- ${toolsDisplay} — **FREE** — Not Complex, Scope Clear, No Implicit Assumptions`)
  }

  const costOrder = { FREE: 0, CHEAP: 1, EXPENSIVE: 2 }
  const sortedAgents = [...agents]
    .filter((a) => a.metadata.category !== "utility")
    .sort((a, b) => costOrder[a.metadata.cost] - costOrder[b.metadata.cost])

  for (const agent of sortedAgents) {
    const shortDesc = agent.description.split(".")[0] || agent.description
    rows.push(`- \`${agent.name}\` agent — **${agent.metadata.cost}** — ${shortDesc}`)
  }

  rows.push("")
  rows.push("**Default flow**: explore/librarian + tools → oracle (after research, for validation/second opinion)")

  return rows.join("\n")
}

export function buildExploreSection(agents: AvailableAgent[]): string {
  const exploreAgent = agents.find((a) => a.name === "explore")
  if (!exploreAgent) return ""

  const useWhen = exploreAgent.metadata.useWhen || []
  const avoidWhen = exploreAgent.metadata.avoidWhen || []

  return `### Explore Agent = Contextual Grep

Use it as a **peer tool**, not a fallback. Fire liberally for discovery, not for files you already know.

**Delegation Trust Rule:** Once you fire an explore agent for a search, do **not** manually perform that same search yourself. Use direct tools only for non-overlapping work or when you intentionally skipped delegation.

**Use Direct Tools when:**
${avoidWhen.map((w) => `- ${w}`).join("\n")}

**Use Explore Agent when:**
${useWhen.map((w) => `- ${w}`).join("\n")}`
}

export function buildLibrarianSection(agents: AvailableAgent[]): string {
  const librarianAgent = agents.find((a) => a.name === "librarian")
  if (!librarianAgent) return ""

  const useWhen = librarianAgent.metadata.useWhen || []

  return `### Librarian Agent = Reference Grep

Search **external references** (docs, OSS, web). Fire proactively when unfamiliar libraries are involved.

**Contextual Grep (Internal)** — search OUR codebase, find patterns in THIS repo, project-specific logic.
**Reference Grep (External)** — search EXTERNAL resources, official API docs, library best practices, OSS implementation examples.

**Trigger phrases** (fire librarian immediately):
${useWhen.map((w) => `- "${w}"`).join("\n")}`
}

export function buildDelegationTable(agents: AvailableAgent[]): string {
  const rows: string[] = [
    "### Delegation Table:",
    "",
  ]

  for (const agent of agents) {
    for (const trigger of agent.metadata.triggers) {
      rows.push(`- **${trigger.domain}** → \`${agent.name}\` — ${trigger.trigger}`)
    }
  }

  return rows.join("\n")
}


export function buildCategorySkillsDelegationGuide(categories: AvailableCategory[], skills: AvailableSkill[]): string {
  if (categories.length === 0 && skills.length === 0) return ""

  const categoryRows = categories.map((c) => {
    const desc = c.description || c.name
    return `- \`${c.name}\` — ${desc}`
  })

  const builtinSkills = skills.filter((s) => s.location === "plugin")
  const customSkills = skills.filter((s) => s.location !== "plugin")

  const builtinNames = builtinSkills.map((s) => s.name).join(", ")
  const customNames = customSkills.map((s) => {
    const source = s.location === "project" ? "project" : "user"
    return `${s.name} (${source})`
  }).join(", ")

  let skillsSection: string

  if (customSkills.length > 0 && builtinSkills.length > 0) {
    skillsSection = `#### Available Skills (via \`skill\` tool)

**Built-in**: ${builtinNames}
**Your Skills**: ${customNames}

> Load skills via \`skill\` tool when their domain matches your current task.`
  } else if (customSkills.length > 0) {
    skillsSection = `#### Available Skills (via \`skill\` tool)

**Your Skills**: ${customNames}

> Load skills via \`skill\` tool when their domain matches your current task.`
  } else if (builtinSkills.length > 0) {
    skillsSection = `#### Available Skills (via \`skill\` tool)

**Built-in**: ${builtinNames}

> Load skills via \`skill\` tool when their domain matches your current task.`
  } else {
    skillsSection = ""
  }

  return `### Category + Skills System (Available for Delegation)

When you choose to delegate via \`task()\`, categories and skills are available:

#### Available Categories

${categoryRows.join("\n")}

${skillsSection}

To delegate: \`task(category="...", load_skills=["..."], prompt="...")\``
}

export function buildOracleSection(agents: AvailableAgent[]): string {
  const oracleAgent = agents.find((a) => a.name === "oracle")
  if (!oracleAgent) return ""

  const useWhen = oracleAgent.metadata.useWhen || []
  const avoidWhen = oracleAgent.metadata.avoidWhen || []

  return `<Oracle_Usage>
## Oracle — Read-Only High-IQ Consultant

Oracle is a read-only, high-quality reasoning model. Consultation only — Oracle advises, you decide and act.

**Oracle is encouraged, not rationed.** It costs the same as explore/librarian. Use it whenever a second opinion would improve your confidence or catch blind spots. The only prerequisite: do your research first so Oracle has concrete material to reason about.

### WHEN to Consult:

${useWhen.map((w) => `- ${w}`).join("\n")}

### Prerequisites (do these FIRST so Oracle can be effective):

1. **Gather context** — read relevant files, run explore/librarian agents, understand the landscape
2. **Form your own view** — have findings, a hypothesis, or candidate approaches ready
3. **Know your question** — what specific decision or validation do you need from Oracle?

### WHEN to SKIP Oracle:

${avoidWhen.map((w) => `- ${w}`).join("\n")}

### How to Consult Oracle:

Briefly announce "Consulting Oracle for [reason]" before invocation.

Always call Oracle synchronously with \`run_in_background=false\`. Oracle results return inline — no polling, no background management needed.

**Every Oracle call MUST include a structured payload:**

\`\`\`
task(subagent_type="oracle", run_in_background=false, load_skills=[], description="Consult Oracle on [topic]", prompt="
  PROBLEM: [What you're solving or deciding — 1-2 sentences]
  EVIDENCE: [What you found from explore/librarian/tools — concrete findings, not vague summaries]
  CONTEXT: [What you already tried or considered, if applicable]
  HYPOTHESES: [Your current competing theories or candidate approaches]
  QUESTION: [One precise question Oracle can answer with read-only analysis]
")
\`\`\`

**Give Oracle rich context.** The better the evidence and hypotheses you provide, the more useful Oracle's analysis will be.

### After Oracle Returns:

**Immediately resume control.** Oracle advises — you decide and execute.

1. Summarize Oracle's answer in 1-2 bullets (for your own reasoning, not as output to user)
2. Decide the next concrete action based on Oracle's analysis
3. Execute that action immediately — do NOT end your turn after receiving Oracle's response
4. If Oracle's advice conflicts with your evidence, follow up with Oracle using \`session_id\` from the previous result — share the conflicting evidence and ask Oracle to reconcile
</Oracle_Usage>`
}

export function buildHardBlocksSection(): string {
  const blocks = [
    "- Type error suppression (`as any`, `@ts-ignore`) — **Never**",
    "- Commit without explicit request — **Never**",
    "- Speculate about unread code — **Never**",
    "- Leave code in broken state after failures — **Never**",
    "- `background_cancel(all=true)` — **Never.** Always cancel individually by taskId.",
  ]

  return `## Hard Blocks (NEVER violate)

${blocks.join("\n")}`
}

export function buildAntiPatternsSection(): string {
  const patterns = [
    "- **Type Safety**: `as any`, `@ts-ignore`, `@ts-expect-error`",
    "- **Error Handling**: Empty catch blocks `catch(e) {}`",
    "- **Testing**: Deleting failing tests to \"pass\"",
    "- **Search**: Firing agents for single-line typos or obvious syntax errors",
    "- **Debugging**: Shotgun debugging, random changes",
    "- **Sequential Research**: Firing one explore/librarian agent, waiting for results, then firing the next — fire ALL in parallel in the same response",
    "- **Delegation Duplication**: Delegating exploration to explore/librarian and then manually doing the same search yourself",
  ]

  return `## Anti-Patterns (BLOCKING violations)

${patterns.join("\n")}`
}

export function buildToolCallFormatSection(): string {
  return `## Tool Call Format (CRITICAL)

**ALWAYS use the native tool calling mechanism. NEVER output tool calls as text.**

When you need to call a tool:
1. Use the tool call interface provided by the system
2. Do NOT write tool calls as plain text like \`assistant to=functions.XXX\`
3. Do NOT output JSON directly in your text response
4. The system handles tool call formatting automatically

**CORRECT**: Invoke the tool through the tool call interface
**WRONG**: Writing \`assistant to=functions.todowrite\` or \`json\n{...}\` as text

Your tool calls are processed automatically. Just invoke the tool - do not format the call yourself.`
}

export function buildNonClaudePlannerSection(model: string): string {
  const isNonClaude = !model.toLowerCase().includes('claude')
  if (!isNonClaude) return ""

  return `### Plan Agent Dependency (Non-Claude)

Multi-step task? **ALWAYS consult Plan Agent first.** Do NOT start implementation without a plan.

- Single-file fix or trivial change → proceed directly
- Anything else (2+ steps, unclear scope, architecture) → \`task(subagent_type="plan", ...)\` FIRST
- Use \`session_id\` to resume the same Plan Agent — ask follow-up questions aggressively
- If ANY part of the task is ambiguous, ask Plan Agent before guessing

Plan Agent returns a structured work breakdown with parallel execution opportunities. Follow it.`
}

export function buildParallelDelegationSection(model: string, categories: AvailableCategory[]): string {
  const isNonClaude = !model.toLowerCase().includes('claude')
  const hasDelegationCategory = categories.some(c => c.name === 'deep' || c.name === 'unspecified-high')

  if (!isNonClaude || !hasDelegationCategory) return ""

  return `### DECOMPOSE AND DELEGATE — YOU ARE NOT AN IMPLEMENTER

**YOUR FAILURE MODE: You attempt to do work yourself instead of decomposing and delegating.** When you implement directly, the result is measurably worse than when specialized subagents do it. Subagents have domain-specific configurations, loaded skills, and tuned prompts that you lack.

**MANDATORY — for ANY implementation task:**

1. **ALWAYS decompose** the task into independent work units. No exceptions. Even if the task "feels small", decompose it.
2. **ALWAYS delegate** EACH unit to a \`deep\` or \`unspecified-high\` agent in parallel (\`run_in_background=true\`).
3. **NEVER work sequentially.** If 4 independent units exist, spawn 4 agents simultaneously. Not 1 at a time. Not 2 then 2.
4. **NEVER implement directly** when delegation is possible. You write prompts, not code.

**YOUR PROMPT TO EACH AGENT MUST INCLUDE:**
- GOAL with explicit success criteria (what "done" looks like)
- File paths and constraints (where to work, what not to touch)
- Existing patterns to follow (reference specific files the agent should read)
- Clear scope boundary (what is IN scope, what is OUT of scope)

**Vague delegation = failed delegation.** If your prompt to the subagent is shorter than 5 lines, it is too vague.

| You Want To Do | You MUST Do Instead |
|---|---|
| Write code yourself | Delegate to \`deep\` or \`unspecified-high\` agent |
| Handle 3 changes sequentially | Spawn 3 agents in parallel |
| "Quickly fix this one thing" | Still delegate — your "quick fix" is slower and worse than a subagent's |

**Your value is orchestration, decomposition, and quality control. Delegating with crystal-clear prompts IS your work.**`
}

export function buildUltraworkSection(
  agents: AvailableAgent[],
  categories: AvailableCategory[],
  skills: AvailableSkill[]
): string {
  const lines: string[] = []

  if (categories.length > 0) {
    lines.push("**Categories** (for implementation tasks):")
    for (const cat of categories) {
      const shortDesc = cat.description || cat.name
      lines.push(`- \`${cat.name}\`: ${shortDesc}`)
    }
    lines.push("")
  }

  if (skills.length > 0) {
    const builtinSkills = skills.filter((s) => s.location === "plugin")
    const customSkills = skills.filter((s) => s.location !== "plugin")

    if (builtinSkills.length > 0) {
      lines.push("**Built-in Skills** (combine with categories):")
      for (const skill of builtinSkills) {
        const shortDesc = skill.description.split(".")[0] || skill.description
        lines.push(`- \`${skill.name}\`: ${shortDesc}`)
      }
      lines.push("")
    }

    if (customSkills.length > 0) {
      lines.push("**User-Installed Skills** (HIGH PRIORITY - user installed these for their workflow):")
      for (const skill of customSkills) {
        const shortDesc = skill.description.split(".")[0] || skill.description
        lines.push(`- \`${skill.name}\`: ${shortDesc}`)
      }
      lines.push("")
    }
  }

  if (agents.length > 0) {
    const ultraworkAgentPriority = ["explore", "librarian", "plan", "oracle"]
    const sortedAgents = [...agents].sort((a, b) => {
      const aIdx = ultraworkAgentPriority.indexOf(a.name)
      const bIdx = ultraworkAgentPriority.indexOf(b.name)
      if (aIdx === -1 && bIdx === -1) return 0
      if (aIdx === -1) return 1
      if (bIdx === -1) return -1
      return aIdx - bIdx
    })

    lines.push("**Agents** (for specialized consultation/exploration):")
    for (const agent of sortedAgents) {
      const shortDesc = agent.description.length > 120 ? agent.description.slice(0, 120) + "..." : agent.description
      const suffix = agent.name === "explore" || agent.name === "librarian" ? " (multiple)" : ""
      lines.push(`- \`${agent.name}${suffix}\`: ${shortDesc}`)
    }
  }

  return lines.join("\n")
}

// Anti-duplication section for agent prompts
export function buildAntiDuplicationSection(): string {
  return `<Anti_Duplication>
## Anti-Duplication Rule (CRITICAL)

Once you delegate exploration to explore/librarian agents, **DO NOT perform the same search yourself**.

### What this means:

**FORBIDDEN:**
- After firing explore/librarian, manually grep/search for the same information
- Re-doing the research the agents were just tasked with
- "Just quickly checking" the same files the background agents are checking

**ALLOWED:**
- Continue with **non-overlapping work** — work that doesn't depend on the delegated research
- Work on unrelated parts of the codebase
- Preparation work (e.g., setting up files, configs) that can proceed independently

### Wait for Results Properly:

When you need the delegated results but they're not ready:

1. **End your response** — do NOT continue with work that depends on those results
2. **Wait for the completion notification** — the system will trigger your next turn
3. **Then** collect results via \`background_output(task_id="...")\`
4. **Do NOT** impatiently re-search the same topics while waiting

### Why This Matters:

- **Wasted tokens**: Duplicate exploration wastes your context budget
- **Confusion**: You might contradict the agent's findings
- **Efficiency**: The whole point of delegation is parallel throughput

### Example:

\`\`\`typescript
// WRONG: After delegating, re-doing the search
task(subagent_type="explore", run_in_background=true, ...)
// Then immediately grep for the same thing yourself — FORBIDDEN

// CORRECT: Continue non-overlapping work
task(subagent_type="explore", run_in_background=true, ...)
// Work on a different, unrelated file while they search
// End your response and wait for the notification
\`\`\`
</Anti_Duplication>`
}
