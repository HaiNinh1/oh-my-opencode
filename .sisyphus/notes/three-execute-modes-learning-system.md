## How the Learning System Works with Each Agent

### The Three Execution Modes

The plugin has three fundamentally different execution patterns, each needing different learning integration:

```
┌───────────────────────────────────────────────────────────────────────┐
│                    EXECUTION MODES                                    │
│                                                                       │
│  SISYPHUS (Interactive)     ATLAS (Orchestrator)   HERACLES (Exec)    │
│  ┌────────────────────┐      ┌──────────────────┐    ┌──────────────┐ │
│  │ User message       │      │ Plan + boulder   │    │ Plan direct  │ │
│  │ -> Intent gate     │      │ -> Delegate task │    │ -> Sequential│ │
│  │ -> Research        │      │ -> Verify result │    │   execute    │ │
│  │ -> Plan/todos      │      │ -> Continue next │    │ -> Verify    │ │
│  │ -> Execute/delegate│      │ -> Final wave    │    │ -> Final wave│ │
│  │ -> Verify          │      │ -> User approval │    │ -> Complete  │ │
│  │ -> Complete        │      │                  │    │              │ │
│  └────────────────────┘      └──────────────────┘    └──────────────┘ │
│                                                                       │
│  Memory Planes (shared across all modes):                             │
│  ┌─────────────────────────────────────────────────────────────┐      │
│  │ Curated Facts (.sisyphus/facts.jsonc)                       │      │
│  │   -> Loaded once at session start, frozen (cache-stable)    │      │
│  │ Episodic Recall (.sisyphus/recall/ + session DB)            │      │
│  │   -> Prefetched per-turn, in <memory-context> block         │      │
│  │ LearningCards (.sisyphus/learnings.json)                    │      │
│  │   -> Proactive + reactive, in <memory-context> block        │      │
│  │   -> Scoped: session > plan > project > user (Letta-insp.)  │      │
│  │ Promoted Rules (.sisyphus/rules/learned/)                   │      │
│  │   -> Via rules-injector, zero token cost                    │      │
│  │ Memory Audit Journal (.sisyphus/memory-journal.jsonl)       │      │
│  │   -> Append-only log of all memory writes (Letta-inspired)  │      │
│                                                                       │
│  Continuation:              Continuation:          Continuation:      │
│  todoContinuationEnforcer   Atlas idle-event hook  Atlas idle hook    │
│  (stagnation tracking)      (boulder-backed)       (boulder-backed)   │
│                                                                       │
│  State:                     State:                 State:             │
│  In-memory session +        boulder.json +         boulder.json +     │
│  todos                      task_sessions +        plan checkboxes    │
│                             in-memory Atlas state  + notepads         │
└───────────────────────────────────────────────────────────────────────┘
```

---

### Sisyphus: Interactive Learning Loop

Sisyphus is the general-purpose engineer. Work is interactive, multi-turn, research-heavy.

**What Sisyphus learns about:**
- Tool usage patterns (edit failures, bash pitfalls)
- Codebase conventions discovered during research
- Error recovery strategies that worked
- Which subagents/categories are effective for what
- Project-specific build/test quirks
- User preferences and corrections (via /remember and memory-check reminders)
**Capture points in Sisyphus's workflow:**

