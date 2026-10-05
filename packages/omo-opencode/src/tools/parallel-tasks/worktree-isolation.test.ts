/// <reference types="bun-types" />

import { afterAll, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { formatResults } from "./result-formatter"
import type { ParallelTaskItem, TaskResult } from "./types"
import { buildWorktreePreamble, decideIsolation, mergeBackInOrder, prepareWorktrees } from "./worktree-isolation"

const temporaryDirectories: string[] = []

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`)
  return result.stdout.toString()
}

async function readText(filePath: string): Promise<string> {
  return (await fs.readFile(filePath, "utf8")).replaceAll("\r\n", "\n")
}

async function initRepo(): Promise<string> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "parallel-isolation-")))
  temporaryDirectories.push(root)
  git(root, "init", "-q")
  git(root, "config", "user.email", "test@example.com")
  git(root, "config", "user.name", "Test User")
  git(root, "config", "core.autocrlf", "false")
  await fs.mkdir(path.join(root, "pkg"))
  await fs.writeFile(path.join(root, "pkg", "a.ts"), "export const a = 1\n")
  await fs.writeFile(path.join(root, "pkg", "b.ts"), "export const b = 1\n")
  git(root, "add", "-A")
  git(root, "commit", "-q", "-m", "init")
  return root
}

afterAll(async () => {
  for (const directory of temporaryDirectories) {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

const impl = (overrides: Partial<ParallelTaskItem> = {}): ParallelTaskItem => ({
  description: "impl",
  prompt: "do",
  load_skills: [],
  category: "quick",
  ...overrides,
})
const research = (subagent_type = "explore"): ParallelTaskItem => ({ description: "r", prompt: "find", load_skills: [], subagent_type })

describe("parallel_tasks decideIsolation", () => {
  test("#given 2+ implementation items in a git repo #when no override #then implementation items get worktrees and research items do not", () => {
    // given
    const items = [impl(), impl({ category: undefined, subagent_type: "sisyphus-junior" }), research(), research("librarian")]

    // when
    const modes = decideIsolation({ items, inGitRepo: true })

    // then
    expect(modes).toEqual(["worktree", "worktree", "none", "none"])
  })

  test("#given a single implementation item #when no override #then it is not isolated", () => {
    // given
    const items = [impl(), research()]

    // when
    const modes = decideIsolation({ items, inGitRepo: true })

    // then
    expect(modes).toEqual(["none", "none"])
  })

  test("#given a session outside git #when isolation is requested #then nothing is isolated", () => {
    // given
    const items = [impl({ isolation: "worktree" }), impl()]

    // when
    const modes = decideIsolation({ items, callIsolation: "worktree", configDefault: "worktree", inGitRepo: false })

    // then
    expect(modes).toEqual(["none", "none"])
  })

  test("#given overrides #when deciding #then item beats call beats config, and research is never isolated", () => {
    // given
    const items = [impl({ isolation: "none" }), impl(), { ...research(), isolation: "worktree" as const }]

    // when
    const callLevel = decideIsolation({ items, callIsolation: "worktree", configDefault: "none", inGitRepo: true })
    const configLevel = decideIsolation({ items: [impl()], configDefault: "worktree", inGitRepo: true })
    const configNone = decideIsolation({ items: [impl(), impl()], configDefault: "none", inGitRepo: true })
    const configAuto = decideIsolation({ items: [impl(), impl()], configDefault: "auto", inGitRepo: true })

    // then
    expect(callLevel).toEqual(["none", "worktree", "none"])
    expect(configLevel).toEqual(["worktree"])
    expect(configNone).toEqual(["none", "none"])
    expect(configAuto).toEqual(["worktree", "worktree"])
  })
})

describe("parallel_tasks worktree lifecycle", () => {
  test("#given a session in a repo subdirectory #when preparing worktrees #then paths are forward-slash under .omo/worktrees and the session dir mirrors the subdirectory", async () => {
    // given
    const root = await initRepo()

    // when
    const prepared = await prepareWorktrees({ repoRoot: root.replaceAll("\\", "/"), sessionDirectory: path.join(root, "pkg"), indices: [0, 2] })

    // then
    expect([...prepared.keys()]).toEqual([0, 2])
    for (const [index, entry] of prepared) {
      if ("error" in entry) throw new Error(entry.error)
      expect(entry.worktreePath).not.toContain("\\")
      expect(entry.worktreePath).toMatch(new RegExp(`/\\.omo/worktrees/pt-[0-9a-f]{8}-${index + 1}$`))
      expect(entry.sessionDirectory).toBe(`${entry.worktreePath}/pkg`)
      expect(await readText(path.join(entry.sessionDirectory, "a.ts"))).toBe("export const a = 1\n")
    }
    expect(git(root, "status", "--porcelain").trim()).toBe("")
    expect(buildWorktreePreamble("C:/r/.omo/worktrees/pt-1", "C:/r")).toContain("Your working directory is C:/r/.omo/worktrees/pt-1")
  })

  test("#given finished items #when merging back in order #then successes land, a failed task's work is kept unmerged, and the report shows status and files", async () => {
    // given
    const root = (await initRepo()).replaceAll("\\", "/")
    await fs.writeFile(path.join(root, "pkg", "dirty.ts"), "export const dirty = true\n")
    const prepared = await prepareWorktrees({ repoRoot: root, sessionDirectory: root, indices: [0, 1, 2] })
    const worktreeOf = (index: number): string => {
      const entry = prepared.get(index)
      if (!entry || "error" in entry) throw new Error("missing worktree")
      return entry.worktreePath
    }
    expect(await readText(path.join(worktreeOf(0), "pkg", "dirty.ts"))).toBe("export const dirty = true\n")
    await fs.writeFile(path.join(worktreeOf(0), "pkg", "a.ts"), "export const a = 2\n")
    await fs.writeFile(path.join(worktreeOf(1), "pkg", "b.ts"), "export const b = 2\n")
    await fs.writeFile(path.join(worktreeOf(1), "pkg", "new.ts"), "export const created = 1\n")
    await fs.writeFile(path.join(worktreeOf(2), "pkg", "a.ts"), "export const a = 99\n")

    // when
    const reports = await mergeBackInOrder([
      { index: 2, worktreePath: worktreeOf(2), taskSucceeded: false },
      { index: 1, worktreePath: worktreeOf(1), taskSucceeded: true },
      { index: 0, worktreePath: worktreeOf(0), taskSucceeded: true },
    ])

    // then
    expect([...reports.keys()]).toEqual([0, 1, 2])
    expect(reports.get(0)?.merge?.status).toBe("applied")
    expect(reports.get(1)?.merge?.status).toBe("applied")
    expect(reports.get(1)?.merge?.filesChanged.sort()).toEqual(["pkg/b.ts", "pkg/new.ts"])
    expect(reports.get(2)?.merge?.status).toBe("skipped")
    expect(reports.get(2)?.merge?.retainedPath).toBe(worktreeOf(2))
    expect(await readText(path.join(root, "pkg", "a.ts"))).toBe("export const a = 2\n")
    expect(await readText(path.join(root, "pkg", "b.ts"))).toBe("export const b = 2\n")
    expect(await readText(path.join(root, "pkg", "new.ts"))).toBe("export const created = 1\n")
    expect(await readText(path.join(root, "pkg", "dirty.ts"))).toBe("export const dirty = true\n")
    expect(await fs.access(worktreeOf(2)).then(() => true, () => false)).toBe(true)

    const results: TaskResult[] = [0, 1, 2].map((index) => ({
      index,
      description: `item ${index}`,
      output: index === 2 ? "Task failed" : "Task completed in 1s",
      errorMessage: null,
      emitted: false,
      childSessionId: undefined,
      agent: "sisyphus-junior",
      isolation: reports.get(index),
    }))
    const text = formatResults(results, [], new Date(), 3)
    expect(text).toContain("Merge: applied")
    expect(text).toContain("Files changed: pkg/b.ts, pkg/new.ts")
    expect(text).toContain("Merge: skipped (task did not complete successfully; changes were not merged)")
    expect(text).toContain(`Worktree kept at ${worktreeOf(2)}`)
  })

  test("#given an unisolated item report #when formatting #then it states isolation none with the reason", () => {
    // given
    const result: TaskResult = {
      index: 0,
      description: "research",
      output: "Task completed in 1s",
      errorMessage: null,
      emitted: false,
      childSessionId: undefined,
      agent: "explore",
      isolation: { mode: "none", note: "research item" },
    }

    // when
    const text = formatResults([result], [], new Date(), 1)

    // then
    expect(text).toContain("Isolation: none (research item) | Merge: n/a")
  })
})
