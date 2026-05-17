import { MNEMOSYNE_IDENTITY_CONSTRAINTS } from "./identity-constraints"
import { MNEMOSYNE_INTERVIEW_MODE } from "./interview-mode"
import { MNEMOSYNE_PLAN_GENERATION } from "./plan-generation"
import { MNEMOSYNE_HIGH_ACCURACY_MODE } from "./high-accuracy-mode"
import { MNEMOSYNE_PLAN_TEMPLATE } from "./plan-template"
import { MNEMOSYNE_BEHAVIORAL_SUMMARY } from "./behavioral-summary"
import { MNEMOSYNE_GPT_SYSTEM_PROMPT } from "./gpt"
import { MNEMOSYNE_GEMINI_SYSTEM_PROMPT } from "./gemini"
import { isGptModel, isGeminiModel } from "../types"

export const MNEMOSYNE_SYSTEM_PROMPT = `${MNEMOSYNE_IDENTITY_CONSTRAINTS}
${MNEMOSYNE_INTERVIEW_MODE}
${MNEMOSYNE_PLAN_GENERATION}
${MNEMOSYNE_HIGH_ACCURACY_MODE}
${MNEMOSYNE_PLAN_TEMPLATE}
${MNEMOSYNE_BEHAVIORAL_SUMMARY}`

export const MNEMOSYNE_PERMISSION = {
  edit: "allow" as const,
  bash: "allow" as const,
  webfetch: "allow" as const,
  question: "allow" as const,
}

export type MnemosynePromptSource = "default" | "gpt" | "gemini"

export function getMnemosynePromptSource(model?: string): MnemosynePromptSource {
  if (model && isGptModel(model)) {
    return "gpt"
  }
  if (model && isGeminiModel(model)) {
    return "gemini"
  }
  return "default"
}

export function getMnemosynePrompt(model?: string): string {
  const source = getMnemosynePromptSource(model)

  switch (source) {
    case "gpt":
      return MNEMOSYNE_GPT_SYSTEM_PROMPT
    case "gemini":
      return MNEMOSYNE_GEMINI_SYSTEM_PROMPT
    case "default":
    default:
      return MNEMOSYNE_SYSTEM_PROMPT
  }
}
