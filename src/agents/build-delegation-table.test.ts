/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import type { AvailableAgent } from "./dynamic-agent-prompt-builder"
import { buildDelegationTable } from "./dynamic-agent-prompt-builder"

describe("buildDelegationTable", () => {
  it("omits Hermes rows from the rendered delegation table", () => {
    const agents: AvailableAgent[] = [
      {
        name: "hermes",
        description: "Routing agent",
        metadata: {
          category: "utility",
          cost: "EXPENSIVE",
          triggers: [
            {
              domain: "Task Routing",
              trigger: "Need to forward request to specific agent",
            },
          ],
        },
      },
      {
        name: "explore",
        description: "Search agent",
        metadata: {
          category: "research",
          cost: "FREE",
          triggers: [
            {
              domain: "Code Search",
              trigger: "Need to find implementation details",
            },
          ],
        },
      },
    ]

    const result = buildDelegationTable(agents)

    expect(result).not.toContain("`hermes`")
    expect(result).toContain("**Code Search** → `explore` - Need to find implementation details")
  })

  it("keeps non-Hermes agents even when they share the utility category", () => {
    const agents: AvailableAgent[] = [
      {
        name: "multimodal-looker",
        description: "File analysis agent",
        metadata: {
          category: "utility",
          cost: "CHEAP",
          triggers: [
            {
              domain: "Media Analysis",
              trigger: "Need to inspect image or PDF content",
            },
          ],
        },
      },
    ]

    const result = buildDelegationTable(agents)

    expect(result).toContain("**Media Analysis** → `multimodal-looker` - Need to inspect image or PDF content")
  })
})
