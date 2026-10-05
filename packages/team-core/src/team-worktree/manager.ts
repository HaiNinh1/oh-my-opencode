import path from "node:path"
import { spawn as bunSpawn } from "@oh-my-opencode/utils/runtime"

export type TeamModeConfig = {
  worktreeBaseDir?: string
}

export class GitUnavailableError extends Error {
  constructor() {
    super("git required for worktree members")
    this.name = "GitUnavailableError"
  }
}

function countParentSegments(spec: string): number {
  return spec.split("/").filter((segment) => segment === "..").length
}

async function runGit(args: string[], cwd?: string): Promise<{ code: number; stderr: string }> {
  const process = bunSpawn({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" })
  const [exitCode, stderrBytes] = await Promise.all([process.exited, new Response(process.stderr).text()])
  return { code: exitCode, stderr: stderrBytes }
}

let gitCommandRunner = runGit

export function setGitCommandRunnerForTests(runner: typeof runGit): void {
  gitCommandRunner = runner
}

export async function isGitAvailable(): Promise<boolean> {
  const result = await gitCommandRunner(["--version"])
  return result.code === 0
}

/** Windows specs (`.\\wt`, `..\\wt`, `C:\\wt`) are accepted by normalizing backslashes to forward slashes. */
export function normalizeWorktreeSpec(spec: string): string {
  return spec.replaceAll("\\", "/")
}

export function validateWorktreeSpec(spec: string): void {
  const normalized = normalizeWorktreeSpec(spec)
  const isRelative = /^\.\.?\/.+/.test(normalized)
  // UNC/network roots (`//server/share`, `\\server\share`) stay rejected.
  const isPosixAbsolute = /^\/(?!\/).+/.test(normalized)
  const isDriveAbsolute = /^[A-Za-z]:\/.+/.test(normalized)
  if (normalized.includes("\0") || !(isRelative || isPosixAbsolute || isDriveAbsolute) || countParentSegments(normalized) > 2) {
    throw new Error("worktreePath must be a filesystem path (relative './...', '../...' or absolute '/...')")
  }
}

export async function createWorktree(
  repoRoot: string,
  _teamRunId: string,
  _memberName: string,
  worktreePath: string,
  _config: TeamModeConfig,
): Promise<string> {
  validateWorktreeSpec(worktreePath)

  if (!(await isGitAvailable())) {
    throw new GitUnavailableError()
  }

  const normalizedPath = normalizeWorktreeSpec(worktreePath)
  const absolutePath = path.isAbsolute(normalizedPath) ? normalizedPath : path.resolve(repoRoot, normalizedPath)
  const result = await gitCommandRunner(["-C", repoRoot, "worktree", "add", "--detach", absolutePath])

  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "git worktree add failed")
  }

  return absolutePath
}
