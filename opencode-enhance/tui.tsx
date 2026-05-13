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
const DEFAULT_SYSTEM = `You are a prompt enhancement assistant. Your job is to take a user's draft prompt and rewrite it to be clearer, more specific, and more effective for an AI coding assistant.

Rules:
- Preserve the user's original intent exactly
- Add specificity where the original is vague
- Structure the prompt with clear sections if it's complex
- Keep it concise — don't add unnecessary verbosity
- Output ONLY the enhanced prompt text, nothing else
- Do not wrap in quotes or markdown code blocks
- If project instructions are provided in <project_instructions> tags, follow those conventions and constraints when enhancing the prompt (naming, structure, patterns, etc.).
- If session context is provided in <session_context> tags, use it to resolve references and understand the user's current work, but do not assume the user wants to continue in the same direction. If the prompt signals a pivot, enhance it on its own terms.`;

function enhance(api, opts, text, sid) {
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
      const parts = [];
      parts.push(`<prompt-to-enhance>\n${text}\n</prompt-to-enhance>`);
      if (instructions) parts.push(instructions.trim());
      if (ctx) parts.push(ctx.trim());
      if (ctx || instructions) parts.push("REMINDER: Output ONLY the enhanced prompt. No preamble, no explanation, no wrapping.");
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
  });

  function run() {
    if (state() === "loading") return;
    const text = src?.plainText?.trim();
    if (!text) return;
    setSource(text);
    setState("loading");
    setError("");
    enhance(api, opts, text, ctx() ? sid : undefined)
      .then((r) => {
        setResult(r);
        setState("done");
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
            <text attributes={TextAttributes.BOLD} fg={theme().text}>
              ✨ Enhance Prompt
            </text>
            <box flexDirection="row" gap={2}>
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
