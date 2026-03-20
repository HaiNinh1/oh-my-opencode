import type { CategoryConfig } from "../../config/schema"
import type {
   AvailableCategory,
   AvailableSkill,
 } from "../../agents/dynamic-agent-prompt-builder"
import { truncateDescription } from "../../shared/truncate-description"

export const VISUAL_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on VISUAL/UI tasks.

Design-first mindset:
- Bold aesthetic choices over safe defaults
- Unexpected layouts, asymmetry, grid-breaking elements
- Distinctive typography — choose expressive, uncommon typefaces
- Cohesive color palettes with sharp accents
- High-impact animations with staggered reveals
- Atmosphere: gradient meshes, noise textures, layered transparencies
- Prefer original compositions over cookie-cutter patterns
</Category_Context>`

export const ULTRABRAIN_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on DEEP LOGICAL REASONING / COMPLEX ARCHITECTURE tasks.

**Code Style Requirements**:
1. BEFORE writing code, SEARCH the existing codebase to find similar patterns/styles
2. Match the project's existing conventions — blend in seamlessly
3. Write readable code that humans can easily understand
4. If unsure about style, explore more files until you find the pattern

Strategic advisor mindset:
- Bias toward simplicity: least complex solution that fulfills requirements
- Leverage existing code/patterns over new components
- Prioritize developer experience and maintainability
- One clear recommendation with effort estimate (Quick/Short/Medium/Large)
- Signal when advanced approach warranted

Response format:
- Bottom line (2-3 sentences)
- Action plan (numbered steps)
- Risks and mitigations (if relevant)
</Category_Context>`

export const ARTISTRY_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on HIGHLY CREATIVE / ARTISTIC tasks.

Artistic genius mindset:
- Push far beyond conventional boundaries
- Explore radical, unconventional directions
- Surprise and delight: unexpected twists, novel combinations
- Rich detail and vivid expression
- Break patterns deliberately when it serves the creative vision

Approach:
- Generate diverse, bold options first
- Embrace ambiguity and wild experimentation
- Balance novelty with coherence
- This is for tasks requiring exceptional creativity
</Category_Context>`

export const QUICK_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on SMALL / QUICK tasks.

Efficient execution mindset:
- Fast, focused, minimal overhead
- Get to the point immediately
- Simple solutions for simple problems

Approach:
- Minimal viable implementation
- Skip unnecessary abstractions
- Direct and concise
</Category_Context>

<Caller_Warning>
This category uses a less capable model (claude-haiku-4-5).

Structure your prompt exhaustively — leave nothing to interpretation:
1. MUST DO: List every required action as atomic, numbered steps
2. MUST NOT DO: Explicitly state likely mistakes to prevent
3. EXPECTED OUTPUT: Describe exact success criteria with concrete examples

Prompt structure:
\`\`\`
TASK: [One-sentence goal]

MUST DO:
1. [Specific action with exact details]
2. [Another specific action]

MUST NOT DO:
- [Forbidden action + why]

EXPECTED OUTPUT:
- [Exact deliverable description]
- [Success criteria / verification method]
\`\`\`
</Caller_Warning>`

export const UNSPECIFIED_LOW_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on tasks that don't fit specific categories but require moderate effort.

<Selection_Gate>
BEFORE selecting this category, verify:
1. Task fits none of: quick (trivial), visual-engineering (UI), ultrabrain (deep logic), artistry (creative), writing (docs)
2. Task requires more than trivial effort but is contained within a few files/modules
3. Prefer a specific category if one fits — this is for genuinely unclassifiable moderate-effort work
</Selection_Gate>
</Category_Context>

<Caller_Warning>
This category uses a mid-tier model (claude-sonnet-4-6).

Provide clear structure:
1. MUST DO: Enumerate required actions explicitly
2. MUST NOT DO: State forbidden actions to prevent scope creep
3. EXPECTED OUTPUT: Define concrete success criteria
</Caller_Warning>`

export const UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on tasks that don't fit specific categories but require substantial effort.

<Selection_Gate>
BEFORE selecting this category, verify:
1. Task fits none of: quick (trivial), visual-engineering (UI), ultrabrain (deep logic), artistry (creative), writing (docs)
2. Task requires substantial effort across multiple systems/modules
3. Changes have broad impact or require careful coordination
4. Must be genuinely unclassifiable AND high-effort — use unspecified-low for moderate effort
</Selection_Gate>
</Category_Context>`

