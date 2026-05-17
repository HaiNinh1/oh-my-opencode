/** @jsxImportSource @opentui/solid */
// @ts-nocheck
import { createSignal, Show, onMount, onCleanup } from "solid-js";
import {
  useKeyboard,
  useRenderer,
  useTerminalDimensions,
} from "@opentui/solid";
import { TextAttributes, RGBA } from "@opentui/core";
import { join } from "path";

const PLUGIN_ID = "opencode-enhance";
const DEFAULT_SYSTEM = `You are a prompt enhancement assistant. Your job is to take a user's draft prompt and rewrite it so it is clearer, more specific, and more effective for an autonomous AI coding agent.

TARGET ENVIRONMENT
The enhanced prompt is sent to an autonomous coding agent running inside an IDE/CLI workspace. The agent has full tool access:
- File tools: Read, Edit, Write, MultiEdit — it modifies files in place on disk.
- Shell: Bash for builds, tests, scripts, git.
- Search and introspection: Grep, Glob, LSP diagnostics.
- Multi-turn autonomous execution; can dispatch parallel subagents.
This is NOT a web chatbot Q&A. The user's prompt is a task or intent statement; the agent executes it via side effects (file edits, command output, test runs) — not by composing a textual answer for the user to copy.

CORE RULES
- Preserve the user's original intent exactly.
- Preserve the user's intent verb ("explain", "investigate", "implement", "fix", "refactor", "design") — these signal what the agent should do.
- Add specificity where the original is vague: which file/module, what error, what observable behavior.
- Surface implied scope boundaries (in scope / out of scope).
- Surface implied constraints (no new dependencies, keep public API stable, no refactor of unrelated code).
- Surface implied acceptance criteria (build passes, specific tests pass, behavior X visible).
- Keep it concise — never add verbosity that doesn't carry information.
- Use clear sections only when the prompt is genuinely complex; keep simple prompts simple.

NEVER ADD (these belong to web-chatbot prompts, not agent prompts)
- Output-format dictates for the agent's reply: "respond inline", "as a short copyable text", "in markdown", "as bullet points", "in code blocks", "as JSON", "format your response as ...".
- Response-length controls on the agent: "be brief", "be concise in your reply", "give a thorough explanation".
- "Show me the code", "paste the diff", "include the snippet" — the agent edits files directly; nothing needs to be shown.
- "Explain your reasoning", "walk me through your thinking", "first describe then implement" on action tasks — the agent acts, it does not narrate.
- Procedural scripts ("first do X, then Y, then verify Z") — let the agent plan execution.
- Filler nudges ("make sure to ...", "be sure that ...", "remember to ...") that carry no concrete constraint.
- Reframing an imperative request as a question.

OUTPUT
- Output ONLY the enhanced prompt text. No preamble, no closing remark, no meta-commentary.
- Do not wrap the output in quotes or markdown code blocks.
- Do not restate or summarize these rules in your output.

REFERENCE TAGS
- <project_instructions>: project conventions and constraints. Apply naming, structure, and patterns when they bear on the prompt.
- <session_context>: prior conversation with the agent. Use it to resolve references and understand the user's current work with the agent, but do not assume the user wants to continue in the same direction. If the prompt signals a pivot, enhance it on its own terms.
- <agent_guide>: agent-specific do/don't list for the recipient agent. Strictly follow it, and apply ONLY the guidance for the named agent. Never invent guidance for other agents, and never echo the guide text in your output.`;

const KNOWN_AGENTS = [
  "sisyphus",
  "hephaestus",
  "mnemosyne",
  "prometheus",
];
const AGENT_CYCLE = ["auto", ...KNOWN_AGENTS];

