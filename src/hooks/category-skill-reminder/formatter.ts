import type { AvailableSkill } from "../../agents/dynamic-agent-prompt-builder"

function formatSkillNames(skills: AvailableSkill[], limit: number): string {
  if (skills.length === 0) return "(none)"
  const shown = skills.slice(0, limit).map((s) => s.name)
  const remaining = skills.length - shown.length
  const suffix = remaining > 0 ? ` (+${remaining} more)` : ""
  return shown.join(", ") + suffix
}

export function buildReminderMessage(availableSkills: AvailableSkill[]): string {
  const builtinSkills = availableSkills.filter((s) => s.location === "plugin")
  const customSkills = availableSkills.filter((s) => s.location !== "plugin")

  const builtinText = formatSkillNames(builtinSkills, 8)
  const customText = formatSkillNames(customSkills, 8)

  return `\n[Explore/Librarian Reminder] You're doing search/exploration directly. Use \`parallel_tasks\` to dispatch multiple explore/librarian agents in parallel for guaranteed concurrent execution. Skills available — Built-in: ${builtinText} | Yours: ${customText}\n`
}
