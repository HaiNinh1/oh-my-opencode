# Hermes Transparent Proxy: Complete Implementation Plan

## 1. High-Level Design Summary

The system has two halves: a **plugin-side enforcement layer** in oh-my-opencode and a **forked TUI** vendored into this repo. The plugin enforces session pinning: on the first Hermes message, it parses the `@agent-name` AgentPart from `output.parts`, validates it against the allowed target list, and stores the target in a new `hermes-proxy-state` registry. On every subsequent Hermes `task()` call, the `tool.execute.before` hook rewrites args to reuse the pinned child `session_id`, and `tool.execute.after` captures the child session ID on first success. The forked TUI is a vendored snapshot of OpenCode v1.4.3's buildable packages, with exactly 6 files modified to: hide all non-Hermes agents from the picker, filter `@autocomplete` to show only Hermes-allowed targets, display the proxy target name (not "Hermes") in the prompt bar and assistant footer, and continue sending `agent: "hermes"` to the server on every submission. The server/plugin never changes execution identity: internally it is always Hermes routing to a pinned subagent. The TUI changes are purely cosmetic.

## 2. Scope and Goals

### What Changes (display-only in TUI, enforcement-only in plugin)
- **TUI**: Agent picker shows only Hermes. `@autocomplete` shows allowed proxy targets. Prompt bar renders proxy target name when pinned. Assistant footer shows target agent identity. Submission payload always sends `agent: "hermes"`.
- **Plugin**: First-message AgentPart parsing and validation. Session-keyed proxy state store. `tool.execute.before` rewrites `task()` args to pinned child session. `tool.execute.after` captures child session ID. Hermes prompt simplified for single-agent-per-session behavior. Cleanup on `session.deleted`.

### What Remains Unchanged (server-side)
- `sessionAgentMap` stays "hermes" for the parent session
- `input.agent` stays "hermes" on every turn
- Model resolution, fallback chains, permissions use Hermes identity
- All hooks (keyword-detector, think-mode, todo-continuation, output-pruning) see Hermes and behave accordingly
- MCPs, agent modes, Zod config, hook ordering untouched
- No OpenCode server code modified
- No protocol/schema changes

## 3. Detailed Architecture and Enforcement

### Proxy Metadata Flow

```
Turn 1:
  User types: "@sisyphus implement X"
  TUI sends: { agent: "hermes", parts: [{type:"text",...}, {type:"agent", name:"sisyphus"}] }
  
  chat.message hook:
    1. Detects Hermes session (input.agent === "hermes" or sessionAgentMap)
    2. Finds AgentPart in output.parts where type === "agent"
    3. Validates part.name against HERMES_ALLOWED_AGENTS
    4. Stores { targetAgent: "sisyphus" } in hermes-proxy-state for this sessionID
    5. Does NOT change input.agent or sessionAgentMap
  
  Hermes LLM runs, calls task(subagent_type="sisyphus", prompt="implement X")
  
  tool.execute.before:
    1. Hermes guard validates subagent_type matches proxy target
    2. Allows the call
  
  task() creates child session, returns result with <task_metadata>session_id: ses_child</task_metadata>
  
  tool.execute.after:
    1. Extracts session_id from task_metadata
    2. Pins { targetAgent: "sisyphus", childSessionID: "ses_child" } in proxy state

Turn 2+:
  User types: "now add tests"
  TUI sends: { agent: "hermes", parts: [{type:"text", text:"now add tests"}] }
  
  Hermes LLM runs, calls task(session_id="ses_child", prompt="now add tests")
  -- OR calls task(subagent_type="sisyphus", prompt="now add tests")
  
  tool.execute.before:
    1. Detects pinned state for this Hermes session
    2. If task has session_id matching pinned child: allow
    3. If task has subagent_type but no session_id: rewrite to session_id=pinned child, clear subagent_type
    4. If task targets different agent: reject with error
    5. Block category routing, get_agent_prompts, resolve_* tools, background mode
```

### State Store Design

