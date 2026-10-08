export const TODOWRITE_DESCRIPTION = `Use this tool to create and manage a structured task list for tracking progress on multi-step work.

## OpenCode Schema Contract

The upstream OpenCode \`todowrite\` schema expects each todo item to include:

- \`content\`: string
- \`status\`: string, one of \`pending\`, \`in_progress\`, \`completed\`, \`cancelled\`
- \`priority\`: string, one of \`high\`, \`medium\`, \`low\`

\`priority\` is a string field. Never send numeric priorities such as \`0\`, \`1\`, \`2\`, or labels such as \`P0\`, \`P1\`, \`P2\`.

## When to use

Use this tool for multi-step work (2 or more steps), or when the user gives several separate items; the list is your plan. Skip it for single, trivial changes.

## Todo Format

Each todo is a short imperative phrase naming the concrete change, e.g. "Add validateEmail() to src/utils/validation.ts" or "Run auth tests". One item per meaningful step, not one per tool call.

## Task Management
- One in_progress at a time. Complete it before starting the next.
- Mark completed immediately after finishing each item.`
