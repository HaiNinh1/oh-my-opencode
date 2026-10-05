import { appendFile, copyFile, mkdir, mkdtemp, readdir, readFile, rm, rmdir, stat, writeFile } from "node:fs/promises"
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
 *
 * `.omo/` (plugin runtime state, evidence, worktrees) is never snapshotted in or merged back.
 */

export const ISOLATED_WORKTREES_DIR = ".omo/worktrees"
const METADATA_FILE = "omo-isolation.json"
const EXCLUDE_PATTERN = "/.omo/worktrees/"
/** Applied as a pathspec (not via info/exclude) so the user's own `git status` still shows untracked `.omo/` config. */
const OMO_PATHSPEC = [".", ":(exclude).omo"]
const MIN_GIT_VERSION: readonly [number, number] = [2, 32]

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
  /** Patch of the worktree's changes, kept under `<repo>/.omo/worktrees/` for manual `git apply --3way`. */
  patchPath?: string
  error?: string
  /** Changes landed (or there were none) but the worktree directory could not be removed. */
  cleanupError?: string
  /** Gitignored paths created or changed in the worktree; these are never merged back. */
  ignoredNotMerged?: string[]
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

const LOCK_CONTENTION = /index\.lock|config\.lock|could not lock|unable to create .*\.lock/i

