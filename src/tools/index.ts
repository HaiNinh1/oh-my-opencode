import {
  lsp_goto_definition,
  lsp_find_references,
  lsp_symbols,
  lsp_diagnostics,
  lsp_prepare_rename,
  lsp_rename,
  lspManager,
} from "./lsp"
import { get_agent_prompts } from "./get-agent-prompts"

export { lspManager }

export { createAstGrepTools } from "./ast-grep"
export { createGrepTools } from "./grep"
export { createGlobTools } from "./glob"
export { createSkillTool } from "./skill"
export { discoverCommandsSync } from "./slashcommand"
export { createSessionManagerTools } from "./session-manager"

export { sessionExists } from "./session-manager/storage"

export { interactive_bash, startBackgroundCheck as startTmuxCheck } from "./interactive-bash"
export { createSkillMcpTool } from "./skill-mcp"

import {
  createBackgroundOutput,
  createBackgroundCancel,
  type BackgroundOutputManager,
  type BackgroundCancelClient,
} from "./background-task"

import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../features/background-agent"

type OpencodeClient = PluginInput["client"]

export { createResolveAtlasContextTool } from "./resolve-atlas-context"
export { createResolveHeraclesContextTool } from "./resolve-heracles-context"
export { createCallOmoAgent } from "./call-omo-agent"

export { createLookAt } from "./look-at"
export { createDelegateTask } from "./delegate-task"
export {
  createTaskCreateTool,
  createTaskGetTool,
  createTaskList,
  createTaskUpdateTool,
} from "./task"
export { createHashlineEditTool } from "./hashline-edit"
export { createParallelTasksTool } from "./parallel-tasks"
export { get_agent_prompts } from "./get-agent-prompts"

export function createBackgroundTools(manager: BackgroundManager, client: OpencodeClient): Record<string, ToolDefinition> {
  const outputManager: BackgroundOutputManager = manager
  const cancelClient: BackgroundCancelClient = client
  return {
    background_output: createBackgroundOutput(outputManager, client),
    background_cancel: createBackgroundCancel(manager, cancelClient),
  }
}

export const builtinTools: Record<string, ToolDefinition> = {
  lsp_goto_definition,
  lsp_find_references,
  lsp_symbols,
  lsp_diagnostics,
  lsp_prepare_rename,
  lsp_rename,
  get_agent_prompts,
}
