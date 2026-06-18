import type { AgentConfig } from "@opencode-ai/sdk";
import { categorizeTools } from "../dynamic-agent-prompt-builder";
import type {
  AvailableAgent,
  AvailableCategory,
  AvailableSkill,
} from "../dynamic-agent-prompt-builder";
import { buildFallbackSisyphusPrompt } from "../sisyphus-dynamic-prompt";
import { buildClaudeFable5SisyphusPrompt } from "../sisyphus/claude-fable-5";
import { buildClaudeOpus47SisyphusPrompt } from "../sisyphus/claude-opus-4-7";
import { buildClaudeOpus48SisyphusPrompt } from "../sisyphus/claude-opus-4-8";
import { buildGpt54SisyphusPrompt } from "../sisyphus/gpt-5-4";
import { buildGpt55SisyphusPrompt } from "../sisyphus/gpt-5-5";
import { buildKimiK26SisyphusPrompt } from "../sisyphus/kimi-k2-6";
import { buildKimiK27SisyphusPrompt } from "../sisyphus/kimi-k2-7";
import { buildClaudeThinkingConfig } from "../types";
import type { AgentMode } from "../types";
import {
  isClaudeFable5Model,
  isClaudeOpus47Model,
  isClaudeOpus48Model,
  isGpt5_5Model,
  isGptModel,
  isGptNativeSisyphusModel,
  isKimiK2Model,
  isKimiK27Model,
} from "../types";
import { getFrontierToolSchemaPermission } from "../frontier-tool-schema-guard";

const MODE: AgentMode = "primary";
const HERACLES_COLOR = "#fc1414";

const HERACLES_EXECUTION_CONTRACT = `
<heracles_execution_contract>
You are Heracles, the direct sequential plan executor. This contract overrides any conflicting default above.

- A saved \`.omo/plans/*.md\` is the SOURCE OF TRUTH. Execute its tasks yourself, in order.
- Do NOT re-plan. Do NOT delegate the implementation. Do NOT stop to re-litigate plan decisions.
- Research only via quick lookups (explore/librarian, direct reads) when a task genuinely needs context — never as a reason to pause or hand off implementation.
- Verify each task as you finish it, then move to the next. The plan is done when every task is done.
</heracles_execution_contract>`;

function withHeraclesContract(prompt: string): string {
  return `${prompt}\n${HERACLES_EXECUTION_CONTRACT}`;
}

const HERACLES_DESCRIPTION =
  "Direct sequential plan executor. Reads a saved Prometheus plan and implements every task itself, in order, without delegating implementation work. Uses explore/librarian only for quick research. Routed by /execute-plan. (Heracles - OhMyOpenCode)";

function buildHeraclesPermission(model: string): AgentConfig["permission"] {
  return {
    question: "allow",
    call_omo_agent: "deny",
    ...getFrontierToolSchemaPermission(model),
  } as AgentConfig["permission"];
}

function buildBaseHeraclesAgentConfig(
  model: string,
  prompt: string,
): AgentConfig {
  return {
    description: HERACLES_DESCRIPTION,
    mode: MODE,
    model,
    maxTokens: 64000,
    prompt,
    color: HERACLES_COLOR,
    permission: buildHeraclesPermission(model),
  };
}

function buildGptHeraclesAgentConfig(model: string, prompt: string): AgentConfig {
  return {
    ...buildBaseHeraclesAgentConfig(model, prompt),
    reasoningEffort: "medium",
  };
}

function buildClaudeHeraclesAgentConfig(model: string, prompt: string): AgentConfig {
  return {
    ...buildBaseHeraclesAgentConfig(model, prompt),
    ...buildClaudeThinkingConfig(model),
  };
}

/**
 * Heracles agent — direct sequential executor for saved plans.
 *
 * Shares the Sisyphus prompt corpus (same engineering discipline and
 * model-specific tuning) but is surfaced as its own agent so the
 * `/execute-plan` command can route saved `.omo/plans/*.md` plans to a
 * single agent that implements every task itself instead of delegating.
 * The "execute everything yourself, no delegation" contract is carried by
 * the execute-plan command template + hook context injection.
 */
export function createHeraclesAgent(
  model: string,
  availableAgents?: AvailableAgent[],
  availableToolNames?: string[],
  availableSkills?: AvailableSkill[],
  availableCategories?: AvailableCategory[],
  useTaskSystem = false,
): AgentConfig {
  const tools = availableToolNames ? categorizeTools(availableToolNames) : [];
  const skills = availableSkills ?? [];
  const categories = availableCategories ?? [];
  const agents = availableAgents ?? [];

  if (isKimiK27Model(model)) {
    return buildGptHeraclesAgentConfig(
      model,
      withHeraclesContract(buildKimiK27SisyphusPrompt(model, agents, tools, skills, categories, useTaskSystem)),
    );
  }

  if (isKimiK2Model(model)) {
    return buildGptHeraclesAgentConfig(
      model,
      withHeraclesContract(buildKimiK26SisyphusPrompt(model, agents, tools, skills, categories, useTaskSystem)),
    );
  }

  if (isGpt5_5Model(model)) {
    return buildGptHeraclesAgentConfig(
      model,
      withHeraclesContract(buildGpt55SisyphusPrompt(model, agents, tools, skills, categories, useTaskSystem)),
    );
  }

  if (isGptNativeSisyphusModel(model)) {
    return buildGptHeraclesAgentConfig(
      model,
      withHeraclesContract(buildGpt54SisyphusPrompt(model, agents, tools, skills, categories, useTaskSystem)),
    );
  }

  if (isClaudeFable5Model(model)) {
    return buildClaudeHeraclesAgentConfig(
      model,
      withHeraclesContract(buildClaudeFable5SisyphusPrompt(model, agents, tools, skills, categories, useTaskSystem)),
    );
  }

  if (isClaudeOpus48Model(model)) {
    return buildClaudeHeraclesAgentConfig(
      model,
      withHeraclesContract(buildClaudeOpus48SisyphusPrompt(model, agents, tools, skills, categories, useTaskSystem)),
    );
  }

  if (isClaudeOpus47Model(model)) {
    return buildClaudeHeraclesAgentConfig(
      model,
      withHeraclesContract(buildClaudeOpus47SisyphusPrompt(model, agents, tools, skills, categories, useTaskSystem)),
    );
  }

  const prompt = withHeraclesContract(buildFallbackSisyphusPrompt(
    model,
    agents,
    tools,
    skills,
    categories,
    useTaskSystem,
  ));

  if (isGptModel(model)) {
    return buildGptHeraclesAgentConfig(model, prompt);
  }

  return buildClaudeHeraclesAgentConfig(model, prompt);
}
createHeraclesAgent.mode = MODE;
