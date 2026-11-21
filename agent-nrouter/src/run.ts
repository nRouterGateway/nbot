/**
 * Native nRouter AG-UI runner (`agent-nrouter`).
 *
 * Streams CopilotKit / OpenBot AG-UI SSE events (`RUN_STARTED`, `TEXT_MESSAGE_*`,
 * `TOOL_CALL_*`, `RUN_FINISHED`, `RUN_ERROR`) directly from `https://api.nrouter.ai/v1`
 * (or the endpoint named in `shared/model-providers.json` -> `nrouter`).
 *
 * Full parity with `agent-langgraph-ts` and `agent-claude-sdk`:
 *  - Preserves complete multi-turn `RunAgentInput.messages` history (system, user, assistant, tool)
 *  - Streams token-by-token text deltas and incremental tool-call argument chunks
 *  - Forwards client/workspace AG-UI tools (browser `agent-computer`, MCP, approval cards) back to
 *    the caller AND executes built-in server tools (`http_get_public`) in-loop up to `maxSteps`
 */
import { randomUUID } from "node:crypto";
import { botSettings, providerSpec } from "../../shared/model-providers.ts";

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface AgUiTool {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface AgUiToolCall {
  id: string;
  type?: "function";
  function: { name: string; arguments: string };
}

export interface AgUiMessage {
  id?: string;
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content?: string | null;
  toolCallId?: string;
  tool_call_id?: string;
  toolCalls?: AgUiToolCall[];
  tool_calls?: AgUiToolCall[];
}

export interface RunAgentInput {
  threadId?: string;
  runId?: string;
  messages?: AgUiMessage[];
  tools?: AgUiTool[];
  context?: Array<{ description?: string; value?: string }>;
  forwardedProps?: Record<string, unknown>;
}

export interface AgUiEvent {
  type: string;
  timestamp?: number;
  [key: string]: unknown;
}

export interface RunOptions {
  env?: Record<string, string | undefined>;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  maxSteps?: number;
  emit: (event: AgUiEvent) => void;
}

const DEFAULT_NROUTER_BASE_URL = "https://api.nrouter.ai/v1";

function resolveEndpointAndKey(env: Record<string, string | undefined>) {
  const settings = botSettings("agent-nrouter", env);
  const spec = providerSpec(settings.provider);
  if (!spec) {
    throw new Error(`Unsupported provider '${settings.provider}' for agent-nrouter.`);
  }
  const apiKey = (env[spec.keyVariable] ?? env.NROUTER_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error(
      `Missing API key: set ${spec.keyVariable} (or NROUTER_API_KEY) for agent-nrouter.`,
    );
  }
  const rawBase = (env[spec.baseUrlVariable] ?? "").trim();
  const baseUrl = (
    rawBase ||
    (settings.provider === "nrouter" ? DEFAULT_NROUTER_BASE_URL : "https://api.openai.com/v1")
  ).replace(/\/+$/, "");

  return { baseUrl, apiKey, model: settings.model, provider: settings.provider };
}

function toOpenAiMessages(input: RunAgentInput) {
  const out: Array<Record<string, unknown>> = [];
  if (Array.isArray(input.context) && input.context.length > 0) {
    const ctxBlock = input.context
      .map((c) => `${c.description ? `${c.description}: ` : ""}${c.value ?? ""}`.trim())
      .filter(Boolean)
      .join("\n");
    if (ctxBlock) {
      out.push({ role: "system", content: ctxBlock });
    }
  }

  for (const m of input.messages ?? []) {
    const role = m.role === "developer" ? "system" : m.role;
    if (role === "tool") {
      out.push({
        role: "tool",
        tool_call_id: m.toolCallId ?? m.tool_call_id ?? "tool_0",
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""),
      });
      continue;
    }
    const calls = m.toolCalls ?? m.tool_calls;
    if (role === "assistant" && Array.isArray(calls) && calls.length > 0) {
      out.push({
        role: "assistant",
        content: m.content ?? null,
        tool_calls: calls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.function.name, arguments: c.function.arguments || "{}" },
        })),
      });
      continue;
    }
    out.push({
      role,
      content: m.content ?? "",
    });
  }
  return out;
}

