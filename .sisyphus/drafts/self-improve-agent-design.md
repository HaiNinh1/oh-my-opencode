## Self-Improving Agent Framework: Unified Design

### Core Concept: The Learning Control Plane

The system is a **3-stage loop** built on an **immune-system lifecycle** with a **behavior ladder**.

```
┌─────────────────────────────────────────────────────────────────┐
│                    LEARNING CONTROL PLANE                       │
│                                                                 │
│  ┌──────────┐    ┌──────────────┐    ┌───────────────────────┐  │
│  │ CAPTURE  │───>│   PROMOTE    │───>│       INJECT          │  │
│  │          │    │              │    │                       │  │
│  │ Raw      │    │ Validate &   │    │ Proactive: chat.msg   │  │
│  │ evidence │    │ distill into │    │ Reactive: tool.after  │  │
│  │ from     │    │ LearningCards│    │ Top 3-5 one-liners    │  │
│  │ hooks    │    │              │    │                       │  │
│  └──────────┘    └──────────────┘    └───────────────────────┘  │
│       ^                                        │                │
│       └────────── reinforcement ───────────────┘                │
└─────────────────────────────────────────────────────────────────┘
```

### 1. The LearningCard: Core Unit

Each learning is a structured, evidence-backed card - not free-form text. The schema is intentionally slim: only fields that cannot be derived from the evidence array are persisted. Derived metrics (trust, confidence, reinforcements) are computed at query time from evidence entries. See Section 14 for the full rationale.

```typescript
interface LearningCard {
  id: string
  state: "candidate" | "active" | "quarantined" | "promoted" | "retired"
  
  // The learning itself
  claim: string                 // what was learned (1-2 sentences, dedup key)
  instruction: string           // actionable guidance to inject (1 line, compact)
  
  // When to activate (non-negotiable: v1 retrieval primitive without embeddings)
  trigger: {
    paths?: string[]            // file globs: ["src/features/*/index.ts"]
    tools?: string[]            // tool names: ["edit", "bash"]
    errors?: string[]           // error patterns: ["oldString not found"]
    agents?: string[]           // agent names: ["sisyphus", "hephaestus"]
    keywords?: string[]         // task keywords: ["barrel export", "migration"]
  }
  
  // Scope (Letta-inspired: scoped overlays with precedence)
  // Precedence: session > plan > project > user
  // Default to 'session'; only broaden through explicit promotion
  scope: "session" | "plan" | "project" | "user"
  
  // Retrieval metadata (structured matching without embeddings)
  tags: string[]               // freeform tags: ["barrel-export", "bun", "test-config", "anti-pattern"]
                               // NOTE: 'kind' (semantic/procedural/self-model/anti-pattern) is folded
                               // into tags rather than a separate enum. Add back as enum only if
                               // code branches on it at the reducer/retrieval level.
  
  // Provenance (source of truth for ALL derived metrics)
  evidence: Array<{
    sessionId: string
    source: "error-recovery" | "oracle-review" | "momus-correction" 
            | "human-correction" | "notepad" | "circuit-breaker"
            | "memory-capture" | "remember-command" | "memory-reminder"
            | "reflection-review" | "history-backfill"
            | "staleness-check"   // trigger path no longer exists in codebase
    timestamp: number
    summary: string             // what happened
    agent?: string              // which agent created this entry (for diversity weighting)
    isReinforcement?: boolean   // card was injected + task succeeded (positive feedback)
    isContradiction?: boolean   // card's claim was disproven or instruction caused failure
  }>
  
  // Operational (must be persisted, cannot derive from evidence)
  createdAt: number
  lastSeen: number              // last time this card was matched/injected (for recency ranking)
}
```

#### 1a. Derived Metrics (computed at query time, not persisted)

All ranking/lifecycle metrics are derived from the evidence array via a single pure function. This keeps evidence as the single source of truth and eliminates denormalized-field drift.

```typescript
interface DerivedMetrics {
  trust: number                 // 0-1, weighted by evidence source quality
  confidence: number            // 0-1, function of evidence count, diversity, and reinforcements
  evidenceCount: number         // evidence.length
  reinforcements: number        // evidence.filter(e => e.isReinforcement).length
  contradictions: number        // evidence.filter(e => e.isContradiction).length
  lastReinforced: number | null // max timestamp of reinforcement evidence
  sourceCapturePath: string     // evidence[0].source (how the card was originally created)
  sourceAgent: string           // evidence[0].agent (which agent created the card)
  instructionEffectiveness: number  // reinforcements / (reinforcements + contradictions) or 0
}

// Source weights for trust derivation (centralized, deterministic)
const SOURCE_WEIGHTS: Record<string, number> = {
  "human-correction": 0.7,
  "remember-command": 0.7,
  "oracle-review": 0.5,
  "momus-correction": 0.5,
  "reflection-review": 0.4,
  "error-recovery": 0.3,
  "memory-capture": 0.3,
  "memory-reminder": 0.3,
  "circuit-breaker": 0.3,
  "notepad": 0.2,
  "history-backfill": 0.2,
  "staleness-check": 0.0,  // negative signal, not trust-building
}

function deriveMetrics(evidence: Evidence[]): DerivedMetrics {
  // Trust: weighted average of evidence source quality
  const trust = evidence.length > 0
    ? evidence.reduce((sum, e) => sum + (SOURCE_WEIGHTS[e.source] ?? 0.2), 0) / evidence.length
    : 0
  
  // Evidence diversity: cross-session and cross-agent confirmation
  const uniqueSessions = new Set(evidence.map(e => e.sessionId)).size
  const uniqueAgents = new Set(evidence.filter(e => e.agent).map(e => e.agent)).size
  const diversityBonus = Math.min(
    (uniqueSessions - 1) * 0.1 +  // cross-session confirmation
    (uniqueAgents - 1) * 0.15,    // cross-agent confirmation
    0.4                            // cap
  )
  
  const reinforcements = evidence.filter(e => e.isReinforcement).length
  const contradictions = evidence.filter(e => e.isContradiction).length
  const baseConfidence = Math.min(evidence.length * 0.15, 0.6) // saturates at ~4 evidence entries
  const confidence = Math.min(baseConfidence + diversityBonus - (contradictions * 0.2), 1.0)
  
  return {
    trust,
    confidence: Math.max(0, confidence),
    evidenceCount: evidence.length,
    reinforcements,
    contradictions,
    lastReinforced: reinforcements > 0
      ? Math.max(...evidence.filter(e => e.isReinforcement).map(e => e.timestamp))
      : null,
    sourceCapturePath: evidence[0]?.source ?? "unknown",
    sourceAgent: evidence[0]?.agent ?? "unknown",
    instructionEffectiveness: (reinforcements + contradictions) > 0
      ? reinforcements / (reinforcements + contradictions)
      : 0,
  }
}
```

**Why derive instead of persist (Option B rationale, see Section 14 for full analysis):**
- With <100 cards and <10 evidence entries per card, derivation is trivial (O(n) where n < 1000 total)
- Evidence array is the single source of truth; no risk of drift between evidence and denormalized scores
- Smaller persisted schema = fewer fields to validate, migrate, and merge in the single reducer
- Clean upgrade path: materialize derived fields later (Option D) if card count grows beyond ~500

**Removed fields and their replacements:**

| Removed Field | Replacement |
|---|---|
| `kind` | Folded into `tags` (e.g., tag `"anti-pattern"` instead of `kind: "anti-pattern"`). Add back as enum only if reducer/retrieval code branches on it. |
| `confidence` | Derived from evidence count + diversity + reinforcements - contradictions |
| `trust` | Derived from weighted average of `evidence[].source` quality |
| `reinforcements` / `lastReinforced` | Derived from `evidence.filter(e => e.isReinforcement)` |
| `evidenceCount` | `evidence.length` |
| `sourceAgent` | `evidence[0].agent` |
| `sourceCapturePath` | `evidence[0].source` |
| `ttl` | **Removed.** No calendar-based decay. Decay is purely evidence-based: trigger staleness (paths no longer exist) and contradiction accumulation. Session/plan cards use scope lifecycle (session end / plan completion). Project cards persist indefinitely unless contradicted or stale. A dormant project resumed after months should find its learnings intact. |
| `derivedFrom` | Deferred to P1 defrag. Add when merge tracking is needed. |

### 2. Behavior Ladder (Graduated Expression)

As a card matures, it changes HOW it influences the agent - not just whether it does:

```
whisper       →  nudge        →  checklist     →  guardrail      →  rule-candidate
(low conf)       (medium)        (high)           (very high)       (promoted)

Injected as    Injected as     Appears in      Pre-tool check     Written to
brief aside    direct advice   verification    before relevant    .sisyphus/rules/
in context     in tool output  step list       tool execution     (requires approval)

~10 tokens     ~30 tokens      ~50 tokens      ~20 tokens         permanent rule
per-session    per-match       per-checklist   per-tool-call      no token cost
```

Key insight: **mature learnings consume FEWER tokens**, not more. They graduate from verbose prompt text to compact guardrails.