```typescript
// src/shared/hermes-proxy-state.ts
interface HermesProxyMetadata {
  targetAgent: string
  childSessionID?: string
}

const store = new Map<string, HermesProxyMetadata>()

export function setHermesProxyTarget(sessionID: string, targetAgent: string): void
export function pinHermesChildSession(sessionID: string, childSessionID: string): void
export function getHermesProxyState(sessionID: string): HermesProxyMetadata | undefined
export function clearHermesProxyState(sessionID: string): void
export function hasHermesProxyTarget(sessionID: string): boolean
```

## 4. Files and Directories to Copy for TUI Fork

### Target Location

```
vendor/opencode-v1.4.3/
```

### What to Copy

The TUI is not standalone. It requires the full buildable package context. Copy these from `/mnt/windows_data/Code/opencode/` at the v1.4.3 tag:

| Source | Target | Reason |
|--------|--------|--------|
| `packages/opencode/` | `vendor/opencode-v1.4.3/packages/opencode/` | Contains TUI, server, CLI, build scripts. The TUI imports server/config/session/tools/LSP modules |
| `packages/sdk/js/` | `vendor/opencode-v1.4.3/packages/sdk/js/` | TUI imports `@opencode-ai/sdk/v2` types. SDK is a workspace dependency |
| `packages/plugin/` | `vendor/opencode-v1.4.3/packages/plugin/` | TUI plugin runtime imports `@opencode-ai/plugin` types |
| `package.json` | `vendor/opencode-v1.4.3/package.json` | Workspace resolution, Bun version, catalog versions |
| `tsconfig.json` | `vendor/opencode-v1.4.3/tsconfig.json` | Shared TS config base if referenced |
| `bun.lock` | `vendor/opencode-v1.4.3/bun.lock` | Reproducible dependency resolution |

### What NOT to Copy

| Excluded | Reason |
|----------|--------|
| `packages/app/` | Web UI, not imported by TUI |
| `packages/ui/` | Shared web components, not imported by TUI |
| `.github/`, docs, `.changeset/` | CI/docs irrelevant to fork |
| `packages/opencode/src/__tests__/` | Upstream tests, not needed for build |

### Manifest File

Create `vendor/opencode-v1.4.3/VENDOR_MANIFEST.md`:
```
Upstream: https://github.com/opencode-ai/opencode
Tag: v1.4.3
Commit: <sha>
Date: <date>
Modified files (Hermes proxy):
  - packages/opencode/src/cli/cmd/tui/context/local.tsx
  - packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx
  - packages/opencode/src/cli/cmd/tui/routes/session/index.tsx
  - packages/opencode/src/cli/cmd/tui/component/dialog-agent.tsx
  - packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx
  - packages/opencode/src/cli/cmd/tui/routes/session/subagent-footer.tsx
```

## 5. Plugin Code Areas to Change or Add

### New Files

| File | Description | Impact |
|------|-------------|--------|
| `src/shared/hermes-proxy-state.ts` | Session-keyed `Map<string, HermesProxyMetadata>` with `set/pin/get/clear/has` API. Follows `session-category-registry.ts` pattern | **Critical** - central proxy state |
| `src/shared/hermes-proxy-state.test.ts` | Unit tests for store CRUD and edge cases | Required |

### Modified Files (Highest Impact First)

| File | Change | Impact |
|------|--------|--------|
| `src/plugin/chat-message.ts` | **At the top, before enhancer check**: Parse `output.parts` for `type === "agent"` on first Hermes root session message. Validate against `HERMES_ALLOWED_AGENTS`. Call `setHermesProxyTarget()`. Reject if missing/multiple/invalid with thrown error containing user-facing message. Consume `firstMessageVariantGate` only after successful parse | **Critical** |
| `src/hooks/hermes-routing-guard/hook.ts` | Extend to enforce proxy pinning. Pre-pin: validate first `task()` target matches declared proxy target. Post-pin: rewrite `task()` args to `session_id=childSessionID`, clear `category`/`subagent_type`. Block `get_agent_prompts`, `resolve_atlas_context`, `resolve_heracles_context` when pinned. Block `run_in_background=true`. Throw on target mismatch | **Critical** |
| `src/plugin/tool-execute-after.ts` | After existing `task-resume-info` hook: for Hermes sessions, extract `session_id` from `<task_metadata>` in tool output. Call `pinHermesChildSession()` on first success | **High** |
| `src/agents/hermes/index.ts` | Simplify prompt for single-agent-per-session mode. Remove multi-agent routing examples. Emphasize: "Reuse session_id from previous task result. Never create new sessions after first delegation. Forward user message as prompt" | **High** |
| `src/plugin/event.ts` | In `session.deleted` handler: add `clearHermesProxyState(sessionID)` | **Medium** |
| `src/hooks/hermes-routing-guard/constants.ts` | Export allowed agents list for reuse by chat-message parser. Already contains the canonical list | **Low** |

