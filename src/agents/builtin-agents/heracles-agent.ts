import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentOverrides } from "../types"
import type { CategoryConfig } from "../../config/schema"
import { AGENT_MODEL_REQUIREMENTS } from "../../shared"
import { applyOverrides } from "./agent-overrides"
import { applyModelResolution } from "./model-resolution"
import { createHeraclesAgent } from "../heracles"

export function maybeCreateHeraclesConfig(input: {
  disabledAgents: string[]
  agentOverrides: AgentOverrides
  availableModels: Set<string>
  systemDefaultModel?: string
  mergedCategories: Record<string, CategoryConfig>
  directory?: string
}): AgentConfig | undefined {
  const {
    disabledAgents,
    agentOverrides,
    availableModels,
    systemDefaultModel,
    mergedCategories,
    directory,
  } = input

  if (disabledAgents.includes("heracles")) return undefined

  const override = agentOverrides["heracles"]
  const requirement = AGENT_MODEL_REQUIREMENTS["heracles"]

  const resolution = applyModelResolution({
    userModel: override?.model,
    requirement,
    availableModels,
    systemDefaultModel,
  })

  if (!resolution) return undefined
  const { model, variant: resolvedVariant } = resolution

  let config = createHeraclesAgent(model)

  if (resolvedVariant) {
    config = { ...config, variant: resolvedVariant }
  }

  config = applyOverrides(config, override, mergedCategories, directory)

  return config
}
