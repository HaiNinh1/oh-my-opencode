import { appendFile, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { spawn as runtimeSpawn } from "@oh-my-opencode/utils/runtime"

/**
 * Git worktree isolation with merge-back.
 *
 * A worktree starts from a "base tree": a snapshot of the parent's working tree
 * (tracked + untracked, honoring ignores) written through a throwaway index, so
 * the parent's uncommitted changes are carried into the worktree and the user's
 * real index is never touched. Merge-back diffs the worktree's working tree
 * against that base tree and lands the result in the parent working tree only
 * after a conflict-free `git apply --3way` against a throwaway parent index.
 * On conflict nothing in the parent changes and the worktree is retained.
 */

export const ISOLATED_WORKTREES_DIR = ".omo/worktrees"
const METADATA_FILE = "omo-isolation.json"
const EXCLUDE_PATTERN = "/.omo/worktrees/"

type GitResult = { code: number; stdout: string; stderr: string }

export type IsolationMetadata = { baseTree: string; parentRoot: string }

/** "skipped": changes exist but the caller asked not to apply them (worktree retained). */
export type WorktreeMergeStatus = "applied" | "no-changes" | "conflict" | "failed" | "skipped"

export type WorktreeMergeResult = {
  status: WorktreeMergeStatus
  worktreePath: string
  filesChanged: string[]
  conflictFiles: string[]
  /** Set when the worktree was kept on disk (conflict or failure). */
  retainedPath?: string
  /** Patch of the worktree's changes, kept next to a retained worktree for manual `git apply --3way`. */
  patchPath?: string
  error?: string
  /** Changes landed (or there were none) but the worktree directory could not be removed. */
  cleanupError?: string
}

export function toForwardSlashes(value: string): string {
  return value.replaceAll("\\", "/")
}

async function git(args: string[], cwd: string, env?: Record<string, string>): Promise<GitResult> {
  const child = runtimeSpawn({
    cmd: ["git", ...args],
    cwd,
    env: env ? { ...process.env, ...env } : undefined,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, stdout, stderr }
}

async function gitOrThrow(args: string[], cwd: string, env?: Record<string, string>): Promise<string> {
  const result = await git(args, cwd, env)
  if (result.code !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`}`)
  }
  return result.stdout
}

/** Top-level directory of the git working tree containing `directory`, or null outside git. */
export async function resolveGitRoot(directory: string): Promise<string | null> {
  const result = await git(["rev-parse", "--show-toplevel"], directory).catch(() => null)
  if (!result || result.code !== 0) return null
  const root = result.stdout.trim()
  return root ? toForwardSlashes(root) : null
}

async function withTemporaryIndex<T>(repoDir: string, fn: (env: Record<string, string>) => Promise<T>): Promise<T> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "omo-isolation-index-"))
  const indexPath = path.join(tempDir, "index")
  try {
    const realIndex = (await gitOrThrow(["rev-parse", "--path-format=absolute", "--git-path", "index"], repoDir)).trim()
    // Seeding from the real index keeps stat data, so `add -A` only rehashes changed files.
    await copyFile(realIndex, indexPath).catch((error: unknown) => {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
    })
    return await fn({ GIT_INDEX_FILE: indexPath })
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function writeTreeWithIndex(repoDir: string, env: Record<string, string>): Promise<string> {
  await gitOrThrow(["add", "-A", "--", "."], repoDir, env)
  return (await gitOrThrow(["write-tree"], repoDir, env)).trim()
}

/** Tree object of `repoDir`'s current working tree (tracked + untracked, ignores honored). The real index is untouched. */
export async function snapshotWorkingTree(repoDir: string): Promise<string> {
  return withTemporaryIndex(repoDir, (env) => writeTreeWithIndex(repoDir, env))
}

export async function isWorkingTreeDirty(repoDir: string): Promise<boolean> {
  const status = await gitOrThrow(["status", "--porcelain", "--untracked-files=all"], repoDir)
  return status.trim().length > 0
}

/** Keep isolated worktrees out of the parent's status and snapshots without editing tracked files. */
async function ensureExcluded(repoRoot: string, pattern: string): Promise<void> {
  const commonDir = (await gitOrThrow(["rev-parse", "--path-format=absolute", "--git-common-dir"], repoRoot)).trim()
  const excludePath = path.join(commonDir, "info", "exclude")
  const current = await readFile(excludePath, "utf8").catch(() => "")
  if (current.split(/\r?\n/).includes(pattern)) return
  await mkdir(path.dirname(excludePath), { recursive: true })
  await appendFile(excludePath, `${current.length > 0 && !current.endsWith("\n") ? "\n" : ""}${pattern}\n`)
}

async function metadataPath(worktreePath: string): Promise<string> {
  const gitDir = (await gitOrThrow(["rev-parse", "--path-format=absolute", "--git-dir"], worktreePath)).trim()
  return path.join(gitDir, METADATA_FILE)
}

/** Metadata of the isolated worktree rooted exactly at `worktreePath` (a subdirectory of one does not count). */
export async function readIsolationMetadata(worktreePath: string): Promise<IsolationMetadata | null> {
  try {
    const topLevel = await resolveGitRoot(worktreePath)
    if (!topLevel || path.resolve(topLevel).toLowerCase() !== path.resolve(await realpath(worktreePath)).toLowerCase()) return null
    const parsed = JSON.parse(await readFile(await metadataPath(worktreePath), "utf8")) as Partial<IsolationMetadata>
    if (typeof parsed.baseTree !== "string" || typeof parsed.parentRoot !== "string") return null
    return { baseTree: parsed.baseTree, parentRoot: parsed.parentRoot }
  } catch {
    return null
  }
}

export function defaultIsolatedWorktreePath(repoRoot: string, id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || id.includes("..")) throw new Error(`Invalid isolated worktree id: ${id}`)
  return `${toForwardSlashes(repoRoot)}/${ISOLATED_WORKTREES_DIR}/${id}`
}

