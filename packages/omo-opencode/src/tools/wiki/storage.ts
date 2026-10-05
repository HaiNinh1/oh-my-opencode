import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"

export const WIKI_DIR = "wiki"
export const WIKI_INDEX_FILE = "index.md"
export const STALE_DAYS = 90

export type WikiPage = {
  slug: string
  title: string
  tags: string[]
  updated: string
  body: string
}

function wikiDir(directory: string): string {
  return join(directory, ".omo", WIKI_DIR)
}

function pagePath(directory: string, slug: string): string {
  return join(wikiDir(directory), `${slug}.md`)
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

async function ensureWikiDir(directory: string): Promise<void> {
  await mkdir(wikiDir(directory), { recursive: true })
}

function serializePage(page: WikiPage): string {
  const tags = page.tags.length > 0 ? page.tags.join(", ") : ""
  return [
    "---",
    `title: ${page.title}`,
    `tags: [${tags}]`,
    `updated: ${page.updated}`,
    "---",
    "",
    page.body.trimEnd(),
    "",
  ].join("\n")
}

export function parsePage(slug: string, raw: string): WikiPage {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) {
    return { slug, title: slug, tags: [], updated: "", body: raw.trim() }
  }
  const [, frontmatter, body] = match
  let title = slug
  let tags: string[] = []
  let updated = ""
  for (const line of frontmatter.split(/\r?\n/)) {
    const titleMatch = line.match(/^title:\s*(.*)$/)
    if (titleMatch) {
      title = titleMatch[1].trim()
      continue
    }
    const tagsMatch = line.match(/^tags:\s*\[(.*)\]\s*$/)
    if (tagsMatch) {
      tags = tagsMatch[1]
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
      continue
    }
    const updatedMatch = line.match(/^updated:\s*(.*)$/)
    if (updatedMatch) {
      updated = updatedMatch[1].trim()
    }
  }
  return { slug, title, tags, updated, body: body.trim() }
}

export async function writePage(
  directory: string,
  input: { slug?: string; title: string; tags?: string[]; body: string },
): Promise<WikiPage> {
  await ensureWikiDir(directory)
  const slug = input.slug ? slugify(input.slug) : slugify(input.title)
  const page: WikiPage = {
    slug,
    title: input.title,
    tags: input.tags ?? [],
    updated: new Date().toISOString(),
    body: input.body,
  }
  await writeFile(pagePath(directory, slug), serializePage(page), "utf8")
  await rebuildIndex(directory)
  return page
}

export async function readPage(directory: string, slug: string): Promise<WikiPage | null> {
  try {
    const raw = await readFile(pagePath(directory, slugify(slug)), "utf8")
    return parsePage(slugify(slug), raw)
  } catch {
    return null
  }
}

export async function listPages(directory: string): Promise<WikiPage[]> {
  let entries: string[]
  try {
    entries = await readdir(wikiDir(directory))
  } catch {
    return []
  }
  const pages: WikiPage[] = []
  for (const entry of entries) {
    if (!entry.endsWith(".md") || entry === WIKI_INDEX_FILE) continue
    const slug = entry.slice(0, -3)
    const page = await readPage(directory, slug)
    if (page) pages.push(page)
  }
  pages.sort((a, b) => a.slug.localeCompare(b.slug))
  return pages
}

async function rebuildIndex(directory: string): Promise<void> {
  const pages = await listPages(directory)
  const lines: string[] = ["# Wiki Index", "", `Pages: ${pages.length}`, ""]
  if (pages.length > 0) {
    lines.push("| Slug | Title | Tags | Updated |", "|------|-------|------|---------|")
    for (const page of pages) {
      lines.push(
        `| ${page.slug} | ${page.title} | ${page.tags.join(", ")} | ${page.updated} |`,
      )
    }
    lines.push("")
  }
  await writeFile(join(wikiDir(directory), WIKI_INDEX_FILE), lines.join("\n"), "utf8")
}

export type WikiSearchHit = {
  page: WikiPage
  score: number
  snippet: string
}

export function searchPages(
  pages: WikiPage[],
  query: string,
  tags: string[] = [],
): WikiSearchHit[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0)
  const wantedTags = tags.map((t) => t.toLowerCase())
  const hits: WikiSearchHit[] = []

  for (const page of pages) {
    const pageTags = page.tags.map((t) => t.toLowerCase())
    if (wantedTags.length > 0 && !wantedTags.every((t) => pageTags.includes(t))) {
      continue
    }
    const haystackTitle = page.title.toLowerCase()
    const haystackBody = page.body.toLowerCase()
    let score = 0
    for (const term of terms) {
      if (haystackTitle.includes(term)) score += 5
      const bodyMatches = haystackBody.split(term).length - 1
      score += bodyMatches
      if (pageTags.includes(term)) score += 3
    }
    // Tag-only queries (no terms) still match tagged pages.
    if (terms.length === 0 && wantedTags.length > 0) score += 1
    if (score <= 0) continue
    hits.push({ page, score, snippet: buildSnippet(page.body, terms) })
  }

  hits.sort((a, b) => b.score - a.score)
  return hits
}

function buildSnippet(body: string, terms: string[]): string {
  const flat = body.replace(/\s+/g, " ").trim()
  if (terms.length === 0) return flat.slice(0, 200)
  const lower = flat.toLowerCase()
  let idx = -1
  for (const term of terms) {
    const found = lower.indexOf(term)
    if (found !== -1 && (idx === -1 || found < idx)) idx = found
  }
  if (idx === -1) return flat.slice(0, 200)
  const start = Math.max(0, idx - 60)
  const end = Math.min(flat.length, idx + 140)
  const prefix = start > 0 ? "..." : ""
  const suffix = end < flat.length ? "..." : ""
  return `${prefix}${flat.slice(start, end)}${suffix}`
}

export type WikiLintIssue = {
  slug: string
  kind: "empty" | "untagged" | "orphan" | "stale"
  detail: string
}

export async function lintPages(directory: string): Promise<WikiLintIssue[]> {
  const pages = await listPages(directory)
  const issues: WikiLintIssue[] = []
  const now = Date.now()
  const slugSet = new Set(pages.map((p) => p.slug))

  for (const page of pages) {
    if (page.body.trim().length === 0) {
      issues.push({ slug: page.slug, kind: "empty", detail: "Page has no body content" })
    }
    if (page.tags.length === 0) {
      issues.push({ slug: page.slug, kind: "untagged", detail: "Page has no tags" })
    }
    if (page.updated) {
      const updatedMs = Date.parse(page.updated)
      if (!Number.isNaN(updatedMs)) {
        const ageDays = (now - updatedMs) / (1000 * 60 * 60 * 24)
        if (ageDays > STALE_DAYS) {
          issues.push({
            slug: page.slug,
            kind: "stale",
            detail: `Not updated in ${Math.floor(ageDays)} days`,
          })
        }
      }
    }
    // Orphan = a [[wiki-link]] reference that points at a missing page.
    const links = [...page.body.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => slugify(m[1]))
    for (const link of links) {
      if (!slugSet.has(link)) {
        issues.push({
          slug: page.slug,
          kind: "orphan",
          detail: `Broken cross-reference to missing page: ${link}`,
        })
      }
    }
  }
  return issues
}

// Exposed for tests / diagnostics.
export async function indexExists(directory: string): Promise<boolean> {
  try {
    await stat(join(wikiDir(directory), WIKI_INDEX_FILE))
    return true
  } catch {
    return false
  }
}
