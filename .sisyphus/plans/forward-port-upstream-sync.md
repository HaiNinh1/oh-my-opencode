# Forward-Port Plan: `upstream-sync-review` → `upstream/dev`

**Created:** 2026-04-15
**Status:** APPROVED — executing
**Strategy:** Forward-port (create integration branch from upstream/dev, transplant customizations)
**Conflict Policy:** Preserve all plugin behavior from upstream-sync-review
**Push Policy:** Local only

## Context

| Dimension | Value |
|---|---|
| Source branch | `upstream-sync-review` (15 commits ahead) |
| Target base | `upstream/dev` (924 commits ahead) |
| Merge base | `9d9365901b484f71cf1648d3de29973fab521227` |
| Conflicting files | ~180 across all subsystems |
| Integration branch | `integration/upstream-sync` |

### What our branch adds/changes
1. **Massive rework** of agent prompts (sisyphus, hephaestus, prometheus, metis, oracle)
2. **New parallel_tasks tool** (`src/tools/parallel-tasks/` — 6 files)
3. **New enhancer agent** (`src/agents/enhancer.ts`, `src/shared/enhancer-sessions.ts`)
4. **Agent display name symbols** (`src/shared/agent-display-names.ts`)
5. **Request dumping** (`dump_requests.py`, `opencode-enhance/`)
6. **Simplified preemptive compaction** (removed degradation-monitor, no-text-tail)
7. **Deleted files**: model-capabilities system, legacy-plugin-toast, webfetch-redirect-guard, formatter-trigger, various tests
8. **Heracles agent** (`src/agents/heracles/`) — new agent added
9. **Hermes agent** (`src/agents/hermes/`) — new agent added
10. **Mnemosyne agent** (`src/agents/mnemosyne/`) — new agent added
11. **Execute-plan hook** (`src/hooks/execute-plan/`)
12. **Hermes routing guard hook** (`src/hooks/hermes-routing-guard/`)
13. **Resolve-atlas-context tool** (`src/tools/resolve-atlas-context/`)
14. **Resolve-heracles-context tool** (`src/tools/resolve-heracles-context/`)
15. **Get-agent-prompts tool** (`src/tools/get-agent-prompts/`)

### What upstream added (924 commits)
- New agents: Mnemosyne, Heracles, Hermes (may overlap with ours)
- Atlas/Hephaestus/Sisyphus-Junior heavy refactors (prompt-sections split)
- Dynamic prompt builder split into 5 modules
- Agent definitions loader, posthog telemetry
- New hooks: tool-pair-validator, execute-plan, bash-file-read-guard, background-notification
- New skills: review-work, ai-slop-remover
- Model capabilities refactored into `model-capabilities/` directory
- Openclaw reply-listener split into 8+ submodules
- MCP OAuth refresh-mutex, scope filtering
- CI overhaul with `run-ci-tests.ts`
- Many test additions, bugfixes, docs

## Conflict Resolution Policy

- **Agent prompts/behavior**: Always preserve our modifications. Port into upstream's refactored file structure.
- **New upstream features**: Keep ALL upstream additions — they don't conflict with our plugin behavior.
- **Deletions**: Re-express as disabling at registration/config level rather than file deletion, unless upstream also removed the same file.
- **Tests**: Keep upstream's test additions. Modify tests only where they conflict with ported behavior.

---

## Phase 0: Safety Net
- [ ] `git tag pre-merge-ref upstream-sync-review`
- [ ] `git checkout -b integration/upstream-sync upstream/dev`

## Phase 1: Additive Features (Low Risk)

| Item | Action | Files |
|---|---|---|
| parallel_tasks tool | Copy entire directory from `upstream-sync-review` | `src/tools/parallel-tasks/*` (6 files: index.ts, parallel-executor.ts, result-formatter.ts, task-resolver.ts, tools.ts, tui-part-emitter.ts, types.ts) |
| Enhancer agent | Copy | `src/agents/enhancer.ts` |
| Enhancer sessions helper | Copy | `src/shared/enhancer-sessions.ts` |
| Request dumping | Copy | `dump_requests.py`, `opencode-enhance/*` |
| Heracles agent | Compare with upstream's version, keep ours if different | `src/agents/heracles/*` |
| Hermes agent | Compare with upstream's version, keep ours if different | `src/agents/hermes/*` |
| Mnemosyne agent | Compare with upstream's version, keep ours if different | `src/agents/mnemosyne/*` |
| Execute-plan hook | Compare with upstream's version | `src/hooks/execute-plan/*` |
| Hermes routing guard | Compare with upstream's version | `src/hooks/hermes-routing-guard/*` |
| Resolve-atlas-context tool | Copy/compare | `src/tools/resolve-atlas-context/*` |
| Resolve-heracles-context tool | Copy/compare | `src/tools/resolve-heracles-context/*` |
| Get-agent-prompts tool | Copy/compare | `src/tools/get-agent-prompts/*` |
| Register all new tools | Add to `src/tools/index.ts`, `src/plugin/tool-registry.ts` | |
| Register all new agents | Add to `src/agents/builtin-agents.ts`, display names | |
| **Verify** | `bun run build && bun run typecheck` | |

## Phase 2: Prompt/Behavior Modifications (High Risk)

For each agent, read the diff between merge-base and `upstream-sync-review` to extract behavioral intent, then apply to upstream's current files.

### Diff extraction command
```bash
git diff <merge-base>..upstream-sync-review -- <file>
```