### Files to Inspect but NOT Modify

| File | Reason |
|------|--------|
| `src/features/claude-code-session-state/state.ts` | Do NOT add proxy state here. Separate store per convention |
| `src/shared/passthrough-agents.ts` | Hermes stays passthrough. Do not change |
| `src/tools/delegate-task/task-output-pruner.ts` | Output pruning stays. Hermes doesn't need child output text |
| `src/plugin/messages-transform.ts` | No changes needed. Transform stage unaffected |

## 6. TUI Changes in the Fork

All paths relative to `vendor/opencode-v1.4.3/packages/opencode/src/cli/cmd/tui/`.

### 6.1 `context/local.tsx` - Agent Filtering

**Current behavior**: `agents = sync.data.agent.filter((x) => x.mode !== "subagent" && !x.hidden)` - shows all primary/all non-hidden agents in picker.

**Change**: Filter to show ONLY Hermes (or agents explicitly marked for Hermes proxy mode).

```typescript
// Replace agent filter at ~line 38
agents = sync.data.agent.filter((x) => 
  x.mode !== "subagent" && !x.hidden && isHermesProxyAgent(x.name)
)
```

Where `isHermesProxyAgent` checks against a hardcoded or config-driven list (initially just `"hermes"`).

**What stays unchanged**: Color lookup list (`visibleAgents`), `current()` accessor, `set()` validation, `move()` cycling, agent-model coupling. Submission always sends `local.agent.current().name` which will be "hermes".

### 6.2 `component/prompt/index.tsx` - Prompt Bar Display

**Current behavior**: Renders `Locale.titlecase(local.agent.current().name)` at ~line 1094. Shows "Hermes ☤ (Task Router)".

**Change**: When a proxy target is active for the current session, display the target name instead. The proxy target can be derived from the latest `@agent` part in the first message of the session, or from assistant message metadata if the plugin emits it.

**Implementation approach**: Read the last user message's agent parts from `sync.data` to find the pinned target. Display `"Hermes -> {Target}"` or just `"{Target}"` with a subtle routing indicator.

**What stays unchanged**: Submit payload always sends `agent: local.agent.current().name` (= "hermes"). Session-change restore logic. Spinner color. Prompt highlight border.

### 6.3 `routes/session/index.tsx` - Message Rendering

**Current behavior**: 
- User message color: `local.agent.color(props.message.agent)` at ~line 1254
- Assistant footer: colored glyph by `local.agent.color(props.message.agent)`, label from `Locale.titlecase(props.message.mode)` at ~line 1411

**Change**:
- User message color: Derive from proxy target agent color when in a Hermes proxy session
- Assistant footer label: Show proxy target name instead of "hermes" when proxy is active

**What stays unchanged**: Message structure, model display, duration display, plan_enter/plan_exit auto-switch, tool rendering.

### 6.4 `component/dialog-agent.tsx` - Selection Dialog

**Current behavior**: Shows `local.agent.list()` as options.

**Change**: Since `local.tsx` already filters to Hermes-only, the dialog will only show Hermes. Optionally, hide the dialog entirely or show a message that Hermes is the only available agent.

**What stays unchanged**: Selection mechanism, dialog open/close.

### 6.5 `component/prompt/autocomplete.tsx` - @Agent Suggestions

**Current behavior**: Shows `sync.data.agent.filter(a => !a.hidden && a.mode !== "primary")` at ~line 337-340. Excludes primary agents.

**Change**: Filter to show only agents in the Hermes allowed target list: `atlas`, `prometheus`, `mnemosyne`, `heracles`, `hephaestus`, `sisyphus`.

```typescript
// Replace filter at ~line 337
const HERMES_ALLOWED_TARGETS = new Set(["atlas", "prometheus", "mnemosyne", "heracles", "hephaestus", "sisyphus"])
sync.data.agent.filter(a => !a.hidden && HERMES_ALLOWED_TARGETS.has(a.name.toLowerCase()))
```

