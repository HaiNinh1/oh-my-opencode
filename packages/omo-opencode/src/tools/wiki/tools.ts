import type { PluginInput } from "@opencode-ai/plugin"
import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import {
  WIKI_ADD_DESCRIPTION,
  WIKI_LINT_DESCRIPTION,
  WIKI_LIST_DESCRIPTION,
  WIKI_QUERY_DESCRIPTION,
  WIKI_READ_DESCRIPTION,
} from "./constants"
import { lintPages, listPages, readPage, searchPages, writePage } from "./storage"

export function createWikiTools(ctx: PluginInput): Record<string, ToolDefinition> {
  const wiki_add: ToolDefinition = tool({
    description: WIKI_ADD_DESCRIPTION,
    args: {
      title: tool.schema.string().describe("Human-readable page title"),
      slug: tool.schema.string().optional().describe("Stable identifier (derived from title when omitted)"),
      tags: tool.schema.array(tool.schema.string()).optional().describe("Keywords used for tag filtering"),
      body: tool.schema.string().describe("Markdown content; use [[other-slug]] for cross-references"),
    },
    execute: async (args, _context) => {
      try {
        const page = await writePage(ctx.directory, {
          title: args.title,
          slug: args.slug,
          tags: args.tags,
          body: args.body,
        })
        return `Saved wiki page '${page.slug}' (${page.title}) with ${page.tags.length} tag(s).`
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  const wiki_query: ToolDefinition = tool({
    description: WIKI_QUERY_DESCRIPTION,
    args: {
      query: tool.schema.string().optional().describe("Space-separated keywords (may be empty when filtering by tags)"),
      tags: tool.schema.array(tool.schema.string()).optional().describe("Only return pages carrying ALL of these tags"),
      limit: tool.schema.number().optional().describe("Maximum number of pages to return (default 10)"),
    },
    execute: async (args, _context) => {
      try {
        const pages = await listPages(ctx.directory)
        const hits = searchPages(pages, args.query ?? "", args.tags ?? [])
        const limit = args.limit && args.limit > 0 ? args.limit : 10
        const limited = hits.slice(0, limit)
        if (limited.length === 0) {
          return "No matching wiki pages."
        }
        const blocks = limited.map(
          (hit) =>
            `## ${hit.page.title} (${hit.page.slug})\n` +
            `tags: ${hit.page.tags.join(", ") || "(none)"} | score: ${hit.score}\n` +
            `${hit.snippet}`,
        )
        return blocks.join("\n\n")
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  const wiki_read: ToolDefinition = tool({
    description: WIKI_READ_DESCRIPTION,
    args: {
      slug: tool.schema.string().describe("Slug of the page to read"),
    },
    execute: async (args, _context) => {
      try {
        const page = await readPage(ctx.directory, args.slug)
        if (!page) {
          return `Wiki page not found: ${args.slug}`
        }
        return (
          `# ${page.title}\n` +
          `slug: ${page.slug}\n` +
          `tags: ${page.tags.join(", ") || "(none)"}\n` +
          `updated: ${page.updated || "(unknown)"}\n\n` +
          page.body
        )
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  const wiki_list: ToolDefinition = tool({
    description: WIKI_LIST_DESCRIPTION,
    args: {},
    execute: async (_args, _context) => {
      try {
        const pages = await listPages(ctx.directory)
        if (pages.length === 0) {
          return "No wiki pages yet."
        }
        const rows = pages.map(
          (p) => `- ${p.slug} — ${p.title} [${p.tags.join(", ") || "no tags"}] (updated ${p.updated || "unknown"})`,
        )
        return `Wiki pages (${pages.length}):\n${rows.join("\n")}`
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  const wiki_lint: ToolDefinition = tool({
    description: WIKI_LINT_DESCRIPTION,
    args: {},
    execute: async (_args, _context) => {
      try {
        const issues = await lintPages(ctx.directory)
        if (issues.length === 0) {
          return "Wiki lint: no issues found."
        }
        const rows = issues.map((i) => `- [${i.kind}] ${i.slug}: ${i.detail}`)
        return `Wiki lint found ${issues.length} issue(s):\n${rows.join("\n")}`
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  return { wiki_add, wiki_query, wiki_read, wiki_list, wiki_lint }
}
