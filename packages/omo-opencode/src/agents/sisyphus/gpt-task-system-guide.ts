export function buildTaskSystemGuide(useTaskSystem: boolean): string {
  if (useTaskSystem) {
    return `Create tasks before any multi-step work (2+ steps, or several separate items from the user); the task list is your plan. Skip them for single, trivial changes. Keep each item a short imperative phrase naming the concrete change.

Workflow:
1. On receiving a request for implementation the user explicitly asked for, call \`task_create\` with one item per meaningful step.
2. Before each step, call \`task_update(status="in_progress")\`. One step in progress at a time.
3. After each step, call \`task_update(status="completed")\` immediately. Never batch completions.
4. If scope changes, update the task list before proceeding.

Your task creations are tracked by the harness; the system will nudge you if you go idle with open tasks.`
  }

  return `Create todos before any multi-step work (2+ steps, or several separate items from the user); the todo list is your plan. Skip them for single, trivial changes. Keep each item a short imperative phrase naming the concrete change.

Workflow:
1. On receiving a request for implementation the user explicitly asked for, call \`todowrite\` with one item per meaningful step.
2. Before each step, mark the item \`in_progress\`. One step in progress at a time.
3. After each step, mark it \`completed\` immediately. Never batch completions.
4. If scope changes, update the todo list before proceeding.

Your todo creations are tracked by the harness; the system will nudge you if you go idle with open items.`
}
