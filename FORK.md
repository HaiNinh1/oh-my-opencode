# This fork: setup on a new machine

One repo, two editions, installed side by side:

- **OpenCode edition** (`packages/omo-opencode`): loaded by OpenCode straight from this checkout's `dist/`. Has the fork-only tools `parallel_tasks` (worktree-isolated), `wiki_*`, `project_memory_*`, and team mode.
- **lazycodex** (`packages/omo-codex`): installed into `~/.codex`, stamped `dev`. Hooks show `(OmO dev)`.

Both share the fork skills (autopilot, ultraqa, ask, ccg, skillify) and the project's `.omo/` folder.

## Install

Prerequisites: Git (Git Bash on Windows), Bun, Node, `npm i -g opencode-ai`, and the Codex app or CLI.

```bash
git clone https://github.com/HaiNinh1/oh-my-opencode.git
cd oh-my-opencode
bun run install:fork
```

That builds the repo, installs lazycodex into Codex, points OpenCode's `opencode.json` and `tui.json` at this checkout, and writes `~/.omo/omo.jsonc` with ChatGPT-subscription model routing and team mode on. Existing config files are backed up as `*.bak-<timestamp>`. Use `--no-codex` or `--no-opencode` to install only one.

Then sign in once per machine:

```bash
opencode auth login          # OpenAI -> "ChatGPT Plus/Pro"
opencode models --refresh
# Codex: sign in from the Codex app (or `codex login`)
```

## Verify

```bash
bun dist/cli/index.js doctor
```

In Codex, new sessions show `(OmO dev)` in hook messages.

## Updating

```bash
git pull
bun run install:fork     # or just `bun run build` if only OpenCode code changed
```
