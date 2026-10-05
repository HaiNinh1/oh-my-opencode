/// <reference types="bun-types" />

import { afterAll, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  checkGitIsolationSupport,
  createIsolatedWorktree,
  removeDirectoryIfDisposable,
  defaultIsolatedWorktreePath,
  isWorkingTreeDirty,
  mergeBackWorktree,
  readIsolationMetadata,
  resolveGitRoot,
} from "./isolated-worktree"

const temporaryDirectories: string[] = []

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`)
  return result.stdout.toString()
}

async function readText(filePath: string): Promise<string> {
  return (await fs.readFile(filePath, "utf8")).replaceAll("\r\n", "\n")
}

async function exists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true, () => false)
}

async function initRepo(): Promise<string> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "isolated-worktree-")))
  temporaryDirectories.push(root)
  git(root, "init", "-q")
  git(root, "config", "user.email", "test@example.com")
  git(root, "config", "user.name", "Test User")
  git(root, "config", "core.autocrlf", "false")
  await fs.writeFile(path.join(root, "a.txt"), "1\n2\n3\n4\n5\n6\n7\n8\n")
  await fs.writeFile(path.join(root, "b.txt"), "b\n")
  git(root, "add", "-A")
  git(root, "commit", "-q", "-m", "init")
  return root
}

afterAll(async () => {
  for (const directory of temporaryDirectories) {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

describe("isolated worktree", () => {
  test("#given a Windows-style repo root #when building the default path #then it uses forward slashes under .omo/worktrees", () => {
    // given
    const repoRoot = "C:\\work\\repo"

    // when
    const worktreePath = defaultIsolatedWorktreePath(repoRoot, "pt-abc123-1")

    // then
    expect(worktreePath).toBe("C:/work/repo/.omo/worktrees/pt-abc123-1")
    expect(() => defaultIsolatedWorktreePath(repoRoot, "../escape")).toThrow("Invalid isolated worktree id")
  })

  test("#given a subdirectory of a repo #when resolving the git root #then it returns the forward-slash top level, and null outside git", async () => {
    // given
    const root = await initRepo()
    await fs.mkdir(path.join(root, "sub"))
    const outside = await fs.mkdtemp(path.join(tmpdir(), "isolated-worktree-nogit-"))
    temporaryDirectories.push(outside)

    // when
    const resolved = await resolveGitRoot(path.join(root, "sub"))
    const missing = await resolveGitRoot(outside)

    // then
    expect(resolved?.toLowerCase()).toBe(root.replaceAll("\\", "/").toLowerCase())
    expect(resolved).not.toContain("\\")
    expect(missing).toBeNull()
  })

  test("#given a dirty parent #when creating an isolated worktree #then uncommitted and untracked parent changes are carried in, unstaged, and the parent index is untouched", async () => {
    // given
    const root = await initRepo()
    await fs.writeFile(path.join(root, "b.txt"), "b-dirty\n")
    await fs.writeFile(path.join(root, "untracked.txt"), "u\n")
    git(root, "add", "b.txt")
    const parentStatusBefore = git(root, "status", "--porcelain")

    // when
    const { worktreePath, baseTree } = await createIsolatedWorktree({
      repoRoot: root,
      worktreePath: defaultIsolatedWorktreePath(root, "dirty-1"),
    })

    // then
    expect(worktreePath).not.toContain("\\")
    expect(await readText(path.join(worktreePath, "b.txt"))).toBe("b-dirty\n")
    expect(await readText(path.join(worktreePath, "untracked.txt"))).toBe("u\n")
    expect(git(worktreePath, "diff", "--cached", "--name-only").trim()).toBe("")
    expect(git(root, "status", "--porcelain")).toBe(parentStatusBefore)
    expect(await readIsolationMetadata(worktreePath)).toEqual({ baseTree, parentRoot: root.replaceAll("\\", "/") })
    expect(await isWorkingTreeDirty(root)).toBe(true)
  })

  test("#given two isolated worktrees with disjoint edits #when merging back sequentially #then both land in the parent uncommitted and the worktrees are removed", async () => {
    // given
    const root = await initRepo()
    const headBefore = git(root, "rev-parse", "HEAD").trim()
    const first = await createIsolatedWorktree({ repoRoot: root, worktreePath: defaultIsolatedWorktreePath(root, "seq-1") })
    const second = await createIsolatedWorktree({ repoRoot: root, worktreePath: defaultIsolatedWorktreePath(root, "seq-2"), baseTree: first.baseTree })
    await fs.writeFile(path.join(first.worktreePath, "a.txt"), "1-first\n2\n3\n4\n5\n6\n7\n8\n")
    await fs.writeFile(path.join(second.worktreePath, "a.txt"), "1\n2\n3\n4\n5\n6\n7\n8-second\n")
    // A commit inside the worktree is captured too, without moving the parent branch.
    await fs.writeFile(path.join(second.worktreePath, "committed.txt"), "c\n")
    git(second.worktreePath, "add", "committed.txt")
    git(second.worktreePath, "commit", "-q", "-m", "inside worktree")

    // when
    const firstResult = await mergeBackWorktree(first.worktreePath)
    const secondResult = await mergeBackWorktree(second.worktreePath)

    // then
    expect(firstResult.status).toBe("applied")
    expect(firstResult.filesChanged).toEqual(["a.txt"])
    expect(secondResult.status).toBe("applied")
    expect(secondResult.filesChanged.sort()).toEqual(["a.txt", "committed.txt"])
    expect(await readText(path.join(root, "a.txt"))).toBe("1-first\n2\n3\n4\n5\n6\n7\n8-second\n")
    expect(await readText(path.join(root, "committed.txt"))).toBe("c\n")
    expect(git(root, "rev-parse", "HEAD").trim()).toBe(headBefore)
    expect(git(root, "diff", "--cached", "--name-only").trim()).toBe("")
    expect(await exists(first.worktreePath)).toBe(false)
    expect(await exists(second.worktreePath)).toBe(false)
    expect(git(root, "worktree", "list")).not.toContain(".omo/worktrees")
  })

  test("#given a worktree that adds new untracked files #when merging back #then the files appear untracked in the parent", async () => {
    // given
    const root = await initRepo()
    const created = await createIsolatedWorktree({ repoRoot: root, worktreePath: defaultIsolatedWorktreePath(root, "new-files") })
    await fs.mkdir(path.join(created.worktreePath, "src", "nested"), { recursive: true })
    await fs.writeFile(path.join(created.worktreePath, "src", "nested", "new.ts"), "export const x = 1\n")
    await fs.rm(path.join(created.worktreePath, "b.txt"))

    // when
    const result = await mergeBackWorktree(created.worktreePath)

    // then
    expect(result.status).toBe("applied")
    expect(result.filesChanged.sort()).toEqual(["b.txt", "src/nested/new.ts"])
    expect(await readText(path.join(root, "src", "nested", "new.ts"))).toBe("export const x = 1\n")
    expect(await exists(path.join(root, "b.txt"))).toBe(false)
    expect(git(root, "status", "--porcelain")).toContain("?? src/")
  })

  test("#given a dirty parent and a worktree editing another region #when merging back #then parent edits survive alongside the worktree edits", async () => {
    // given
    const root = await initRepo()
    await fs.writeFile(path.join(root, "a.txt"), "1-parent\n2\n3\n4\n5\n6\n7\n8\n")
    const created = await createIsolatedWorktree({ repoRoot: root, worktreePath: defaultIsolatedWorktreePath(root, "dirty-merge") })
    await fs.writeFile(path.join(created.worktreePath, "a.txt"), "1-parent\n2\n3\n4\n5\n6\n7\n8-wt\n")
    await fs.writeFile(path.join(root, "a.txt"), "1-parent\n2\n3\n4-parent-later\n5\n6\n7\n8\n")

    // when
    const result = await mergeBackWorktree(created.worktreePath)

    // then
    expect(result.status).toBe("applied")
    expect(await readText(path.join(root, "a.txt"))).toBe("1-parent\n2\n3\n4-parent-later\n5\n6\n7\n8-wt\n")
  })

  test("#given a conflicting parent edit #when merging back #then the parent is untouched, the worktree is retained, and conflicting files are reported", async () => {
    // given
    const root = await initRepo()
    const created = await createIsolatedWorktree({ repoRoot: root, worktreePath: defaultIsolatedWorktreePath(root, "conflict") })
    await fs.writeFile(path.join(created.worktreePath, "a.txt"), "1-worktree\n2\n3\n4\n5\n6\n7\n8\n")
    await fs.writeFile(path.join(created.worktreePath, "fresh.txt"), "fresh\n")
    await fs.writeFile(path.join(root, "a.txt"), "1-parent\n2\n3\n4\n5\n6\n7\n8\n")

    // when
    const result = await mergeBackWorktree(created.worktreePath)

    // then
    expect(result.status).toBe("conflict")
    expect(result.conflictFiles).toEqual(["a.txt"])
    expect(result.retainedPath).toBe(created.worktreePath)
    expect(result.patchPath).toBeDefined()
    expect(await exists(result.patchPath!)).toBe(true)
    expect(result.patchPath!.toLowerCase()).toBe(`${root.replaceAll("\\", "/")}/.omo/worktrees/conflict.patch`.toLowerCase())
    expect(git(root, "status", "--porcelain", "--untracked-files=all")).not.toContain(".patch")
    expect(await readText(path.join(root, "a.txt"))).toBe("1-parent\n2\n3\n4\n5\n6\n7\n8\n")
    expect(await exists(path.join(root, "fresh.txt"))).toBe(false)
    expect(await readText(path.join(created.worktreePath, "a.txt"))).toBe("1-worktree\n2\n3\n4\n5\n6\n7\n8\n")
    expect(git(root, "diff", "--cached", "--name-only").trim()).toBe("")
  })

  test("#given a process still running inside the worktree #when merging back #then the merge still lands, removal problems are only a cleanup warning, and it cannot be merged twice", async () => {
    // given
    const root = await initRepo()
    const created = await createIsolatedWorktree({ repoRoot: root, worktreePath: defaultIsolatedWorktreePath(root, "busy") })
    await fs.writeFile(path.join(created.worktreePath, "busy.txt"), "busy\n")
    // Like a lingering agent process: on Windows its cwd handle blocks directory removal.
    const holder = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], { cwd: created.worktreePath, stdout: "ignore", stderr: "ignore" })

    // when
    let first: Awaited<ReturnType<typeof mergeBackWorktree>>
    try {
      first = await mergeBackWorktree(created.worktreePath)
    } finally {
      holder.kill()
      await holder.exited
    }
    const second = await mergeBackWorktree(created.worktreePath)

    // then
    expect(first.status).toBe("applied")
    expect(first.retainedPath).toBeUndefined()
    if (process.platform === "win32") expect(first.cleanupError).toContain("could not be removed")
    else expect(first.cleanupError).toBeUndefined()
    expect(await readText(path.join(root, "busy.txt"))).toBe("busy\n")
    expect(second.status).toBe("failed")
    expect(second.error).toContain("missing isolation metadata")
  })

  test("#given core.autocrlf=true and CRLF files in the parent #when a worktree edits them #then the merge applies cleanly and keeps CRLF", async () => {
    // given
    const root = await initRepo()
    git(root, "config", "core.autocrlf", "true")
    await fs.writeFile(path.join(root, "crlf.txt"), "one\r\ntwo\r\nthree\r\nfour\r\nfive\r\nsix\r\n")
    git(root, "add", "crlf.txt")
    git(root, "commit", "-q", "-m", "crlf")
    await fs.writeFile(path.join(root, "crlf.txt"), "ONE-parent\r\ntwo\r\nthree\r\nfour\r\nfive\r\nsix\r\n")
    const created = await createIsolatedWorktree({ repoRoot: root, worktreePath: defaultIsolatedWorktreePath(root, "crlf") })
    const carried = await fs.readFile(path.join(created.worktreePath, "crlf.txt"), "utf8")
    await fs.writeFile(path.join(created.worktreePath, "crlf.txt"), carried.replace("six", "SIX-worktree"))

    // when
    const result = await mergeBackWorktree(created.worktreePath)

    // then
    expect(result.status).toBe("applied")
    expect(await fs.readFile(path.join(root, "crlf.txt"), "utf8")).toBe("ONE-parent\r\ntwo\r\nthree\r\nfour\r\nfive\r\nSIX-worktree\r\n")
  })

  test("#given binary, renamed and deleted files in a worktree #when merging back #then all of them land byte-exact", async () => {
    // given
    const root = await initRepo()
    const binary = Buffer.from([0, 1, 2, 3, 255, 254, 0, 10, 13, 0])
    await fs.writeFile(path.join(root, "blob.bin"), binary)
    git(root, "add", "blob.bin")
    git(root, "commit", "-q", "-m", "binary")
    const created = await createIsolatedWorktree({ repoRoot: root, worktreePath: defaultIsolatedWorktreePath(root, "binary") })
    const changedBinary = Buffer.from([9, 0, 0, 255, 1, 2, 3])
    await fs.writeFile(path.join(created.worktreePath, "blob.bin"), changedBinary)
    await fs.writeFile(path.join(created.worktreePath, "new.bin"), Buffer.from([0, 0, 7, 0]))
    await fs.rename(path.join(created.worktreePath, "a.txt"), path.join(created.worktreePath, "renamed.txt"))
    await fs.rm(path.join(created.worktreePath, "b.txt"))

    // when
    const result = await mergeBackWorktree(created.worktreePath)

    // then
    expect(result.status).toBe("applied")
    expect(result.filesChanged.sort()).toEqual(["a.txt", "b.txt", "blob.bin", "new.bin", "renamed.txt"])
    expect(Buffer.compare(await fs.readFile(path.join(root, "blob.bin")), changedBinary)).toBe(0)
    expect(Buffer.compare(await fs.readFile(path.join(root, "new.bin")), Buffer.from([0, 0, 7, 0]))).toBe(0)
    expect(await readText(path.join(root, "renamed.txt"))).toBe("1\n2\n3\n4\n5\n6\n7\n8\n")
    expect(await exists(path.join(root, "a.txt"))).toBe(false)
    expect(await exists(path.join(root, "b.txt"))).toBe(false)
  })

  test("#given untracked .omo state on both sides #when isolating and merging back #then .omo is neither carried in nor merged back nor a conflict", async () => {
    // given
    const root = await initRepo()
    await fs.mkdir(path.join(root, ".omo", "run-continuation"), { recursive: true })
    await fs.writeFile(path.join(root, ".omo", "run-continuation", "parent.json"), "{\"parent\":true}\n")
    const created = await createIsolatedWorktree({ repoRoot: root, worktreePath: defaultIsolatedWorktreePath(root, "omo-state") })
    expect(await exists(path.join(created.worktreePath, ".omo", "run-continuation", "parent.json"))).toBe(false)
    await fs.mkdir(path.join(created.worktreePath, ".omo", "run-continuation"), { recursive: true })
    await fs.writeFile(path.join(created.worktreePath, ".omo", "run-continuation", "parent.json"), "{\"child\":true}\n")
    await fs.writeFile(path.join(created.worktreePath, ".omo", "run-continuation", "child.json"), "{}\n")
    await fs.writeFile(path.join(created.worktreePath, "real.txt"), "real\n")

    // when
    const result = await mergeBackWorktree(created.worktreePath)

    // then
    expect(result.status).toBe("applied")
    expect(result.filesChanged).toEqual(["real.txt"])
    expect(await readText(path.join(root, ".omo", "run-continuation", "parent.json"))).toBe("{\"parent\":true}\n")
    expect(await exists(path.join(root, ".omo", "run-continuation", "child.json"))).toBe(false)
  })

  test("#given only .omo state changed #when merging back #then it reports no changes", async () => {
    // given
    const root = await initRepo()
    const created = await createIsolatedWorktree({ repoRoot: root, worktreePath: defaultIsolatedWorktreePath(root, "omo-only") })
    await fs.mkdir(path.join(created.worktreePath, ".omo"), { recursive: true })
    await fs.writeFile(path.join(created.worktreePath, ".omo", "state.json"), "{}\n")

    // when
    const result = await mergeBackWorktree(created.worktreePath)

    // then
    expect(result.status).toBe("no-changes")
    expect(await exists(created.worktreePath)).toBe(false)
  })

  test("#given an agent writes gitignored files #when merging back #then they are reported as not merged", async () => {
    // given
    const root = await initRepo()
    await fs.writeFile(path.join(root, ".gitignore"), "node_modules/\n*.log\n")
    git(root, "add", ".gitignore")
    git(root, "commit", "-q", "-m", "ignore")
    const created = await createIsolatedWorktree({ repoRoot: root, worktreePath: defaultIsolatedWorktreePath(root, "ignored") })
    await fs.mkdir(path.join(created.worktreePath, "node_modules", "pkg"), { recursive: true })
    await fs.writeFile(path.join(created.worktreePath, "node_modules", "pkg", "index.js"), "x\n")
    await fs.writeFile(path.join(created.worktreePath, "debug.log"), "log\n")
    await fs.writeFile(path.join(created.worktreePath, "kept.txt"), "kept\n")

    // when
    const result = await mergeBackWorktree(created.worktreePath)

    // then
    expect(result.status).toBe("applied")
    expect(result.filesChanged).toEqual(["kept.txt"])
    expect(result.ignoredNotMerged?.sort()).toEqual(["debug.log", "node_modules/"])
    expect(await exists(path.join(root, "node_modules"))).toBe(false)
  })

  test("#given a worktree whose metadata cannot be read #when cleaning up #then neither merge nor disposal deletes it", async () => {
    // given
    const root = await initRepo()
    const created = await createIsolatedWorktree({ repoRoot: root, worktreePath: defaultIsolatedWorktreePath(root, "no-meta") })
    await fs.writeFile(path.join(created.worktreePath, "work.txt"), "unmerged work\n")
    const gitDir = git(created.worktreePath, "rev-parse", "--path-format=absolute", "--git-dir").trim()
    await fs.rm(path.join(gitDir, "omo-isolation.json"))
    const plain = path.join(root, "..", `${path.basename(root)}-plain`)
    temporaryDirectories.push(plain)
    await fs.mkdir(plain, { recursive: true })
    await fs.writeFile(path.join(plain, "notes.txt"), "member notes\n")
    const empty = path.join(root, "..", `${path.basename(root)}-empty`)
    await fs.mkdir(empty, { recursive: true })

    // when
    const merge = await mergeBackWorktree(created.worktreePath)
    const worktreeDisposal = await removeDirectoryIfDisposable(created.worktreePath)
    const plainDisposal = await removeDirectoryIfDisposable(plain)
    const emptyDisposal = await removeDirectoryIfDisposable(empty)

    // then
    expect(merge.status).toBe("failed")
    expect(worktreeDisposal.removed).toBe(false)
    expect(worktreeDisposal.error).toContain("git worktree")
    expect(await readText(path.join(created.worktreePath, "work.txt"))).toBe("unmerged work\n")
    expect(plainDisposal.removed).toBe(false)
    expect(await readText(path.join(plain, "notes.txt"))).toBe("member notes\n")
    expect(emptyDisposal.removed).toBe(true)
    expect(await exists(empty)).toBe(false)
  })

  test("#given concurrent creations in one repo #when they race #then all worktrees are created and excluded once", async () => {
    // given
    const root = await initRepo()

    // when
    const created = await Promise.all([1, 2, 3, 4].map((index) =>
      createIsolatedWorktree({ repoRoot: root, worktreePath: defaultIsolatedWorktreePath(root, `race-${index}`) })))

    // then
    expect(created).toHaveLength(4)
    const exclude = await fs.readFile(path.join(root, ".git", "info", "exclude"), "utf8")
    expect(exclude.split(/\r?\n/).filter((line) => line === "/.omo/worktrees/")).toHaveLength(1)
    expect((await checkGitIsolationSupport()).ok).toBe(true)
  })

  test("#given an untouched worktree #when merging back #then it reports no changes and removes the worktree", async () => {
    // given
    const root = await initRepo()
    const created = await createIsolatedWorktree({ repoRoot: root, worktreePath: defaultIsolatedWorktreePath(root, "noop") })

    // when
    const result = await mergeBackWorktree(created.worktreePath)

    // then
    expect(result.status).toBe("no-changes")
    expect(await exists(created.worktreePath)).toBe(false)
    expect(git(root, "status", "--porcelain").trim()).toBe("")
  })

  test("#given a plain directory without isolation metadata #when merging back #then it is left untouched and reported as failed", async () => {
    // given
    const directory = await fs.mkdtemp(path.join(tmpdir(), "isolated-worktree-plain-"))
    temporaryDirectories.push(directory)
    await fs.writeFile(path.join(directory, "keep.txt"), "keep\n")

    // when
    const result = await mergeBackWorktree(directory)

    // then
    expect(result.status).toBe("failed")
    expect(result.retainedPath).toBe(directory.replaceAll("\\", "/"))
    expect(await readText(path.join(directory, "keep.txt"))).toBe("keep\n")
  })
})
