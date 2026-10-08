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
  "grep_app_searchgithub",
]);

export const AGENT_TOOLS = new Set([
  "task",
  "call_omo_agent",
]);

export const REMINDER_MESSAGE = `
[Agent Usage Reminder]

Direct search is right when you know or can guess the target. If this search is turning into a broad sweep across many files, or needs external docs, hand it to one background \`explore\`/\`librarian\` task instead of continuing by hand.
`;
