/** @jsxImportSource @opentui/solid */
// @ts-nocheck
import { createSignal, Show, onMount } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";

const PLUGIN_ID = "opencode-enhance";
const DEFAULT_SYSTEM = `You are a prompt enhancement assistant. Your job is to take a user's draft prompt and rewrite it to be clearer, more specific, and more effective for an AI coding assistant.

Rules:
- Preserve the user's original intent exactly
- Add specificity where the original is vague
- Structure the prompt with clear sections if it's complex
- Keep it concise — don't add unnecessary verbosity
- Output ONLY the enhanced prompt text, nothing else
- Do not wrap in quotes or markdown code blocks`;

function enhance(api, opts, text) {
  return new Promise(async (resolve, reject) => {
    let sid;
    try {
      const created = await api.client.session.create({
        title: "[enhancer] ephemeral",
      });
      if (!created.data) {
        reject(new Error("Failed to create session"));
        return;
      }
      sid = created.data.id;

      const model = opts?.model ? parse(opts.model) : undefined;
      const system = opts?.system || DEFAULT_SYSTEM;

      const result = await api.client.session.prompt({
        sessionID: sid,
        agent: "enhancer",
        system,
        model,
        parts: [{ type: "text", text }],
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
      if (sid) {
        api.client.session
          .delete({ sessionID: sid })
          .catch(() => {});
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

function Dialog(props) {
  const { api, opts, initial } = props;
  const theme = () => api.theme.current;
  let src;
  let out;
  const [state, setState] = createSignal("idle");
  const [result, setResult] = createSignal("");
  const [error, setError] = createSignal("");

  onMount(() => {
    api.ui.dialog.setSize("large");
    setTimeout(() => {
      if (!src || src.isDestroyed) return;
      src.focus();
      src.gotoLineEnd();
    }, 1);
  });

  useKeyboard((evt) => {
    if (state() === "loading") {
      evt.preventDefault();
      evt.stopPropagation();
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
      if (out && !out.isDestroyed) out.focus();
      return;
    }
    if (evt.name === "return" && state() === "done") {
      evt.preventDefault();
      evt.stopPropagation();
      insert();
      return;
    }
    if (evt.ctrl && evt.name === "y" && state() === "done") {
      evt.preventDefault();
      evt.stopPropagation();
      copy();
      return;
    }
  });

  function run() {
    if (state() === "loading") return;
    const text = src?.plainText?.trim();
    if (!text) return;
    setState("loading");
    setError("");
    enhance(api, opts, text)
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

  async function insert() {
    const text = result();
    if (!text) return;
    api.ui.dialog.clear();
    await api.client.tui.clearPrompt();
    await api.client.tui.appendPrompt({ text });
  }

  function copy() {
    const text = result();
    if (!text) return;
    const b64 = Buffer.from(text).toString("base64");
    process.stdout.write(`\x1b]52;c;${b64}\x07`);
    api.ui.dialog.clear();
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme().text}>
          ✨ Enhance Prompt
        </text>
        <text fg={theme().textMuted} onMouseUp={() => api.ui.dialog.clear()}>
          esc
        </text>
      </box>

      <box gap={0}>
        <text fg={theme().textMuted}>Source prompt:</text>
        <textarea
          height={5}
          ref={(r) => {
            src = r
          }}
          initialValue={initial || ""}
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
            height={8}
            ref={(r) => {
              out = r
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
        </Show>
        <Show when={state() === "done"}>
          <text fg={theme().text} onMouseUp={insert}>
            enter{" "}
            <span style={{ fg: theme().textMuted }}>insert into prompt</span>
          </text>
          <text fg={theme().text} onMouseUp={copy}>
            ctrl+y{" "}
            <span style={{ fg: theme().textMuted }}>copy</span>
          </text>
          <text fg={theme().textMuted}>tab switch focus</text>
        </Show>
      </box>
    </box>
  );
}

const tui = async (api, opts) => {
  const keys = api.keybind.create({ open: "<leader>p" }, opts?.keybinds);

  function open() {
    api.ui.dialog.replace(() => <Dialog api={api} opts={opts} initial="" />);
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
