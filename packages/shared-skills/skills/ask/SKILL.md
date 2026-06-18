---
name: ask
description: "Get a second opinion from a DIFFERENT model (GPT/Codex or Gemini) on a question, decision, or design, and CAPTURE the answer as an auditable artifact. Routes through OMO's native `task` tool with category-based model routing - NO external CLIs. Triggers: ask, ask codex, ask gpt, ask gemini, second opinion, get a second opinion, consult another model, cross-check this, sanity-check this decision, what would another model say."
metadata:
  short-description: Consult ONE different model for a second opinion and capture it as an artifact
---

# Ask - Single-Model Second Opinion (OMO-native)

You consult exactly ONE model that is DIFFERENT from yourself on a question, decision, or design, then CAPTURE its answer as an auditable artifact under `.omo/consults/`. This is a consultation discipline, not a chat: every consult leaves a durable, reviewable record of the question, the context you provided, and the raw answer.

OMO already routes work to different providers through delegation **categories** - you do NOT need any external CLI (`codex`, `gemini`, `claude`), no API keys, and no new dependencies. The `task` tool's `category` parameter selects the model/provider for you.

## The mechanism: category routing maps to a provider

OMO's built-in delegation categories each pin a concrete model. Picking a category is how you pick a DIFFERENT model:

| To consult... | Use category | Backing model |
| --- | --- | --- |
| **GPT / Codex** (deep reasoning) | `deep` | `openai/gpt-5.5` (medium) |
| **GPT / Codex** (hardest logic) | `ultrabrain` | `openai/gpt-5.5` (xhigh) |
| **GPT / Codex** (quick check) | `quick` | `openai/gpt-5.4-mini` |
| **Gemini** (UI / design / creative) | `visual-engineering` | `google/gemini-3.1-pro` |
| **Gemini** (unconventional angles) | `artistry` | `google/gemini-3.1-pro` |
| **Claude** (different-tier sanity check) | `unspecified-high` | `anthropic/claude-opus` |
| **Claude** (moderate effort) | `unspecified-low` | `anthropic/claude-sonnet` |

> The exact category roster is configurable per project. If a category above is missing, the `task` tool's error/description lists the available categories - pick the closest one whose backing model differs from your own. The point of `ask` is a DIFFERENT model, so never route a consult to a category whose model matches the one you are already running.

This is strictly better than shelling out to a CLI: routing inherits the user's existing provider auth/config, runs in-process, and the consulted model can read the repo with the same tools you have.

## Usage

```
/ask <gpt|codex|gemini|claude> <question, decision, or design to get a second opinion on>
```

Examples:

```
/ask gpt "Is an event queue or a polling cron the better fit for retrying failed webhooks here? Files: src/webhooks/**"
/ask gemini "Critique the UX of this onboarding flow - what would you change?"
/ask codex "Review this auth refactor for correctness and security holes."
```

`gpt`/`codex` -> `deep` (or `ultrabrain` for genuinely hard logic). `gemini` -> `visual-engineering` (UI) or `artistry` (open-ended). `claude` -> `unspecified-high`.

## Workflow

### 1. Frame the question and pick the model

- Restate the question, decision, or design in ONE crisp sentence. A second opinion is only as good as the question.
- Choose the target model per the table above. Default to `deep` (GPT) for architecture/correctness/debugging second opinions; `visual-engineering` (Gemini) for UI/UX; `artistry` (Gemini) when you want a deliberately different angle.
- Decide the context the other model needs: exact file paths, constraints, your current leaning, and what you already tried. The consulted model has NO memory of your session.

### 2. Scaffold the consult artifact FIRST

Run the scaffold script before dispatching, so the capture target exists no matter what:

```
node "<skill-root>/scripts/new-consult.mjs" <slug> --kind=ask --models=<model-label> --question="<one-line question>"
```

(`<skill-root>` = this skill's own directory; `bun` is an accepted substitute for `node`. `<model-label>` is a short tag like `gpt`, `gemini`, or `codex` - it only labels the artifact section.) It writes `.omo/consults/<timestamp>-<slug>.md` with a frontmatter header, a `## Question / Decision` block, a `## Context provided` block, an `## Answer: <model-label>` section, and a `## Takeaway`. Re-running on the same minute is a safe no-op.

### 3. Dispatch the consult to the DIFFERENT model

Use OMO's `task` tool with the chosen category. State the role and ask for a self-contained answer (the artifact must stand alone):

```
task(
  category="deep",          // GPT - or visual-engineering/artistry for Gemini
  load_skills=[],
  run_in_background=false,
  description="GPT second opinion",
  prompt="You are a peer reviewer giving a SECOND OPINION. Do not just agree.
  QUESTION: <one-line question>.
  CONTEXT: <files, constraints, what I already tried, my current leaning>.
  DELIVER: your recommendation, the key trade-off, and where you would push back on my leaning. Be concrete and self-contained - cite file paths."
)
```

If the chosen category is unavailable, the tool reports the available categories; pick the closest one backed by a DIFFERENT model than yours and proceed.

### 4. CAPTURE the raw answer (do not paraphrase)

APPEND the consulted model's response VERBATIM into the `## Answer: <model-label>` section of the artifact with `edit`/`apply_patch`. Capture, do not summarize - the raw answer is the auditable record. Then fill `## Question / Decision` and `## Context provided` if the script left placeholders, and set frontmatter `status: captured`.

### 5. Decide and record the takeaway

In `## Takeaway`, write 1-3 lines on how the second opinion changed or confirmed your plan. You are not obligated to follow it - but you ARE obligated to record what you did with it. Then report to the caller: the recommendation, whether you are adopting it, and the artifact path.

## Rules

- **Different model, always.** Never route an `ask` to a category whose backing model matches your own. The entire value is an outside perspective.
- **Capture, don't chat.** Every consult ends with a `.omo/consults/<timestamp>-<slug>.md` artifact containing the question, the context, and the RAW answer. No artifact = the consult did not happen.
- **No external CLIs.** Use the `task` tool with category routing. Do NOT shell out to `codex`, `gemini`, or `claude` binaries - OMO routes providers natively.
- **One model per `ask`.** For multiple models in parallel with synthesis, use the `ccg` skill instead.
- **Verbatim capture.** Append the answer unedited; put your own interpretation only in `## Takeaway`.

<user-request>
$ARGUMENTS
</user-request>