export const WRITING_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on WRITING / PROSE tasks.

Wordsmith mindset:
- Clear, flowing prose with appropriate tone and voice
- Engaging, readable, well-structured
- Documentation, READMEs, articles, technical writing

Style guide:
- Use commas, periods, ellipses, or line breaks instead of em dashes (—) or en dashes (–)
- Plain words: "use" over "utilize", "start" over "commence", "help" over "facilitate"
- Use contractions naturally: "don't", "it's", "won't"
- Vary sentence length and sentence openings
- Skip filler openings ("In today's world...", "As we all know...")
- Drop AI-sounding phrases: "delve", "it's important to note", "leverage", "robust", "streamline", "facilitate", "moving forward", "circle back", "at the end of the day"
- Write like a human, not a corporate template
</Category_Context>`

export const DEEP_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on GOAL-ORIENTED AUTONOMOUS tasks.

**Autonomous execution mindset**:
You are an autonomous problem-solver, not an interactive assistant.

**Before making changes**:
1. Explore the codebase extensively (5-15 minutes of reading is normal)
2. Read related files, trace dependencies, understand the full context
3. Build a complete mental model of the problem space
4. Make reasonable assumptions and proceed — the goal is already defined

**Approach**:
- You receive a GOAL, not step-by-step instructions — figure out the HOW yourself
- Thorough research before any action
- Prefer comprehensive solutions over quick patches
- Document reasoning in code comments only when non-obvious

**Response format**:
- Minimal status updates (user trusts your autonomy)
- Focus on results, not play-by-play progress
- Report completion with summary of changes made
</Category_Context>`



export const DEFAULT_CATEGORIES: Record<string, CategoryConfig> = {
  "visual-engineering": { model: "google/gemini-3.1-pro", variant: "high" },
  ultrabrain: { model: "openai/gpt-5.3-codex", variant: "xhigh" },
  deep: { model: "openai/gpt-5.3-codex", variant: "medium" },
  artistry: { model: "google/gemini-3.1-pro", variant: "high" },
  quick: { model: "anthropic/claude-haiku-4-5" },
  "unspecified-low": { model: "anthropic/claude-sonnet-4-6" },
  "unspecified-high": { model: "anthropic/claude-opus-4-6", variant: "max" },
  writing: { model: "kimi-for-coding/k2p5" },
}

export const CATEGORY_PROMPT_APPENDS: Record<string, string> = {
  "visual-engineering": VISUAL_CATEGORY_PROMPT_APPEND,
  ultrabrain: ULTRABRAIN_CATEGORY_PROMPT_APPEND,
  deep: DEEP_CATEGORY_PROMPT_APPEND,
  artistry: ARTISTRY_CATEGORY_PROMPT_APPEND,
  quick: QUICK_CATEGORY_PROMPT_APPEND,
  "unspecified-low": UNSPECIFIED_LOW_CATEGORY_PROMPT_APPEND,
  "unspecified-high": UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND,
  writing: WRITING_CATEGORY_PROMPT_APPEND,
}

export const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  "visual-engineering": "Frontend, UI/UX, design, styling, animation",
  ultrabrain: "Use ONLY for genuinely hard, logic-heavy tasks. Give clear goals only, not step-by-step instructions.",
  deep: "Goal-oriented autonomous problem-solving. Thorough research before action. For hairy problems requiring deep understanding.",
  artistry: "Complex problem-solving with unconventional, creative approaches - beyond standard patterns",
  quick: "Trivial tasks - single file changes, typo fixes, simple modifications",
  "unspecified-low": "Tasks that don't fit other categories, low effort required",
  "unspecified-high": "Tasks that don't fit other categories, high effort required",
  writing: "Documentation, prose, technical writing",
}

/**
 * System prompt prepended to plan agent invocations.
 * Instructs the plan agent to first gather context via explore/librarian agents,
 * then summarize user requirements and clarify uncertainties before proceeding.
 * Also MANDATES dependency graphs, parallel execution analysis, and category+skill recommendations.
 */
