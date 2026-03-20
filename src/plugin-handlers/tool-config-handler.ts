import type { OhMyOpenCodeConfig } from "../config";
import { getAgentDisplayName } from "../shared/agent-display-names";

type AgentWithPermission = { permission?: Record<string, unknown> };

function getConfigQuestionPermission(): string | null {
  const configContent = process.env.OPENCODE_CONFIG_CONTENT;
  if (!configContent) return null;
  try {
    const parsed = JSON.parse(configContent);
    return parsed?.permission?.question ?? null;
  } catch {
    return null;
  }
}

function agentByKey(agentResult: Record<string, unknown>, key: string): AgentWithPermission | undefined {
  return (agentResult[key] ?? agentResult[getAgentDisplayName(key)]) as
    | AgentWithPermission
    | undefined;
}

export function applyToolConfig(params: {
  config: Record<string, unknown>;
  pluginConfig: OhMyOpenCodeConfig;
  agentResult: Record<string, unknown>;
}): void {
  const denyTodoTools = params.pluginConfig.experimental?.task_system
    ? { todowrite: "deny", todoread: "deny" }
    : {}

  const denyHermesOnlyTools = {
    get_agent_prompts: "deny",
    resolve_atlas_context: "deny",
    resolve_heracles_context: "deny",
  }

  params.config.tools = {
    ...(params.config.tools as Record<string, unknown>),
    "grep_app_*": false,
    LspHover: false,
    LspCodeActions: false,
    LspCodeActionResolve: false,
    "task_*": false,
    teammate: false,
    ...(params.pluginConfig.experimental?.task_system
      ? { todowrite: false, todoread: false }
      : {}),
  };

  const isCliRunMode = process.env.OPENCODE_CLI_RUN_MODE === "true";
  const configQuestionPermission = getConfigQuestionPermission();
  const questionPermission =
    configQuestionPermission === "deny" ? "deny" :
    isCliRunMode ? "deny" :
    "allow";

  const librarian = agentByKey(params.agentResult, "librarian");
  if (librarian) {
    librarian.permission = { ...librarian.permission, "grep_app_*": "allow" };
  }
  const looker = agentByKey(params.agentResult, "multimodal-looker");
  if (looker) {
    looker.permission = { ...looker.permission, task: "deny", look_at: "deny" };
  }
  const atlas = agentByKey(params.agentResult, "atlas");
  if (atlas) {
    atlas.permission = {
      ...atlas.permission,
      task: "allow",
      call_omo_agent: "deny",
      "task_*": "allow",
      teammate: "allow",
      ...denyHermesOnlyTools,
      ...denyTodoTools,
    };
  }
  const sisyphus = agentByKey(params.agentResult, "sisyphus");
  if (sisyphus) {
    sisyphus.permission = {
      ...sisyphus.permission,
      call_omo_agent: "deny",
      task: "allow",
      question: questionPermission,
      "task_*": "allow",
      teammate: "allow",
      ...denyHermesOnlyTools,
      ...denyTodoTools,
    };
  }
  const hephaestus = agentByKey(params.agentResult, "hephaestus");
  if (hephaestus) {
    hephaestus.permission = {
      ...hephaestus.permission,
      call_omo_agent: "deny",
      task: "allow",
      question: questionPermission,
      ...denyHermesOnlyTools,
      ...denyTodoTools,
    };
  }
  const prometheus = agentByKey(params.agentResult, "prometheus");
  if (prometheus) {
    prometheus.permission = {
      ...prometheus.permission,
      call_omo_agent: "deny",
      task: "allow",
      question: questionPermission,
      "task_*": "allow",
      teammate: "allow",
      ...denyHermesOnlyTools,
      ...denyTodoTools,
    };
  }
  const junior = agentByKey(params.agentResult, "sisyphus-junior");
  if (junior) {
    junior.permission = {
      ...junior.permission,
      task: "allow",
      "task_*": "allow",
      teammate: "allow",
      ...denyHermesOnlyTools,
      ...denyTodoTools,
    };
  }
  const mnemosyne = agentByKey(params.agentResult, "mnemosyne");
  if (mnemosyne) {
    mnemosyne.permission = {
      ...mnemosyne.permission,
      call_omo_agent: "deny",
      task: "allow",
      question: questionPermission,
      "task_*": "allow",
      teammate: "allow",
      ...denyHermesOnlyTools,
      ...denyTodoTools,
    };
  }
  const heracles = agentByKey(params.agentResult, "heracles");
  if (heracles) {
    heracles.permission = {
      ...heracles.permission,
      call_omo_agent: "deny",
      task: "allow",
      question: questionPermission,
      "task_*": "allow",
      teammate: "allow",
      ...denyHermesOnlyTools,
      ...denyTodoTools,
    };
  }

  params.config.permission = {
    webfetch: "allow",
    external_directory: "allow",
    ...(params.config.permission as Record<string, unknown>),
    task: "deny",
  };
}