```
Session starts
  │
  ├─ LOAD: Curated Facts from .sisyphus/facts.jsonc
  │   (frozen for session, stable prompt prefix, ~500 tokens)
  │
User message arrives
  │
  ├─ chat.message hooks fire + system transform (DCP-compatible)
  │   ├─ INJECT (proactive): query LearningCards store
  │   │   (top 3-5 matching cards as one-liners, ~200 tokens)
  │   │   Scoped: session > plan > project > user precedence
  │   ├─ INJECT (dynamic overlay): any new captures from previous turn
  │   │   (Letta-inspired: next-turn visibility without mutating stable prefix)
  │   ├─ INJECT (episodic): prefetch top 2-3 relevant session summaries
  │   │   from .sisyphus/recall/ (~300 tokens)
  │   └─ All injected in <memory-context> block via experimental.chat.system.transform
  │      (appended to system prompt after stable prefix, NOT in user message)
  │      (DCP-compatible: avoids user message transform conflicts, see design doc 13a)
  │
  ├─ /remember command (Letta-inspired, if user invokes)
  │   └─ Routes through memory_capture with elevated trust (0.7)
  │      scope: as specified by user (default: project)
  │      -> Audit journal entry appended
  │
  ├─ Intent gate (research/implement/fix)
  │
  ├─ Research phase
  │   ├─ task(explore/librarian) ──► tool.execute.after
  │   │                              ◄── CAPTURE: if research reveals
  │   │                                   codebase convention not yet
  │   │                                   in learnings store
  │   └─ task(oracle) ──────────► tool.execute.after
  │                                ◄── CAPTURE: Oracle corrections/insights
  │                                     (disagreement with agent's hypothesis
  │                                      = high-value learning signal)
  │
  ├─ Execute phase
  │   ├─ edit/write tool ──────► tool.execute.after
  │   │                          ◄── CAPTURE: edit failures (already detected
  │   │                               by editErrorRecovery, but now also
  │   │                               recorded as candidate LearningCard)
  │   │                          ◄── INJECT (reactive): when error
  │   │                               matches known learned pattern
  │   │
  │   ├─ bash (build/test) ───► tool.execute.after
  │   │                          ◄── CAPTURE: build failures + successful
  │   │                               fix = procedural learning
  │   │
  │   ├─ memory_capture tool (Letta-inspired, agent-initiated)
  │   │   Agent explicitly captures a learning during work:
  │   │   -> Creates candidate LearningCard with required:
  │   │      scope, kind, tags, evidence, claim, instruction
  │   │   -> Default scope: session (narrowest)
  │   │   -> Logged to memory audit journal
  │   │   -> Visible in <memory-context> on NEXT turn
  │   │
  │   └─ task(category) ──────► tool.execute.after
  │                              ◄── CAPTURE: delegation outcomes
  │                                   (empty response, wrong model, etc.)
  │
  ├─ MEMORY CHECK REMINDER (state-based, DCP-compatible)
  │   Triggers (state-based, not turn-count):
  │     - After user correction (state: correction detected)
  │     - After DCP compress calls (state: compress tool executed)
  │     - On session.idle with unreviewed raw messages
  │     - Before native compaction as safety net
  │   └─ Injects reminder via system transform to review recent turns
  │      and use memory_capture for durable knowledge
  │      (reuses verification-reminders pattern)
  │
  ├─ BACKGROUND REVIEW (optional P1, deprioritized in B + Bounded A)
  │   └─ Hidden background task reviews last N turns
  │      ◄── CAPTURE: latent learnings from successful patterns
  │      NOTE: Replaced as primary periodic review by the strong
  │            reflection subagent at session boundaries (see below).
  │            Enable only for long sessions where boundary review is too late.
  │
  ├─ Verify phase
  │   ├─ lsp_diagnostics ────── CAPTURE: recurring diagnostic patterns
  │   └─ test results ────────── CAPTURE: test failure -> fix patterns
  │
  ├─ Phase 2C Failure Recovery
  │   └─ 3 failures -> revert -> Oracle -> ask user
  │       ◄── CAPTURE: high-value "what NOT to do" anti-pattern card
  │
  └─ Session boundaries + DCP compress boundaries
      ├─ DCP compress call (tool.execute.before/after) <-- PRIMARY boundary with DCP
      │   ├─ PRE-COMPRESSION FLUSH: save uncaptured observations (before)
      │   ├─ Mark compressed range as reviewed (after)
      │   ├─ Update lastReviewedRawMessageId
      │   ├─ STRONG REFLECTION SUBAGENT: incremental review of compressed span
      │   └─ MEMORY CHECK REMINDER fires (post-compress trigger)
      ├─ session.idle ◄───────── PROMOTE: validate candidates into
      │                           durable store if evidence threshold met
      │                           + write session outcome to episodic recall
      │                           + STRONG REFLECTION SUBAGENT (P0, B + Bounded A):
      │                             Capable model (opus 4.6 / gpt 5.4) reviews
      │                             raw messages since lastReviewedRawMessageId.
      │                             Advisory only, feeds through single reducer.
      ├─ session.compacted (FALLBACK safety net, rare with DCP active)
      │   ├─ PRE-COMPRESSION FLUSH: save observations before context loss
      │   ├─ STRONG REFLECTION SUBAGENT also fires (compaction trigger)
      │   ├─ Write session summary to episodic recall index
      │   ├─ PROMOTE: persist pending card IDs + applied card IDs
      │   └─ MEMORY CHECK REMINDER fires (post-compaction trigger)
      │   All captures go through SINGLE REDUCER -> learnings.json
      └─ session.deleted ◄────── PROMOTE: final reflection pass
```

**Concrete hook integration for Sisyphus:**