**What stays unchanged**: AgentPart insertion mechanism (still creates `{type: "agent", name: "..."}` parts). Mixed file/agent/MCP autocomplete structure. Display format.

### 6.6 `routes/session/subagent-footer.tsx` - Subagent Label

**Current behavior**: Parses session title with `/@(\w+) subagent/` regex at ~line 21.

**Change**: Use the extracted agent name as the primary session label. Potentially add a "routed by Hermes" indicator for admin visibility.

**What stays unchanged**: Sibling position calculation, basic render structure.

## 7. Enforcement Rules (Server-Side Plugin)

### Rule 1: Users Can Only Select Hermes in the UI

**Enforcement layer**: TUI-side only (forked `local.tsx`).

**Plugin-side safety net**: The plugin does not need to reject non-Hermes `input.agent` values, but the proxy state logic only activates when `input.agent` matches Hermes. If someone bypasses the TUI and sends a different agent, the proxy system simply doesn't engage, and standard behavior applies.

### Rule 2: First-Message @agent-name Pins the Session

**Enforcement location**: `src/plugin/chat-message.ts`, at the top of the handler before all existing hooks.

**Logic**:
```
if session is Hermes AND is first root message AND no proxy target set:
  agentParts = output.parts.filter(p => p.type === "agent")
  if agentParts.length === 0:
    throw "Start your message with @agent-name to choose a target agent"
  if agentParts.length > 1:
    throw "Only one @agent-name allowed per session"
  if agentParts[0].name not in HERMES_ALLOWED_AGENTS:
    throw "Agent '{name}' is not available. Use one of: {list}"
  setHermesProxyTarget(sessionID, normalizedName)
```

**Rejection**: By throwing an error. This is the established short-circuit mechanism in `chat.message` (proven by `claude-code-hooks` block behavior).

### Rule 3: All Subsequent Turns Reuse Pinned Session

**Enforcement location**: `src/hooks/hermes-routing-guard/hook.ts` (extended).

**Logic for pinned sessions**:
```
if Hermes session AND hasHermesProxyTarget(sessionID):
  proxyState = getHermesProxyState(sessionID)
  
  if tool is get_agent_prompts OR resolve_atlas_context OR resolve_heracles_context:
    throw "Helper tools blocked in pinned proxy session"
  
  if tool is task:
    if args.run_in_background === true:
      throw "Background routing not supported in proxy mode"
    
    if proxyState.childSessionID exists:
      // Post-pin: force continuation
      args.session_id = proxyState.childSessionID
      delete args.category
      delete args.subagent_type
    else:
      // Pre-pin: validate first task matches target
      if args.subagent_type and normalize(args.subagent_type) !== proxyState.targetAgent:
        throw "Cannot route to {args.subagent_type}. Session pinned to {proxyState.targetAgent}"
```

### Rule 4: Fail-Closed Behavior

| Invalid State | Behavior |
|--------------|----------|
| No `@agent` on first Hermes message | Throw error with usage hint |
| Multiple `@agent` parts | Throw error |
| Unknown agent name | Throw error with allowed list |
| `task()` targeting different agent after pin | Throw error |
| Background mode attempted | Throw error |
| Child session deleted | `clearHermesProxyState` on next `session.deleted` event. Next `task()` call fails because child session no longer exists (OpenCode returns error). Plugin could also pre-check and throw with "Pinned session no longer exists" |
| Category routing attempted | Throw error (existing guard behavior) |
| Helper tools (get_agent_prompts, resolve_*) | Throw error when proxy is pinned |

## 8. Minimal Proof-of-Concept Change Set

### Phase 1: Plugin-Side Proxy Enforcement (Day 1)

**Files to create:**
- `src/shared/hermes-proxy-state.ts` - proxy state store (Map + CRUD)
- `src/shared/hermes-proxy-state.test.ts` - store unit tests

**Files to modify:**
- `src/plugin/chat-message.ts` - add AgentPart parsing block at top
- `src/hooks/hermes-routing-guard/hook.ts` - add pinned-session enforcement
- `src/hooks/hermes-routing-guard/constants.ts` - export allowed agents for reuse
- `src/plugin/tool-execute-after.ts` - add child session ID capture
- `src/plugin/event.ts` - add proxy state cleanup on session.deleted
- `src/agents/hermes/index.ts` - simplify prompt for single-target mode

