// One-command setup for this fork on a new machine: builds the repo, installs
// lazycodex into Codex, points OpenCode at this checkout's build, and writes
// ChatGPT-subscription model routing with team mode enabled.
//
//   bun run install:fork            # everything
//   bun run install:fork --no-codex # skip the Codex install
//   bun run install:fork --no-opencode
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url))
const args = process.argv.slice(2)
const skipCodex = args.includes("--no-codex")
const skipOpenCode = args.includes("--no-opencode")
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)

function run(label: string, command: string, commandArgs: readonly string[], env: NodeJS.ProcessEnv = process.env): void {
  console.log(`\n[install-fork] ${label}`)
  const result = spawnSync(command, commandArgs, { cwd: repositoryRoot, stdio: "inherit", env, shell: process.platform === "win32" })
  if (result.error) throw result.error
  if (result.status !== 0) {
    console.error(`[install-fork] "${label}" exited with code ${result.status}`)
    process.exit(result.status ?? 1)
  }
}

function readJsonc(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  return JSON.parse(readFileSync(path, "utf8").replace(/^\s*\/\/.*$/gm, "")) as Record<string, unknown>
}

function writeWithBackup(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true })
  if (existsSync(path)) copyFileSync(path, `${path}.bak-${stamp}`)
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
  console.log(`[install-fork] wrote ${path}`)
}

// Keeps the user's other plugins, drops any published or older omo entry, adds this checkout's build.
function withForkPlugin(config: Record<string, unknown>, pluginSpec: string): Record<string, unknown> {
  const existing = Array.isArray(config.plugin) ? (config.plugin as unknown[]) : []
  const others = existing.filter((entry) => {
    const name = String(Array.isArray(entry) ? entry[0] : entry)
    return !/oh-my-open(agent|code)|\/dist\/(index|tui)\.js$/.test(name)
  })
  return { ...config, plugin: [...others, pluginSpec] }
}

// The upstream installer writes ChatGPT-only routing but also swaps the plugin for the npm
// package, so it runs against a throwaway HOME and only its routing is copied over.
function generateChatGptRouting(): Record<string, unknown> {
  const sandbox = mkdtempSync(join(tmpdir(), "omo-fork-routing-"))
  try {
    const home = join(sandbox, "home")
    mkdirSync(home, { recursive: true })
    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(sandbox, "config"),
      XDG_DATA_HOME: join(sandbox, "data"),
      XDG_STATE_HOME: join(sandbox, "state"),
      XDG_CACHE_HOME: join(sandbox, "cache"),
    }
    run("Generating ChatGPT-subscription model routing", "bun", [
      "dist/cli/index.js", "install", "--no-tui", "--platform=opencode",
      "--claude=no", "--openai=yes", "--gemini=no", "--copilot=no", "--skip-auth",
    ], env)
    const generated = readJsonc(join(home, ".omo", "omo.jsonc"))["[opencode]"] as Record<string, unknown> | undefined
    if (!generated) throw new Error("installer did not produce an [opencode] section")
    delete generated.$schema
    // The installer falls back to OpenCode Zen's free nano model for the planners; use the subscription instead.
    const agents = generated.agents as Record<string, unknown>
    agents.prometheus = { model: "openai/gpt-5.6-sol", variant: "high" }
    agents.metis = { model: "openai/gpt-5.6-sol", variant: "high" }
    return generated
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
}

function dirtyPaths(): Set<string> {
  const result = spawnSync("git", ["status", "--porcelain"], { cwd: repositoryRoot, encoding: "utf8" })
  return new Set(result.stdout.split("\n").filter(Boolean).map((line) => line.slice(3)))
}

// The build regenerates committed bundles (bun.lock, senpi extensions, codex installer) with
// platform-specific output; restore the ones this run dirtied so later `git pull`s stay clean.
function restoreGeneratedFiles(dirtyBefore: Set<string>): void {
  const generated = /^(bun\.lock|packages\/omo-senpi\/plugin\/|packages\/omo-codex\/scripts\/install-dist\/)/
  const touched = [...dirtyPaths()].filter((path) => generated.test(path) && !dirtyBefore.has(path))
  if (touched.length === 0) return
  spawnSync("git", ["checkout", "--", ...touched], { cwd: repositoryRoot, stdio: "inherit" })
  console.log(`[install-fork] restored ${touched.length} regenerated build artifact(s)`)
}

const dirtyBeforeBuild = dirtyPaths()
run("Initializing submodules", "git", ["submodule", "update", "--init", "--recursive"])
run("Installing dependencies", "bun", ["install", "--ignore-scripts"])
run("Building", "bun", ["run", "build"])

if (!skipCodex) {
  run("Installing codex plugin dependencies", "npm", ["--prefix", "packages/omo-codex/plugin", "ci"])
  run("Installing lazycodex into Codex (stamped dev)", "bun", ["run", "install:codex-dev"])
}

if (!skipOpenCode) {
  const pluginSpec = pathToFileURL(join(repositoryRoot, "dist", "index.js")).href
  const configDir = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode")
  const openCodePath = join(configDir, "opencode.json")
  writeWithBackup(openCodePath, {
    $schema: "https://opencode.ai/config.json",
    ...withForkPlugin(readJsonc(openCodePath), pluginSpec),
  })
  const tuiPath = join(configDir, "tui.json")
  writeWithBackup(tuiPath, { $schema: "https://opencode.ai/tui.json", ...withForkPlugin(readJsonc(tuiPath), pluginSpec) })

  const omoPath = join(homedir(), ".omo", "omo.jsonc")
  const omo = readJsonc(omoPath)
  const current = (omo["[opencode]"] as Record<string, unknown> | undefined) ?? {}
  writeWithBackup(omoPath, {
    $schema: "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json",
    ...omo,
    "[opencode]": { ...current, ...generateChatGptRouting(), team_mode: { enabled: true } },
  })
}

restoreGeneratedFiles(dirtyBeforeBuild)

console.log(`
[install-fork] Done.
  Next steps (interactive, run once per machine):
    opencode auth login      -> OpenAI -> "ChatGPT Plus/Pro"
    codex login              -> or sign in from the Codex app
    opencode models --refresh
  Verify:
    bun dist/cli/index.js doctor
    Codex: hook messages start with "(OmO dev)"
  After pulling new commits: bun run install:fork (or just bun run build for OpenCode).
`)
