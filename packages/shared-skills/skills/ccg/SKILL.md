---
name: ccg
description: "Claude-Codex-Gemini tri-model consultation: ask Claude + GPT/Codex + Gemini the SAME question in PARALLEL via OMO's native parallel_tasks (per-item category/model routing - NO external CLIs), capture each raw answer as an artifact, then SYNTHESIZE one recommendation. Triggers: ccg, claude codex gemini, tri-model, ask all models, parallel second opinions, cross-validate across models, get multiple model perspectives, what do all three say."
metadata:
  short-description: Consult Claude + GPT + Gemini in parallel and synthesize one recommendation
---

# CCG - Claude / Codex(GPT) / Gemini Tri-Model Consultation (OMO-native)

You ask the SAME question to three DIFFERENT models in PARALLEL - Claude, GPT/Codex, and Gemini - capture each raw answer as an auditable artifact, then synthesize the three into ONE recommendation that calls out agreements and conflicts. Use this when one second opinion is not enough: high-stakes decisions, cross-validation, or a question that spans backend correctness AND UX.

This runs entirely through OMO's native delegation - **no external CLIs** (`codex`, `gemini`, `claude`), no API keys, no new dependencies. OMO's `parallel_tasks` tool fires all three concurrently with per-item `category` routing, and each category pins a different provider.

## The mechanism: parallel_tasks with per-item category routing

`parallel_tasks` runs multiple agents concurrently in ONE operation and returns all results together. Each task item picks its own `category`, and each category maps to a concrete model/provider - so a single `parallel_tasks` call fans the SAME question out to three models at once:

| Lane | category | Backing model |
| --- | --- | --- |
| **Codex / GPT** | `deep` (or `ultrabrain` for hardest logic) | `openai/gpt-5.5` |
| **Gemini** | `visual-engineering` (UI) or `artistry` (open-ended) | `google/gemini-3.1-pro` |
| **Claude** | `unspecified-high` | `anthropic/claude-opus` |

> If a category is unavailable in this project, `parallel_tasks` reports the available roster; substitute the closest category backed by the intended provider. The three lanes must resolve to three DIFFERENT models - that is the whole point.

This beats shelling out to CLIs: it inherits the user's provider auth/config, runs in-process, guarantees the three run concurrently (not sequentially across turns), and each consulted model can read the repo with the same tools you have.

## Usage

```
/ccg <question, decision, or design to cross-validate across Claude + GPT + Gemini>
```

Example:

```
/ccg "Should the realtime layer use SSE or WebSockets here? Cross-check correctness (GPT), client/UX implications (Gemini), and a Claude take. Files: src/realtime/**"
```

## When to use

- High-stakes architecture or design decisions where one opinion is not enough.
- Cross-validation: you suspect the models will disagree and want the disagreement surfaced.
- A request spanning backend/correctness AND UX/design in one shot (GPT lane + Gemini lane).
- You want parallel perspectives WITHOUT spinning up a tmux team or external CLIs.

For a single second opinion, use the lighter-weight `ask` skill instead.

## Workflow

### 1. Frame ONE shared question and tailor per-lane emphasis

- State the question/decision in ONE crisp sentence - all three lanes answer the SAME core question.
- Optionally bias each lane toward its strength: GPT -> correctness/architecture/risk/test strategy; Gemini -> UX/clarity/alternatives/edge-case usability; Claude -> a balanced independent take. Keep the core question identical so answers are comparable.
- Gather the context all three need: exact file paths, constraints, your current leaning, prior attempts. The consulted models have NO memory of your session.

### 2. Scaffold the consult artifact FIRST

```
node "<skill-root>/scripts/new-consult.mjs" <slug> --kind=ccg --models=claude,gpt,gemini --question="<one-line shared question>"
```