**Tests to add:**
- `src/shared/hermes-proxy-state.test.ts` - CRUD, duplicate set, clear
- `src/hooks/hermes-routing-guard/hermes-proxy-enforcement.test.ts`:
  - First turn: valid @agent pins target
  - First turn: missing @agent throws
  - First turn: multiple @agent throws
  - First turn: invalid agent name throws
  - Post-pin: task() rewritten to session_id
  - Post-pin: mismatched target rejected
  - Post-pin: background mode rejected
  - Post-pin: helper tools blocked
  - Non-Hermes session: no proxy logic fires
  - Session.deleted: state cleaned up
- `src/plugin/chat-message.test.ts` - extend existing tests for AgentPart parsing

### Phase 2: TUI Fork (Day 2)

**Setup:**
- Copy vendored OpenCode into `vendor/opencode-v1.4.3/`
- Verify build with `bun run build` from `vendor/opencode-v1.4.3/packages/opencode/`
- Create `vendor/opencode-v1.4.3/VENDOR_MANIFEST.md`

**Files to modify** (all under `vendor/opencode-v1.4.3/packages/opencode/src/cli/cmd/tui/`):
- `context/local.tsx` - filter agents to Hermes-only
- `component/prompt/index.tsx` - display proxy target in prompt bar
- `component/prompt/autocomplete.tsx` - filter @autocomplete to allowed targets
- `component/dialog-agent.tsx` - simplify or hide (only Hermes available)
- `routes/session/index.tsx` - use proxy target for message colors and footer
- `routes/session/subagent-footer.tsx` - enhance label for proxy sessions

### Test Plan (One Paragraph)

Start a fresh session with the modified TUI connected to an OpenCode server running the oh-my-opencode plugin. Verify: (a) agent picker shows only Hermes; (b) typing `@` shows only the 6 allowed targets; (c) submitting `@sisyphus implement hello world` triggers AgentPart parsing, proxy state storage, and Hermes delegation; (d) the prompt bar shows "Sisyphus" (or "Hermes -> Sisyphus"); (e) the assistant footer shows the target agent name, not "Hermes"; (f) submitting a follow-up message reuses the same child session; (g) attempting `@atlas` on a second message is either ignored or rejected; (h) opening a new session and submitting without `@agent` shows an error; (i) checking `/tmp/oh-my-opencode.log` confirms Hermes is the real session agent in all log entries; (j) `session_read` tool output shows `proxyExecutor: hermes` in metadata.

## 9. Backward-Compatibility & Integration Notes

| System | Impact | Evidence |
|--------|--------|---------|
| **Model fallback** | None. `chat.params` and model resolution read `sessionAgentMap` which stays "hermes" | `src/hooks/model-fallback/hook.ts` reads session agent |
| **Runtime fallback** | None. `runtime-fallback/agent-resolver.ts` reads `sessionAgentMap` = "hermes" | `src/hooks/runtime-fallback/` |
| **MCPs** | None. MCP system doesn't use agent identity | `src/mcp/` |
| **Agent modes** | None. Hermes stays `primary`, targets stay their own modes. `subagent-resolver.ts` filtering unchanged | `src/tools/delegate-task/subagent-resolver.ts` |
| **Zod config merging** | None. No schema changes. Proxy state is runtime-only | `src/config/schema/` |
| **Hook ordering** | AgentPart parsing added at TOP of `chat.message` before all existing hooks. Hermes guard extension is additive. After-hook addition is at end | `src/plugin/chat-message.ts`, `src/plugin/tool-execute-after.ts` |
| **Passthrough behavior** | Preserved. Hermes stays in `PASSTHROUGH_AGENTS`. Output pruning, keyword skip, think-mode skip all unchanged | `src/shared/passthrough-agents.ts` |
| **Compaction** | Module-level Map survives compaction in-process. Compaction context injector preserves delegated session_ids. No special handling needed | `src/hooks/compaction-context-injector/` |
| **Todo continuation** | Unchanged. Hermes skipped by todo-continuation-enforcer | `src/hooks/todo-continuation-enforcer/constants.ts` |
| **CI tests** | New tests added alongside existing. No existing tests broken because no existing behavior changed | `src/plugin/chat-message.test.ts` pattern |
| **`no-sisyphus-gpt` / `no-hephaestus-non-gpt`** | Unchanged. These check `sessionAgentMap` = "hermes", won't trigger rewrite | `src/hooks/no-sisyphus-gpt/hook.ts` |

