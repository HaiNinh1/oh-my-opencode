import { join } from "node:path";
import { OPENCODE_STORAGE } from "../../shared";
export const AGENT_USAGE_REMINDER_STORAGE = join(
  OPENCODE_STORAGE,
  "agent-usage-reminder",
);

// All tool names normalized to lowercase for case-insensitive matching
export const TARGET_TOOLS = new Set([
  "grep",
  "safe_grep",
  "glob",
  "safe_glob",
  "webfetch",
  "context7_resolve-library-id",
  "context7_query-docs",
  "websearch_web_search_exa",
  "context7_get-library-docs",
  "grep_app_searchgithub",
]);

export const AGENT_TOOLS = new Set([
  "task",
  "call_omo_agent",
  "task",
]);

export const REMINDER_MESSAGE = `
[Agent Usage Reminder] You called a search/fetch tool directly. Fire parallel \`task(subagent_type="explore", run_in_background=false)\` or \`task(subagent_type="librarian", run_in_background=false)\` calls — multiple sync calls in one response run in parallel automatically. Deeper, context-efficient results.
`;
