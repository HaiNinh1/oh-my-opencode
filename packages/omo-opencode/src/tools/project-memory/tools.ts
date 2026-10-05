import type { PluginInput } from "@opencode-ai/plugin"
import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import {
  PROJECT_MEMORY_ADD_DIRECTIVE_DESCRIPTION,
  PROJECT_MEMORY_ADD_NOTE_DESCRIPTION,
  PROJECT_MEMORY_READ_DESCRIPTION,
  PROJECT_MEMORY_WRITE_DESCRIPTION,
} from "./constants"
import { addDirective, addNote, formatMemory, readMemory, writeMemory } from "./storage"

export function createProjectMemoryTools(ctx: PluginInput): Record<string, ToolDefinition> {
  const project_memory_add_note: ToolDefinition = tool({
    description: PROJECT_MEMORY_ADD_NOTE_DESCRIPTION,
    args: {
      text: tool.schema.string().describe("The note (fact/decision) to record"),
    },
    execute: async (args, _context) => {
      try {
        const memory = await addNote(ctx.directory, args.text)
        return `Note added. Project memory now has ${memory.notes.length} note(s) and ${memory.directives.length} directive(s).`
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  const project_memory_add_directive: ToolDefinition = tool({
    description: PROJECT_MEMORY_ADD_DIRECTIVE_DESCRIPTION,
    args: {
      text: tool.schema.string().describe("The directive (standing rule) to record"),
    },
    execute: async (args, _context) => {
      try {
        const memory = await addDirective(ctx.directory, args.text)
        return `Directive added. Project memory now has ${memory.directives.length} directive(s) and ${memory.notes.length} note(s).`
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  const project_memory_read: ToolDefinition = tool({
    description: PROJECT_MEMORY_READ_DESCRIPTION,
    args: {},
    execute: async (_args, _context) => {
      try {
        const memory = await readMemory(ctx.directory)
        if (memory.directives.length === 0 && memory.notes.length === 0) {
          return "Project memory is empty."
        }
        return formatMemory(memory)
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  const project_memory_write: ToolDefinition = tool({
    description: PROJECT_MEMORY_WRITE_DESCRIPTION,
    args: {
      content: tool.schema.string().describe("Full markdown content to store as the new project memory"),
    },
    execute: async (args, _context) => {
      try {
        await writeMemory(ctx.directory, args.content)
        return "Project memory overwritten."
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  return {
    project_memory_add_note,
    project_memory_add_directive,
    project_memory_read,
    project_memory_write,
  }
}