| Hook | File | Learning Action |
|------|------|-----------------|
| Session start | `src/plugin/config.ts` | Load curated facts from `.sisyphus/facts.jsonc` into stable prompt block |
| `experimental.chat.system.transform` | `src/plugin/system-transform.ts` | Inject matching LearningCards (scoped) + dynamic overlay + episodic recall in `<memory-context>` block appended to system prompt (DCP-compatible) |
| `chat.message` | `src/plugin/chat-message.ts` | Session setup, keyword detection (no longer used for memory injection) |
| `tool.execute.after` (edit) | `src/hooks/edit-error-recovery/hook.ts` | Capture error + recovery as candidate card; reactive inject |
| `tool.execute.after` (task) | `src/plugin/tool-execute-after.ts` | Capture Oracle/delegation outcomes |
| `tool.execute.after` (bash) | `src/plugin/tool-execute-after.ts` | Capture build/test failure patterns |
| `tool.execute.after` (memory_capture) | New: `src/tools/memory-capture/tool.ts` | Agent-initiated capture -> candidate queue + audit journal (Letta-inspired) |
| `/remember` command | New: `src/features/builtin-commands/remember/` | User-triggered capture -> memory_capture with elevated trust (Letta-inspired) |
| Memory-check reminder | New: `src/hooks/memory-reminder/hook.ts` | State-based reminders: post-correction, post-compress, idle with unreviewed, pre-compaction (DCP-compatible: no turn-count triggers) |
| Background review | New: `src/hooks/background-review/hook.ts` | Optional P1: every N tool calls hidden reflection (deprioritized, replaced by boundary reflection subagent) |
| Reflection subagent | New: `src/hooks/reflection-review/hook.ts` | **P0**: incremental review at session.idle + DCP compress + compaction + session end. Uses lastReviewedRawMessageId. Advisory, feeds through single reducer. (B + Bounded A) |
| `session.idle` | `src/hooks/todo-continuation-enforcer/idle-event.ts` | Promotion pass + episodic recall write + **reflection subagent fires** + continuation injection |
| `tool.execute.before` (compress) | New: `src/hooks/compress-boundary/hook.ts` | **DCP-aware**: fire pre-compression flush before DCP compress executes; record compressed range for incremental reflection |
| `tool.execute.after` (compress) | New: `src/hooks/compress-boundary/hook.ts` | **DCP-aware**: mark range as reviewed, update lastReviewedRawMessageId, queue reflection, log to audit journal |
| `session.compacted` | `src/hooks/compaction-context-injector/hook.ts` | FALLBACK: Pre-compression flush + persist card state + episodic recall entry + memory-check reminder (rare with DCP) |
| Continuation injection | `src/hooks/todo-continuation-enforcer/continuation-injection.ts` | Include relevant learnings (scoped) in continuation prompt |
---

### Heracles: Plan Execution Learning Loop

Heracles is the direct executor. Work is plan-driven, sequential, verification-heavy.

**What Heracles learns about:**
- Implementation patterns that work/fail for this codebase
- Build/test configuration quirks
- File-specific conventions (barrel exports, test patterns)
- Verification shortcuts and thorough checks
- Which plan task structures lead to blockers
- Implementation-time discoveries worth persisting (via memory_capture)
**Capture points in Heracles's workflow:**

