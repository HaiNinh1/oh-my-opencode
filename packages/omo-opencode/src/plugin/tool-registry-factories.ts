import {
  createTeamApproveShutdownTool,
  createTeamCreateTool,
  createTeamDeleteTool,
  createTeamRejectShutdownTool,
  createTeamShutdownRequestTool,
} from "../features/team-mode/tools/lifecycle"
import { createTeamSendMessageTool } from "../features/team-mode/tools/messaging"
import { createTeamListTool, createTeamStatusTool } from "../features/team-mode/tools/query"
import {
  createTeamTaskCreateTool,
  createTeamTaskGetTool,
  createTeamTaskListTool,
  createTeamTaskUpdateTool,
} from "../features/team-mode/tools/tasks"
import {
  createBackgroundTools,
  createCallOmoAgent,
  createDelegateTask,
  createGlobTools,
  createGrepTools,
  createHashlineEditTool,
  createLookAt,
  createMonitorTools,
  createParallelTasksTool,
  createProjectMemoryTools,
  createSessionManagerTools,
  createSkillMcpTool,
  createSkillTool,
  createTaskCreateTool,
  createTaskGetTool,
  createTaskList,
  createTaskUpdateTool,
  createWikiTools,
  discoverCommandsSync,
  interactive_bash,
} from "../tools"

export type ToolRegistryFactories = {
  createBackgroundTools: typeof createBackgroundTools
  createCallOmoAgent: typeof createCallOmoAgent
  createLookAt: typeof createLookAt
  createMonitorTools: typeof createMonitorTools
  createSkillMcpTool: typeof createSkillMcpTool
  createSkillTool: typeof createSkillTool
  createGrepTools: typeof createGrepTools
  createGlobTools: typeof createGlobTools
  createSessionManagerTools: typeof createSessionManagerTools
  createWikiTools: typeof createWikiTools
  createProjectMemoryTools: typeof createProjectMemoryTools
  createDelegateTask: typeof createDelegateTask
  createParallelTasksTool: typeof createParallelTasksTool
  discoverCommandsSync: typeof discoverCommandsSync
  interactive_bash: typeof interactive_bash
  createTaskCreateTool: typeof createTaskCreateTool
  createTaskGetTool: typeof createTaskGetTool
  createTaskList: typeof createTaskList
  createTaskUpdateTool: typeof createTaskUpdateTool
  createHashlineEditTool: typeof createHashlineEditTool
  createTeamApproveShutdownTool: typeof createTeamApproveShutdownTool
  createTeamCreateTool: typeof createTeamCreateTool
  createTeamDeleteTool: typeof createTeamDeleteTool
  createTeamRejectShutdownTool: typeof createTeamRejectShutdownTool
  createTeamShutdownRequestTool: typeof createTeamShutdownRequestTool
  createTeamSendMessageTool: typeof createTeamSendMessageTool
  createTeamTaskCreateTool: typeof createTeamTaskCreateTool
  createTeamTaskGetTool: typeof createTeamTaskGetTool
  createTeamTaskListTool: typeof createTeamTaskListTool
  createTeamTaskUpdateTool: typeof createTeamTaskUpdateTool
  createTeamStatusTool: typeof createTeamStatusTool
  createTeamListTool: typeof createTeamListTool
}

export const defaultToolRegistryFactories: ToolRegistryFactories = {
  createBackgroundTools,
  createCallOmoAgent,
  createLookAt,
  createMonitorTools,
  createSkillMcpTool,
  createSkillTool,
  createGrepTools,
  createGlobTools,
  createSessionManagerTools,
  createWikiTools,
  createProjectMemoryTools,
  createDelegateTask,
  createParallelTasksTool,
  discoverCommandsSync,
  interactive_bash,
  createTaskCreateTool,
  createTaskGetTool,
  createTaskList,
  createTaskUpdateTool,
  createHashlineEditTool,
  createTeamApproveShutdownTool,
  createTeamCreateTool,
  createTeamDeleteTool,
  createTeamRejectShutdownTool,
  createTeamShutdownRequestTool,
  createTeamSendMessageTool,
  createTeamTaskCreateTool,
  createTeamTaskGetTool,
  createTeamTaskListTool,
  createTeamTaskUpdateTool,
  createTeamStatusTool,
  createTeamListTool,
}