### 3. Multi-Plane Memory Architecture

The system uses **four memory planes** organized by volatility and purpose. Each plane has a distinct storage, injection path, and lifecycle.

```
                          MEMORY PLANES

 Volatile                                                    Permanent
 (session)                                                   (forever)
  |                                                              |
  |  Working Memory    Episodic Recall    LearningCards    Promoted Rules
  |  (tool metadata,   (session history,  (validated       (.sisyphus/
  |   notepads,        compaction         learned          rules/learned/)
  |   raw evidence)    summaries,         behaviors)       
  |                    outcomes)                           
  |  [in-memory]       [session DB +      [learnings.json] [.md files]
  |                    .sisyphus/recall/]
  |
  |  Curated Facts
  |  (stable project truths, frozen per session)
  |  [.sisyphus/facts.jsonc]
```

| Plane | Location | Survives | Purpose | Injection |
|-------|----------|----------|---------|-----------|
| **Working** | Tool metadata store + notepads | Session only | Raw observations during execution | N/A (internal) |
| **Curated Facts** | `.sisyphus/facts.jsonc` | Permanent (human-editable) | Stable project truths, preferences, conventions | Stable bounded block, loaded once per session |
| **Episodic Recall** | Session DB + `.sisyphus/recall/` | Cross-session | Past session outcomes, summaries, key decisions | On-demand in `<memory-context>` block in user message |
| **LearningCards** | `.sisyphus/learnings.json` | Compaction + sessions | Validated learned behaviors with lifecycle | Proactive + reactive in `<memory-context>` in user message |
| **Promoted Rules** | `.sisyphus/rules/learned/` | Permanent | High-confidence rules (approval required) | Via existing rules-injector (zero token cost) |

**Key design principle (from Hermes):** Curated facts go into a **stable** block loaded once per session to maximize prompt cache hits. Dynamic recall and LearningCards are injected into the **current user message** inside a fenced `<memory-context>` block, keeping the stable prompt prefix unchanged.

#### 3a. Curated Facts Plane

Always-on stable project knowledge. Think of these as "things that are always true about this project" that every agent should know.

```typescript
// .sisyphus/facts.jsonc - human-editable, JSONC with comments
{
  "facts": [
    {
      "id": "fact-001",
      "content": "This project uses Bun, not Node. Always use bun test, bun run build.",
      "scope": "project",
      "addedBy": "human",  // or "promoted-from-card"
      "addedAt": 1720000000
    },
    {
      "id": "fact-002",
      "content": "Barrel exports in src/features/*/index.ts are required for cross-module imports.",
      "scope": "project",
      "addedBy": "promoted-from-card",
      "derivedFromCard": "card-abc123",
      "addedAt": 1720100000
    }
  ]
}
```

**Behavior:**
- Loaded once at session start, frozen for the session (maximizes prompt cache stability)
- Injected as a stable bounded block before any dynamic content
- Human-editable (JSONC format with comments)
- LearningCards can be promoted into facts when they represent stable truths rather than procedural guidance
- Bounded: max 20 facts, ~500 token budget

#### 3b. Episodic Recall Plane

On-demand cross-session recall built on existing session persistence. Agents can search past session outcomes, decisions, and summaries.

**v1 approach (build on existing persistence first):**
- Use existing `session_read`, `session_search` tools as the recall interface
- Index compaction summaries and session outcomes (not raw transcripts)
- Store lightweight recall metadata in `.sisyphus/recall/` for fast lookup

```typescript
// .sisyphus/recall/session-index.json
{
  "sessions": [
    {
      "sessionId": "ses_abc123",
      "completedAt": 1720000000,
      "agent": "sisyphus",
      "outcome": "success",
      "summary": "Implemented barrel export pattern for features module",
      "keyDecisions": ["Used index.ts re-export pattern", "Added shared/ barrel"],
      "relatedPaths": ["src/features/", "src/shared/"],
      "relatedCards": ["card-abc123"]
    }
  ]
}
```

**Behavior:**
- NOT automatically injected every turn (unlike curated facts)
- Retrieved on-demand when agent encounters a familiar context
- Prefetched at `chat.message` time: query top 2-3 relevant session summaries
- Injected in `<memory-context>` block alongside LearningCard guidance
- Bounded: max 3 session summaries, ~300 token budget
- Start with compaction summaries and final outcomes before adding raw transcript FTS

#### 3c. LearningCards Plane (unchanged core, refined role)

LearningCards remain the core learned-behavior store as defined in Section 1. The refinement: LearningCards are now explicitly for **learned behaviors and patterns**, not for stable project facts (those go in Curated Facts) or past session outcomes (those go in Episodic Recall).

#### 3d. Promoted Rules Plane (unchanged)

High-confidence LearningCards that graduate to `.sisyphus/rules/learned/*.md` via the behavior ladder. Injected by the existing rules-injector with zero ongoing token cost.

### 4. Capture: When and What

Capture at **surprise points** during execution, plus two new Hermes-inspired reflection hooks:

#### 4a. Surprise-Point Capture (during execution)

| Signal | Hook | What to Capture |
|--------|------|-----------------|
| Repeated failure then fix | `tool.execute.after` | Error pattern + successful fix approach |
| Circuit breaker trips | `tool.execute.after` | Repetitive tool use pattern |
| Oracle/Momus disagreement resolved | `tool.execute.after` (task tool) | The correction and why |
| Human corrects agent work | `chat.message` | What agent did wrong vs. human's fix |
| Compaction pre-pass | `session.compacted` | Consolidate working memory into candidates |
| Notepad files written | `tool.execute.after` (write/edit) | Parse `.sisyphus/notepads/*` as raw evidence |

#### 4b. Background Review (optional, deprioritized in favor of Reflection Subagent)

**NOTE**: With the B + Bounded A architecture (Section 4g), the periodic in-session background review is **deprioritized**. The strong reflection subagent at session boundaries (Section 4h) provides better coverage with higher context quality. This section is retained as an optional P1 addition for teams that want mid-session periodic review in addition to boundary-based reflection.

A background reflection hook that runs periodically, not just at failure points. Originally designed to catch latent learnings from successful patterns that surprise-point capture misses. However, this role is now primarily filled by the reflection subagent at session boundaries, which has full transcript context and uses a capable model.

```
Trigger: Every N tool calls (configurable, default: 20) with cooldown
         (OPTIONAL - only enable if boundary reflection proves insufficient)

   When to consider enabling:
  - Long Sisyphus sessions where boundary review is too late
  - High-volume Heracles runs with many implementation tasks
  - Sessions where compaction happens rarely

  Implementation:
  - Same as before: hidden background task, candidate cards to working memory
  - Rate-limited and idempotent (skip if already reviewed these turns)
  - If enabled alongside reflection subagent, both feed through the single reducer
```

#### 4c. Pre-Compression Flush (new, Hermes-inspired)

Before compaction discards context, give the agent one last chance to persist learnings. **DCP compatibility note:** With DCP active, native compaction is rare because DCP shrinks context earlier. The DCP `compress` tool is the primary compression boundary; native `session.compacted` is the fallback safety net. See Section 13b.

```
Triggers (priority order):
  PRIMARY: tool.execute.before(compress)
    - Fires when agent invokes DCP compress tool
    - DCP compress is the most frequent compression boundary with DCP active
    - Records raw message IDs being compressed for incremental reflection

  FALLBACK: session.compacted event (before context is summarized)
    - Fires on native OpenCode compaction (rare with DCP, but possible)
    - Safety net for sessions without DCP or when DCP does not compress enough

Pre-compression flush prompt:
  "The session is about to be compressed. Review your recent work.
   - Save any observations worth remembering as candidate cards.
   - Update any existing cards that were reinforced this session.
   - Record session outcome in episodic recall index."

Post-compression tracking: tool.execute.after(compress)
  - Mark compressed range as reviewed (update lastReviewedRawMessageId)
  - Queue lightweight reflection if nothing was captured from that range
  - Log compression boundary to memory audit journal

Implementation:
  - Primary path fires BEFORE DCP compress executes (tool.execute.before)
  - Fallback path fires BEFORE compaction-context-injector runs (session.compacted)
  - Agent writes candidates to working memory store
  - Promotion pass runs immediately after flush
  - Also writes session summary to episodic recall index
```

#### 4d. Dual-Phase Capture (unchanged principle, expanded scope)

- **During execution**: Record raw evidence from surprise points + background reviews (noisy, high-volume, cheap)
- **At session boundaries** (`session.idle`, `session.compacted`, `session.deleted`, plan completion): Promote validated candidates into durable cards + write episodic recall entry

#### 4e. Agent-Driven Memory Capture (new, Letta-inspired)

The biggest import from Letta: agents can explicitly write to memory through a dedicated tool, not just through passive hook capture. All paths (tool, command, reminder) feed the same candidate queue.

**`memory_capture` tool (P0)**

Agents call `memory_capture` to propose a candidate LearningCard. The tool writes only to the candidate queue; it cannot modify curated facts, promoted rules, or active cards directly.