```
/execute-plan starts
  │
  ├─ LOAD: Curated Facts from .sisyphus/facts.jsonc
  │   (frozen for session, inherited from parent session or loaded fresh)
  │
  ├─ execute-plan-hook.ts fires
  │   ├─ Creates/resumes boulder.json
  │   ├─ Sets session agent to "heracles"
  │   ├─ INJECT (proactive): plan-scoped LearningCards
  │   │   (match against plan file paths, task descriptions)
  │   │   Scoped: session > plan > project precedence
  │   ├─ INJECT (dynamic overlay): captures from previous turn
  │   │   (Letta-inspired: next-turn visibility)
  │   └─ INJECT (episodic): relevant past session summaries for this plan scope
  │      All in <memory-context> block via experimental.chat.system.transform
  │      (DCP-compatible: avoids user message transform conflicts)
  │
  ├─ Read full plan -> register todos
  │
  ├─ For each unchecked task:
  │   │
  │   ├─ Read references ──────► tool.execute.after
  │   │                          ◄── INJECT (reactive): file-specific learnings
  │   │                               (via rulesInjector for promoted rules
  │   │                                or reactive LearningCard injection)
  │   │
  │   ├─ Implement ────────────► tool.execute.after
  │   │                          ◄── CAPTURE: edit/write failures
  │   │                          ◄── INJECT (reactive): matching anti-patterns
  │   │
  │   ├─ memory_capture tool (Letta-inspired, agent-initiated)
  │   │   Heracles captures implementation discoveries:
  │   │   -> File conventions, build quirks, verification patterns
  │   │   -> Default scope: plan (plan-execution context)
  │   │   -> Logged to memory audit journal
  │   │   -> Visible in <memory-context> on NEXT turn/task
  │   │
  │   ├─ Verify (lsp + build + test)
  │   │   ├─ Success ──────────── REINFORCE: relevant active cards
  │   │   └─ Failure ──────────── CAPTURE: failure -> fix as procedural card
  │   │       └─ Max 3 retries
  │   │           └─ Mark blocked -- CAPTURE: blocker as anti-pattern card
  │   │
  │   └─ Mark checkbox + commit
  │       └─ CAPTURE: successful task completion reinforces
  │              any cards that were injected for this task
  │
  ├─ MEMORY CHECK REMINDER (state-based, DCP-compatible)
  │   Triggers (state-based, not turn-count):
  │     - After implementation failures (state: failure detected)
  │     - After DCP compress calls (state: compress tool executed)
  │     - On session.idle with unreviewed raw messages
  │     - Before native compaction as safety net
  │   └─ Injects reminder via system transform to review recent work
  │      and use memory_capture for durable knowledge
  │
  ├─ BACKGROUND REVIEW (optional P1, deprioritized in B + Bounded A)
  │   └─ Hidden reflection on implementation patterns
  │      NOTE: Replaced by strong reflection subagent at boundaries.
  │      Enable only for long sessions where boundary review is too late.
  │
  ├─ Final Verification Wave (F1-F4)
  │   ├─ F1 Oracle ──────────── CAPTURE: Oracle's plan compliance findings
  │   ├─ F2 Code quality ─────── CAPTURE: quality issues found
  │   ├─ F3 QA scenarios ─────── CAPTURE: integration failures
  │   └─ F4 Scope fidelity ────── CAPTURE: scope drift observations
  │
  ├─ session.idle ◄───────── Atlas continuation resumes Heracles
  │                             ◄── INJECT: learnings (scoped) + episodic recall
  │                             in continuation prompt
  │                             + STRONG REFLECTION SUBAGENT (P0):
  │                               Capable model reviews raw messages since
  │                               lastReviewedRawMessageId. Implementation
  │                               patterns, file conventions, build quirks.
  │                               Advisory, feeds through single reducer.
  ├─ DCP compress boundary (tool.execute.before/after) <-- PRIMARY boundary with DCP
  │   ├─ PRE-COMPRESSION FLUSH: save uncaptured implementation observations (before)
  │   ├─ Mark compressed range as reviewed (after)
  │   ├─ Update lastReviewedRawMessageId
  │   ├─ STRONG REFLECTION SUBAGENT: incremental review of compressed span
  │   └─ MEMORY CHECK REMINDER fires (post-compress trigger)
  ├─ session.compacted (FALLBACK safety net, rare with DCP active)
  │   ├─ PRE-COMPRESSION FLUSH: save observations before context loss
  │   ├─ STRONG REFLECTION SUBAGENT also fires (compaction trigger)
  │   ├─ Write session summary to episodic recall index
  │   ├─ Persist pending card IDs + applied card IDs
  │   └─ MEMORY CHECK REMINDER fires (post-compaction trigger)
  │   All captures go through SINGLE REDUCER -> learnings.json
  └─ Plan completion ◄─────── PROMOTE: batch-validate all candidates
                                 from this plan execution
                                 + write plan outcome to episodic recall
```

**Key distinction**: Heracles is mostly **prompt-driven**, not hook-enforced. This means:
- Learning capture at hook level catches tool failures automatically
- But learning about implementation strategies requires capturing from the **plan progress** (checkbox state changes, blocked markers) and **notepad files** (`.sisyphus/notepads/{PLAN_NAME}/`)
- Injection is most effective at **session start** (`execute-plan-hook.ts`) and **continuation resume** (`boulder-continuation-injector.ts`)

**Concrete hook integration for Heracles:**