const AGENT_GUIDES = {
  sisyphus: `The target agent is **Sisyphus**, a hands-on AI engineer that researches with parallel subagents (explore/librarian) and implements directly. It auto-decomposes work into a todo list and consults Oracle for non-trivial design decisions on its own.

When enhancing prompts targeted at Sisyphus:
- Frame outcomes and acceptance criteria. Sisyphus owns decomposition and tool choice.
- Preserve intent verbs ("explain", "investigate", "implement", "fix", "refactor", "design") — they trigger different routing inside the agent.
- Surface known scope (files, modules, error messages) and constraints, not steps.
- DO NOT prescribe implementation steps, tool calls, or verification cadence.
- DO NOT add "be thorough", "think step by step", or other generic LLM nudges — Sisyphus is already disciplined.`,

  hephaestus: `The target agent is **Hephaestus**, an autonomous deep worker. Goal-oriented: it explores thoroughly before acting and completes tasks end-to-end without per-step confirmation.

When enhancing prompts targeted at Hephaestus:
- State the GOAL clearly. Skip step-by-step instructions — Hephaestus determines its own steps.
- Include explicit success criteria (build passes, specific tests pass, observable behavior).
- Include scope boundaries (in scope / out of scope) and constraints ("no refactor of unrelated code", "keep public API stable", "no new dependencies").
- DO NOT instruct it on tool usage, verification cadence, background dispatch, or progress tracking — Hephaestus already does these autonomously.
- DO NOT split the work into discrete numbered steps; let Hephaestus plan execution.
- DO NOT add "ask before doing X" — Hephaestus operates autonomously by design.`,

  mnemosyne: `The target agent is **Mnemosyne**, a compact strategic planner. It interviews the user, gathers context via parallel_tasks (explore/librarian), and writes a work plan to .sisyphus/plans/{name}.md. It does NOT implement code (markdown-only, hook-enforced).

When enhancing prompts targeted at Mnemosyne:
- Frame the request as planning ("Plan how to ...", "Design an approach for ..."). If the user wrote "do X" / "build X", preserve that phrasing — Mnemosyne reframes as planning automatically.
- Include all known requirements, constraints, scope IN/OUT, acceptance criteria, and test strategy preference (TDD / tests-after / none) — Mnemosyne uses these to clear its planning checklist faster and ask fewer questions.
- Surface unknowns as explicit open questions when relevant.
- DO NOT add code, file edits, or implementation details — Mnemosyne is markdown-only and will reject non-.md writes.
- DO NOT specify plan file paths, research tools, or tell it to interview — Mnemosyne already does these by default.`,

  prometheus: `The target agent is **Prometheus**, an interview-mode strategic planner that produces detailed work plans (parallel waves, task graph) saved to .sisyphus/plans/*.md. Markdown-only output (hook-enforced).

When enhancing prompts targeted at Prometheus:
- Frame as a planning request. Include scope boundaries, hard constraints, acceptance criteria, and integration points the planner needs to know about.
- Mention if high-accuracy mode (Momus review loop) is desired.
- Surface user preferences for granularity, parallelism, or test strategy if known.
- DO NOT add implementation steps, code, or executor tool instructions — Prometheus is a planner, not an executor.
- DO NOT specify plan file paths — Prometheus already saves to .sisyphus/plans/.
- DO NOT tell it to "use task()" or delegate — Prometheus does not execute, only plans.`,
};

function agentGuideText(name) {
  if (!name) return "";
  const guide = AGENT_GUIDES[name];
  if (!guide) return "";
  return `<agent_guide name="${name}">\n${guide.trim()}\n</agent_guide>`;
}

async function detectSessionAgent(api, sid) {
  if (!sid) return undefined;
  try {
    const res = await api.client.session.messages({ sessionID: sid });
    const messages = res?.data;
    if (!Array.isArray(messages)) return undefined;
    for (const msg of messages) {
      const raw = msg?.info?.agent;
      if (typeof raw === "string" && raw.trim()) {
        return raw.trim().toLowerCase();
      }
    }
  } catch {}
  return undefined;
}

function enhance(api, opts, text, sid, agentName) {
  return new Promise(async (resolve, reject) => {
    let ephemeral;
    try {
      const created = await api.client.session.create({
        title: "[enhancer] ephemeral",
      });
      if (!created.data) {
        reject(new Error("Failed to create session"));
        return;
      }
      ephemeral = created.data.id;

      const model = opts?.model ? parse(opts.model) : undefined;
      const system = opts?.system || DEFAULT_SYSTEM;

      const ctx = await context(api, sid);
      const instructions = await agents(api);
      const guide = agentGuideText(agentName);
      const parts = [];
      parts.push(`<prompt-to-enhance>\n${text}\n</prompt-to-enhance>`);
      if (guide) parts.push(guide);
      if (instructions) parts.push(instructions.trim());
      if (ctx) parts.push(ctx.trim());
      if (ctx || instructions || guide) parts.push("REMINDER: Output ONLY the enhanced prompt. No preamble, no explanation, no wrapping.");
      const prompt = parts.length > 1 ? parts.join("\n\n") : text;

      const result = await api.client.session.prompt({
        sessionID: ephemeral,
        agent: "enhancer",
        system,
        model,
        parts: [{ type: "text", text: prompt }],
      });

      if (!result.data) {
        reject(new Error("No response from model"));
        return;
      }

      const out = result.data.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n")
        .trim();

      resolve(out || text);
    } catch (err) {
      reject(err);
    } finally {
      if (ephemeral) {
        api.client.session.delete({ sessionID: ephemeral }).catch(() => {});
      }
    }
  });
}