/** Retries a git command that lost a race for a repository lock file. */
async function gitWithLockRetry(args: string[], cwd: string, attempts = 3): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const result = await git(args, cwd)
    if (result.code === 0) return result.stdout
    if (attempt >= attempts || !LOCK_CONTENTION.test(result.stderr)) {
      throw new Error(`git ${args[0]} failed: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 150 * attempt))
  }
}

const repoQueues = new Map<string, Promise<void>>()

/** Process-wide per-repository mutex for worktree add/remove, exclude edits, and merge-back. */
async function withRepoMutex<T>(repoRoot: string, fn: () => Promise<T>): Promise<T> {
  const key = toForwardSlashes(path.resolve(repoRoot)).toLowerCase()
  const previous = repoQueues.get(key) ?? Promise.resolve()
  const run = previous.then(fn)
  const tail = run.then(() => undefined, () => undefined)
  repoQueues.set(key, tail)
  try {
    return await run
  } finally {
    if (repoQueues.get(key) === tail) repoQueues.delete(key)
  }
}

let gitSupportCheck: Promise<{ ok: boolean; version: string }> | undefined

/** Isolation relies on `--path-format=absolute` and modern `apply --3way --cached` (git >= 2.32). */
export async function checkGitIsolationSupport(): Promise<{ ok: boolean; version: string }> {
  gitSupportCheck ??= (async () => {
    const result = await git(["--version"], process.cwd()).catch(() => null)
    const version = result?.stdout.trim() ?? ""
    const match = /(\d+)\.(\d+)/.exec(version)
    if (!result || result.code !== 0 || !match) return { ok: false, version: version || "git not found" }
    const [major, minor] = [Number(match[1]), Number(match[2])]
    const ok = major > MIN_GIT_VERSION[0] || (major === MIN_GIT_VERSION[0] && minor >= MIN_GIT_VERSION[1])
    return { ok, version }
  })()
  return gitSupportCheck
}

export const MIN_GIT_VERSION_TEXT = `${MIN_GIT_VERSION[0]}.${MIN_GIT_VERSION[1]}`

/** Top-level directory of the git working tree containing `directory`, or null outside git. */
export async function resolveGitRoot(directory: string): Promise<string | null> {
  const result = await git(["rev-parse", "--show-toplevel"], directory).catch(() => null)
  if (!result || result.code !== 0) return null
  const root = result.stdout.trim()
  return root ? toForwardSlashes(root) : null
}

async function withTemporaryIndex<T>(repoDir: string, fn: (env: Record<string, string>, scratchDir: string) => Promise<T>): Promise<T> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "omo-isolation-index-"))
  const indexPath = path.join(tempDir, "index")
  try {
    const realIndex = (await gitOrThrow(["rev-parse", "--path-format=absolute", "--git-path", "index"], repoDir)).trim()
    // Seeding from the real index keeps stat data, so `add -A` only rehashes changed files.
    await copyFile(realIndex, indexPath).catch((error: unknown) => {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
    })
    return await fn({ GIT_INDEX_FILE: indexPath }, tempDir)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function writeTreeWithIndex(repoDir: string, env: Record<string, string>): Promise<string> {
  await gitOrThrow(["add", "-A", "--", ...OMO_PATHSPEC], repoDir, env)
  return (await gitOrThrow(["write-tree"], repoDir, env)).trim()
}

/** Tree object of `repoDir`'s current working tree (tracked + untracked, ignores and untracked `.omo/` skipped). The real index is untouched. */
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

async function worktreeGitDir(worktreePath: string): Promise<string> {
  return (await gitOrThrow(["rev-parse", "--path-format=absolute", "--git-dir"], worktreePath)).trim()
}

async function metadataPath(worktreePath: string): Promise<string> {
  return path.join(await worktreeGitDir(worktreePath), METADATA_FILE)
}

/**
 * Metadata of the isolated worktree rooted exactly at `worktreePath` (a subdirectory of one does not count).
 * Root-ness is asked of git itself (`--show-prefix` is empty at the top level), so 8.3 names,
 * junctions and `subst` drives cannot cause a path-string mismatch.
 */
export async function readIsolationMetadata(worktreePath: string): Promise<IsolationMetadata | null> {
  try {
    const prefix = await git(["rev-parse", "--show-prefix"], worktreePath)
    if (prefix.code !== 0 || prefix.stdout.trim() !== "") return null
    const parsed = JSON.parse(await readFile(await metadataPath(worktreePath), "utf8")) as Partial<IsolationMetadata>
    if (typeof parsed.baseTree !== "string" || typeof parsed.parentRoot !== "string") return null
    return { baseTree: parsed.baseTree, parentRoot: parsed.parentRoot }
  } catch {
    return null
  }
}

/**
 * Remove a member directory that has no isolation metadata, but only when that cannot lose work:
 * a missing or empty directory is removed; anything holding a `.git` marker or any content is kept.
 */
export async function removeDirectoryIfDisposable(directory: string): Promise<{ removed: boolean; error?: string }> {
  let entries: string[]
  try {
    if (!(await stat(directory)).isDirectory()) return { removed: false, error: `${directory} is not a directory; left in place` }
    entries = await readdir(directory)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { removed: true }
    return { removed: false, error: `could not inspect ${directory}: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (entries.includes(".git")) {
    return { removed: false, error: `${directory} is a git worktree/repository without readable isolation metadata; left in place, merge it manually` }
  }
  if (entries.length > 0) {
    return { removed: false, error: `${directory} is not empty; left in place so no member work is lost` }
  }
  await rmdir(directory)
  return { removed: true }
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
  return withRepoMutex(repoRoot, async () => {
    await ensureExcluded(repoRoot, EXCLUDE_PATTERN)
    const relativeToRepo = toForwardSlashes(path.relative(repoRoot, worktreePath))
    if (relativeToRepo && !relativeToRepo.startsWith("../") && !path.isAbsolute(relativeToRepo) && !relativeToRepo.startsWith(`${ISOLATED_WORKTREES_DIR}/`)) {
      await ensureExcluded(repoRoot, `/${relativeToRepo}/`)
    }
    const baseTree = input.baseTree ?? await snapshotWorkingTree(repoRoot)

    await mkdir(path.dirname(worktreePath), { recursive: true })
    await gitWithLockRetry(["worktree", "add", "--detach", worktreePath, "HEAD"], repoRoot)
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
  })
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

/** A fresh worktree contains no ignored files, so every ignored path present now was produced in it. */
async function listIgnoredPaths(worktreePath: string): Promise<string[]> {
  const status = await git(["status", "--porcelain", "--ignored=traditional", "--untracked-files=normal"], worktreePath)
  if (status.code !== 0) return []
  return splitLines(status.stdout)
    .filter((line) => line.startsWith("!! "))
    .map((line) => line.slice(3).replace(/^"|"$/g, ""))
    .filter((entry) => entry !== ".omo/" && !entry.startsWith(".omo/"))
}

async function retainedPatchPath(parentRoot: string, worktreePath: string): Promise<string> {
  const directory = `${toForwardSlashes(parentRoot)}/${ISOLATED_WORKTREES_DIR}`
  await mkdir(directory, { recursive: true })
  // Git names each linked worktree's admin dir uniquely per repository.
  return `${directory}/${path.basename(await worktreeGitDir(worktreePath))}.patch`
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
  return withRepoMutex(parentRoot, () => mergeBackLocked(worktreePath, baseTree, parentRoot, base, options))
}

async function mergeBackLocked(
  worktreePath: string,
  baseTree: string,
  parentRoot: string,
  base: WorktreeMergeResult,
  options: { apply?: boolean },
): Promise<WorktreeMergeResult> {
  let patchPath: string | undefined
  try {
    const ignored = await listIgnoredPaths(worktreePath)
    const ignoredNote = ignored.length > 0 ? { ignoredNotMerged: ignored } : {}
    const worktreeTree = await snapshotWorkingTree(worktreePath)
    if (worktreeTree === baseTree) {
      const cleanupError = await retireWorktree(parentRoot, worktreePath)
      return { ...base, status: "no-changes", ...ignoredNote, ...(cleanupError ? { cleanupError } : {}) }
    }

    const range = [baseTree, worktreeTree, "--", ...OMO_PATHSPEC]
    const filesChanged = splitLines(await gitOrThrow(["diff-tree", "-r", "--no-renames", "--name-only", ...range], parentRoot))
    if (filesChanged.length === 0) {
      // Only `.omo/` state differed: nothing to integrate.
      const cleanupError = await retireWorktree(parentRoot, worktreePath)
      return { ...base, status: "no-changes", ...ignoredNote, ...(cleanupError ? { cleanupError } : {}) }
    }
    const patch = await gitOrThrow(["diff-tree", "-r", "--no-renames", "-p", "--binary", "--full-index", ...range], parentRoot)
    patchPath = await retainedPatchPath(parentRoot, worktreePath)
    await writeFile(patchPath, patch)
    if (options.apply === false) {
      return { ...base, status: "skipped", filesChanged, retainedPath: worktreePath, patchPath, ...ignoredNote }
    }

    const outcome = await withTemporaryIndex(parentRoot, async (env, scratchDir) => {
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
      const delta = await gitOrThrow(["diff-tree", "-r", "-p", "--binary", "--full-index", "--no-renames", parentTree, mergedTree, "--", ...OMO_PATHSPEC], parentRoot)
      if (delta.trim().length > 0) {
        const deltaPath = path.join(scratchDir, "merged.patch")
        await writeFile(deltaPath, delta)
        const landed = await git(["apply", "--binary", "--whitespace=nowarn", deltaPath], parentRoot)
        if (landed.code !== 0) return { kind: "failed" as const, error: landed.stderr.trim() || "git apply failed" }
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
        ...ignoredNote,
      }
    }
    if (outcome.kind === "failed") {
      return { ...base, filesChanged, retainedPath: worktreePath, patchPath, error: outcome.error, ...ignoredNote }
    }

    await rm(patchPath, { force: true })
    const cleanupError = await retireWorktree(parentRoot, worktreePath)
    return { ...base, status: "applied", filesChanged, ...ignoredNote, ...(cleanupError ? { cleanupError } : {}) }
  } catch (error) {
    return {
      ...base,
      retainedPath: worktreePath,
      ...(patchPath ? { patchPath } : {}),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