## 10. UX, Auditing, and Security Guidance

### Metadata to Emit

| Field | Where | Purpose |
|-------|-------|---------|
| `proxyExecutor: "hermes"` | Logged to `/tmp/oh-my-opencode.log` on proxy state set | Audit trail: who actually runs the session |
| `proxyTarget: "{agent}"` | Logged on pin, available via `getHermesProxyState()` | Audit trail: what agent was targeted |
| `childSessionID` | Logged on pin, stored in proxy state | Session lineage tracing |

### Logging

- Log proxy target declaration: `log.info("Hermes proxy: session ${sessionID} targeting ${targetAgent}")`
- Log child session pin: `log.info("Hermes proxy: session ${sessionID} pinned to child ${childSessionID}")`
- Log rejection: `log.warn("Hermes proxy: rejected ${reason} for session ${sessionID}")`
- All logs go to `/tmp/oh-my-opencode.log` per project convention

### Provenance in TUI

- Prompt bar: Show `"{Target}"` with a subtle dimmed `"via Hermes"` suffix or routing icon
- Assistant footer: Show target agent name. Model shown is the actual model used (from Hermes's model config, which is typically the UI-selected model since Hermes is `primary`)
- Session list: Session title includes child session info (existing `@{agent} subagent` pattern)
- Admin inspection: `session_read` and `session_info` tools show real Hermes session agent. Proxy state visible in logs

### Privacy Considerations

- Target agent names are validated against a hardcoded allowlist: no arbitrary user input becomes a display label
- Internal routing decisions are not exposed to end users beyond the target name
- The proxy relationship is discoverable through logs and session tools, not hidden

### UX Pitfalls and Mitigations

| Pitfall | Mitigation |
|---------|-----------|
| Error messages reference "Hermes" when user sees target name | Error display should reference the target agent. Hermes mentioned only in debug/log details |
| User expects to change target mid-session | Explicitly reject with "Session pinned to {target}. Start a new session to use a different agent" |
| Session restore shows "Hermes" briefly before proxy state loads | Proxy state is in-memory and loads synchronously. TUI reads first message's AgentPart for display |
| Confusion about which model is running | Footer shows actual model. This is correct because Hermes uses the UI-selected model |

## 11. Rollback, Risks, and Mitigation

### Top Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| TUI vendor snapshot drifts from upstream, blocking future updates | Medium | Medium | Manifest file tracks exact commit. Refresh script re-imports and reports diff. Changes confined to 6 files |
| AgentPart not present in `output.parts` on some code paths | Low | High | Defensive check: if Hermes session has no AgentPart AND no proxy state, throw with clear instruction. Test with both autocomplete-selected and manually-typed `@agent` |
| Child session deleted externally while proxy is pinned | Low | Medium | On next `task()`, OpenCode returns session-not-found error. Additionally check proactively in `tool.execute.before` |
| Hermes ignores proxy enforcement and routes to wrong agent | Low | High | Plugin-level guard is enforcement layer, not prompt-level. Guard throws on mismatch. Hermes cannot bypass thrown errors |
| Build fails after vendoring due to missing workspace config | Medium | Low | Include root `package.json`, `bun.lock`, and workspace package references. Test build before modifying files |

### Detection

- **Drift**: `diff` between vendored TUI files and upstream tag
- **AgentPart failures**: Test suite covers missing/multiple/invalid parts
- **Pin failures**: Log all proxy state transitions; alert on `clearHermesProxyState` without explicit `session.deleted`
- **Build failures**: CI step to build vendored TUI

### Quick Rollback

1. **Plugin rollback**: Remove the 3 new code blocks (chat-message parsing, guard extension, after-hook capture). Remove `hermes-proxy-state.ts`. All existing behavior is unchanged since no existing code was modified, only extended.
2. **TUI rollback**: Revert the 6 modified TUI files to upstream state. The vendor snapshot is already a copy of upstream.
3. **Full rollback**: Delete `vendor/opencode-v1.4.3/` directory. Users switch back to official OpenCode binary.

## 12. Effort Estimate and Timeline

### PoC (Functional End-to-End)

| Task | Hours | Risk |
|------|-------|------|
| Create `hermes-proxy-state.ts` + tests | 1h | Low |
| Add AgentPart parsing in `chat-message.ts` + tests | 2h | Low |
| Extend Hermes routing guard for pinning + tests | 3h | Medium |
| Add child session capture in `tool-execute-after.ts` | 1h | Low |
| Simplify Hermes prompt | 1h | Low |
| Add session.deleted cleanup in `event.ts` | 0.5h | Low |
| **Plugin subtotal** | **8.5h** | |
| Vendor OpenCode snapshot + verify build | 2h | Medium |
| Modify 6 TUI files | 3h | Low |
| Integration testing | 2h | Medium |
| **TUI subtotal** | **7h** | |
| **Total PoC** | **~15.5h (2 days)** | **Medium** |

### Full Implementation (Production-Ready)

| Task | Hours | Risk |
|------|-------|------|
| All PoC work | 15.5h | Medium |
| Edge case hardening (deleted child, compaction recovery, restart) | 3h | Medium |
| TUI build integration into project CI | 2h | Low |
| Vendor refresh script | 2h | Low |
| Documentation (VENDOR_MANIFEST, usage guide) | 1h | Low |
| **Total full** | **~23.5h (3 days)** | **Medium** |

### Overall Risk Rating: **Medium**

Primary risk is fork maintenance, not implementation complexity. The plugin changes are additive and safe. The TUI changes are cosmetic and confined.

## 13. Acceptance Criteria and Verification Steps

### Functional Criteria

- [ ] Agent picker in forked TUI shows only Hermes
- [ ] `@` autocomplete shows exactly: atlas, prometheus, mnemosyne, heracles, hephaestus, sisyphus
- [ ] First message with `@sisyphus implement X` pins session to Sisyphus
- [ ] Prompt bar displays "Sisyphus" (or "Hermes -> Sisyphus") after pinning
- [ ] Assistant footer shows target agent name, not "Hermes"
- [ ] Follow-up messages reuse pinned child session (verified via session_read showing same child session_id)
- [ ] `@atlas` in follow-up message is rejected with clear error
- [ ] Message without `@agent` on first Hermes turn is rejected with usage hint
- [ ] Multiple `@agent` parts on first turn are rejected
- [ ] Invalid agent name (e.g., `@oracle`) is rejected with allowed list
- [ ] Background mode (`run_in_background: true`) is rejected in proxy mode
- [ ] Helper tools (`get_agent_prompts`, `resolve_atlas_context`) are blocked when pinned
- [ ] Starting a new session allows choosing a different target

### Auditing Criteria

- [ ] `/tmp/oh-my-opencode.log` shows proxy target declaration on first message
- [ ] `/tmp/oh-my-opencode.log` shows child session pinning on first task() success
- [ ] `session_read` tool shows Hermes as session agent (not the target)
- [ ] `getSessionAgent(sessionID)` returns "hermes" throughout session lifetime
- [ ] `sessionAgentMap` is never written with the proxy target name

### Backward-Compatibility Criteria

- [ ] All existing tests pass without modification
- [ ] Non-Hermes sessions are completely unaffected
- [ ] Hermes sessions without proxy (if any remain) work as before
- [ ] Model resolution uses Hermes's model config (UI-selected model)
- [ ] Keyword-detector, think-mode, todo-continuation all correctly skip Hermes sessions
- [ ] Output pruning still applies to Hermes parent (passthrough behavior preserved)
- [ ] Compaction preserves delegated session_id in context
- [ ] `task-resume-info` hook still appends continuation hints

### Build/CI Criteria

- [ ] Vendored TUI builds successfully with `bun run build` from vendor directory
- [ ] Modified TUI binary connects to official OpenCode server
- [ ] Plugin typecheck passes (`bun run typecheck`)
- [ ] New tests pass (`bun test`)
- [ ] No new `as any`, `@ts-ignore`, or `@ts-expect-error` introduced