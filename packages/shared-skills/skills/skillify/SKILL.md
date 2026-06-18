---
name: skillify
description: "Distill the current session's repeatable workflow into a reusable OMO skill: extract the procedure, apply a quality gate, and WRITE a discoverable SKILL.md into the project's learned-skills directory. Aliases: learner. Triggers: skillify, learner, extract a skill, save this as a skill, turn this into a skill, make this reusable, capture this workflow, learn from this session."
---

# Skillify (alias: learner)

Use this skill when the current session uncovered a repeatable workflow that should become a reusable OMO skill. OMO can already LOAD learned skills and GENERATE AGENTS.md (`init-deep`); this skill is the missing EXTRACT step: it captures what you just figured out as a frontmatter `SKILL.md` that OMO auto-discovers next session.

> Compatibility: `learner` is a deprecated alias for this skill. Prefer `skillify` in docs and new workflows. Existing learner invocations keep working.

## Goal

Capture a successful multi-step workflow as a concrete, discoverable skill instead of rediscovering it later. The deliverable is a real `SKILL.md` written to a directory the OMO skill loader scans — not a chat-only draft.

## Core Principle

A reusable skill is not a snippet to copy-paste. It encodes **principles and decision-making heuristics** that teach an agent HOW TO THINK about a class of problems.

- BAD (mimicking): "When you see ConnectionResetError, paste this try/except."
- GOOD (reusable): "In async network code any I/O can fail independently because of client/server lifecycle mismatch; wrap each I/O op separately because failure between ops is the common case."

## Quality Gate (ALL three must be YES before extracting)

1. "Could someone Google this in 5 minutes?" -> NO
2. "Is this specific to THIS codebase, project, or workflow?" -> YES
3. "Did this take real debugging, design, or operational effort to discover?" -> YES

Prefer skills that encode constraints, pitfalls, recognition signals, and verification steps. Do NOT extract: generic programming patterns, refactoring techniques, library usage examples, type/boilerplate, or anything a junior could search in 5 minutes. If any gate answer is NO, STOP and tell the user it does not warrant a skill (suggest a note instead).

## Recognition Signals (extract ONLY after one of these)

- Solved a tricky bug that needed deep investigation.
- Found a non-obvious workaround specific to this codebase.
- Hit a hidden gotcha that wastes time when forgotten.
- Uncovered undocumented behavior that affects this project.

## Where OMO discovers learned skills (WRITE target)

The OMO skill loader (`packages/skills-loader-core/src/features/opencode-skill-loader/loader.ts`) scans these directories and loads any `<skill-name>/SKILL.md` inside them. A learned skill MUST live in its OWN subdirectory as `SKILL.md` (flat `<name>.md` files are NOT picked up by these project/user scans):

Project scope (walked from cwd up to the git worktree root — the DEFAULT target, committable with the repo):
- `.opencode/skills/<skill-name>/SKILL.md`  (OpenCode-native; preferred for OMO)
- `.claude/skills/<skill-name>/SKILL.md`     (Claude-compat)
- `.agents/skills/<skill-name>/SKILL.md`     (agents-compat)

User / global scope (only for truly portable, cross-project insights):
- `${CLAUDE_CONFIG_DIR:-~/.claude}/skills/<skill-name>/SKILL.md`
- `~/.agents/skills/<skill-name>/SKILL.md`
- OpenCode global config `skills/` or `skill/` dirs

Default to `.opencode/skills/<skill-name>/SKILL.md` unless the user asks for user-global. In a linked git worktree an uncommitted skill is worktree-local until committed.

## Workflow

1. Identify the single repeatable task the session accomplished. State it in one line.
2. Apply the Quality Gate above. If it fails, STOP — report why and do not write a file.
3. Extract the reusable structure:
   - one-line description + trigger keywords (error fragments, file names, symptoms — specific, not generic)
   - the insight / mental model (the principle, not the code)
   - recognition pattern (how to know it applies)
   - ordered steps / approach (decision heuristic)
   - constraints, pitfalls, and verification evidence
   - concrete anchors: real file paths, line numbers, error messages from THIS session
4. Choose the target directory (default `.opencode/skills/<skill-name>/SKILL.md`; see above).
5. WRITE the skill. Prefer the bundled scaffold so frontmatter and the `<name>/SKILL.md` layout are correct on every OS:

   ```bash
   node "@scripts/scaffold-skill.mjs" <skill-name> --dir=.opencode/skills --desc="<one-line description with Triggers: ...>"
   ```

   The scaffold creates `<dir>/<skill-name>/SKILL.md` with valid frontmatter and a body template, and is a NO-OP if a SKILL.md already exists there (it never clobbers a hand-edited skill). Then fill the body sections via Edit. If you cannot run the script, Write the file directly at the exact path `<dir>/<skill-name>/SKILL.md` using the frontmatter shape below.
6. Point out anything still too fuzzy to encode safely (unresolved branches, unverified assumptions).
7. Confirm discoverability: the file is at `<dir>/<skill-name>/SKILL.md`, has YAML frontmatter with `name` and `description`, and the dir is one the loader scans. Note that it surfaces next session (and as `shared/<name>` only if placed under the shared-skills bundle — not the usual learned-skill path).

## Required SKILL.md frontmatter

OMO parses these frontmatter keys: `name`, `description`, and optionally `model`, `agent`, `subtask`, `argument-hint`, `allowed-tools`, `license`, `compatibility`, `metadata`. The body after the frontmatter becomes the skill template. Minimum:

```yaml
---
name: <skill-name>
description: "<one-line description>. Triggers: <kw1>, <kw2>, <kw3>."
---
```

OMO folds trigger keywords into the `description` string (auto-discovery matches on description), so put them there rather than a separate `triggers:` list.

## Body template (fill after scaffolding)

```markdown
---
name: <skill-name>
description: "<one-line description>. Triggers: <kw1>, <kw2>, <kw3>."
---

# <Skill Name>

## The Insight
The underlying PRINCIPLE discovered — the mental model, not the code.

## Why This Matters
What goes wrong without it; the symptom that led here.

## Recognition Pattern
How to know this skill applies — the signs, with real file paths / error fragments.

## The Approach
The decision-making heuristic and ordered steps. How to THINK about this.

## Verification
How to confirm the approach worked (exact command / assertion / evidence).

## Example (optional)
Code only as illustration of the principle, not copy-paste material.
```

## Rules

- Only capture workflows that are actually repeatable and non-trivial.
- Keep the skill practical and scoped; explicit success criteria over vague prose.
- A skill is REUSABLE only if it applies to NEW situations, not just the identical one.
- Default to project scope (`.opencode/skills/`); reserve user-global for portable insights.
- Never write plain markdown without YAML frontmatter — undiscoverable.
- Never place the file as a flat `<name>.md` in a scanned skills dir; it must be `<name>/SKILL.md`.

## Output (report to the user)

- Proposed skill name
- Target path written (or the draft, if the gate failed / write was blocked)
- Quality-gate result (the three answers)
- How discoverability was confirmed
- Open questions, if any
