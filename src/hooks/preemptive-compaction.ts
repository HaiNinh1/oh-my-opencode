import { log } from "../shared/logger";
import type { OhMyOpenCodeConfig } from "../config";

import { resolveCompactionModel } from "./shared/compaction-model-resolver";

const PREEMPTIVE_COMPACTION_TIMEOUT_MS = 120_000;
const COMPACTION_TOKEN_THRESHOLD = 30_000; // Trigger compaction when reaching 30k tokens to allow time for compaction before hitting limits on long responses

interface TokenInfo {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
  total?: number;
}

interface ModelLimits {
  input: number;
  output: number;
  context: number;
}

interface CachedTokenState {
  providerID: string;
  modelID: string;
  tokens: TokenInfo;
}

type PluginInput = {
  client: {
    session: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      summarize: (...args: any[]) => any;
    };
  };
  directory: string;
};

function withTimeout<TValue>(
  promise: Promise<TValue>,
  timeoutMs: number,
  errorMessage: string,
): Promise<TValue> {
  let timeoutID: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutID = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutID !== undefined) {
      clearTimeout(timeoutID);
    }
  });
}

export function createPreemptiveCompactionHook(
  ctx: PluginInput,
  pluginConfig: OhMyOpenCodeConfig,
) {
  const compacting = new Set<string>();
  const tokens = new Map<string, CachedTokenState>();
  const limits = new Map<string, ModelLimits>();

  const chatParams = async (input: unknown, _output: unknown) => {
    const raw = input as Record<string, unknown> | undefined;
    if (!raw) return;
    const sessionID = raw.sessionID as string | undefined;
    const model = raw.model as { limit?: Record<string, unknown> } | undefined;
    if (!sessionID || !model?.limit) return;
    const lim = model.limit;
    if (
      typeof lim.input !== "number" ||
      typeof lim.output !== "number" ||
      typeof lim.context !== "number"
    )
      return;
    limits.set(sessionID, {
      input: lim.input,
      output: lim.output,
      context: lim.context,
    });
  };

  const event = async ({
    event: ev,
  }: {
    event: { type: string; properties?: unknown };
  }) => {
    const props = ev.properties as Record<string, unknown> | undefined;

    if (ev.type === "session.deleted") {
      const info = props?.info as { id?: string } | undefined;
      if (info?.id) {
        compacting.delete(info.id);
        tokens.delete(info.id);
        limits.delete(info.id);
      }
      return;
    }

    if (ev.type === "session.compacted") {
      const sessionID = props?.sessionID as string | undefined;
      if (sessionID) tokens.delete(sessionID);
      return;
    }

    if (ev.type === "message.updated") {
      const info = props?.info as
        | {
            role?: string;
            sessionID?: string;
            providerID?: string;
            modelID?: string;
            finish?: boolean;
            summary?: boolean;
            tokens?: TokenInfo;
          }
        | undefined;

      if (!info || info.role !== "assistant" || !info.finish || info.summary)
        return;
      if (!info.sessionID || !info.providerID || !info.tokens) return;

      tokens.set(info.sessionID, {
        providerID: info.providerID,
        modelID: info.modelID ?? "",
        tokens: info.tokens,
      });
      return;
    }

    if (ev.type === "session.idle") {
      const sessionID = props?.sessionID as string | undefined;
      if (!sessionID || compacting.has(sessionID)) return;

      const cached = tokens.get(sessionID);
      const lim = limits.get(sessionID);
      if (!cached || !lim) return;

      const count =
        cached.tokens.total ??
        cached.tokens.input +
          cached.tokens.output +
          cached.tokens.cache.read +
          cached.tokens.cache.write;
      const remaining = lim.input - count;

      if (remaining >= COMPACTION_TOKEN_THRESHOLD) return;

      log("[preemptive-compaction] End-of-turn compaction", {
        sessionID,
        count,
        remaining,
        inputLimit: lim.input,
        outputLimit: lim.output,
      });

      compacting.add(sessionID);

      try {
        const { providerID, modelID } = resolveCompactionModel(
          pluginConfig,
          sessionID,
          cached.providerID,
          cached.modelID,
        );

        await withTimeout(
          ctx.client.session.summarize({
            path: { id: sessionID },
            body: { providerID, modelID, auto: true } as never,
            query: { directory: ctx.directory },
          }),
          PREEMPTIVE_COMPACTION_TIMEOUT_MS,
          `Compaction timed out after ${PREEMPTIVE_COMPACTION_TIMEOUT_MS}ms`,
        );
      } catch (error) {
        log("[preemptive-compaction] Compaction failed", {
          sessionID,
          error: String(error),
        });
      } finally {
        compacting.delete(sessionID);
      }
    }
  };

  return {
    "chat.params": chatParams,
    event,
  };
}