| Hook | File | Learning Action |
|------|------|-----------------|
| Session start | `src/hooks/execute-plan/execute-plan-hook.ts` | Load curated facts from `.sisyphus/facts.jsonc` into stable prompt block |
| `experimental.chat.system.transform` | `src/plugin/system-transform.ts` | Inject plan-scoped LearningCards (scoped) + dynamic overlay + episodic recall in `<memory-context>` block appended to system prompt (DCP-compatible) |
| `resolve-heracles-context` | `src/tools/resolve-heracles-context/tools.ts` | Alternative entry: inject learnings here too |
| `tool.execute.after` (edit) | `src/hooks/edit-error-recovery/hook.ts` | Same as Sisyphus: capture + reactive inject |
| `tool.execute.after` (all) | `src/plugin/tool-execute-after.ts` | Capture failures, reinforce on success |
| `tool.execute.after` (memory_capture) | New: `src/tools/memory-capture/tool.ts` | Agent-initiated capture -> candidate queue + audit journal (Letta-inspired) |
| Memory-check reminder | New: `src/hooks/memory-reminder/hook.ts` | State-based reminders: post-failure, post-compress, idle with unreviewed, pre-compaction (DCP-compatible: no turn-count triggers) |
| Background review | New: `src/hooks/background-review/hook.ts` | Optional P1: every N tool calls hidden reflection (deprioritized, replaced by boundary reflection subagent) |
| Reflection subagent | New: `src/hooks/reflection-review/hook.ts` | **P0**: incremental review at session.idle + DCP compress + compaction + plan completion. Uses lastReviewedRawMessageId. Advisory, feeds through single reducer. (B + Bounded A) |
| Boulder continuation | `src/hooks/atlas/boulder-continuation-injector.ts` | Include LearningCards (scoped) + episodic recall in resume prompt |
| `tool.execute.before` (compress) | New: `src/hooks/compress-boundary/hook.ts` | **DCP-aware**: fire pre-compression flush before DCP compress executes; record compressed range for incremental reflection |
| `tool.execute.after` (compress) | New: `src/hooks/compress-boundary/hook.ts` | **DCP-aware**: mark range as reviewed, update lastReviewedRawMessageId, queue reflection, log to audit journal |
| `session.compacted` | `src/hooks/compaction-context-injector/hook.ts` | FALLBACK (rare with DCP): Pre-compression flush + persist card state + episodic recall entry + memory-check reminder |
| Plan checkpoint change | `.sisyphus/plans/*.md` | Capture blocked tasks as anti-pattern evidence |
| Notepad writes | `.sisyphus/notepads/{PLAN}/` | Parse as raw evidence for candidate cards |
| Plan completion | Boulder state transition | Batch promotion pass + episodic recall plan outcome |

---

### Atlas: Orchestration Learning Loop

Atlas is the meta-orchestrator. Work is delegation-heavy, cross-session, verification-gated.

**What Atlas learns about:**
- Which categories/models work best for which task types
- Delegation patterns that produce good/bad results
- Verification strategies that catch real issues vs false positives
- Plan structures that execute smoothly vs get stuck
- Optimal task granularity for subagents
- Meta-patterns across delegations (via memory_capture)
**Capture points in Atlas's workflow:**

```
Hermes routes to Atlas
  │
  ├─ LOAD: Curated Facts from .sisyphus/facts.jsonc
  │   (frozen for session)
  │
  ├─ resolve_atlas_context
  │   ├─ Creates/resumes boulder.json
  │   ├─ INJECT (proactive): plan-scoped LearningCards
  │   │   Scoped: session > plan > project precedence
  │   ├─ INJECT (dynamic overlay): captures from previous turn
  │   │   (Letta-inspired: next-turn visibility)
  │   └─ INJECT (episodic): relevant session summaries for plan scope
  │      All in <memory-context> block via experimental.chat.system.transform
  │      (DCP-compatible: avoids user message transform conflicts)
  │
  ├─ Atlas reads plan, decides delegation
  │
  ├─ memory_capture tool (Letta-inspired, agent-initiated)
  │   Atlas captures delegation meta-observations:
  │   -> Model/category effectiveness for task types
  │   -> Session reuse patterns across similar tasks
  │   -> Default scope: plan (delegation context)
  │   -> Logged to memory audit journal
  │
  ├─ task(category/subagent) ──► tool.execute.before
  │                               (atlas/tool-execute-before.ts)
  │                               ◄── INJECT (reactive): delegation-specific
  │                                    LearningCards
  │                                    ("for tasks matching X, prefer category Y")
  │
  ├─ Subagent returns ─────────► tool.execute.after
  │                               (atlas/tool-execute-after.ts)
  │                               ◄── CAPTURE: delegation outcome
  │                               │   - Was session_id reusable?
  │                               │   - Did subagent complete successfully?
  │                               │   - Was result rejected by verification?
  │                               │   - Which model/category was used?
  │                               │
  │                               ├── Stores task_session in boulder
  │                               └── Appends verification gate
  │
  ├─ Verification by Atlas
  │   ├─ Success ──────────── REINFORCE: delegation strategy card
  │   └─ Failure ──────────── CAPTURE: delegation + verification mismatch
  │
  ├─ MEMORY CHECK REMINDER (state-based, DCP-compatible)
  │   Triggers (state-based, not turn-count):
  │     - After delegation failures (state: failure detected)
  │     - After DCP compress calls (state: compress tool executed)
  │     - On session.idle with unreviewed raw messages
  │     - Before native compaction as safety net
  │   └─ Injects reminder via system transform to review delegation patterns
  │      and use memory_capture for meta-observations
  │
  ├─ BACKGROUND REVIEW (optional P1, deprioritized in B + Bounded A)
  │   └─ Hidden reflection on delegation meta-patterns
  │      NOTE: Replaced by strong reflection subagent at boundaries.
  │      Atlas benefits most from boundary review since meta-patterns
  │      emerge over time, not in real-time.
  │
  ├─ session.idle ───────────── Atlas idle-event.ts
  │   ├─ Check boulder progress
  │   ├─ PROMOTE: candidates from completed tasks
  │   ├─ Write session progress to episodic recall
  │   ├─ STRONG REFLECTION SUBAGENT (P0, B + Bounded A):
  │   │   Capable model reviews raw messages since
  │   │   lastReviewedRawMessageId. Delegation meta-patterns,
  │   │   model/category effectiveness, task granularity.
  │   │   Advisory, feeds through single reducer.
  │   └─ Inject continuation: LearningCards (scoped) + episodic recall in prompt
  │
  ├─ Final wave (F1-F4)
  │   ├─ Each reviewer returns ── CAPTURE: reviewer findings as evidence
  │   └─ All approved ────────── CAPTURE: successful plan execution metadata
  │       └─ Pause for user ──── PROMOTE: batch-validate all plan candidates
  │
  ├─ DCP compress boundary (tool.execute.before/after) <-- PRIMARY boundary with DCP
  │   ├─ PRE-COMPRESSION FLUSH: save uncaptured delegation observations (before)
  │   ├─ Mark compressed range as reviewed (after)
  │   ├─ Update lastReviewedRawMessageId
  │   ├─ STRONG REFLECTION SUBAGENT: incremental review of compressed span
  │   └─ MEMORY CHECK REMINDER fires (post-compress trigger)
  │
  └─ session.compacted (FALLBACK safety net, rare with DCP active)
      ├─ PRE-COMPRESSION FLUSH: save delegation meta-observations
      ├─ STRONG REFLECTION SUBAGENT also fires (compaction trigger)
      ├─ Atlas in-memory state cleared
      ├─ boulder.json persists
      ├─ Write session summary to episodic recall index
      ├─ Persist pending card IDs + applied card IDs in boulder state
      └─ MEMORY CHECK REMINDER fires (post-compaction trigger)
      All captures go through SINGLE REDUCER -> learnings.json
```

