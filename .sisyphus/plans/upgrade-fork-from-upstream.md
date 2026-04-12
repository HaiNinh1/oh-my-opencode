# Upgrade Fork: Sync oh-my-opencode with Upstream

## TL;DR

Complete the in-progress merge of 288 upstream commits into the fork, commit it, fix the 251 failing tests, and push. The merge is already conflict-free (no markers), typecheck passes, build passes. Only tests need fixing.

- **Deliverables**: Merged fork, all tests passing (or matching upstream's pass rate), pushed to origin
- **Estimated Effort**: Medium
- **Task Count**: 8 tasks across 4 phases

---

## Context

### Current State

| Property | Value |
|----------|-------|
| **Origin** | `https://github.com/HaiNinh1/oh-my-opencode.git` |
| **Upstream** | `https://github.com/code-yeongyu/oh-my-opencode.git` |
| **Current Branch** | `main` |
| **Package Version** | `3.11.0` |
| **Merge Base** | `261bbdf4` |
| **Commits Behind Upstream** | **288 commits** |
| **Your Custom Commits** | **5 commits** (ahead of upstream) |

### Merge Status (Verified)

- `MERGE_HEAD` exists pointing to `upstream/dev` at `9d936590`
- **Zero conflict markers** in any file (verified via `grep` and `git diff --check`)
- **`bun run typecheck` PASSES** (zero errors)
- **`bun run build` PASSES** (schema + ESM + declarations all good)
- **`bun test`: 3998 pass / 251 fail / 22 snapshot failures** across 410 files

### Your 5 Custom Commits

```
f0eb6f86 fix call 2
e9b369f2 fix name call for all agent
3d71d16a sync local changes to main
e4b37962 fix(hooks/preemptive-compaction): simplify compaction threshold check
5e981188 massive rework
```

These added: Heracles, Hermes, Mnemosyne agents; execute-plan hook; hermes-routing-guard hook; new tools (get-agent-prompts, resolve-atlas-context, resolve-heracles-context); plus various modifications.

### Stray Files to Clean

- `session-ses_323b.md` (session dump, should not be in repo)
- `session-ses_3257.md` (session dump, should not be in repo)

---

## Work Objectives

### Core Objective
Finalize the upstream merge, fix test failures, and push the synced fork.

### Definition of Done
- [ ] Merge committed (MERGE_HEAD gone)
- [ ] Stray session files removed and gitignored
- [ ] `bun run typecheck` passes (already passing pre-merge)
- [ ] `bun run build` succeeds (already passing pre-merge)
- [ ] `bun test` failures reduced to zero (or only pre-existing upstream failures remain); current: 3998 pass / 251 fail
- [ ] Pushed to `origin/main`

### Verified Pre-Merge State (as of plan creation)
- **Conflict markers**: ZERO (verified via `grep` and `git diff --check`)
- **`bun run typecheck`**: PASSES (zero errors)
- **`bun run build`**: PASSES (schema + ESM + declarations)
- **`bun test`**: 3998 pass / 251 fail / 22 snapshot failures across 410 files
- **LSP server**: NOT installed (`typescript-language-server` missing) - LSP diagnostics are unreliable/stale. Trust `bun run typecheck` and `bun test` only.

### Must-NOT-haves (Guardrails)
- Do NOT force push without creating backup branch first
- Do NOT delete custom agent code (Heracles, Hermes, Mnemosyne, etc.)
- Do NOT run `bun publish` or bump version
- Do NOT modify working business logic; only fix tests and broken imports
- Do NOT add `as any` or `@ts-ignore` to suppress errors

---

## Verification Strategy

- **Automated tests**: `bun test` (target: 0 failures or match upstream's failure count)
- **Type checking**: `bun run typecheck` (must remain at zero errors)
- **Build**: `bun run build` (must remain passing)
- **Smoke test**: `bunx oh-my-opencode doctor`

---

## TODOs

### Phase 0: Safety Net

#### TODO 0.1: Create backup branch [DONE]
- **What**: Create a restore point before committing the merge
- **Steps**:
  1. Run: `git branch pre-upgrade-backup main`
- **Must NOT do**: Do not delete existing `pre-merge-backup` branch
- **Acceptance Criteria**: `git branch --list pre-upgrade-backup` shows the branch exists
- **Commit**: NO

---

### Phase 1: Finalize the Merge

#### TODO 1.1: Remove stray files and update gitignore [DONE]
- **What**: Delete session dump files from the repo and prevent future commits of them
- **Steps**:
  1. Run: `git rm session-ses_323b.md session-ses_3257.md`
  2. Add `session-ses_*.md` to `.gitignore` (append to end of file)
  3. Run: `git add .gitignore`
- **References**:
  - `session-ses_323b.md` (root of repo)
  - `session-ses_3257.md` (root of repo)
  - `.gitignore` (root of repo)
- **Acceptance Criteria**: `git status` no longer shows session files; `.gitignore` contains the pattern
- **Commit**: NO (will be part of merge commit)

#### TODO 1.2: Commit the merge [DONE]
- **What**: Finalize the in-progress merge with all current state
- **Steps**:
  1. Run: `git add -A`
  2. Run: `git commit -m "merge: sync fork with upstream/dev (288 commits from code-yeongyu/oh-my-opencode)"`
  3. Verify: `git log -1 --oneline` shows merge commit
  4. Verify: MERGE_HEAD no longer exists (check with `git rev-parse MERGE_HEAD` which should fail)
- **Acceptance Criteria**: Merge commit exists; no MERGE_HEAD; `git status` is clean
- **Commit**: YES - `merge: sync fork with upstream/dev (288 commits from code-yeongyu/oh-my-opencode)`

---

### Phase 2: Verify and Fix

#### TODO 2.1: Run full verification and catalog failures [DONE]
- **What**: Run typecheck + build + tests to establish baseline after merge commit
- **Steps**:
  1. Run: `bun install` (in case dependencies changed)
  2. Run: `bun run typecheck` (expected: PASS)
  3. Run: `bun run build` (expected: PASS)
  4. Run: `bun test 2>&1` and capture the full output
  5. Catalog all failing test files with their error messages
- **Acceptance Criteria**: Typecheck and build pass; test failures cataloged with file paths and error types
- **Commit**: NO

#### TODO 2.2: Check which test failures exist on upstream too [DONE]
- **What**: Determine if failures are from your custom code or pre-existing upstream issues
- **Steps**:
  1. For each failing test file, check if the file was modified by your custom commits: `git diff 261bbdf4..f0eb6f86 --name-only | grep <test-file>`
  2. For failures in files you did NOT modify: these are upstream issues, document and skip
  3. For failures in files you DID modify: these need fixing
  4. Also check: `git stash && git checkout upstream/dev -- <failing-test-file> && bun test <file>` pattern to see if upstream's version of the test passes
- **Must NOT do**: Do not modify test files that are failing due to upstream bugs (not your fault)
- **Acceptance Criteria**: Clear list of (a) your-fault failures vs (b) upstream pre-existing failures
- **Commit**: NO

#### TODO 2.3: Fix test failures caused by the merge [DONE]
- **What**: Fix only the test failures that are caused by the fork's custom changes conflicting with upstream changes
- **Steps**:
  1. For each failing test in "your-fault" list from TODO 2.2:
     - Read the test file and the source file it tests
     - Identify why it fails (wrong import, changed API, snapshot mismatch, etc.)
     - Fix the test or source code to make it pass
  2. For snapshot failures: run `bun test --update-snapshots` if the new snapshots are correct
  3. Re-run `bun test` after each batch of fixes to track progress
- **Must NOT do**: Do not change business logic to make tests pass; fix the tests or the integration point
- **Must NOT do**: Do not add `as any`, `@ts-ignore`, or `@ts-expect-error`
- **References**: Use `bun test <specific-file>` to run individual tests during fixing
- **Acceptance Criteria**: `bun test` failure count reduced to only upstream pre-existing failures (or zero)
- **Commit**: YES - `fix: resolve test failures from upstream merge`

#### TODO 2.4: Final verification [DONE]
- **What**: Run the full verification suite one last time
- **Steps**:
  1. Run: `bun run typecheck` (must pass)
  2. Run: `bun run build` (must pass)
  3. Run: `bun test` (document final pass/fail count)
  4. Run: `bunx oh-my-opencode doctor` (smoke test)
- **Acceptance Criteria**: Typecheck passes, build passes, test results documented, doctor runs
- **Commit**: NO

---

### Phase 3: Push and Clean Up

#### TODO 3.1: Push to origin
- **What**: Push the merged and fixed code to the fork's remote
- **Steps**:
  1. Run: `git push origin main`
  2. Verify: `git status` shows "Your branch is up to date with 'origin/main'"
- **Acceptance Criteria**: Push succeeds; GitHub fork shows the merge commit
- **Commit**: N/A (push only)

#### TODO 3.2: Clean up backup branch
- **What**: Remove the backup branch now that everything is verified
- **Steps**:
  1. Only proceed if TODO 2.4 passed successfully
  2. Run: `git branch -d pre-upgrade-backup`
- **Acceptance Criteria**: Backup branch deleted; `git branch` no longer shows it
- **Commit**: NO

---

## Rollback Plan

If anything goes catastrophically wrong after the merge commit:
```bash
git reset --hard pre-upgrade-backup
git push origin main --force
```

---

## Final Verification Checklist

- [ ] No `<<<<<<<` conflict markers in any file
- [ ] `bun run typecheck` zero errors
- [ ] `bun run build` succeeds
- [ ] `bun test` results documented (pass count, fail count, which are upstream pre-existing)
- [ ] No `as any`, `@ts-ignore`, or empty `catch {}` added
- [ ] Custom agents (Heracles, Hermes, Mnemosyne) still present and functional
- [ ] `git status` clean after push
- [ ] Stray `session-ses_*.md` files removed and gitignored