```typescript
// memory_capture tool schema
interface MemoryCaptureInput {
  claim: string              // what was learned (required, 1-2 sentences)
  instruction: string        // actionable guidance (required, 1 line)
  scope: "session" | "plan" | "project"  // default: "session"
  tags: string[]             // freeform tags for retrieval (required, min 1)
                             // Include kind-like tags: "procedural", "anti-pattern", etc.
  evidence: string           // what happened (required, grounded in specific event)
  trigger?: {
    paths?: string[]
    tools?: string[]
    errors?: string[]
    keywords?: string[]
  }
}

// All memory_capture calls create candidate LearningCards with:
//   state: "candidate"
//   evidence[0].source: "memory-capture"
//   evidence[0].agent: current agent name
//   trust/confidence: DERIVED at query time from evidence[].source weights
//   (no persisted confidence/trust fields; see Section 1a for derivation)
```

**Constraints:**
- Can only write `candidate` state cards (never active/promoted)
- Cannot modify curated facts (`.sisyphus/facts.jsonc`) or promoted rules
- Requires non-empty `evidence` and at least one `tag`
- Default scope is `session`; broader scopes require stronger evidence or promotion
- New captures appear in `<memory-context>` on the next turn via dynamic overlay
- All writes logged to memory audit journal

**`/remember` command (P0)**

Explicit user-triggered memory capture. Routes through the same candidate pipeline as `memory_capture`.

```
User: /remember always run bun test with --timeout 5000 in this project

Flow:
  1. Command handler extracts user text
  2. Injects system reminder: "The user wants you to remember this.
     Determine the right memory plane and use memory_capture to store it.
     User preferences carry high trust because evidence[].source will be
     'remember-command' (source weight: 0.7). They still enter as candidates,
     not promoted rules."
  3. Agent calls memory_capture with:
     - claim: extracted from user text
     - scope: "project" (user explicitly stated)
     - tags: ["test-config", "bun"]
     - evidence: "User explicitly requested this convention"
     // trust is DERIVED from evidence[].source = "remember-command" (weight 0.7)
     // No explicit trust parameter needed
  4. Candidate enters normal lifecycle (promoted faster due to higher derived trust)
```

**Memory-check reminders (P0, Letta-inspired)**

Periodic reminders that nudge the agent to review recent turns and capture durable knowledge. Fires on **state-based signals**, not turn counts. **DCP compatibility note:** Turn-count triggers are unreliable when DCP compresses away turns. All triggers are now state-based. See Section 13c.

```
Triggers (state-based, DCP-compatible):
  - After an explicit user correction (state: correction detected in chat.message)
  - After DCP compress calls (state: compress tool executed in tool.execute.after)
  - On session.idle with unreviewed raw messages
    (state: lastReviewedRawMessageId < latest raw message ID)
  - Before native compaction as safety net (state: session.compacted event)

  NOTE: "Every N tool calls" is REMOVED as a primary trigger.
  Turn counts are unreliable with DCP (turns get compressed away).
  For long sessions, use a time-based cooldown (min 10 min) instead if needed.

Reminder injection (via existing verification-reminders pattern):
  "MEMORY CHECK: Review this conversation for information worth storing.
   - Corrections the user made to your work
   - Project conventions or preferences discovered
   - Build/test quirks worth remembering
   Use memory_capture for anything worth persisting."

Implementation:
  - Reuse src/hooks/atlas/verification-reminders.ts pattern
  - Inject via system transform (not user message, to avoid DCP pruning)
  - Rate-limited: skip if agent already called memory_capture since last reminder
  - Cooldown timer resets on each reminder (time-based, not turn-based)
```

**All capture paths feed ONE candidate queue:**

```
  IN-SESSION CAPTURE (primary, immediate)     BOUNDARY CAPTURE (secondary)
  ==========================================   ========================
  memory_capture tool  ---+                    Reflection subagent ---+
                          |                    (capable model,        |
  /remember command  -----+                     session boundaries)   |
                          |                                          |
  Memory-check reminder --+                                          |
                          |                                          |
  Surprise-point hooks ---+------> SINGLE REDUCER <------------------+
                          |        (owns learnings.json)
  Pre-compression flush --+        |
                                   |  1. Deduplicate (fingerprint)
                                   |  2. Lock + temp write + rename
                                   |  3. Zod validate
                                   |  4. Audit journal entry
                                   v
                            .sisyphus/learnings.json
                            (state: "candidate")

  All entries carry (slim schema):
    claim, instruction, trigger, scope, state,
    tags, evidence[], createdAt, lastSeen

#### 4f. Scoped Overlays and Dynamic Injection (new, Letta-inspired)

Memory writes must be visible without mutating load-once stable state. This is the key constraint from Letta's prompt-recompilation model, adapted to our cache-stable architecture. **DCP compatibility note:** the dynamic overlay is delivered via `experimental.chat.system.transform` (not user message injection) to avoid cross-plugin hook ordering conflicts with DCP. See Section 13a for full rationale.

**Scope precedence hierarchy:**

```
session > plan > project > user

When multiple memories match the same context, narrower scope wins.
Session-scoped memories override project-scoped ones for the same claim.
```

**Dynamic overlay rule (critical invariant):**

New memory writes (from `memory_capture`, `/remember`, hooks, reminders) appear in the `<memory-context>` block on the **next turn**, not immediately. The dynamic overlay is appended to the system prompt via `experimental.chat.system.transform`, AFTER the stable curated-facts prefix. This keeps dynamic memory off the user-message surface that DCP rewrites (see Section 13a). They never mutate:
- Curated facts in the stable prompt prefix (loaded once, frozen for session)
- Promoted rules in `.sisyphus/rules/learned/` (injected by rules-injector via `tool.execute.before`)
- Active LearningCards that were loaded at session start

```
Turn N: Agent calls memory_capture(claim: "X", scope: "session")
  -> Candidate written to learnings.json
  -> Audit journal entry appended

Turn N+1: system transform handler queries learnings.json
  -> New candidate appears in <memory-context> block appended to system prompt
  -> Original stable prompt prefix is UNCHANGED (cache preserved for prefix portion)
  -> User messages are UNTOUCHED (DCP can prune/compress freely)
```

**When broader scope takes effect:**
- `session` scope: visible in current session only, next turn onwards
- `plan` scope: visible in current plan execution across continuations
- `project` scope: visible in all future sessions (requires promotion from session/plan)
- `user` scope: reserved for future global memory (v2)

**Promotion widens scope, not initial capture:**
- All captures default to `session` scope
- Background review or promotion pass can widen to `plan` or `project`
- Only adversarial promotion (Oracle + Momus) can widen to `project` for durable cards

#### 4g. Learning Population Architecture: B + Bounded A

The learning system uses a **hybrid population model** evaluated against three alternatives:

- **Option A (Dedicated Background Learner)**: Always-on watcher subagent that observes the session and captures learnings independently
- **Option B (Current Hybrid)**: Running agent captures learnings via hooks, tools, and reminders during its own work
- **Option C (Hybrid + Post-Session Sweep)**: B's in-session capture plus a lightweight post-session scan

**Decision: B + Bounded A** (the running agent does primary capture; a strong reflection subagent reviews at session boundaries only)

```
WHY NOT pure A (dedicated watcher):
  - Background jobs are separate child sessions (src/features/background-agent/manager.ts)
    and report back asynchronously. A watcher is always LATE for same-session learning.
  - Transcript-only review lacks execution context (why a decision was made,
    what alternatives were considered). The executing agent has higher-fidelity context.
  - Two independent writers to learnings.json creates duplicate/contradictory cards.
    A file-based store rewards single-writer discipline.
  - "Capture moral hazard": if the agent knows a watcher exists, it deprioritizes
    self-capture. This costs same-session learning, which is the most valuable kind.
  - These are ARCHITECTURAL problems, not cost problems.
    Even with unlimited budget (opus 4.6, gpt 5.4), these constraints remain.