/**
 * Create a detached worktree at `worktreePath` whose files equal `baseTree`
 * (defaults to a fresh snapshot of the parent, so uncommitted parent changes are included).
 */
export async function createIsolatedWorktree(input: {
  repoRoot: string
  worktreePath: string
  baseTree?: string
}): Promise<{ worktreePath: string; baseTree: string }> {
  const repoRoot = toForwardSlashes(input.repoRoot)
  const worktreePath = toForwardSlashes(path.resolve(repoRoot, input.worktreePath))
  await ensureExcluded(repoRoot, EXCLUDE_PATTERN)
  const relativeToRepo = toForwardSlashes(path.relative(repoRoot, worktreePath))
  if (relativeToRepo && !relativeToRepo.startsWith("../") && !path.isAbsolute(relativeToRepo) && !relativeToRepo.startsWith(`${ISOLATED_WORKTREES_DIR}/`)) {
    await ensureExcluded(repoRoot, `/${relativeToRepo}/`)
  }
  const baseTree = input.baseTree ?? await snapshotWorkingTree(repoRoot)

  await mkdir(path.dirname(worktreePath), { recursive: true })
  await gitOrThrow(["worktree", "add", "--detach", worktreePath, "HEAD"], repoRoot)
  try {
    const headTree = (await gitOrThrow(["rev-parse", "HEAD^{tree}"], worktreePath)).trim()
    if (headTree !== baseTree) {
      await gitOrThrow(["read-tree", "--reset", "-u", baseTree], worktreePath)
      // Leave the carried-over parent changes unstaged, as they are in the parent.
      await gitOrThrow(["reset", "-q"], worktreePath)
    }
    const metadata: IsolationMetadata = { baseTree, parentRoot: repoRoot }
    await writeFile(await metadataPath(worktreePath), `${JSON.stringify(metadata, null, 2)}\n`)
  } catch (error) {
    await removeIsolatedWorktree(repoRoot, worktreePath).catch(() => undefined)
    throw error
  }
  return { worktreePath, baseTree }
}

export async function removeIsolatedWorktree(parentRoot: string, worktreePath: string): Promise<void> {
  const result = await git(["worktree", "remove", "--force", worktreePath], parentRoot)
  if (result.code !== 0) {
    // Windows: a just-finished agent's process may still hold handles; rm retries EBUSY/EPERM.
    await rm(worktreePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    await git(["worktree", "prune"], parentRoot)
  }
}

/**
 * Drop the metadata first so an already-integrated worktree can never be merged twice,
 * then remove it. Returns the removal error instead of throwing: the merge already landed.
 */
async function retireWorktree(parentRoot: string, worktreePath: string): Promise<string | undefined> {
  try {
    await rm(await metadataPath(worktreePath), { force: true })
    await removeIsolatedWorktree(parentRoot, worktreePath)
    return undefined
  } catch (error) {
    return `worktree could not be removed (remove it later with \`git worktree remove --force ${worktreePath}\`): ${error instanceof Error ? error.message : String(error)}`
  }
}

function splitLines(output: string): string[] {
  return [...new Set(output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))]
}

