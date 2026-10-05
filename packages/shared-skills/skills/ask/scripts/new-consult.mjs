#!/usr/bin/env node
// new-consult.mjs - scaffold a consult artifact under .omo/consults/ deterministically.
//
// Zero external dependencies (node:fs/path/process/url builtins only) so it runs
// byte-identically under `node` and `bun` on macOS, Linux, and Windows with no uv
// bootstrap, no npm/pip install, and no POSIX-shell or python3 precondition - the
// two things genuinely not guaranteed on native Windows across the omo harnesses.
//
// Usage:
//   node "<skill-root>/scripts/new-consult.mjs" <slug> --kind=ask    --models=<m1,m2,...> [--question=<q>]
//   node "<skill-root>/scripts/new-consult.mjs" <slug> --kind=ccg    --models=<m1,m2,...> [--question=<q>]
//
// Emits a single timestamped markdown artifact:
//   .omo/consults/<timestamp>-<slug>.md
// pre-seeded with a frontmatter header, a section per consulted model (raw answer
// goes here), and - for ccg - a synthesis section. The model APPENDS each raw
// answer into the matching section and fills the synthesis with edit/apply_patch;
// it never hand-builds the file header.
//
// RESUME-SAFE: re-running with the SAME slug on the SAME calendar minute is a no-op
// success (the timestamp+slug path already exists), so a model resuming after
// compaction cannot crash the turn or clobber a partially-filled artifact. A new
// minute simply mints a fresh artifact - consults are immutable point-in-time
// records, so that is correct.
//
// WRITE BOUNDARY: this script self-guards its own writes to resolve under .omo/
// consults/ and to end in .md. It contains no other shell commands.