| Agent | Our changes | Upstream structure | Action |
|---|---|---|---|
| Sisyphus | Heavy prompt rewrite (238 lines) | Split: `sisyphus/default.ts`, `gemini.ts`, `gpt-5-4.ts` + `sisyphus.ts` facade | Port prompt changes into split files |
| Hephaestus gpt-5-3-codex | 81 lines changed | Expanded to 162 lines | Port modifications |
| Hephaestus gpt-5-4 | 98 lines changed | Expanded to 471 lines | Port modifications |
| Prometheus (all) | Modified behavioral-summary, identity-constraints, interview-mode, plan-generation, plan-template | Upstream also modified | Prefer our prompt text, keep upstream structural improvements |
| Metis | 46 lines changed | 32 lines upstream | Port our changes |
| Oracle | 29 lines changed | 20 lines upstream | Port our changes |
| Dynamic prompt builder | 174 lines in monolith | Split into 5 modules: core-sections, policy-sections, category-skills-guide, tool-categorization, prompt-types | Port behavioral intent into split modules |
| Atlas default | 29 lines changed | Major restructure (prompt-sections) | Port into split structure |

## Phase 3: Hook/Plugin Behavior Modifications

| Hook | Our changes | Action |
|---|---|---|
| Preemptive compaction | Simplified threshold, removed degradation-monitor, removed no-text-tail | Port simplification. Upstream kept degradation-monitor — disable via config if needed |
| Keyword detector ultrawork | Modified default.ts (174 lines), gemini.ts, gpt.ts, planner.ts, source-detector.ts | Port prompt/behavior changes |
| Model fallback hook | 21 lines | Port into upstream's expanded version |
| Anthropic effort | 46 lines | Port into upstream's version |
| Atlas idle-event, tool-execute-after | Modified | Port, preserve upstream's new features |
| Thinking block validator | Simplified (143 lines) | Evaluate compatibility with upstream's simplification |
| Legacy plugin toast | We deleted; upstream kept & modified | Disable via `disabled_hooks` or keep upstream |
| Category skill reminder | Modified formatter + hook | Port into upstream's version |
| Tool output truncator | 6 lines added | Port |
| Auto-update checker | Modified | Port |

## Phase 4: Plugin Core Integration

| File | Action |
|---|---|
| `src/index.ts` | Keep upstream structure, add enhancer/parallel_tasks registration |
| `src/plugin-interface.ts` | Port our 94-line changes into upstream's version |
| `src/plugin/tool-registry.ts` | Add parallel_tasks + enhancer + new tools to upstream's expanded registry |
| `src/plugin/event.ts` | Port our changes into upstream's refactored version |
| `src/plugin/chat-message.ts` | Port changes |
| `src/plugin/chat-params.ts` | Port changes |
| `src/plugin/hooks/create-session-hooks.ts` | Port hook additions |
| `src/plugin/hooks/create-tool-guard-hooks.ts` | Port additions |
| `src/plugin-handlers/*` | Port into upstream's expanded handlers |
| `src/create-tools.ts` | Wire parallel_tasks and new tools |
| `src/create-managers.ts` | Port changes |

## Phase 5: Shared Utilities & Config

| Area | Action |
|---|---|
| `src/shared/agent-display-names.ts` | Merge display name symbols into upstream's expanded version |
| `src/shared/index.ts` | Add new exports (enhancer-sessions, passthrough-agents, etc.) |
| `src/config/schema/*` | Port schema changes (agent-names, commands, experimental, fallback-models) |
| `src/tools/delegate-task/constants.ts` | Port category changes, mnemosyne-plan-constants |
| `src/tools/delegate-task/*` | Port subagent resolver, model selection, sync-continuation changes |
| `src/tools/call-omo-agent/*` | Port changes |
| `src/shared/migration/agent-names.ts` | Port additions |
| `src/shared/connected-providers-cache.ts` | Port changes |
| `src/shared/model-requirements.ts` | Port changes |
| `src/shared/model-resolver.ts` | Port changes |

## Phase 6: Non-Core Files

| Area | Action |
|---|---|
| `.github/workflows/*` | Keep upstream CI |
| `docs/*` | Keep upstream docs |
| `README*.md` | Keep upstream, merge our additions |
| `package.json` | Keep upstream, add our deps if any |
| `test-setup.ts` | Merge |
| `assets/oh-my-opencode.schema.json` | Regenerate after code changes |

## Phase 7: Verification

1. `bun run build` — must exit 0
2. `bun run typecheck` — must exit 0
3. `bun test` — run and document pass/fail
4. Spot-check: enhancer agent registers, parallel_tasks registers, display name symbols show

## Rollback

```bash
git checkout upstream-sync-review
git branch -D integration/upstream-sync
git tag -d pre-merge-ref
```

## Risk Assessment

| Area | Risk | Reason |
|---|---|---|
| Agent prompts (sisyphus, hephaestus, prometheus) | **HIGH** | Both sides heavily modified; upstream refactored structure |
| Dynamic prompt builder | **HIGH** | Upstream split into 5 modules; our changes target old monolith |
| Plugin core (event.ts, tool-registry, chat-message) | **HIGH** | Both sides modified registration/wiring |
| Preemptive compaction | **MEDIUM** | Both modified; simplification vs additions |
| parallel_tasks tool | **LOW** | Clean additive |
| Enhancer agent | **LOW** | Clean additive |
| Model capabilities deletion | **MEDIUM** | Upstream refactored rather than deleted |

## Escalation Triggers

- Build/typecheck failures cascading through 10+ files → stop, report, propose alternative
- Upstream features fundamentally incompatible with our changes → stop, report
- Tests failing in unmodified areas → document as pre-existing, continue