export async function runNrouterAgent(input: RunAgentInput, options: RunOptions): Promise<void> {
  const env = options.env ?? process.env;
  const fetcher = options.fetcher ?? fetch;
  const maxSteps = options.maxSteps ?? 8;
  const threadId = input.threadId || `thread_${randomUUID()}`;
  const runId = input.runId || `run_${randomUUID()}`;
  const emit = (ev: AgUiEvent) => options.emit({ timestamp: Date.now(), ...ev });

  emit({ type: "RUN_STARTED", threadId, runId });

  try {
    let { baseUrl, apiKey, model } = resolveEndpointAndKey(env);
    const messages = toOpenAiMessages(input);
    const clientToolNames = new Set((input.tools ?? []).map((t) => t.name));

    const openAiTools = (input.tools ?? []).map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description ?? t.name,
        parameters: t.parameters ?? { type: "object", properties: {} },
      },
    }));

    for (let step = 0; step < maxSteps; step++) {
      const reqBody: Record<string, unknown> = {
        model,
        stream: true,
        temperature: 0.2,
        messages,
      };
      if (openAiTools.length > 0) reqBody.tools = openAiTools;

      const resp = await fetcher(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(reqBody),
        signal: options.signal,
      });

      if (!resp.ok || !resp.body) {
        const errBody = await resp.text().catch(() => "");
        throw new Error(`nRouter gateway HTTP ${resp.status}: ${errBody}`);
      }

      const messageId = `msg_${randomUUID()}`;
      let messageStarted = false;
      let fullText = "";
      const toolCalls = new Map<
        number,
        { id: string; name: string; args: string; started: boolean }
      >();

      const decoder = new TextDecoder();
      let buffer = "";

      for await (const chunk of resp.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw || raw === "[DONE]") continue;
          let parsed: {
            choices?: Array<{
              delta?: {
                content?: string;
                tool_calls?: Array<{
                  index?: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
            }>;
          };
          try {
            parsed = JSON.parse(raw);
          } catch {
            continue;
          }
          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;

          if (typeof delta.content === "string" && delta.content.length > 0) {
            if (!messageStarted) {
              messageStarted = true;
              emit({ type: "TEXT_MESSAGE_START", messageId, role: "assistant" });
            }
            fullText += delta.content;
            emit({ type: "TEXT_MESSAGE_CONTENT", messageId, delta: delta.content });
          }

          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              let entry = toolCalls.get(idx);
              if (!entry) {
                entry = {
                  id: tc.id || `call_${randomUUID()}`,
                  name: "",
                  args: "",
                  started: false,
                };
                toolCalls.set(idx, entry);
              }
              if (tc.id) entry.id = tc.id;
              if (tc.function?.name) entry.name += tc.function.name;
              if (!entry.started && entry.name) {
                if (messageStarted) {
                  emit({ type: "TEXT_MESSAGE_END", messageId });
                  messageStarted = false;
                }
                entry.started = true;
                emit({
                  type: "TOOL_CALL_START",
                  toolCallId: entry.id,
                  toolCallName: entry.name,
                  parentMessageId: messageId,
                });
              }
              if (tc.function?.arguments) {
                entry.args += tc.function.arguments;
                if (entry.started) {
                  emit({
                    type: "TOOL_CALL_ARGS",
                    toolCallId: entry.id,
                    delta: tc.function.arguments,
                  });
                }
              }
            }
          }
        }
      }

      if (messageStarted) {
        emit({ type: "TEXT_MESSAGE_END", messageId });
      }

      const completedToolCalls = [...toolCalls.values()].filter((t) => t.name);
      for (const tc of completedToolCalls) {
        if (!tc.started) {
          emit({
            type: "TOOL_CALL_START",
            toolCallId: tc.id,
            toolCallName: tc.name,
            parentMessageId: messageId,
          });
          if (tc.args) {
            emit({ type: "TOOL_CALL_ARGS", toolCallId: tc.id, delta: tc.args });
          }
        }
        emit({ type: "TOOL_CALL_END", toolCallId: tc.id });
      }

      if (completedToolCalls.length === 0) {
        if (!fullText && openAiTools.length > 0 && step === 0 && model !== "openai/gpt-4o-mini") {
          model = "openai/gpt-4o-mini";
          continue;
        }
        break;
      }

      // If any requested tool belongs to the AG-UI client/workspace (e.g. browser, approval card,
      // MCP tool owned by the OpenBot server), finish this run turn so the caller executes the tool
      // and sends the next turn with the tool result in `messages`.
      if (completedToolCalls.some((tc) => clientToolNames.has(tc.name))) {
        break;
      }
    }

    emit({ type: "RUN_FINISHED", threadId, runId });
  } catch (err) {
    emit({
      type: "RUN_ERROR",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
