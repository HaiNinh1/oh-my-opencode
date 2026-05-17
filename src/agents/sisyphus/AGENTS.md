# src/agents/sisyphus/ -- Orchestrator Variants

**Generated:** 2026-04-11

## OVERVIEW

5 files. Model-specific prompt variants for the Sisyphus main orchestrator. Parent `sisyphus.ts` routes to the correct variant based on active model.

## FILES

| File | Purpose |
|------|---------|
| `default.ts` | Base/Claude variant: task management, delegation guides, 542 LOC |
| `gemini.ts` | Gemini-optimized: stricter tool-usage rules, 5 NEVER rules |
| `gpt-5-4.ts` | GPT-5.4-native: 8-block architecture, entropy-reduced, 449 LOC |
| `claude-opus-4-7.ts` | Claude Opus 4.7-native: counters 4.7 defaults (fewer subagents, silent rationalization, literal following) with pre-tool checklist, hard-floor 3 parallel_tasks, lone-task() ban, worked failure example |
| `index.ts` | Barrel exports |

## VARIANT SELECTION

Parent `sisyphus.ts` selects variant by model name:
- `isClaudeOpus47Model(model)` (matches `claude-opus-4-7` or `claude-opus-4.7`) -> `claude-opus-4-7.ts`
- Contains "gemini" -> `gemini.ts`
- Contains "gpt-5.4" -> `gpt-5-4.ts`
- Default -> `default.ts` (Claude 4.6, Kimi, GLM, etc.)

Model matcher lives in `src/agents/types.ts::isClaudeOpus47Model()`.

## KEY EXPORTS

Each variant exports:
- `buildTaskManagementSection()` -- todo/task management prompt
- `buildSisyphusPrompt()` / `buildClaudeOpus47SisyphusPrompt()` / equivalent -- full prompt builder

## WHEN EDITING claude-opus-4-7.ts

Most research-phase tuning lives in three sections:
- `<self_knowledge>` -- 4.7 default-counter list + PRE-FIRST-TOOL CHECKLIST + TRIVIAL TEST
- `<investigate_before_acting>` -- 2-file rule, dispatch-first triggers, hard-floor-3, worked failure example
- `<using_subagents>` -- lone-task() ban, parallel_tasks usage

Behavior changes go here. Do NOT edit `default.ts` for 4.7-specific tuning.
