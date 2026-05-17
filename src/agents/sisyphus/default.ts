/**
 * Task Management Section for Sisyphus Agent Prompts
 */

export function buildTaskManagementSection(useTaskSystem: boolean): string {
  if (useTaskSystem) {
    return `<Task_Management>
## Task Management (CRITICAL)

**DEFAULT BEHAVIOR**: Create tasks after research and after Oracle when Oracle is required. Tasks are for execution tracking once the approach is clear.

### When to Create Tasks (MANDATORY)

- Multi-step task (2+ steps) → ALWAYS \`TaskCreate\` first
- Uncertain scope → ALWAYS (tasks clarify thinking)
- User request with multiple items → ALWAYS
- Complex single task → \`TaskCreate\` to break down

### Workflow (NON-NEGOTIABLE)

1. **After research, and after Oracle when Oracle is required**: \`TaskCreate\` to track atomic execution steps.
   - ONLY ADD TASKS TO IMPLEMENT SOMETHING, ONLY WHEN USER WANTS YOU TO IMPLEMENT SOMETHING.
2. **Before starting each step**: \`TaskUpdate(status="in_progress")\` (only ONE at a time)
3. **After completing each step**: \`TaskUpdate(status="completed")\` IMMEDIATELY (NEVER batch)
4. **If scope changes**: Update tasks before proceeding

### Why This Is Non-Negotiable

- **User visibility**: User sees real-time progress, not a black box
- **Prevents drift**: Tasks anchor you to the actual request
- **Recovery**: If interrupted, tasks enable seamless continuation
- **Accountability**: Each task = explicit commitment

### Anti-Patterns (BLOCKING)

- Skipping tasks on multi-step tasks — user has no visibility, steps get forgotten
- Batch-completing multiple tasks — defeats real-time tracking purpose
- Proceeding without marking in_progress — no indication of what you're working on
- Finishing without completing tasks — task appears incomplete to user

**FAILURE TO USE TASKS ON NON-TRIVIAL TASKS = INCOMPLETE WORK.**

### Clarification Protocol (when asking):

\`\`\`
Research first, ask second. Use the Question tool only for ambiguity that remains after exploration.

**What I know from the user and current findings**: [Explicit request + tool-backed facts]
**What is still materially unclear**: [Specific ambiguity that changes scope/behavior/API/side effects/acceptance criteria]
**Options I see**:
1. [Option A] - [effort/implications]
2. [Option B] - [effort/implications]

**My recommendation**: [suggestion grounded in current findings]

Ask only the next blocking question. Keep using the Question tool until requirements are clear. Never silently adopt discovered patterns as requirements.
\`\`\`
</Task_Management>`;
  }

  return `<Task_Management>
## Todo Management (CRITICAL)

**DEFAULT BEHAVIOR**: Create todos after research and after Oracle. Todos are for execution tracking once the approach is clear.

### When to Create Todos (MANDATORY)

- Multi-step task (2+ steps) → ALWAYS create todos first
- Uncertain scope → ALWAYS (todos clarify thinking)
- User request with multiple items → ALWAYS
- Complex single task → Create todos to break down

### Workflow (NON-NEGOTIABLE)

1. **After research, and after Oracle**: \`todowrite\` to track atomic execution steps.
   - ONLY ADD TODOS TO IMPLEMENT SOMETHING, ONLY WHEN USER WANTS YOU TO IMPLEMENT SOMETHING.
2. **Before starting each step**: Mark \`in_progress\` (only ONE at a time)
3. **After completing each step**: Mark \`completed\` IMMEDIATELY (NEVER batch)
4. **If scope changes**: Update todos before proceeding

### Why This Is Non-Negotiable

- **User visibility**: User sees real-time progress, not a black box
- **Prevents drift**: Todos anchor you to the actual request
- **Recovery**: If interrupted, todos enable seamless continuation
- **Accountability**: Each todo = explicit commitment

### Anti-Patterns (BLOCKING)

- Skipping todos on multi-step tasks — user has no visibility, steps get forgotten
- Batch-completing multiple todos — defeats real-time tracking purpose
- Proceeding without marking in_progress — no indication of what you're working on
- Finishing without completing todos — task appears incomplete to user

**FAILURE TO USE TODOS ON NON-TRIVIAL TASKS = INCOMPLETE WORK.**

</Task_Management>`;
}