WHY NOT pure B (no reviewer):
  - The executing agent is busy and sometimes forgets to capture soft signals
    (conventions, preferences, successful approaches that aren't surprise-point-triggered).
  - No second perspective: the author misses things a reviewer catches (code review analogy).
  - Under-capture during difficult work when the agent is focused on solving the problem.

THE HYBRID (B + Bounded A):
  - Primary path: in-session capture via hooks, memory_capture tool, /remember,
    memory-check reminders, pre-compression flush. These provide IMMEDIATE learning
    (available next turn via dynamic overlay).
  - Secondary path: ONE strong reflection subagent at session boundaries only
    (compaction, session.idle, session end). Uses a capable model (opus 4.6 / gpt 5.4).
    Reviews transcript for misses, contradictions, and promotion candidates.
    Advisory, not authoritative: outputs go through the same candidate pipeline.
  - All sources feed through a SINGLE REDUCER that owns learnings.json.
    No parallel writers. Lock + temp write + rename + fingerprints.
```

**What unlimited budget buys**: Better review quality at boundaries (one strong bounded review is better than many weak continuous scans), not more uncontrolled writers.

**Tuning by mode:**
- Sisyphus: biases toward immediate capture (interactive, user corrections are high-signal)
- Atlas: relies more on boundary review (delegation meta-patterns emerge over time)
- Heracles: biases toward immediate capture (implementation patterns, build/test quirks)

**Escalation triggers:**
- Move closer to pure A only if cross-session memory quality matters more than same-session adaptation
- If long sessions need more same-session recall, add a sparse compaction-triggered mini-review before adding a full-time watcher
- If candidate memory grows beyond what tags + text search can handle, add a lexical index first, embeddings only after proven retrieval misses

#### 4h. Strong Reflection Subagent (P0, promoted from P1 11b)

The secondary capture path in the B + Bounded A architecture. A high-capability reflection subagent that reviews the session transcript at boundaries to catch what in-session capture missed. This is the "code review" layer: the author (executing agent) misses things a reviewer catches. **DCP compatibility note:** Reflection uses incremental review with `lastReviewedRawMessageId` to avoid re-reviewing the entire transcript. DCP compress calls are a primary trigger. See Section 13d.

**Key properties:**
- Uses a **capable model** (opus 4.6, gpt 5.4, or equivalent) for high-quality review
- Runs ONLY at session boundaries, NOT continuously
- **Advisory, not authoritative**: all outputs are candidate LearningCards, not promoted rules
- Feeds through the **single reducer** (same as all other capture paths)
- Provides a **different perspective** from the executing agent (reviews patterns, not just reacts to events)

```
Triggers (any of):
  - session.idle (after main work completes, before continuation)
  - DCP compress calls (tool.execute.after for compress) -- PRIMARY with DCP active
  - session.compacted (before context is lost) -- fallback safety net
  - Plan completion (batch review of plan execution)
  - session.deleted (final reflection pass)

Reflection subagent prompt:
  "Review the completed work in this session. You are a separate reviewer
   with a different perspective than the executing agent. Look for:
   - Mistakes the agent made and how they were resolved
   - User corrections or expressions of frustration
   - Approaches that worked well and could be generalized
   - Project conventions not yet in the learning store
   - Patterns the executing agent was too busy to capture
   Use memory_capture for anything worth persisting.
   Be specific: include the error message, the fix, the file path."

Implementation:
  - Runs as background task via src/features/background-agent/manager.ts
  - Uses a dedicated high-capability model (not the session's working model)
  - Outputs go through memory_capture -> single reducer -> learnings.json
  - Rate-limited: max 1 reflection per session idle, 1 per compaction/compress boundary
  - Skips if session had very few tool calls (< 5) or was pure research
  - INCREMENTAL REVIEW (DCP-aware):
    - Track lastReviewedRawMessageId in .sisyphus/learning-state.json
    - After each trigger, review only raw messages since lastReviewedRawMessageId
    - After DCP compress: target the specific compressed span for review
    - Prevents re-reviewing entire transcript on every boundary event
    - Reads raw session messages via session API (not DCP-transformed messages)
  - Mode-specific behavior:
    - Sisyphus: focuses on user corrections, conventions, successful patterns
    - Atlas: focuses on delegation meta-patterns, model/category effectiveness
    - Heracles: focuses on implementation patterns, build/test quirks, file conventions

Safety:
  - Reflection outputs are ALWAYS candidate state (never active/promoted directly)
  - Deduplication against existing cards before creating (via single reducer)
  - Cannot modify curated facts, promoted rules, or active cards
  - All writes logged to memory audit journal with source: "reflection-review"
  - If reflection contradicts an existing card, creates a separate card
    (contradiction resolution is handled by defrag/promotion, not by reflection)
```
### 5. Injection: Multi-Plane, Two Channels

Injection follows a strict hierarchy to maximize prompt cache stability and minimize context pollution:

```
SESSION START (stable, loaded once, in system prompt prefix)
  |
  +-- Curated Facts: bounded block in stable prompt prefix
  |   (~500 tokens, frozen for session, cache-friendly)
  |
EVERY TURN (dynamic, appended to system prompt via experimental.chat.system.transform)
  |
  +-- <memory-context>
  |     [System note: The following is recalled context,
  |      NOT new user input. Treat as informational background.]
  |
  |     ## Relevant Learnings (proactive LearningCards)
  |     - [instruction from card 1]
  |     - [instruction from card 2]
  |
  |     ## Recalled Context (episodic recall, if relevant)
  |     - Session ses_abc: "Used X pattern for Y, worked well"
  |   </memory-context>
  |
  +-- Hard token budget: 500 tokens max (200 cards + 300 recall)
  |   Enforced per-request; rank and truncate if exceeded
  |
USER MESSAGE (untouched by learning system -- DCP-compatible)
  |
  +-- [actual user message text]
  |   (No injected memory content. DCP can prune/compress freely.)
  |
TOOL OUTPUT (reactive, appended to specific tool results)
  |
  +-- "Previous learning: [instruction]" when error matches card
```

**Proactive channel** (via `experimental.chat.system.transform`):
- Query LearningCard store for cards matching current task/context
- Query episodic recall for relevant past session summaries
- Rank by: exact path match > tool match > agent match > keyword match > confidence > recency
- Inject top 3-5 card instructions + top 2-3 session summaries
- Combined budget: ~500 tokens max (200 for cards, 300 for recall)
- Fenced in `<memory-context>` block appended to system prompt (DCP-compatible: avoids user message transform conflicts, see Section 13a)

**Reactive channel** (on `tool.execute.after`):
- When tool output matches a card's error trigger
- Append specific guidance: "Previous learning: [instruction]"
- Updates card evidence: adds reinforcement entry (isReinforcement: true) on successful application
- No fencing needed (appended directly to tool output)
### 6. Reinforcement, Decay, and Clustering

```
Reinforcement (positive feedback loop):
  - Only counts across SEPARATE sessions or DISTINCT agents
  - One long failing loop cannot self-reinforce
  - Human-accepted outcomes count double
  - Oracle/Momus agreement with a card's claim counts as reviewer-source reinforcement
  - Successful reuse (card injected + task completed successfully) counts as application reinforcement
  - Each reinforcement adds an evidence entry with isReinforcement: true

Negative evidence (immune-system feedback loop, P0):
  - When a card is injected and the task FAILS, add an evidence entry with isContradiction: true
  - When a card's claim is explicitly disproven, add contradiction evidence
  - Contradictions weigh more heavily than reinforcements in derived confidence:
    - Each reinforcement: +0.15 confidence
    - Each contradiction: -0.20 confidence (asymmetric, like Holographic's -0.10 vs +0.05)
  - If contradictions > reinforcements: auto-transition state to 'quarantined'
  - Quarantined cards can be revived by new matching evidence (reinforcements)

Injection-outcome correlation (P0):
  - Track which cards were injected each turn in learning-state.json:
    injectedThisTurn: string[]   // card IDs injected via <memory-context>
    reactiveThisTurn: string[]   // card IDs injected via tool.execute.after
  - After each turn, in tool.execute.after:
    - If tool SUCCEEDED and a card was injected: add reinforcement evidence to that card
    - If tool FAILED and a card was injected: do NOT auto-add contradiction
      (failure may be unrelated). Flag for reflection subagent review instead.
  - This closes the feedback loop: reinforcement is grounded in actual outcomes,
    not vague 'successful application'

Evidence diversity weighting (P0, in derived confidence):
  - Cross-session bonus: +0.10 per unique sessionId beyond the first
  - Cross-agent bonus:  +0.15 per unique agent beyond the first
  - Diversity cap: 0.4 max bonus
  - A card with 5 evidence entries from 1 agent in 1 session ranks lower
    than a card with 3 entries from 2 agents across 2 sessions
  - Prevents echo-chamber cards where one long failing loop
    accumulates multiple evidence entries from the same flawed reasoning

Feedback-weighted ranking (derived at query time, see Section 1a):
  - Human corrections: weight 0.7 (explicit signal)
  - /remember command: weight 0.7 (explicit user request)
  - Oracle/Momus review: weight 0.5 (reviewer-originated)
  - Reflection review: weight 0.4 (second-perspective review)
  - Error recovery, memory capture, circuit breaker, reminders: weight 0.3
  - Notepad, history backfill: weight 0.2
  - Staleness check: weight 0.0 (negative signal, not trust-building)

Instruction effectiveness (P1):
  - Derived metric: reinforcements / (reinforcements + contradictions)
  - Cards with low effectiveness (<0.3) are deprioritized in injection ranking
  - Reflection subagent can assess whether agents followed the instruction
  - Enables instruction rewrite during P1 defrag (refine wording, not just claim)

Decay (purely evidence-based, NO calendar TTL):
  - Project cards NEVER expire by time alone. A project dormant for 6 months
    and then resumed should find all learnings intact. Time is not evidence
    against a card's validity.
  - Session cards: cleaned up at session end (scope lifecycle, not TTL)
  - Plan cards: cleaned up when plan completes (scope lifecycle, not TTL)
  - Project cards: persist indefinitely unless one of these signals fires:
    1. Trigger staleness: glob(trigger.paths) finds no matches at session start
       -> add contradiction evidence (source: 'staleness-check')
    2. Contradiction accumulation: contradictions > reinforcements
       -> auto-quarantine
    3. Explicit retirement: human or adversarial promotion pipeline
       marks card as retired
  - Cards with no negative evidence and no staleness are ALWAYS valid,
    whether they are 30 days old or 3 years old. Silence is not evidence.
  - Quarantined cards can be revived by new matching evidence (reinforcement)
  - Relevance-based decay (P2): if a card hasn't been *matched* in N sessions
    where its trigger context was active, flag for review. NOT auto-quarantine.
    This catches cards whose triggers still exist but are never relevant.

Clustering:
  - N similar reinforced cards (same trigger pattern, related claims)
  - Auto-cluster into a "policy candidate"
  - Policy candidates are promotion-ready
```

### 7. Multi-Agent Governance (Adversarial Promotion)

No card reaches `promoted` state without passing through the existing review agents:

```
Candidate card
  → Sisyphus/Hephaestus propose (from captured evidence)
  → Oracle validates (is the evidence sufficient? is the claim sound?)
  → Momus attacks (overgeneralization? missing edge cases?)
  → Metis searches counterexamples (is there evidence AGAINST this?)
  → Shadow mode trial (card is retrieved but logged, not injected)
  → If shadow hits correlate with success → promote to guardrail
  → If promoted to rule-candidate → human approval gate
```

### 8. Compaction Interaction

```
Before compaction:
  1. Extract pending candidate cards from working memory
  2. Snapshot applied learning IDs for this session

After compaction:
  1. Restore pending candidate IDs + applied learning IDs
  2. Re-run normal retrieval against durable store
  3. Mini-reflection: any working-memory observations worth promoting?
```

### 9. Storage and Safety

**Storage:**
- LearningCards: `.sisyphus/learnings.json` using atomic write + lock pattern (same as task storage). Zod-validated on every read/write. Last-known-good backup on corruption.
- Curated Facts: `.sisyphus/facts.jsonc` (JSONC, human-editable, Zod-validated on load)
- Episodic Recall: `.sisyphus/recall/session-index.json` (atomic write, append-mostly)
- Promoted Rules: `.sisyphus/rules/learned/*.md` (via behavior ladder, requires approval)

**Single Reducer (P0, B + Bounded A architecture):**

All capture paths (hooks, memory_capture, /remember, reminders, pre-compression flush, reflection subagent) feed through ONE reducer that owns `learnings.json`. No source writes to the file directly.

```
                ALL CAPTURE SOURCES
                       |
  hooks -----+         |
  memory_    -+         |
    capture   +-------> SINGLE REDUCER ------> .sisyphus/learnings.json
  /remember --+         |                      (atomic write)
  reminders --+         |
  pre-flush --+         |    Also writes:
  reflection -+         +-----> .sisyphus/memory-journal.jsonl
    subagent            |       (audit log)

Reducer responsibilities:
  1. Deduplication: fingerprint each candidate (hash of claim + trigger)
     before writing. Skip if duplicate exists.
  2. Locking: acquire file lock before read-modify-write cycle.
     Use lock + temp write + rename pattern
     (same as src/features/claude-tasks/storage.ts).
  3. Validation: Zod-validate the full store on every write.
     Reject malformed entries without corrupting existing data.
  4. Audit: append a MemoryJournalEntry for every mutation.
  5. Conflict resolution: if two sources capture overlapping claims,
     merge evidence arrays. No need to compare persisted confidence/trust
     because these are DERIVED from evidence. Merged evidence array
     naturally produces the correct derived metrics.
  6. Session isolation: tag each write with sessionId and source
     for provenance tracking.
```

**Why a single reducer matters:**
- File-based storage (learnings.json) has no built-in concurrency control
- Multiple writers (executing agent + reflection subagent + hooks) risk corruption
- The reducer serializes all writes through one code path
- Same pattern as `src/features/claude-tasks/storage.ts` which already handles concurrent task storage

**Memory audit journal (P0, Letta-inspired):**

Every memory write (create, update, promote, quarantine, retire, defrag) is logged to an append-only journal. This provides rollback capability, debugging, and governance audit trails.

```typescript
// .sisyphus/memory-journal.jsonl - one JSON object per line, append-only
interface MemoryJournalEntry {
  timestamp: number
  actor: string               // agent name or "human" or "system"
  action: "create" | "update" | "promote" | "quarantine" | "retire"
         | "defrag-merge" | "defrag-prune" | "scope-widen" | "restore"
  source: string              // capture path: "memory_capture" | "remember" | "hook:tool.execute.after" | ...
  target: {
    plane: "learnings" | "facts" | "recall" | "rules"
    id: string                // card ID, fact ID, session ID, or rule path
  }
  before?: string             // SHA-256 hash of previous value (null for creates)
  after: string               // SHA-256 hash of new value
  sessionId: string
  metadata?: {
    scope?: string            // scope at time of write
    derivedConfidence?: number // confidence derived from evidence at time of write
    mergedFrom?: string[]     // for defrag-merge: source card IDs
  }
}
```

**Journal behavior:**
- Append-only: never edit or delete entries (JSONL for efficient appending)
- Bounded: rotate after 10K entries (archive old journal to `.sisyphus/memory-journal.{timestamp}.jsonl`)
- Enables `memory_restore` command (P1): revert a card to a previous state using before/after hashes
- Enables introspection: "why was this card created?" traces back through journal entries
- All capture paths (memory_capture, /remember, hooks, reminders, background review) write to journal
- Memory Audit Journal: `.sisyphus/memory-journal.jsonl` (append-only, JSONL format)

**Safety rails:**
- Learned items change **context only** - never rewrite code, agent prompts, or static rules
- Inject only the short `instruction` field, never full evidence
- Concurrent subagent writes use lock + atomic rename
- Single-session guesses stay `candidate` until confirmed
- Contradictions split into narrower scoped cards instead of deleting
- Hard token budget cap on total injected learnings per turn

**Multi-agent safety (new):**
- All episodic recall entries carry **provenance tags**: agent, session, turn, outcome
- Prefer finalized outcomes over raw internal debate in recall results
- Filter recall by agent perspective when context is agent-specific
- Never inject raw Oracle critique into a different agent's context without summarizing

**Injection bloat prevention:**
- Hard caps: 500 tokens total per turn (200 cards + 300 recall)
- Graceful degradation: if budget exceeded, rank and truncate (cards first, then recall)
- Session-level dedup: don't re-inject the same card within same session unless error recurs
- Curated facts are bounded at 20 entries max

**Procedural memory safety (Phase 2):**
- Promoted LearningCards can generate "playbook candidates" (skill-like artifacts)
- Agents CANNOT freely create/edit SKILL.md files in v1
- Playbook candidates require human review or dual Oracle+Momus approval
- Keep behind same quarantine/review path as promoted learnings
### 10. Introspection (Ship Early)

- `why was this injected?` - trace from card to evidence to session
- Resume-time memory diff: what was reinforced, quarantined, promoted, retired since last session
- Active vs quarantined card counts
- Genealogy: observation -> card -> policy -> outcome chain

### 11. P1 Features (Letta-inspired)

#### 11a. Memory Defragmentation

As the candidate and active LearningCard stores grow, duplicates and near-duplicates accumulate. Defrag runs as a deterministic background job, not a creative rewrite.

```
Trigger: On session.idle when card count exceeds threshold (default: 50 candidates)
         OR manually via /memory-defrag command (P2)

Defrag operations (deterministic, no LLM needed):
  1. Exact-claim dedup: merge cards with identical claims
     - Union tags and evidence arrays
     - Derived metrics naturally recalculate from merged evidence
     - Log merge in audit journal (action: "defrag-merge")
  2. Tag normalization: lowercase, trim, dedup tag lists
  3. Stale candidate pruning: remove candidates with no reinforcement evidence
     and either trigger staleness or state=quarantined (action: "defrag-prune")
  4. Evidence compaction: if a card has >10 evidence entries,
     keep the 5 most recent + the original

Defrag operations (LLM-assisted, P2):
  5. Near-duplicate clustering: group cards with overlapping
     triggers and similar claims, propose merge candidates
     (LLM proposes patch, system applies after validation)
  6. Contradiction detection: flag cards with opposing claims
     for the same trigger context

Safety:
  - All defrag writes go through audit journal
  - Never delete promoted rules or curated facts
  - LLM-assisted defrag proposes patches, never directly rewrites
  - Rollback via journal if defrag damages useful cards
```

#### 11b. Reflection/Memory-Review Job (PROMOTED TO P0 as Section 4h)

**This section has been promoted to Section 4h (Strong Reflection Subagent).** The reflection subagent is now a P0 component of the B + Bounded A architecture, not a P1 deferral. See Section 4g for the architectural rationale and Section 4h for the full specification.

The key upgrade from the original P1 design:
- Uses a **capable model** (opus 4.6 / gpt 5.4) instead of the session's working model
- Is explicitly the **secondary capture path** in the B + Bounded A hybrid
- Feeds through the **single reducer** (prevents parallel writer conflicts)
- Advisory only: outputs are always candidates, never directly promoted

#### 11c. History Analyzer/Backfill

Mine existing session history for repeated patterns, corrections, and conventions that were never captured. Seeds the learning store from past sessions.

```
Trigger: Manual command /memory-backfill (P1)
         OR on first plugin load for a project with existing sessions (P2)

Backfill flow:
  1. Use session_search to find sessions with correction signals:
     - "I already told you", "no, use", "that's wrong", "stop doing"
     - Repeated error patterns across sessions
     - Explicit preference statements
  2. For each matching session, use session_read to get context
  3. Extract candidate LearningCards via memory_capture
     - evidence[0].source: "history-backfill"
     - Default scope: "project" (historical patterns are likely project-wide)
     - Higher initial evidence count if pattern appears in 3+ sessions
  4. Run normal promotion pipeline on backfilled candidates

Safety:
  - Read-only access to session history (never modify past sessions)
  - All backfilled cards enter as candidates (normal lifecycle)
  - Rate-limited: process max 20 sessions per backfill run
  - Deduplicate against existing cards before creating
```
---

### Scope for v1

**Per-project only.** No global store until learnings prove cross-project value (manual promotion). No embeddings or vector DB - explicit trigger matching (paths, tools, errors, keywords) is sufficient given the structured nature of the cards.

### Implementation Phases

| Phase | Scope | Effort |
|-------|-------|--------|
| **P0** | Slim LearningCard schema (~10 persisted fields) + derived metrics helper (Section 1a) + store + Curated Facts store + basic capture from error hooks + proactive injection via `experimental.chat.system.transform` with `<memory-context>` fencing + **`memory_capture` tool** + **`/remember` command** + **memory-check reminders (state-based triggers)** + **scoped overlays (session/plan/project)** + **memory audit journal** + **single reducer** (owns learnings.json, lock+temp+rename+fingerprint) + **strong reflection subagent** (capable model, incremental review with lastReviewedRawMessageId) + **pre-compression flush** (DCP compress as primary trigger, native compaction as fallback) + **DCP compatibility layer** (system transform injection, compress tool hooks, state-based reminders) + **learning-state.json** (lastReviewedRawMessageId, injection-outcome correlation tracking) + **negative evidence** (isContradiction on evidence entries, evidence-based quarantine) + **injection-outcome correlation** (injectedThisTurn tracking, reinforcement grounded in actual outcomes) + **evidence diversity weighting** (cross-session/cross-agent bonuses in derived confidence) | Large (3-5d) |
| **P1** | Reactive injection on `tool.execute.after` + episodic recall index (compaction summaries) + **memory defragmentation (deterministic)** + **history analyzer/backfill** + **`memory_restore` command** + **trigger staleness detection** (glob check trigger.paths at session start) + **instruction effectiveness tracking** (instructionFollowed evidence, deprioritize low-compliance cards) + **background review hook** (optional, for teams wanting mid-session periodic review) | Medium (2-3d) |
| **P2** | Behavior ladder (graduated expression) + feedback-weighted ranking + clustering + shadow mode + episodic recall prefetch + **LLM-assisted defrag (near-duplicate clustering, contradiction detection)** | Large (3-5d) |
| **P3** | Adversarial promotion (Oracle/Momus/Metis) + introspection + procedural memory (playbook candidates from promoted cards) + **block-based curated facts** (if retrieval quality warrants it) | Large (3-5d) |

**Minimum viable delta: P0 only (Large, 3-5d for safe v1)**

The biggest wins we incorporate:

From Hermes:
1. Multi-plane memory separation (facts vs episodes vs learned behaviors)
2. User-message injection with `<memory-context>` fencing for cache stability
3. Pre-compression flush to prevent knowledge loss during compaction

From Letta:
4. Agent-driven memory capture tool (`memory_capture`) as the primary explicit write path
5. `/remember` command for user-triggered memory persistence
6. Memory-check reminders on strong signals (corrections, compaction, every N turns)
7. Scoped overlays with precedence (session > plan > project > user)
8. Slim persisted schema with derived metrics (evidence as single source of truth, see Section 14)
9. Append-only memory audit journal for governance, rollback, and introspection
10. History analyzer/backfill to seed learning store from existing session history

From architecture evaluation (B + Bounded A):
11. Strong reflection subagent at session boundaries (capable model, advisory, second perspective)
12. Single reducer pattern (owns learnings.json, prevents parallel-writer conflicts)
13. Background review deprioritized in favor of boundary-based reflection
14. Negative evidence (isContradiction) for evidence-based quarantine instead of TTL-only decay
15. Injection-outcome correlation (injectedThisTurn tracking, reinforcement grounded in outcomes)
16. Evidence diversity weighting (cross-session/cross-agent bonuses in derived confidence)

---

### 12. Letta Comparison: What We Copy, Skip, and Improve

| Letta Pattern | Our Decision | Rationale |
|---------------|-------------|-----------|
| **Agent-driven memory tools** (core_memory_append, memory_rethink) | **Copy as `memory_capture`** (P0) | Biggest import. But candidate-only; agents cannot edit curated facts or rules directly. |
| **Periodic memory-check reminders** (step-count + compaction triggers) | **Copy** (P0) | Cheap, effective. Fire on strong signals only (corrections, compaction, every N turns with cooldown). |
| **`/remember` command** | **Copy** (P0) | Strong UX signal. Routes through same candidate pipeline with elevated trust. |
| **Three-tier memory** (core/recall/archival) | **Already have** (4 planes) | Our planes map to: Curated Facts ~ core blocks, Episodic Recall ~ recall, LearningCards ~ archival with lifecycle, Promoted Rules ~ read-only blocks. |
| **Prompt recompilation on memory change** | **Adapt as dynamic overlay** (P0) | We use next-turn `<memory-context>` injection instead of system prompt rebuild. Preserves prompt cache stability. |
| **Memory defragmentation** (Letta-Code's defrag subagent) | **Copy, deterministic first** (P1) | Start with exact-dedup, tag normalization, stale pruning. LLM-assisted clustering in P2. |
| **Reflection subagent** (Letta-Code: reviews conversations for mistakes) | **Promoted to P0 as Strong Reflection Subagent** (Section 4h) | Upgraded from P1: uses capable model at session boundaries. Advisory, not authoritative. Second perspective in B + Bounded A architecture. |
| **History analyzer** (Letta-Code: bulk-mines past sessions) | **Copy** (P1) | Use existing `session_search`/`session_read` tools to mine past patterns. |
| **Block-based core memory with size limits** | **Defer to P3** | Our curated facts are file-based (JSONC). Blockify only if retrieval quality warrants it. |
| **Git-backed MemFS** | **Skip** | Our `.sisyphus/` file-based storage with atomic writes is sufficient. No need for git-backed memory filesystem. |
| **Shared writable memory across agents** | **Skip** (keep notepads/plan files) | Strong conflict with role separation. Notepads are plan-scoped, file-visible, append-only. At most add read-only shared plan overlay in P2. |
| **Sleeptime agent** (background post-conversation memory maintenance) | **Adapted as strong reflection subagent** (P0) | Our session.idle hook + capable-model reflection subagent achieves similar effect. Runs at boundaries only, not continuously. |
| **Hybrid retrieval** (Turbopuffer vector ANN + BM25 + RRF) | **Skip for v1** | No embeddings needed yet. Structured trigger matching (paths, tools, errors, keywords, tags) is sufficient. Add lexical index if retrieval quality degrades. |
| **Conversation isolation** (per-conversation block overrides) | **Covered by scope hierarchy** | Session-scoped memories are already conversation-isolated. Plan-scoped memories cover multi-session continuity. |
| **Block version history / undo-redo** | **Adapt as audit journal** (P0 log, P1 restore) | Append-only JSONL journal with before/after hashes instead of per-block snapshots. Simpler, more general. |
| **Confidence/trust scores on memories** | **Our design is stronger (derived, not persisted)** | Letta has no confidence or trust fields. Hermes Holographic has `trust_score` + `helpful_count` (3 fields). We derive trust, confidence, reinforcements, contradictions, and diversity metrics from the evidence array at query time (Section 1a). Same retrieval accuracy, fewer persisted fields, no drift risk. |
| **Adversarial promotion** | **Our design is unique** | Letta has no adversarial review. We require Oracle + Momus + Metis + shadow mode before promotion. |
| **Behavior ladder** | **Our design is unique** | Letta has no graduated expression. We have whisper > nudge > checklist > guardrail > rule-candidate. |
| **Feedback-based trust scoring** (Hermes Holographic: +0.05/-0.10) | **Adapted as evidence-based feedback** (P0) | Holographic uses persisted trust_score with binary helpful/not-helpful. We use evidence entries with `isReinforcement`/`isContradiction` flags, deriving trust from source weights and confidence from diversity. Richer provenance trail: can explain WHY trust changed, not just the current number. Asymmetric weighting preserved: contradictions weigh -0.20 vs reinforcements +0.15. |
| **Schema richness** (Hermes Holographic: 10 fields, Letta: ~5 fields) | **Slim schema: ~10 persisted fields** (P0) | Holographic has trust_score, retrieval_count, helpful_count, category, tags, hrr_vector, timestamps. Letta has description, read_only, value. We persist claim, instruction, trigger, scope, state, tags, evidence[], createdAt, lastSeen. All ranking/lifecycle metrics derived from evidence at query time (Section 1a). Best of both: richer than Letta, leaner than our original 25-field design, with zero denormalized-field drift. |

**Key insight from Oracle:** "Copy Letta's control loop, not its storage stack." We import the explicit memory workflow (capture tool, reminders, /remember) while keeping our stronger governance (immune lifecycle, adversarial promotion, behavior ladder). The B + Bounded A architecture adds a strong reflection subagent at session boundaries as the secondary capture path, with a single reducer preventing parallel-writer conflicts on file-based storage.

### 13. DCP Compatibility Layer

The learning system must coexist with the Dynamic Context Pruning (DCP) plugin, which rewrites the outgoing message array at request time. DCP never modifies session history; it replaces pruned content with placeholders and injects synthetic summary messages before sending to the LLM.

**DCP hooks used**: `config`, `chat.message`, `experimental.chat.system.transform`, `experimental.chat.messages.transform`, `experimental.text.complete`, `command.execute.before`, `tool.compress`.
**DCP hooks NOT used**: `tool.execute.before`, `tool.execute.after`, `event`, `chat.params`, `chat.headers`.

**What already works without changes:**
- `memory_capture` tool: side effect persists to `learnings.json`; DCP pruning of tool output is harmless (and reduces context noise for free)
- Curated facts in stable prompt prefix: not touched by DCP message transform
- Promoted rules via rules-injector: injected through `tool.execute.before`, a surface DCP does not use
- Reflection subagent: reads raw session messages via session API; DCP preserves raw history longer by delaying native compaction

#### 13a. Problem 1: Dynamic Memory Overlay Surface Conflict

**Issue**: The context-injector puts `<memory-context>` into the last user message via `experimental.chat.messages.transform`. DCP uses the same hook for its pruning and synthetic message injection. Cross-plugin hook ordering is unstable: we cannot guarantee whether DCP prunes before or after our injection runs.

- If DCP runs first: it compresses messages that do not have memory yet
- If our plugin runs first: DCP might compress away the injected memory content

**Fix**: Move the dynamic memory overlay from user message injection (`experimental.chat.messages.transform`) to `experimental.chat.system.transform`.

```
BEFORE (conflict-prone):
  experimental.chat.messages.transform:
    - DCP: prune/compress/inject IDs (order unstable)
    - Learning system: inject <memory-context> into last user message (order unstable)

AFTER (conflict-free):
  experimental.chat.system.transform:
    - Learning system: append dynamic <memory-context> block after stable prefix
    (DCP does not touch system transform for pruning; it only appends its own instructions)
  experimental.chat.messages.transform:
    - DCP: prune/compress/inject IDs (sole owner of this surface for context rewriting)
```

**Constraints on system transform injection:**
- Append dynamic block AFTER the stable curated-facts prefix (preserves prompt cache for the prefix portion)
- Enforce a hard token budget on dynamic memory in system transform (default: 500 tokens) to prevent context bloat migration from user message to system prompt
- Curated facts remain in the stable prefix (loaded once, frozen)
- Promoted rules remain in `tool.execute.before` (unchanged)
- The `<memory-context>` block format stays the same; only the delivery surface changes

#### 13b. Problem 2: Pre-Compression Flush Missing DCP Trigger

**Issue**: The pre-compression flush (Section 4c) fires on native compaction events (`session.compacted`). But DCP delays native compaction significantly (sometimes indefinitely) by shrinking context earlier. The agent-invoked DCP `compress` tool is the real compression boundary, and the learning system has no hook for it.

**Fix**: Add `tool.execute.before` and `tool.execute.after` hooks for the DCP `compress` tool.

```
tool.execute.before (compress):
  1. Fire pre-compression flush: save uncaptured observations as candidate cards
  2. Mark current raw message range as "pending review"
  3. Record the raw message IDs being compressed (for incremental reflection targeting)

tool.execute.after (compress):
  1. Mark the compressed range as reviewed
  2. Optionally queue lightweight reflection if nothing was captured from that range
  3. Update lastReviewedRawMessageId in learning state
  4. Log compression boundary to memory audit journal

Native compaction hooks remain as safety net:
  - session.compacted still fires pre-compression flush
  - But DCP compress is now the PRIMARY learning boundary
  - Native compaction is the FALLBACK boundary
```

**Where DCP helps**: A `compress` call is a strong signal that a span is "complete enough to summarize," which is also a natural checkpoint for learning capture. DCP delays native compaction, giving the reflection subagent a longer raw evidence window.

#### 13c. Problem 3: Turn-Count Reminders Unreliable with DCP

**Issue**: "Every N tool calls" reminders become misleading when DCP compresses away the turns they were injected into. The turn-count signal is unreliable because DCP makes "turns in context" different from "turns that happened."

**Fix**: Replace turn-count triggers with state-based triggers throughout the system.

```
BEFORE (unreliable with DCP):
  Memory-check reminders fire:
    - After user correction (OK)
    - After session compaction (OK but rare with DCP)
    - Every N tool calls with cooldown (UNRELIABLE with DCP)

AFTER (DCP-compatible):
  Memory-check reminders fire:
    - After an explicit user correction (state-based: correction detected)
    - After DCP compress calls (state-based: compress tool executed)
    - On session.idle with unreviewed raw messages (state-based: lastReviewedRawMessageId < latest)
    - Before native compaction as safety net (state-based: compaction event)

  Turn-count periodic review is REMOVED as a primary trigger.
  If needed (long sessions), use a time-based cooldown instead of turn-based.
```

#### 13d. Additional DCP-Aware Improvements

**Incremental reflection with `lastReviewedRawMessageId`:**
- Track the last raw message ID that was reviewed by the reflection subagent
- After each DCP compress call, only review raw messages between `lastReviewedRawMessageId` and the current position
- This prevents re-reviewing the entire transcript on every boundary event
- State stored in `.sisyphus/learning-state.json` alongside other learning metadata

**Learning state (`.sisyphus/learning-state.json`, P0):**

Per-session operational state for the learning system. Tracks reflection progress and injection-outcome correlation.

```typescript
interface LearningState {
  // Incremental reflection tracking (DCP-compatible)
  lastReviewedRawMessageId: string | null  // last raw message ID reviewed by reflection subagent
  
  // Injection-outcome correlation (P0, closes the feedback loop)
  injectedThisTurn: string[]   // card IDs injected via <memory-context> proactive channel
  reactiveThisTurn: string[]   // card IDs injected via tool.execute.after reactive channel
  
  // Session metadata
  sessionId: string
  sessionStartedAt: number
  totalCaptures: number         // count of memory_capture calls this session
  lastCaptureAt: number | null  // timestamp of last memory_capture call
  lastReminderAt: number | null // timestamp of last memory-check reminder
}
```

**Injection-outcome correlation flow:**
```
Turn N:
  1. System transform queries learnings.json for matching cards
  2. Top cards injected into <memory-context>
  3. Card IDs recorded in learning-state.json as injectedThisTurn

Turn N (tool execution):
  4. If reactive card injected via tool.execute.after:
     Card ID added to reactiveThisTurn

Turn N (after final tool result):
  5. For each card in injectedThisTurn + reactiveThisTurn:
     - If task SUCCEEDED: add reinforcement evidence (isReinforcement: true)
     - If task FAILED: do NOT auto-add contradiction
       (failure may be unrelated to the injected card)
       Instead: flag for reflection subagent review
  6. Clear injectedThisTurn and reactiveThisTurn for next turn
```

**Hard token budget on dynamic memory in system transform:**
- Default: 500 tokens (200 for cards, 300 for recall)
- Enforced per-request in `experimental.chat.system.transform`
- If budget exceeded: rank by confidence/recency and truncate
- Prevents migrating context bloat from user message to system prompt

**DCP pruning of `memory_capture` output is beneficial:**
- DCP may prune old `memory_capture` tool outputs as duplicates or superseded
- This is harmless because the learning is already persisted to `learnings.json`
- Net effect: context noise reduction for free

#### 13e. DCP Compatibility Summary

| Surface | Learning System Use | DCP Use | Conflict? | Resolution |
|---------|---------------------|---------|-----------|------------|
| `experimental.chat.system.transform` | Dynamic `<memory-context>` overlay (NEW) | Appends DCP system instructions | No (additive, independent) | Both append to system; no ordering issue |
| `experimental.chat.messages.transform` | Removed from this surface | Prune/compress/inject IDs | No (learning system no longer uses this) | DCP is sole owner for context rewriting |
| `tool.execute.before` (compress) | Pre-compression flush + range tracking (NEW) | N/A (DCP does not use this hook) | No | Clean separation |
| `tool.execute.after` (compress) | Mark range reviewed + queue reflection (NEW) | N/A (DCP does not use this hook) | No | Clean separation |
| `tool.execute.before` (other tools) | Rules injection | N/A | No | Unchanged |
| `tool.execute.after` (other tools) | Surprise-point capture | N/A | No | Unchanged |
| `session.compacted` | Safety-net flush (demoted from primary) | DCP resets state | No | Both react independently |
| `session.idle` | Reflection + promotion | N/A | No | Unchanged |
| Stable prompt prefix | Curated facts (loaded once) | Not touched | No | Unchanged |
| `memory_capture` tool output | Persisted to learnings.json | May be pruned later | No (beneficial) | Pruning reduces noise after persist |

### 14. Schema Design Rationale (Option B: Slim Persisted, Derive at Query Time)

The LearningCard schema was evaluated against four options after researching Hermes Agent (Holographic provider: 10 fields with trust_score), Letta-Code (thin metadata + embeddings), and our original 25-field design. The evaluation assumed <100 cards and <10 evidence entries per card for v1.

#### 14a. Options Evaluated

| Option | Description | Persisted Fields | Retrieval Accuracy | Implementation Complexity |
|--------|-------------|-----------------|-------------------|--------------------------|
| **A (Full Rich)** | Original 25-field schema with persisted trust, confidence, reinforcements, TTL, etc. | 25 | Highest (precomputed) | High (25 fields to validate, migrate, merge in reducer) |
| **B (Slim + Derive)** | ~10 essential fields, derive ranking metrics from evidence at query time | 10 | Same as A for <100 cards | **Low** (fewer fields, evidence is single source of truth) |
| **C (Evidence-Only)** | Drop trigger, rely on evidence text for retrieval | ~6 | **Degraded** (no structured matching without embeddings) | Lowest | 
| **D (Slim + Materialized)** | Slim schema + separate materialized view cache | 10 + cache | Same as A | Medium (cache invalidation, two storage layers) |

#### 14b. Decision: Option B

**Why B:** With <100 cards, deriving trust/confidence/reinforcements from evidence at query time is trivial (O(n) where n < 1000 total evidence entries). The evidence array is the single source of truth. No risk of denormalized fields drifting out of sync with their evidence backing.

**Why not A:** Over-engineered for v1. 25 persisted fields means 25 fields to validate in Zod, migrate on schema changes, and merge correctly in the single reducer. Most of these fields can be derived in microseconds from the evidence array.

**Why not C:** Drops structured triggers, which are the v1 retrieval primitive. Without embeddings, retrieval degrades to text search over evidence summaries. This would require adding embeddings to compensate, which we explicitly defer.

**Why not D:** Adds a materialized cache layer on top of slim storage. Unnecessary complexity for <100 cards. Clean upgrade path FROM B to D if card count grows beyond ~500.

#### 14c. Field-by-Field Analysis

| Field | Status | Rationale |
|-------|--------|-----------|
| `id` | **Persisted** | Card identity. Cannot derive. |
| `state` | **Persisted** | Lifecycle state drives retrieval filtering and injection behavior. Cannot derive without replay. |
| `claim` | **Persisted** | The learned fact. Dedup key (with trigger). Cannot derive. |
| `instruction` | **Persisted** | The compact text injected into context. Cannot derive. |
| `trigger` | **Persisted** | v1 retrieval primitive. Deterministic matching without embeddings. Non-negotiable. |
| `scope` | **Persisted** | Visibility/precedence gate. Cannot derive from evidence alone. |
| `tags` | **Persisted** | Secondary retrieval metadata. `kind` (semantic/procedural/anti-pattern) folded in as a tag. |
| `evidence[]` | **Persisted** | Single source of truth for all derived metrics. Enhanced with `agent`, `isReinforcement`, `isContradiction`. |
| `createdAt` | **Persisted** | Creation timestamp. Needed for age-based ranking. Cannot derive from evidence[0].timestamp reliably (evidence may be reordered). |
| `lastSeen` | **Persisted** | Last time card was matched/injected. Must be persisted because it tracks retrieval events, not evidence writes. |
| `kind` | **Removed** (folded into `tags`) | "semantic", "procedural", "anti-pattern" become tags. Add back as enum only if reducer/retrieval code branches on it. |
| `confidence` | **Derived** | `f(evidence.length, diversity, reinforcements, contradictions)`. See Section 1a. |
| `trust` | **Derived** | Weighted average of `evidence[].source` quality via SOURCE_WEIGHTS. See Section 1a. |
| `reinforcements` | **Derived** | `evidence.filter(e => e.isReinforcement).length`. |
| `lastReinforced` | **Derived** | `max(evidence.filter(e => e.isReinforcement).map(e => e.timestamp))`. |
| `evidenceCount` | **Derived** | `evidence.length`. |
| `contradictions` | **Derived** (new) | `evidence.filter(e => e.isContradiction).length`. |
| `sourceCapturePath` | **Derived** | `evidence[0].source`. |
| `sourceAgent` | **Derived** | `evidence[0].agent`. |
| `instructionEffectiveness` | **Derived** (new) | `reinforcements / (reinforcements + contradictions)`. |
| `ttl` | **Removed** | No calendar-based decay. Decay is purely evidence-based: trigger staleness (paths gone) and contradiction accumulation. Project cards persist indefinitely unless contradicted. A dormant project resumed after months finds its learnings intact. |
| `derivedFrom` | **Removed** | Deferred to P1 defrag merge tracking. |

**Summary: 10 persisted, 10 derived, 3 removed.**

#### 14d. Evidence Entry Enhancements

Three new fields on each evidence entry enable the derived metrics system:

```typescript
evidence: Array<{
  // ... existing fields (sessionId, source, timestamp, summary) ...
  agent?: string              // which agent created this entry (for diversity weighting)
  isReinforcement?: boolean   // card was injected + task succeeded (positive feedback loop)
  isContradiction?: boolean   // card's claim was disproven or instruction caused failure (negative feedback)
}>
```

**Why `agent`:** Enables cross-agent diversity weighting. A card confirmed by both Sisyphus and Heracles is stronger than one confirmed only by Sisyphus.

**Why `isReinforcement`:** Closes the positive feedback loop. Without this, reinforcement is vague ("successful application" with no mechanism to detect it). With injection-outcome correlation (Section 6, Section 9 learning-state.json), reinforcement is grounded in actual tool outcomes.

**Why `isContradiction`:** Enables evidence-based quarantine. Without this, cards can only be removed by manual deletion or trigger staleness. With contradiction evidence, the immune-system lifecycle actually functions: cards are quarantined when concrete evidence accumulates against them (trigger paths gone, instruction led to failure), not by arbitrary timers.

#### 14e. Competitor Schema Comparison

| System | Persisted Fields | Retrieval | Trust/Confidence | Feedback Loop | Provenance |
|--------|-----------------|-----------|-----------------|---------------|------------|
| **Hermes Holographic** | ~10 (fact, category, tags, trust_score, retrieval_count, helpful_count, timestamps, hrr_vector) | FTS5 + trust-weighted scoring | Persisted `trust_score` (binary +0.05/-0.10) | helpful/not-helpful binary | None (bare score) |
| **Letta-Code** | ~3 (description, read_only, value) + embeddings | Hybrid vector ANN + BM25 | None | None | Git history |
| **Hermes Built-in** | ~2 (content string, target file) | Exact string match | None | None | None |
| **Our Design (v1)** | **10** (claim, instruction, trigger, scope, state, tags, evidence[], createdAt, lastSeen) | **Structured trigger matching** (paths, tools, errors, agents, keywords) | **Derived** from evidence at query time (source weights, diversity, reinforcements, contradictions) | **Rich** (isReinforcement, isContradiction, injection-outcome correlation, evidence diversity) | **Full** (every evidence entry carries sessionId, source, agent, timestamp, summary) |

#### 14f. Escalation Triggers (when to revisit this decision)

| Trigger | Revisit | Action |
|---------|---------|--------|
| Card count grows beyond ~500 | Option B → D | Materialize derived metrics into a separate cache for faster reads |
| Evidence arrays grow beyond ~50 entries per card | Computation cost | Add evidence compaction earlier (currently P1 defrag) |
| Multiple concurrent readers need precomputed metrics | Option B → D | Same as card count trigger |
| Trigger matching becomes insufficient for retrieval | Add embeddings | But try lexical index first before adding vector DB |
| `kind` enum is needed for code branching | Restore `kind` field | Extract from tags, add as persisted enum |
| Per-card TTL is needed for specific use cases | Restore `ttl` field | Add optional field, but default remains evidence-based decay (no calendar expiry) |