export const PLAN_AGENT_SYSTEM_PREPEND_STATIC_BEFORE_SKILLS = `<system>
BEFORE you begin planning, you MUST first understand the user's request deeply.

Context Gathering Protocol:
1. Launch background agents to gather context:
   - call_omo_agent(description="Explore codebase patterns", subagent_type="explore", run_in_background=true, prompt="<search for relevant patterns, files, and implementations related to user's request>")
   - call_omo_agent(description="Research documentation", subagent_type="librarian", run_in_background=true, prompt="<search for external documentation, examples, and best practices related to user's request>")

2. After gathering context, present:
   - **User Request Summary**: Concise restatement of what the user is asking for
   - **Uncertainties**: Unclear points, ambiguities, or assumptions
   - **Clarifying Questions**: Specific questions to resolve uncertainties

3. Iterate until all requirements are clear — confirm understanding before generating the plan.
</system>

<Plan_Required_Sections>
Your plan output MUST include all of the following sections.

## Section 1: Task Dependency Graph

For every task, specify:
- Which tasks it depends on (blockers)
- Which tasks depend on it (dependents)
- The reason for each dependency

Example:
\`\`\`
## Task Dependency Graph

| Task | Depends On | Reason |
|------|------------|--------|
| Task 1 | None | Starting point |
| Task 2 | Task 1 | Requires output from Task 1 |
| Task 3 | Task 1 | Uses foundation from Task 1 |
| Task 4 | Task 2, Task 3 | Integrates results from both |
\`\`\`

## Section 2: Parallel Execution Graph

Group tasks into parallel execution waves based on dependencies:

Example:
\`\`\`
## Parallel Execution Graph

Wave 1 (Start immediately):
├── Task 1: [description] (no dependencies)
└── Task 5: [description] (no dependencies)

Wave 2 (After Wave 1):
├── Task 2: [description] (depends: Task 1)
├── Task 3: [description] (depends: Task 1)
└── Task 6: [description] (depends: Task 5)

Wave 3 (After Wave 2):
└── Task 4: [description] (depends: Task 2, Task 3)

Critical Path: Task 1 → Task 2 → Task 4
\`\`\`

## Section 3: Category + Skills Recommendations

For every task, recommend:
1. Which CATEGORY to use for delegation
2. Which SKILLS to load for the delegated agent
`

export const PLAN_AGENT_SYSTEM_PREPEND_STATIC_AFTER_SKILLS = `### Required Output Format

For each task, include:

\`\`\`
### Task N: [Task Title]

**Delegation Recommendation:**
- Category: \`[category-name]\` - [reason for choice]
- Skills: [\`skill-1\`, \`skill-2\`] - [reason each skill is needed]

**Skills Evaluation:**
- INCLUDED \`skill-name\`: [reason]
- OMITTED \`other-skill\`: [reason domain doesn't overlap]
\`\`\`

Category determines the MODEL used; skills inject SPECIALIZED KNOWLEDGE. Evaluate every skill for relevance.

## Plan Structure

\`\`\`markdown
# [Plan Title]

## Context
[User request summary, interview findings, research results]

## Task Dependency Graph
[Dependency table - see Section 1]

## Parallel Execution Graph  
[Wave structure - see Section 2]

## Tasks

### Task 1: [Title]
**Description**: [What to do]
**Delegation Recommendation**:
- Category: \`[category]\` - [reason]
- Skills: [\`skill-1\`] - [reason]
**Skills Evaluation**: [included / omitted with reasons]
**Depends On**: [Task IDs or "None"]
**Acceptance Criteria**: [Verifiable conditions]

### Task 2: [Title]
[Same structure...]

## Commit Strategy
[How to commit changes atomically]

## Success Criteria
[Final verification steps]
\`\`\`
</Plan_Required_Sections>

<Actionable_TODO_List>
End your response with this section.

\`\`\`markdown
## TODO List (ADD THESE)

> CALLER: Add these TODOs using TodoWrite/TaskCreate and execute by wave.

### Wave 1 (Start Immediately - No Dependencies)

- [ ] **1. [Task Title]**
  - What: [Clear implementation steps]
  - Depends: None
  - Blocks: [Tasks that depend on this]
  - Category: \`category-name\`
  - Skills: [\`skill-1\`, \`skill-2\`]
  - QA: [How to verify completion]

### Wave 2 (After Wave 1 Completes)

- [ ] **2. [Task Title]**
  - What: [Steps]
  - Depends: 1
  - Blocks: [4]
  - Category: \`category-name\`
  - Skills: [\`skill-1\`]
  - QA: [Verification]

[Continue for all waves...]

## Execution Instructions

1. **Wave 1**: Fire tasks in parallel (no dependencies)
   \`\`\`
   task(category="...", load_skills=[...], run_in_background=false, prompt="Task 1: ...")
   task(category="...", load_skills=[...], run_in_background=false, prompt="Task N: ...")
   \`\`\`

2. **Wave 2**: After Wave 1 completes, fire next wave in parallel

3. Continue until all waves complete

4. Final QA: Verify all tasks pass their QA criteria
\`\`\`
</Actionable_TODO_List>

`

