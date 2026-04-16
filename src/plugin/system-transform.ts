import { enhancerSessions } from "../shared/enhancer-sessions";
import { ENHANCER_PROMPT } from "../agents/enhancer";

export function createSystemTransformHandler(): (
  input: {
    sessionID?: string;
    model: { id: string; providerID: string; [key: string]: unknown };
  },
  output: { system: string[] },
) => Promise<void> {
  return async (input, output): Promise<void> => {
    if (!input.sessionID) return;
    if (!enhancerSessions.has(input.sessionID)) return;
    // Replace the entire assembled system prompt with just the enhancer prompt.
    // OpenCode injects <env>, <available_skills>, AGENTS.md, etc. into the system
    // array — none of which the enhancer needs.
    output.system.length = 0;
    output.system.push(ENHANCER_PROMPT);
  };
}
