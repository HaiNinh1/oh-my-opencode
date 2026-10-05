#!/usr/bin/env node
// scaffold-skill.mjs - deterministically scaffold a learned OMO skill as
// <dir>/<skill-name>/SKILL.md with valid frontmatter so the OMO skill loader
// (packages/skills-loader-core/.../loader.ts -> loadSkillsFromDir) discovers it
// next session.
//
// Zero external dependencies (node:fs/path/url builtins only) so it runs
// byte-identically under `node` and `bun` on macOS, Linux, and Windows with no
// POSIX-shell or python3 precondition.
//
// Usage:
//   node "<skill-root>/scripts/scaffold-skill.mjs" <skill-name> \
//     [--dir=.opencode/skills] [--desc="one-line description"] [--force]
//
// RESUME-SAFE: a plain re-run on an existing SKILL.md is a NO-OP success (it
// never clobbers a hand-edited skill). --force overwrites an existing file.
//
// Why <name>/SKILL.md and not <name>.md: the project/user skill scans in
// loader.ts load a skill from `<scanned-dir>/<entry>/SKILL.md`. A flat
// `<name>.md` in those scanned dirs is NOT picked up. Keep the directory layout.

import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve, isAbsolute, relative } from "node:path";
import { pathToFileURL } from "node:url";

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;

export function parseArgs(argv) {
	const rest = argv.slice(2);
	let name;
	let dir = ".opencode/skills";
	let desc = "";
	let force = false;
	for (const arg of rest) {
		if (arg === "--force") force = true;
		else if (arg.startsWith("--dir=")) dir = arg.slice("--dir=".length);
		else if (arg.startsWith("--desc=")) desc = arg.slice("--desc=".length);
		else if (arg.startsWith("--")) throw new Error(`unknown flag: ${arg}`);
		else if (name === undefined) name = arg;
		else throw new Error(`unexpected argument: ${arg}`);
	}
	if (!name) {
		throw new Error('usage: scaffold-skill.mjs <skill-name> [--dir=.opencode/skills] [--desc="..."] [--force]');
	}
	if (!NAME_PATTERN.test(name)) {
		throw new Error(`invalid skill name "${name}" - use lowercase letters, digits, and hyphens only`);
	}
	if (dir.trim() === "") throw new Error("--dir must not be empty");
	return { name, dir, desc, force };
}

export function buildSkillMarkdown(name, desc) {
	const title = name
		.split("-")
		.map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
		.join(" ");
	const description = desc.trim() !== "" ? desc.trim() : `${title} - learned skill. Triggers: ${name}.`;
	// JSON.stringify quotes the description and escapes embedded quotes safely.
	return `---
name: ${name}
description: ${JSON.stringify(description)}
---

# ${title}

## The Insight
<!-- The underlying PRINCIPLE you discovered - the mental model, not the code. -->

## Why This Matters
<!-- What goes wrong without it; the symptom that led you here. -->

## Recognition Pattern
<!-- How to know this skill applies - the signs, with real file paths / error fragments. -->

## The Approach
<!-- The decision-making heuristic and ordered steps. How to THINK about this. -->

## Verification
<!-- How to confirm the approach worked: exact command / assertion / evidence. -->

## Example (optional)
<!-- Code only as illustration of the principle, not copy-paste material. -->
`;
}

// Confine the write target under the workspace root and require a .md SKILL file.
export function resolveSkillTarget(cwd, dir, name) {
	const skillDir = isAbsolute(dir) ? join(dir, name) : resolve(cwd, dir, name);
	const target = join(skillDir, "SKILL.md");
	if (!isAbsolute(dir)) {
		const rel = relative(cwd, target);
		if (rel.startsWith("..") || isAbsolute(rel)) {
			throw new Error(`refused: path escapes the workspace root: ${dir}`);
		}
	}
	return { skillDir, target };
}

export async function scaffold(cwd, { name, dir, desc, force }) {
	const { skillDir, target } = resolveSkillTarget(cwd, dir, name);
	const existing = await readFile(target, "utf8").catch(() => null);
	if (existing !== null && existing.trim() !== "" && !force) {
		return { target, status: "exists" };
	}
	await mkdir(skillDir, { recursive: true });
	await writeFile(target, buildSkillMarkdown(name, desc), "utf8");
	return { target, status: existing !== null ? "overwritten" : "created" };
}

async function main() {
	const { name, dir, desc, force } = parseArgs(process.argv);
	const cwd = process.cwd();
	const result = await scaffold(cwd, { name, dir, desc, force });
	process.stdout.write(`${result.status}: ${result.target}\n`);
	if (result.status === "exists") {
		process.stdout.write("left untouched (pass --force to overwrite). Fill the body sections via your editor.\n");
	} else {
		process.stdout.write(
			"next: fill The Insight / Why This Matters / Recognition Pattern / The Approach / Verification with session-specific detail.\n",
		);
	}
	// Best-effort discoverability hint.
	const dirStat = await stat(dirname(result.target)).catch(() => null);
	if (!dirStat) process.stderr.write("warning: skill directory missing after write\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main().catch((err) => {
		process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
		process.exit(1);
	});
}