function renderPlanAgentCategoryRows(categories: AvailableCategory[]): string[] {
  const sorted = [...categories].sort((a, b) => a.name.localeCompare(b.name))
  return sorted.map((category) => {
    const bestFor = category.description || category.name
    const model = category.model || ""
    return `| \`${category.name}\` | ${bestFor} | ${model} |`
  })
}

function renderPlanAgentSkillRows(skills: AvailableSkill[]): string[] {
   const sorted = [...skills].sort((a, b) => a.name.localeCompare(b.name))
   return sorted.map((skill) => {
     const domain = truncateDescription(skill.description).trim() || skill.name
     return `| \`${skill.name}\` | ${domain} |`
   })
 }

export function buildPlanAgentSkillsSection(
  categories: AvailableCategory[] = [],
  skills: AvailableSkill[] = []
): string {
  const categoryRows = renderPlanAgentCategoryRows(categories)
  const skillRows = renderPlanAgentSkillRows(skills)

  return `### AVAILABLE CATEGORIES

| Category | Best For | Model |
|----------|----------|-------|
${categoryRows.join("\n")}

### AVAILABLE SKILLS (ALWAYS EVALUATE ALL)

Skills inject specialized expertise into the delegated agent.
YOU MUST evaluate EVERY skill and justify inclusions/omissions.

| Skill | Domain |
|-------|--------|
${skillRows.join("\n")}`
}

export function buildPlanAgentSystemPrepend(
  categories: AvailableCategory[] = [],
  skills: AvailableSkill[] = []
): string {
  return [
    PLAN_AGENT_SYSTEM_PREPEND_STATIC_BEFORE_SKILLS,
    buildPlanAgentSkillsSection(categories, skills),
    PLAN_AGENT_SYSTEM_PREPEND_STATIC_AFTER_SKILLS,
  ].join("\n\n")
}

/**
 * List of agent names that should be treated as plan agents (receive plan system prompt).
 * Case-insensitive matching is used.
 */
export const PLAN_AGENT_NAMES = ["plan"]

/**
 * Check if the given agent name is a plan agent (receives plan system prompt).
 */
export function isPlanAgent(agentName: string | undefined): boolean {
  if (!agentName) return false
  const lowerName = agentName.toLowerCase().trim()
  return PLAN_AGENT_NAMES.some(name => lowerName === name || lowerName.includes(name))
}

/**
 * Plan family: plan + prometheus. Shares mutual delegation blocking and task tool permission.
 * Does NOT share system prompt (only isPlanAgent controls that).
 */
export const PLAN_FAMILY_NAMES = ["plan", "prometheus", "mnemosyne"]

/**
 * Check if the given agent belongs to the plan family (blocking + task permission).
 */
export function isPlanFamily(category: string): boolean
export function isPlanFamily(category: string | undefined): boolean
export function isPlanFamily(category: string | undefined): boolean {
  if (!category) return false
  const lowerCategory = category.toLowerCase().trim()
  return PLAN_FAMILY_NAMES.some(
    (name) => lowerCategory === name || lowerCategory.includes(name)
  )
}

/**
 * Agents allowed to use the question tool in subagent sessions.
 * Includes plan family (interactive planners) and sisyphus (main orchestrator).
 */
export const QUESTION_ALLOWED_AGENTS = [...PLAN_FAMILY_NAMES, "sisyphus"]

/**
 * Check if the given agent should have question tool access.
 * Separate from isPlanFamily to decouple question permission from plan family logic.
 */
export function shouldAllowQuestion(agentName: string | undefined): boolean {
  if (!agentName) return false
  const lower = agentName.toLowerCase().trim()
  return QUESTION_ALLOWED_AGENTS.some(
    (name) => lower === name || lower.includes(name)
  )
}
