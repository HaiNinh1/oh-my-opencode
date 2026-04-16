import { MNEMOSYNE_IDENTITY_CONSTRAINTS } from "./identity-constraints"
import { MNEMOSYNE_INTERVIEW_MODE } from "./interview-mode"
import { MNEMOSYNE_PLAN_GENERATION } from "./plan-generation"
import { MNEMOSYNE_HIGH_ACCURACY_MODE } from "./high-accuracy-mode"
import { MNEMOSYNE_PLAN_TEMPLATE } from "./plan-template"
import { MNEMOSYNE_BEHAVIORAL_SUMMARY } from "./behavioral-summary"

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
