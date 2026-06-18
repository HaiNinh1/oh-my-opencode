export const WIKI_ADD_DESCRIPTION = `Create or update a wiki page in the project's persistent knowledge base.

Pages are stored as markdown with YAML frontmatter under .omo/wiki/<slug>.md and the
index is auto-maintained. Use this to capture durable, reusable knowledge (architecture,
decisions, patterns, debugging notes) that should compound across sessions.

Arguments:
- title (required): Human-readable page title.
- slug (optional): Stable identifier; derived from title when omitted.
- tags (optional): Keywords used for tag filtering during queries.
- body (required): Markdown content. Use [[other-slug]] to cross-reference pages.`

export const WIKI_QUERY_DESCRIPTION = `Search the wiki by keywords and/or tags (keyword + tag matching only — no embeddings).

Returns ranked pages with snippets. YOU synthesize the final answer with citations from
the matching pages.

Arguments:
- query (optional): Space-separated keywords. May be empty when filtering purely by tags.
- tags (optional): Only return pages that carry ALL of these tags.
- limit (optional): Maximum number of pages to return (default 10).`

export const WIKI_READ_DESCRIPTION = `Read a single wiki page by slug, returning its title, tags, last-updated time, and body.`

export const WIKI_LIST_DESCRIPTION = `List all wiki pages with their tags and last-updated timestamps.`

export const WIKI_LINT_DESCRIPTION = `Run health checks across the wiki.

Reports empty pages, untagged pages, stale pages (not updated in 90+ days), and orphan
cross-references ([[link]] pointing at a missing page).`