import { lstat, mkdir, writeFile, readFile, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;
const VALID_KINDS = new Set(["ask", "ccg"]);

export function parseArgs(argv) {
	const rest = argv.slice(2);
	let slug;
	let kind = "ask";
	let models = [];
	let question = "";
	for (const arg of rest) {
		if (arg.startsWith("--kind=")) kind = arg.slice("--kind=".length).trim();
		else if (arg.startsWith("--models=")) {
			models = arg
				.slice("--models=".length)
				.split(",")
				.map((m) => m.trim())
				.filter(Boolean);
		} else if (arg.startsWith("--question=")) question = arg.slice("--question=".length);
		else if (arg.startsWith("--")) throw new Error(`unknown flag: ${arg}`);
		else if (slug === undefined) slug = arg;
		else throw new Error(`unexpected argument: ${arg}`);
	}
	if (!slug) {
		throw new Error(
			'usage: new-consult.mjs <slug> --kind=<ask|ccg> --models=<m1,m2,...> [--question=<q>]',
		);
	}
	if (!SLUG_PATTERN.test(slug)) {
		throw new Error(`invalid slug "${slug}" - use lowercase letters, digits, and hyphens only`);
	}
	if (!VALID_KINDS.has(kind)) {
		throw new Error(`invalid --kind "${kind}" - expected one of: ask, ccg`);
	}
	if (models.length === 0) {
		throw new Error("at least one --models entry is required (e.g. --models=claude,gpt,gemini)");
	}
	return { slug, kind, models, question };
}

// A stable, sortable, filesystem-safe local timestamp: YYYYMMDD-HHMMSS.
export function timestamp(date = new Date()) {
	const p = (n, w = 2) => String(n).padStart(w, "0");
	return (
		`${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
		`-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
	);
}

// Confine a project-relative path under .omo/consults/ and require a .md suffix.
export function resolveSafeConsultPath(cwd, relPath) {
	const resolved = resolve(cwd, relPath);
	const rel = relative(cwd, resolved);
	if (rel.startsWith("..") || isAbsolute(rel)) {
		throw new Error(`refused: path escapes the workspace root: ${relPath}`);
	}
	if (!/(^|[/\\])\.omo[/\\]consults([/\\]|$)/i.test(rel)) {
		throw new Error(`refused: consult artifacts may only live under .omo/consults/: ${relPath}`);
	}
	if (!resolved.toLowerCase().endsWith(".md")) {
		throw new Error(`refused: consult artifacts must be .md files: ${relPath}`);
	}
	return resolved;
}

function assertContainedPath(parent, child, message) {
	const rel = relative(parent, child);
	if (rel.startsWith("..") || isAbsolute(rel)) {
		throw new Error(message);
	}
}

async function mkdirWithoutSymlinks(dir, stopAt) {
	if (dir === stopAt) return;
	const parent = dirname(dir);
	if (parent === dir || relative(stopAt, dir).startsWith("..") || isAbsolute(relative(stopAt, dir))) {
		throw new Error(`refused: path escapes the workspace root: ${dir}`);
	}
	await mkdirWithoutSymlinks(parent, stopAt);
	const stat = await lstat(dir).catch((err) => {
		if (err && err.code === "ENOENT") return null;
		throw err;
	});
	if (stat) {
		if (stat.isSymbolicLink()) throw new Error(`refused: path component is a symlink: ${dir}`);
		if (!stat.isDirectory()) throw new Error(`refused: path component is not a directory: ${dir}`);
		return;
	}
	await mkdir(dir);
}

async function assertSafeWriteParent(cwd, target) {
	const workspaceReal = await realpath(cwd);
	const workspaceRoot = resolve(cwd);
	const consultsRoot = resolve(cwd, ".omo", "consults");
	const parent = dirname(target);
	assertContainedPath(workspaceRoot, parent, `refused: path escapes the workspace root: ${target}`);
	assertContainedPath(consultsRoot, parent, `refused: artifacts may only write under .omo/consults/: ${target}`);
	await mkdirWithoutSymlinks(parent, workspaceRoot);
	const consultsReal = await realpath(consultsRoot);
	const parentReal = await realpath(parent);
	assertContainedPath(workspaceReal, parentReal, `refused: path escapes the workspace root through symlinks: ${target}`);
	assertContainedPath(consultsReal, parentReal, `refused: artifacts may only write under .omo/consults/ through real paths: ${target}`);
}

async function assertSafeWriteTarget(target) {
	const stat = await lstat(target).catch((err) => {
		if (err && err.code === "ENOENT") return null;
		throw err;
	});
	if (stat?.isSymbolicLink()) throw new Error(`refused: target is a symlink: ${target}`);
}

function modelSection(model) {
	return `## Answer: ${model}
<!-- APPEND ${model}'s raw, unedited response below this line. Do not summarize here - capture verbatim. -->

`;
}

export function buildArtifact({ slug, kind, models, question, when }) {
	const ts = timestamp(when);
	const header = `---
kind: ${kind}
slug: ${slug}
created: ${ts}
models: [${models.join(", ")}]
status: pending
---

# Consult: ${slug}

> Kind: \`${kind}\` | Captured: ${ts} | Models: ${models.join(", ")}

## Question / Decision
${question ? question : "<!-- fill: the exact question, decision, or design put to the consulted model(s) -->"}

## Context provided
<!-- fill: the context (files, constraints, prior attempts) handed to the consulted model(s), so this artifact is auditable on its own -->

`;
	const answers = models.map(modelSection).join("");
	const synthesis =
		kind === "ccg"
			? `## Synthesis (Claude)
<!-- fill LAST, after all answers are captured above. -->

**Agreements:** <where the models converge>

**Conflicts:** <where they disagree - call out explicitly>

**Final recommendation:** <the chosen direction + rationale for picking it over the alternatives>

**Action checklist:**
- [ ] <concrete step>

`
			: `## Takeaway
<!-- fill: how this second opinion changed (or confirmed) your plan, in 1-3 lines. -->

`;
	return { ts, content: header + answers + synthesis };
}

// Resume-safe write: if the exact artifact already exists (same minute + slug), leave
// it untouched and report it - a model re-running after compaction must not clobber a
// partially-filled consult.
export async function writeGuarded(cwd, relPath, content) {
	const target = resolveSafeConsultPath(cwd, relPath);
	await assertSafeWriteParent(cwd, target);
	await assertSafeWriteTarget(target);
	const existing = await readFile(target, "utf8").catch(() => null);
	if (existing && existing.trim() !== "") {
		return { relPath, status: "exists" };
	}
	await writeFile(target, content, "utf8");
	return { relPath, status: "created" };
}

export async function scaffold(cwd, opts) {
	const { content, ts } = buildArtifact({ ...opts, when: opts.when ?? new Date() });
	const relPath = join(".omo", "consults", `${ts}-${opts.slug}.md`);
	const result = await writeGuarded(cwd, relPath, content);
	return result;
}

async function main() {
	const { slug, kind, models, question } = parseArgs(process.argv);
	const result = await scaffold(process.cwd(), { slug, kind, models, question });
	process.stdout.write(`${result.status}: ${result.relPath}\n`);
	process.stdout.write(
		result.status === "created"
			? `next: dispatch the consult(s), then APPEND each raw answer into its "## Answer: <model>" section; fill synthesis/takeaway LAST.\n`
			: `artifact already present - left untouched. APPEND answers into the existing sections.\n`,
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main().catch((err) => {
		process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
		process.exit(1);
	});
}