**Atlas-specific learning value**: Atlas sees **meta-patterns** that individual executors miss:
- "Task X always takes 3 retries with category `quick` but succeeds first try with `ultrabrain`"
- "Plans with >10 top-level tasks get stuck; splitting into 2 plans works better"
- "Subagent sessions for `src/hooks/` tasks are reusable across tasks in the same module"

**Concrete hook integration for Atlas:**

| Hook | File | Learning Action |
|------|------|-----------------|
| Session start | `src/tools/resolve-atlas-context/tools.ts` | Load curated facts from `.sisyphus/facts.jsonc` into stable prompt block |
| `experimental.chat.system.transform` | `src/plugin/system-transform.ts` | Inject plan-scoped LearningCards (scoped) + dynamic overlay + episodic recall in `<memory-context>` block appended to system prompt (DCP-compatible) |
| `tool.execute.before` (task) | `src/hooks/atlas/tool-execute-before.ts` | Inject delegation strategy LearningCards (reactive) |
| `tool.execute.after` (task) | `src/hooks/atlas/tool-execute-after.ts` | Capture delegation outcomes + session reusability |
| `tool.execute.after` (memory_capture) | New: `src/tools/memory-capture/tool.ts` | Atlas-initiated capture of delegation meta-patterns -> candidate queue + audit journal (Letta-inspired) |
| Memory-check reminder | New: `src/hooks/memory-reminder/hook.ts` | State-based reminders: post-failure, post-compress, idle with unreviewed, pre-compaction (DCP-compatible: no turn-count triggers) |
| Background review | New: `src/hooks/background-review/hook.ts` | Optional P1: every N delegations hidden reflection (deprioritized, replaced by boundary reflection subagent) |
| Reflection subagent | New: `src/hooks/reflection-review/hook.ts` | **P0**: incremental review at session.idle + DCP compress + compaction. Uses lastReviewedRawMessageId. Advisory, feeds through single reducer. Atlas benefits most from boundary review. (B + Bounded A) |
| `session.idle` | `src/hooks/atlas/idle-event.ts` | Promotion pass + episodic recall write + reflection review before continuation |
| Boulder continuation | `src/hooks/atlas/boulder-continuation-injector.ts` | Include LearningCards (scoped) + episodic recall in resume prompt |
| `tool.execute.before` (compress) | New: `src/hooks/compress-boundary/hook.ts` | **DCP-aware**: fire pre-compression flush before DCP compress executes; record compressed range for incremental reflection |
| `tool.execute.after` (compress) | New: `src/hooks/compress-boundary/hook.ts` | **DCP-aware**: mark range as reviewed, update lastReviewedRawMessageId, queue reflection, log to audit journal |
| `session.compacted` | `src/hooks/atlas/event-handler.ts` | FALLBACK (rare with DCP): Pre-compression flush + persist card state + episodic recall in boulder + memory-check reminder |
| Final wave boundary | `src/hooks/atlas/final-wave-approval-gate.ts` | Batch capture of reviewer findings |

