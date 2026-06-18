export const PROJECT_MEMORY_ADD_NOTE_DESCRIPTION = `Append a durable NOTE to project memory.

Notes capture facts and decisions (e.g. "the API base URL lives in config/env.ts").
Stored under .omo/project-memory.md and persists across sessions.

Arguments:
- text (required): The note to record.`

export const PROJECT_MEMORY_ADD_DIRECTIVE_DESCRIPTION = `Append a standing DIRECTIVE to project memory.

Directives are standing rules the agent must follow (e.g. "always run the linter before
committing"). Stored under .omo/project-memory.md and persists across sessions.

Arguments:
- text (required): The directive/rule to record.`

export const PROJECT_MEMORY_READ_DESCRIPTION = `Read all project memory — both directives (standing rules) and notes (facts/decisions).`

export const PROJECT_MEMORY_WRITE_DESCRIPTION = `Overwrite the entire project memory file with the provided markdown content.

Use sparingly — for pruning or restructuring. Prefer project_memory_add_note /
project_memory_add_directive for incremental updates.

Arguments:
- content (required): Full markdown content to store as the new project memory.`