/**
 * Bring the worktree's changes (relative to its base tree, including new untracked
 * files and any commits) back into the parent working tree. Never commits and never
 * touches the parent's real index. Removes the worktree only on success / no changes.
 * `apply: false` only inspects: an unchanged worktree is removed, a changed one is kept.
 */
export async function mergeBackWorktree(
  worktreePathInput: string,
  options: { apply?: boolean } = {},
): Promise<WorktreeMergeResult> {
  const worktreePath = toForwardSlashes(worktreePathInput)
  const base: WorktreeMergeResult = { status: "failed", worktreePath, filesChanged: [], conflictFiles: [] }
  const metadata = await readIsolationMetadata(worktreePath)
  if (!metadata) {
    return { ...base, retainedPath: worktreePath, error: "missing isolation metadata; worktree left untouched" }
  }
  const { baseTree, parentRoot } = metadata

  let patchPath: string | undefined
  try {
    const worktreeTree = await snapshotWorkingTree(worktreePath)
    if (worktreeTree === baseTree) {
      const cleanupError = await retireWorktree(parentRoot, worktreePath)
      return { ...base, status: "no-changes", ...(cleanupError ? { cleanupError } : {}) }
    }

    const filesChanged = splitLines(await gitOrThrow(["diff-tree", "-r", "--name-only", "--no-renames", baseTree, worktreeTree], parentRoot))
    const patch = await gitOrThrow(["diff-tree", "-r", "-p", "--binary", "--full-index", "--no-renames", baseTree, worktreeTree], parentRoot)
    patchPath = `${worktreePath}.patch`
    await writeFile(patchPath, patch)
    if (options.apply === false) {
      return { ...base, status: "skipped", filesChanged, retainedPath: worktreePath, patchPath }
    }

    const outcome = await withTemporaryIndex(parentRoot, async (env) => {
      const parentTree = await writeTreeWithIndex(parentRoot, env)
      const applied = await git(["apply", "--cached", "--3way", "--binary", "--whitespace=nowarn", patchPath!], parentRoot, env)
      if (applied.code !== 0) {
        const conflictFiles = splitLines(await gitOrThrow(["diff", "--name-only", "--diff-filter=U"], parentRoot, env).catch(() => ""))
        const error = applied.stderr.trim() || "git apply --3way failed"
        return conflictFiles.length > 0
          ? { kind: "conflict" as const, conflictFiles, error }
          : { kind: "failed" as const, error }
      }
      const mergedTree = (await gitOrThrow(["write-tree"], parentRoot, env)).trim()
      // The parent working tree equals parentTree, so this delta applies exactly.
      const delta = await gitOrThrow(["diff-tree", "-r", "-p", "--binary", "--full-index", "--no-renames", parentTree, mergedTree], parentRoot)
      if (delta.trim().length > 0) {
        const deltaPath = `${worktreePath}.merged.patch`
        await writeFile(deltaPath, delta)
        try {
          const landed = await git(["apply", "--binary", "--whitespace=nowarn", deltaPath], parentRoot)
          if (landed.code !== 0) return { kind: "failed" as const, error: landed.stderr.trim() || "git apply failed" }
        } finally {
          await rm(deltaPath, { force: true })
        }
      }
      return { kind: "applied" as const }
    })

    if (outcome.kind === "conflict") {
      return {
        ...base,
        status: "conflict",
        filesChanged,
        conflictFiles: outcome.conflictFiles,
        retainedPath: worktreePath,
        patchPath,
        error: outcome.error,
      }
    }
    if (outcome.kind === "failed") {
      return { ...base, filesChanged, retainedPath: worktreePath, patchPath, error: outcome.error }
    }

    await rm(patchPath, { force: true })
    const cleanupError = await retireWorktree(parentRoot, worktreePath)
    return { ...base, status: "applied", filesChanged, ...(cleanupError ? { cleanupError } : {}) }
  } catch (error) {
    return {
      ...base,
      retainedPath: worktreePath,
      ...(patchPath ? { patchPath } : {}),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
