import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentOverrides } from "../types"
import type { CategoryConfig } from "../../config/schema"
import type { AvailableAgent, AvailableCategory, AvailableSkill } from "../dynamic-agent-prompt-builder"
import { AGENT_MODEL_REQUIREMENTS, isAnyFallbackModelAvailable } from "../../shared"
import { applyEnvironmentContext } from "./environment-context"
import { applyOverrides } from "./agent-overrides"
import { applyModelResolution, getFirstFallbackModel } from "./model-resolution"
import { createHeraclesAgent } from "../heracles"

export function maybeCreateHeraclesConfig(input: {
  disabledAgents: string[]
  agentOverrides: AgentOverrides
  uiSelectedModel?: string
  availableModels: Set<string>
  systemDefaultModel?: string
  isFirstRunNoCache: boolean
  availableAgents: AvailableAgent[]
  availableSkills: AvailableSkill[]
  availableCategories: AvailableCategory[]
  mergedCategories: Record<string, CategoryConfig>
  directory?: string
  useTaskSystem: boolean
  disableOmoEnv?: boolean
}): AgentConfig | undefined {
  const {
    disabledAgents,
    agentOverrides,
    uiSelectedModel,
    availableModels,
    systemDefaultModel,
    isFirstRunNoCache,
    availableAgents,
    availableSkills,
    availableCategories,
    mergedCategories,
    directory,
    useTaskSystem,
    disableOmoEnv = false,
  } = input

  const override = agentOverrides["heracles"]
  const requirement = AGENT_MODEL_REQUIREMENTS["heracles"]
  const hasExplicitConfig = override !== undefined
  const meetsAnyModelRequirement =
    !requirement?.requiresAnyModel ||
    hasExplicitConfig ||
    isFirstRunNoCache ||
    isAnyFallbackModelAvailable(requirement.fallbackChain, availableModels)

  if (disabledAgents.includes("heracles") || !meetsAnyModelRequirement) return undefined

  let resolution = applyModelResolution({
    uiSelectedModel: override?.model ? undefined : uiSelectedModel,
    userModel: override?.model,
    requirement,
    availableModels,
    systemDefaultModel,
  })

  if (isFirstRunNoCache && !override?.model && !uiSelectedModel) {
    resolution = getFirstFallbackModel(requirement)
  }

  if (!resolution) return undefined
  const { model, variant: resolvedVariant } = resolution

  let config = createHeraclesAgent(
    model,
    availableAgents,
    undefined,
    availableSkills,
    availableCategories,
    useTaskSystem,
  )

  if (resolvedVariant) {
    config = { ...config, variant: resolvedVariant }
  }

  config = applyOverrides(config, override, mergedCategories, directory)
  config = applyEnvironmentContext(config, directory, {
    disableOmoEnv,
  })

  return config
}