(`<skill-root>` = this skill's own directory; `bun` is an accepted substitute for `node`.) It writes `.omo/consults/<timestamp>-<slug>.md` pre-seeded with the question/context blocks, one `## Answer: <model>` section per lane (claude, gpt, gemini), and a `## Synthesis (Claude)` section. Re-running on the same minute is a safe no-op. Keep the `--models` labels aligned with your lanes so each raw answer has a home.

### 3. Fire all three lanes IN PARALLEL

ONE `parallel_tasks` call with three items, each routed to a different model. Send the SAME core question to each, with the lane-specific emphasis:

```
parallel_tasks({
  tasks: [
    {
      category: "deep",                 // Codex / GPT lane
      load_skills: [],
      description: "GPT perspective",
      prompt: "You are a peer reviewer giving an INDEPENDENT opinion - do not assume others agree with you. QUESTION: <shared question>. CONTEXT: <files, constraints, leaning, prior attempts>. EMPHASIS: correctness, architecture, risk, test strategy. DELIVER: your recommendation + the key trade-off + where you would push back. Self-contained, cite file paths."
    },
    {
      category: "visual-engineering",   // Gemini lane (use "artistry" for open-ended)
      load_skills: [],
      description: "Gemini perspective",
      prompt: "You are a peer reviewer giving an INDEPENDENT opinion. QUESTION: <shared question>. CONTEXT: <same context>. EMPHASIS: UX/clarity, alternatives, edge-case usability. DELIVER: recommendation + key trade-off + where you would push back. Self-contained, cite file paths."
    },
    {
      category: "unspecified-high",     // Claude lane (different tier from yourself)
      load_skills: [],
      description: "Claude perspective",
      prompt: "You are a peer reviewer giving an INDEPENDENT, balanced opinion. QUESTION: <shared question>. CONTEXT: <same context>. DELIVER: recommendation + key trade-off + where you would push back. Self-contained, cite file paths."
    }
  ]
})
```

Safety: these are READ-ONLY consultations, so the disjoint-file rule for `parallel_tasks` is satisfied trivially - no lane edits anything. If a category is unavailable, substitute per the table note. If a provider is genuinely unavailable, proceed with the lanes that resolve and record the gap in the synthesis.

### 4. CAPTURE each raw answer (do not paraphrase)

APPEND each lane's response VERBATIM into its matching `## Answer: <model>` section with `edit`/`apply_patch`. Capture, do not summarize - the raw answers are the auditable record and the inputs to your synthesis. Fill `## Question / Decision` and `## Context provided` if placeholders remain.

### 5. SYNTHESIZE into one recommendation (Claude)

In `## Synthesis (Claude)`, reconcile the three captured answers:

- **Agreements:** where the models converge (highest-confidence signal).
- **Conflicts:** where they disagree - call each out EXPLICITLY, with which lane said what.
- **Final recommendation:** the chosen direction and WHY you picked it over the alternatives the other lanes raised.
- **Action checklist:** concrete next steps.

Set frontmatter `status: synthesized`. Then return the synthesis to the caller along with the artifact path.

## Fallbacks

- One provider unavailable: continue with the remaining lanes + synthesis; note the missing perspective and its risk in the synthesis.
- Two unavailable: this degrades to an `ask`-style single second opinion + your own take; say so explicitly.
- Never silently drop a lane - the artifact must record which models actually answered.

## Rules

- **Three DIFFERENT models.** The three lanes must resolve to three distinct providers. Never route two lanes to the same backing model.
- **Same core question.** All lanes answer the SAME question; only the emphasis differs, so the answers are comparable.
- **Capture every raw answer.** Each lane's verbatim response goes into its `## Answer: <model>` section. No artifact = the consult did not happen.
- **Synthesize, don't average.** The synthesis must call out conflicts explicitly and make a real choice with rationale - not a mushy midpoint.
- **No external CLIs.** Use `parallel_tasks` with category routing. Do NOT shell out to `codex`, `gemini`, or `claude` binaries.

<user-request>
$ARGUMENTS
</user-request>