---

### Cross-Agent Learning Flow

The real power comes from learnings that flow between agents across **all memory planes**:

```
Sisyphus discovers              Atlas observes                Heracles hits
"barrel exports need            "category quick fails         "bun test needs
 index.ts updates"               for hooks/ tasks"             --timeout flag"
       |                              |                             |
       v                              v                             v
  LearningCard                   LearningCard                 LearningCard
  kind: procedural               kind: self-model              kind: procedural
  trigger:                       trigger:                      trigger:
    paths: [src/features/**]       agents: [atlas]               tools: [bash]
    tools: [edit, write]           keywords: [hooks, hook]        errors: [timeout]
  scope: session (default)        scope: plan (Atlas default)   scope: plan (Heracles default)
  tags: [barrel, export]          tags: [delegation, category]  tags: [bun, test, timeout]
  sourceCapturePath:              sourceCapturePath:            sourceCapturePath:
    memory_capture                  memory_capture                hook:tool.execute.after
       |                              |                             |
       +------------------------------+-----------------------------+
       |    ALL sources feed through SINGLE REDUCER (B + Bounded A)  |
       |    Lock + temp write + rename + fingerprint dedup           |
       |    ALL writes logged to memory audit journal                |
       +------------------------------+-----------------------------+
       |                              |                             |
       v                              v                             v
 .sisyphus/learnings.json    .sisyphus/recall/            .sisyphus/facts.jsonc
 (shared LearningCards)      (session-index.json)         (curated project truths)
  + scoped overlays            + episodic summaries         (stable "bun not node")
       |                              |                             |
       +------------------------------+-----------------------------+
                                       |
                                       v
                            All planes shared across agents.
                            Each agent reads ALL planes:
                            - Curated Facts (always-on)
                            - Episodic Recall (on-demand)
                            - LearningCards (proactive+reactive, scoped)
                            - Promoted Rules (via rules-injector)
                            - Memory Audit Journal (append-only governance)
                                       |
       +------------------------------+-----------------------------+
       v                              v                             v
  Next Sisyphus                 Next Atlas                 Next Heracles
  session:                      session:                   session:
  Facts: "Uses Bun"            Facts: "Uses Bun"          Facts: "Uses Bun"
  Recall: "Last time           Recall: "Plan X took       Recall: "Build failed
   barrel exports broke"        3 retries"                 without --timeout"
  Cards: "Update               Cards: "Route hooks/       Cards: "Use --timeout
   index.ts on edit"            to ultrabrain"             with bun test"
  Dynamic overlay: any          Dynamic overlay: any       Dynamic overlay: any
   captures from prev turn       captures from prev turn    captures from prev turn
```

**New Letta-inspired capture/injection paths shared by all agents:**

```
  B + Bounded A: Capture Pipeline (all agents)

  IN-SESSION CAPTURE (primary, immediate)     BOUNDARY CAPTURE (secondary)
  ==========================================   ========================
  memory_capture tool  ---+                    Strong reflection     ---+
                          |                    subagent (capable model, |
  /remember command  -----+                     session boundaries)     |
                          |                                             |
  Memory-check reminder --+                                             |
                          |                                             |
  Surprise-point hooks ---+------> SINGLE REDUCER <---------------------+
                          |        (owns learnings.json)
  Pre-compression flush --+        |
                                   |  1. Deduplicate (fingerprint)
  Background review -------+       |  2. Lock + temp + rename
  (optional P1)            +------>|  3. Zod validate
                                   |  4. Audit journal entry
                                   v
                            .sisyphus/learnings.json
                            (state: "candidate")

  New captures visible NEXT turn via dynamic overlay in <memory-context>
  (never mutate stable prompt prefix)
```

### Summary: Multi-Plane Store, Three Integration Patterns