function parse(spec) {
  const idx = spec.lastIndexOf("/");
  if (idx < 1) return undefined;
  return {
    providerID: spec.slice(0, idx),
    modelID: spec.slice(idx + 1),
  };
}

async function agents(api) {
  const root = api.state.path.worktree || api.state.path.directory;
  if (!root) return "";
  try {
    const file = Bun.file(join(root, "AGENTS.md"));
    if (!(await file.exists())) return "";
    const text = await file.text();
    const trimmed = text.trim();
    if (!trimmed) return "";
    return `<project_instructions>\n${trimmed}\n</project_instructions>\n\n`;
  } catch {
    return "";
  }
}
async function context(api, sid, budget = 50000) {
  if (!sid) return "";
  try {
    const res = await api.client.session.messages({ sessionID: sid });
    if (!res.data?.length) return "";
    const lines = [];
    let chars = 0;
    for (let i = res.data.length - 1; i >= 0; i--) {
      const msg = res.data[i];
      const role = msg.info.role;
      const raw = msg.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n")
        .trim();
      const text = raw
        .replace(/<dcp-message-id>[^<]*<\/dcp-message-id>/g, "")
        .replace(/<dcp-system-reminder[^>]*>[\s\S]*?<\/dcp-system-reminder>/g, "")
        .replace(/\[Compressed conversation section\]/g, "")
        .replace(/\(b\d+\)/g, "")
        .replace(/^[\u2500-\u257F\u2580-\u259F\u2800-\u28FF\s]+$/gm, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      if (!text) continue;
      const line = `[${role}]: ${text}`;
      if (chars + line.length > budget) break;
      lines.unshift(line);
      chars += line.length;
    }
    if (!lines.length) return "";
    return `<session_context>\n${lines.join("\n\n")}\n</session_context>\n\n`;
  } catch {
    return "";
  }
}

function Panel(props) {
  const { api, opts, onClose } = props;
  const route = api.route.current;
  const sid = route.name === "session" ? route.params.sessionID : undefined;
  const theme = () => api.theme.current;
  const dims = useTerminalDimensions();
  const renderer = useRenderer();
  const [state, setState] = createSignal("idle");
  const [result, setResult] = createSignal("");
  const [error, setError] = createSignal("");
  const [ctx, setCtx] = createSignal(!!sid);
  const [source, setSource] = createSignal("");
  const [history, setHistory] = createSignal([]);
  const [idx, setIdx] = createSignal(-1);
  const initialAgent = (() => {
    const requested = typeof opts?.agent === "string" ? opts.agent.toLowerCase() : "auto";
    return AGENT_CYCLE.includes(requested) ? requested : "auto";
  })();
  const [agentOverride, setAgentOverride] = createSignal(initialAgent);
  const [resolvedAgent, setResolvedAgent] = createSignal(undefined);
  const effectiveAgent = () => {
    const ov = agentOverride();
    return ov === "auto" ? resolvedAgent() : ov;
  };
  const agentDisplay = () => {
    const eff = effectiveAgent();
    const ov = agentOverride();
    if (!eff) return ov === "auto" ? "auto" : ov;
    return ov === "auto" ? `${eff}*` : eff;
  };
  function cycleAgent() {
    const cur = agentOverride();
    const i = AGENT_CYCLE.indexOf(cur);
    const nextIdx = i < 0 ? 0 : (i + 1) % AGENT_CYCLE.length;
    setAgentOverride(AGENT_CYCLE[nextIdx]);
  }
  let src, out, prev;

  const WIDTH = 100;
  const outHeight = () => Math.max(8, dims().height - 16);
  const height = () => {
    const s = state();
    if (s === "idle") return 12;
    if (s === "loading" || s === "error") return 14;
    return 14 + outHeight();
  };
  const panelWidth = () => Math.min(WIDTH, dims().width - 2);
  const top = () => Math.max(0, Math.floor((dims().height - height()) / 2));
  const left = () => Math.max(0, Math.floor((dims().width - panelWidth()) / 2));

  onMount(() => {
    prev = renderer.currentFocusedRenderable;
    prev?.blur();
    setTimeout(() => {
      if (src && !src.isDestroyed) {
        src.focus();
        src.gotoLineEnd();
      }
    }, 1);
    if (sid) {
      detectSessionAgent(api, sid).then((name) => {
        if (name) setResolvedAgent(name);
      });
    }
  });

  onCleanup(() => {
    setTimeout(() => {
      if (prev && !prev.isDestroyed) prev.focus();
    }, 1);
  });

  useKeyboard((evt) => {
    if (state() === "loading") {
      evt.preventDefault();
      evt.stopPropagation();
      return;
    }
    if (evt.name === "escape" || (evt.ctrl && evt.name === "c")) {
      evt.preventDefault();
      evt.stopPropagation();
      onClose();
      return;
    }
    if (evt.ctrl && evt.name === "e") {
      evt.preventDefault();
      evt.stopPropagation();
      run();
      return;
    }
    if (evt.name === "tab" && state() === "done") {
      evt.preventDefault();
      evt.stopPropagation();
      const focused = renderer.currentFocusedRenderable;
      if (focused === out && src && !src.isDestroyed) src.focus();
      else if (out && !out.isDestroyed) out.focus();
      return;
    }
    if (evt.name === "return" && state() === "done") {
      evt.preventDefault();
      evt.stopPropagation();
      insert();
      return;
    }
    if (evt.ctrl && evt.name === "t") {
      evt.preventDefault();
      evt.stopPropagation();
      setCtx((v) => !v);
      return;
    }
    if (evt.ctrl && evt.name === "a") {
      evt.preventDefault();
      evt.stopPropagation();
      cycleAgent();
      return;
    }
    if ((evt.name === "left" || evt.name === "up") && history().length > 0 && state() === "done") {
      evt.preventDefault();
      evt.stopPropagation();
      const next = Math.max(0, idx() - 1);
      setIdx(next);
      show(next);
      return;
    }
    if ((evt.name === "right" || evt.name === "down") && history().length > 0 && state() === "done") {
      evt.preventDefault();
      evt.stopPropagation();
      const next = Math.min(history().length - 1, idx() + 1);
      setIdx(next);
      show(next);
      return;
    }
  });

  function show(i) {
    const entry = history()[i];
    if (!entry) return;
    setSource(entry.input);
    setResult(entry.output);
    if (src && !src.isDestroyed) src.setText(entry.input);
    if (out && !out.isDestroyed) out.setText(entry.output);
  }

  function run() {
    if (state() === "loading") return;
    const text = src?.plainText?.trim();
    if (!text) return;
    setSource(text);
    setState("loading");
    setError("");
    enhance(api, opts, text, ctx() ? sid : undefined, effectiveAgent())
      .then((r) => {
        setResult(r);
        setState("done");
        const h = [...history(), { input: text, output: r }];
        setHistory(h);
        setIdx(h.length - 1);
        setTimeout(() => {
          if (out && !out.isDestroyed) out.focus();
        }, 1);
      })
      .catch((err) => {
        setError(err?.message || String(err));
        setState("error");
      });
  }

  function osc52(text) {
    const b64 = Buffer.from(text).toString("base64");
    process.stdout.write(`\x1b]52;c;${b64}\x07`);
  }

  async function insert() {
    const enhanced = (out?.plainText ?? result())?.trim();
    if (!enhanced) return;
    const original = source();
    if (original) {
      osc52(original);
      await new Promise((r) => setTimeout(r, 50));
    }
    osc52(enhanced);
    onClose();
    await api.client.tui.clearPrompt();
    await api.client.tui.appendPrompt({ text: enhanced });
  }

  return (
    <box
      position="absolute"
      width={dims().width}
      height={dims().height}
      zIndex={3100}
      left={0}
      top={0}
      backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
      onMouseUp={() => onClose()}
    >
      <box
        position="absolute"
        top={top()}
        left={left()}
        width={panelWidth()}
        backgroundColor={theme().backgroundPanel}
        paddingTop={1}
        onMouseUp={(e) => e.stopPropagation()}
      >
        <box paddingLeft={2} paddingRight={2} gap={1}>
          <box flexDirection="row" justifyContent="space-between">
            <box flexDirection="row" gap={1}>
              <text attributes={TextAttributes.BOLD} fg={theme().text}>
                ✨ Enhance Prompt
              </text>
              <Show when={history().length > 0}>
                <text fg={theme().textMuted}>
                  {idx() + 1}/{history().length}
                </text>
              </Show>
            </box>
            <box flexDirection="row" gap={2}>
              <text
                fg={
                  effectiveAgent()
                    ? agentOverride() === "auto"
                      ? theme().info
                      : theme().success
                    : theme().textMuted
                }
                onMouseUp={cycleAgent}
              >
                ✱ {agentDisplay()}
              </text>
              <Show when={sid}>
                <text
                  fg={ctx() ? theme().success : theme().textMuted}
                  onMouseUp={() => setCtx((v) => !v)}
                >
                  {ctx() ? "◉ context" : "○ context"}
                </text>
              </Show>
              <text fg={theme().textMuted} onMouseUp={() => onClose()}>
                esc
              </text>
            </box>
          </box>

          <box gap={0}>
            <text fg={theme().textMuted}>Source prompt:</text>
            <textarea
              height={5}
              ref={(r) => {
                src = r;
              }}
              initialValue=""
              placeholder="Type or paste your prompt here..."
              placeholderColor={theme().textMuted}
              textColor={theme().text}
              focusedTextColor={theme().text}
              cursorColor={theme().text}
            />
          </box>

          <Show when={state() === "loading"}>
            <text fg={theme().info}>⏳ Enhancing...</text>
          </Show>

          <Show when={state() === "error"}>
            <text fg={theme().error}>Error: {error()}</text>
          </Show>

          <Show when={state() === "done"}>
            <box gap={0}>
              <text fg={theme().success}>Enhanced result:</text>
              <textarea
                height={outHeight()}
                ref={(r) => {
                  out = r;
                }}
                initialValue={result()}
                placeholder=""
                placeholderColor={theme().textMuted}
                textColor={theme().text}
                focusedTextColor={theme().text}
                cursorColor={theme().text}
              />
            </box>
          </Show>

          <box flexDirection="row" gap={2} paddingBottom={1}>
            <Show when={state() !== "loading"}>
              <text fg={theme().text} onMouseUp={run}>
                ctrl+e <span style={{ fg: theme().textMuted }}>enhance</span>
              </text>
              <Show when={sid}>
                <text
                  fg={theme().text}
                  onMouseUp={() => setCtx((v) => !v)}
                >
                  ctrl+t{" "}
                  <span style={{ fg: theme().textMuted }}>
                    context{" "}
                  </span>
                  <span style={{ fg: ctx() ? theme().success : theme().textMuted }}>
                    {ctx() ? "on" : "off"}
                  </span>
                </text>
              </Show>
              <text fg={theme().text} onMouseUp={cycleAgent}>
                ctrl+a{" "}
                <span style={{ fg: theme().textMuted }}>
                  agent{" "}
                </span>
                <span
                  style={{
                    fg: effectiveAgent()
                      ? agentOverride() === "auto"
                        ? theme().info
                        : theme().success
                      : theme().textMuted,
                  }}
                >
                  {agentDisplay()}
                </span>
              </text>
            </Show>
            <Show when={state() === "done"}>
              <text fg={theme().text} onMouseUp={insert}>
                enter{" "}
                <span style={{ fg: theme().textMuted }}>
                  copy + insert
                </span>
              </text>
              <text fg={theme().text}>
                tab <span style={{ fg: theme().textMuted }}>switch focus</span>
              </text>
              <Show when={history().length > 1}>
                <text fg={theme().textMuted}>
                  ◀▶ history
                </text>
              </Show>
            </Show>
          </box>
        </box>
      </box>
    </box>
  );
}

const tui = async (api, opts) => {
  const keys = api.keybind.create({ open: "<leader>p" }, opts?.keybinds);
  const [visible, setVisible] = createSignal(false);

  function open() {
    setVisible(true);
  }

  function close() {
    if (!visible()) return;
    setVisible(false);
  }

  api.slots.register({
    order: 50,
    slots: {
      session_prompt_right(_ctx, props) {
        return (
          <text fg={api.theme.current.info} onMouseUp={open}>
            ✨
          </text>
        );
      },
      home_prompt_right(_ctx, props) {
        return (
          <text fg={api.theme.current.info} onMouseUp={open}>
            ✨
          </text>
        );
      },
      app(_ctx) {
        return (
          <Show when={visible()}>
            <Panel api={api} opts={opts} onClose={close} />
          </Show>
        );
      },
    },
  });

  api.command.register(() => [
    {
      title: "Enhance Prompt",
      value: "enhance.open",
      category: "Enhance",
      description: "Open the prompt enhancer dialog",
      keybind: keys.get("open"),
      onSelect() {
        open();
      },
    },
  ]);
};

export default { id: PLUGIN_ID, tui };
