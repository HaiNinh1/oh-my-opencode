const START_WORK_MARKER = "You are starting a Sisyphus work session."
const EXECUTE_PLAN_MARKER = "You are starting a Heracles direct execution session."

export function getPlanCommandPromptText(parts: Array<{ type: string; text?: string }>): string {
  return parts
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join("\n")
    .trim()
}

export function isStartWorkCommandPrompt(promptText: string): boolean {
  return promptText.includes(START_WORK_MARKER) && promptText.includes("`/start-work")
}

export function isExecutePlanCommandPrompt(promptText: string): boolean {
  return promptText.includes(EXECUTE_PLAN_MARKER) && promptText.includes("`/execute-plan")
}