| Aspect | Sisyphus | Atlas | Heracles |
|--------|----------|-------|----------|
| **Curated Facts injection** | Session start via config | Session start via resolve_atlas_context | Session start via execute-plan-hook |
| **Episodic Recall injection** | `experimental.chat.system.transform` (prefetch in `<memory-context>`) | `experimental.chat.system.transform` + continuation | `experimental.chat.system.transform` + continuation |
| **LearningCard proactive** | `experimental.chat.system.transform` (scoped, in `<memory-context>`) | `experimental.chat.system.transform` + continuation (scoped) | `experimental.chat.system.transform` + continuation (scoped) |
| **LearningCard reactive** | `tool.execute.after` (error match) | `tool.execute.before` (delegation strategy) | `tool.execute.after` (error match) |
| **Dynamic overlay** | `experimental.chat.system.transform` (next-turn captures) | `experimental.chat.system.transform` (next-turn captures) | `experimental.chat.system.transform` (next-turn captures) |
| **Agent-driven capture** | `memory_capture` tool (any time) | `memory_capture` tool (delegation meta-patterns) | `memory_capture` tool (implementation discoveries) |
| **User-driven capture** | `/remember` command (elevated trust) | N/A (Atlas is non-interactive) | N/A (Heracles is plan-driven) |
| **Memory-check reminders** | State-based: post-correction, post-compress, idle w/unreviewed, pre-compaction (DCP-compatible) | State-based: post-failure, post-compress, idle w/unreviewed, pre-compaction (DCP-compatible) | State-based: post-failure, post-compress, idle w/unreviewed, pre-compaction (DCP-compatible) |
| **Primary capture** | `tool.execute.after` + memory_capture + hooks | `atlas/tool-execute-after.ts` + memory_capture + hooks | `tool.execute.after` + plan progress + memory_capture + hooks |
| **Default capture scope** | `session` | `plan` | `plan` |
| **Background review** | Optional P1 (deprioritized in B + Bounded A) | Optional P1 (deprioritized) | Optional P1 (deprioritized) |
| **Strong reflection subagent** | **P0**: session.idle + DCP compress + compaction + session end. Incremental via `lastReviewedRawMessageId`. (user corrections, conventions) | **P0**: session.idle + DCP compress + compaction. Incremental via `lastReviewedRawMessageId`. (delegation meta-patterns, model effectiveness) | **P0**: session.idle + DCP compress + compaction + plan completion. Incremental via `lastReviewedRawMessageId`. (implementation patterns, build quirks) |
| **Pre-compression flush** | DCP `compress` (primary) + `session.compacted` (fallback) | DCP `compress` (primary) + `session.compacted` (fallback) | DCP `compress` (primary) + `session.compacted` (fallback) |
| **DCP compress boundary** | `tool.execute.before/after` (compress): PRIMARY boundary - pre-flush, mark reviewed, update `lastReviewedRawMessageId`, reflection, reminder | Same hooks, same behavior | Same hooks, same behavior |
| **Single reducer** | All captures feed through one reducer -> learnings.json (B + Bounded A) | Same reducer, shared code path | Same reducer, shared code path |
| **Promotion trigger** | `session.idle`, `session.compacted` | `session.idle` (atlas idle-event), final wave | Plan completion, `session.idle` |
| **Unique value** | Discovers patterns interactively + user /remember | Sees meta-patterns across delegations | Generates high-volume procedural evidence |
| **Episodic writes** | Session outcome on idle/compaction | Plan progress + delegation outcomes | Plan outcome + task-level outcomes |
| **Compaction handling** | DCP compress: primary boundary (pre-flush + mark reviewed + reflection). `session.compacted`: fallback (pre-flush + persist + recall + reminder + reflection) | DCP compress: primary boundary. `session.compacted`: fallback (pre-flush + persist in boulder + recall + reminder + reflection) | Same as Atlas (DCP-aware, boulder-backed) |
| **Audit journal** | All memory writes logged via single reducer | All memory writes logged | All memory writes logged |

The stores are shared across all agents:
- **Curated Facts** (`.sisyphus/facts.jsonc`): stable project truths, loaded once per session
- **Episodic Recall** (`.sisyphus/recall/`): session outcomes and summaries, prefetched per-turn
- **LearningCards** (`.sisyphus/learnings.json`): learned behaviors with lifecycle, scoped (session > plan > project > user), proactive + reactive injection
- **Promoted Rules** (`.sisyphus/rules/learned/`): high-confidence rules, zero-cost injection via rules-injector
- **Memory Audit Journal** (`.sisyphus/memory-journal.jsonl`): append-only log of all memory writes for governance, rollback, and introspection (Letta-inspired)

Each agent contributes its unique perspective to all planes, and reads from all planes. The multi-plane design ensures stable knowledge (facts) is not mixed with dynamic behaviors (cards) or historical context (recall). All agents share the same `memory_capture` tool, single reducer, and audit journal, ensuring one unified candidate pipeline regardless of capture path. The B + Bounded A architecture adds a strong reflection subagent at session boundaries as the secondary capture path, providing a "code review" perspective that catches what the executing agent missed.