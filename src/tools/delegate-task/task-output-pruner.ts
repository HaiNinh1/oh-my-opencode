import { isPassthroughAgent } from "../../shared/passthrough-agents"

export function getTaskOutputContent(textContent: string | undefined, parentAgent: string | undefined): string {
  if (isPassthroughAgent(parentAgent)) {
    return "(Output pruned for passthrough agent)"
  }
  return textContent || "(No text output)"
}
