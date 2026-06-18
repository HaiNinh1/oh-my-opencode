import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

export const PROJECT_MEMORY_FILE = "project-memory.md"

const DIRECTIVES_HEADING = "## Directives"
const NOTES_HEADING = "## Notes"

export type ProjectMemoryEntry = {
  text: string
  timestamp: string
}

export type ProjectMemory = {
  directives: ProjectMemoryEntry[]
  notes: ProjectMemoryEntry[]
}

function memoryPath(directory: string): string {
  return join(directory, ".omo", PROJECT_MEMORY_FILE)
}

export function serializeMemory(memory: ProjectMemory): string {
  const lines: string[] = ["# Project Memory", ""]
  lines.push(DIRECTIVES_HEADING, "")
  if (memory.directives.length === 0) {
    lines.push("_No directives yet._", "")
  } else {
    for (const entry of memory.directives) {
      lines.push(`- (${entry.timestamp}) ${entry.text}`)
    }
    lines.push("")
  }
  lines.push(NOTES_HEADING, "")
  if (memory.notes.length === 0) {
    lines.push("_No notes yet._", "")
  } else {
    for (const entry of memory.notes) {
      lines.push(`- (${entry.timestamp}) ${entry.text}`)
    }
    lines.push("")
  }
  return lines.join("\n")
}

export function parseMemory(raw: string): ProjectMemory {
  const directives: ProjectMemoryEntry[] = []
  const notes: ProjectMemoryEntry[] = []
  let section: "directives" | "notes" | null = null

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === DIRECTIVES_HEADING) {
      section = "directives"
      continue
    }
    if (trimmed === NOTES_HEADING) {
      section = "notes"
      continue
    }
    if (!section) continue
    if (!trimmed.startsWith("- ")) continue
    const item = trimmed.slice(2).trim()
    const match = item.match(/^\((.*?)\)\s*([\s\S]*)$/)
    const entry: ProjectMemoryEntry = match
      ? { timestamp: match[1].trim(), text: match[2].trim() }
      : { timestamp: "", text: item }
    if (section === "directives") directives.push(entry)
    else notes.push(entry)
  }

  return { directives, notes }
}

export async function readMemory(directory: string): Promise<ProjectMemory> {
  try {
    const raw = await readFile(memoryPath(directory), "utf8")
    return parseMemory(raw)
  } catch {
    return { directives: [], notes: [] }
  }
}

async function persistMemory(directory: string, memory: ProjectMemory): Promise<void> {
  const path = memoryPath(directory)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, serializeMemory(memory), "utf8")
}

export async function addDirective(directory: string, text: string): Promise<ProjectMemory> {
  const memory = await readMemory(directory)
  memory.directives.push({ text: text.trim(), timestamp: new Date().toISOString() })
  await persistMemory(directory, memory)
  return memory
}

export async function addNote(directory: string, text: string): Promise<ProjectMemory> {
  const memory = await readMemory(directory)
  memory.notes.push({ text: text.trim(), timestamp: new Date().toISOString() })
  await persistMemory(directory, memory)
  return memory
}

export async function writeMemory(directory: string, content: string): Promise<void> {
  const path = memoryPath(directory)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content.endsWith("\n") ? content : `${content}\n`, "utf8")
}

export async function readMemoryRaw(directory: string): Promise<string | null> {
  try {
    return await readFile(memoryPath(directory), "utf8")
  } catch {
    return null
  }
}

export function formatMemory(memory: ProjectMemory): string {
  const lines: string[] = []
  lines.push(`Directives (${memory.directives.length}):`)
  if (memory.directives.length === 0) {
    lines.push("  (none)")
  } else {
    for (const entry of memory.directives) {
      lines.push(`  - ${entry.text}${entry.timestamp ? ` [${entry.timestamp}]` : ""}`)
    }
  }
  lines.push(`Notes (${memory.notes.length}):`)
  if (memory.notes.length === 0) {
    lines.push("  (none)")
  } else {
    for (const entry of memory.notes) {
      lines.push(`  - ${entry.text}${entry.timestamp ? ` [${entry.timestamp}]` : ""}`)
    }
  }
  return lines.join("\n")
}
