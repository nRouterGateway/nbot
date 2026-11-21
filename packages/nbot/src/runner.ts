import { loadBotBundle } from "./loader.js";
import { defaultTools } from "./tools.js";
import type {
  BotBundle,
  HarnessStreamEvent,
  NbotClientOptions,
  PendingApproval,
  RunBotOptions,
  RunBotResult,
  ToolDefinition,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.nrouter.ai/v1";
const DEFAULT_MODEL = "nrouter/auto";

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

/**
 * Narrow available tools to those declared in SKILL.md `skill_tools` (when present).
 */
export function narrowTools(bundle: BotBundle, allTools: ToolDefinition[]): ToolDefinition[] {
  const declared = bundle.skillFrontmatter.skill_tools;
  if (!declared || declared.length === 0) {
    return allTools;
  }
  const allow = new Set(declared);
  return allTools.filter((t) => allow.has(t.name));
}

function isApprovalRequired(bundle: BotBundle, tool: ToolDefinition): boolean {
  if (tool.requiresApproval) return true;
  const gated = bundle.manifest.approval_policy?.require_approval ?? [];
  return gated.includes(tool.name);
}

async function readStreamedChoice(
  resp: Response,
  emit: (e: HarnessStreamEvent) => void,
): Promise<{
  model?: string;
  usage?: Record<string, unknown>;
  message: OpenAIMessage;
}> {
  const contentType = resp.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream") || !resp.body) {
    const data = (await resp.json()) as {
      model?: string;
      usage?: Record<string, unknown>;
      choices: Array<{ message: OpenAIMessage }>;
    };
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error("Gateway returned empty choices");
    if (msg.content) emit({ type: "text_delta", delta: msg.content });
    return { model: data.model, usage: data.usage, message: msg };
  }

  const decoder = new TextDecoder();
  let buf = "";
  let servedModel: string | undefined;
  let lastUsage: Record<string, unknown> | undefined;
  let fullContent = "";
  const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>();

  for await (const chunk of resp.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      let parsed: {
        model?: string;
        usage?: Record<string, unknown>;
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
      if (parsed.model) servedModel = parsed.model;
      if (parsed.usage) lastUsage = parsed.usage;
      const delta = parsed.choices?.[0]?.delta;
      if (!delta) continue;

      if (typeof delta.content === "string" && delta.content.length > 0) {
        fullContent += delta.content;
        emit({ type: "text_delta", delta: delta.content });
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const prev = toolCallsMap.get(idx) ?? {
            id: tc.id || `call_${idx}`,
            name: "",
            arguments: "",
          };
          if (tc.id) prev.id = tc.id;
          if (tc.function?.name) prev.name += tc.function.name;
          if (tc.function?.arguments) prev.arguments += tc.function.arguments;
          toolCallsMap.set(idx, prev);
        }
      }
    }
  }

  const toolCalls = [...toolCallsMap.values()]
    .filter((t) => t.name)
    .map((t) => ({
      id: t.id,
      type: "function" as const,
      function: { name: t.name, arguments: t.arguments || "{}" },
    }));

  return {
    model: servedModel,
    usage: lastUsage,
    message: {
      role: "assistant",
      content: fullContent || null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    },
  };
}

/**
 * Execute a bot bundle against an OpenAI-compatible gateway (default: https://api.nrouter.ai/v1).
 */
export async function runBot(
  botDirOrBundle: string | BotBundle,
  options: RunBotOptions = {},
  clientDefaults: NbotClientOptions = {},
): Promise<RunBotResult> {
  const bundle =
    typeof botDirOrBundle === "string" ? loadBotBundle(botDirOrBundle) : botDirOrBundle;

  const baseUrl = (
    options.baseUrl ??
    clientDefaults.baseUrl ??
    bundle.manifest.model?.base_url ??
    DEFAULT_BASE_URL
  ).replace(/\/+$/, "");

  let model =
    options.model ??
    clientDefaults.model ??
    bundle.manifest.model?.model ??
    DEFAULT_MODEL;

  const apiKeyEnv = bundle.manifest.model?.api_key_env;
  const apiKey =
    options.apiKey ??
    clientDefaults.apiKey ??
    (apiKeyEnv ? process.env[apiKeyEnv] : undefined) ??
    process.env.NROUTER_API_KEY ??
    process.env.OPENAI_API_KEY;

  if (!apiKey && !options.dryRun) {
    throw new Error(
      "Missing API key. Pass apiKey or set NROUTER_API_KEY / OPENAI_API_KEY.",
    );
  }

  const allTools = [
    ...defaultTools,
    ...(clientDefaults.tools ?? []),
    ...(options.extraTools ?? []),
  ];
  const activeTools = narrowTools(bundle, allTools);
  const toolMap = new Map(activeTools.map((t) => [t.name, t]));
  const fetchFn = clientDefaults.fetchImpl ?? fetch;
  const maxSteps = options.maxSteps ?? 6;
  const cwd = options.cwd ?? bundle.dir;
  const emit = (ev: HarnessStreamEvent) => options.onEvent?.(ev);

  if (options.dryRun) {
    return {
      bot: bundle.manifest.name,
      model,
      output: `[dry-run] Ready to run ${bundle.manifest.name} on ${baseUrl} (${model}) with tools: ${activeTools.map((t) => t.name).join(", ") || "none"}`,
      toolCalls: [],
      pendingApprovals: [],
    };
  }

  emit({ type: "run_started", bot: bundle.manifest.name, model });

  const systemPrompt = [
    `You are nbot '${bundle.manifest.name}'. Follow your SKILL.md strictly.`,
    "Never fabricate tool outputs. Any gated action must be returned as a clear proposal for human approval.",
    "",
    bundle.skillBody,
  ].join("\n");

  const userPrompt =
    options.input ??
    (options.target
      ? `Execute your workflow for target: ${options.target}`
      : "Execute your scheduled/default workflow and produce a concise operational report.");

  const messages: OpenAIMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const openAITools = activeTools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  const executedCalls: RunBotResult["toolCalls"] = [];
  const pendingApprovals: PendingApproval[] = [];
  let lastUsage: Record<string, unknown> | undefined;
  let servedModel = model;

  for (let step = 0; step < maxSteps; step++) {
    const body: Record<string, unknown> = {
      model,
      temperature: 0.2,
      stream: Boolean(options.onEvent),
      messages,
    };
    if (openAITools.length > 0) {
      body.tools = openAITools;
    }

    const resp = await fetchFn(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      const errMsg = `Gateway ${baseUrl} returned HTTP ${resp.status}: ${errText}`;
      emit({ type: "run_error", message: errMsg });
      throw new Error(errMsg);
    }

    const parsed = await readStreamedChoice(resp, emit);
    servedModel = parsed.model ?? servedModel;
    lastUsage = parsed.usage ?? lastUsage;
    const msg = parsed.message;

    messages.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      emit({ type: "run_finished", bot: bundle.manifest.name, model: servedModel });
      return {
        bot: bundle.manifest.name,
        model: servedModel,
        output: msg.content ?? "",
        usage: lastUsage,
        toolCalls: executedCalls,
        pendingApprovals,
      };
    }

    for (const tc of msg.tool_calls) {
      const toolName = tc.function.name;
      const tool = toolMap.get(toolName);
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        parsedArgs = {};
      }

      emit({ type: "tool_call_start", id: tc.id, name: toolName, args: parsedArgs });

      if (!tool) {
        const errPayload = JSON.stringify({ error: `Unknown tool '${toolName}'` });
        emit({ type: "tool_call_result", id: tc.id, name: toolName, preview: errPayload });
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: errPayload,
        });
        continue;
      }

      if (isApprovalRequired(bundle, tool)) {
        const reason = `Tool '${toolName}' requires human approval per nbot.yaml`;
        pendingApprovals.push({
          tool: toolName,
          args: parsedArgs,
          reason,
        });
        emit({
          type: "approval_required",
          id: tc.id,
          name: toolName,
          args: parsedArgs,
          reason,
        });
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({
            status: "pending_approval",
            message: `Action '${toolName}' queued for human approval and NOT executed.`,
          }),
        });
        continue;
      }

      const result = await tool.execute(parsedArgs, {
        bot: bundle,
        target: options.target,
        cwd,
      });
      executedCalls.push({ name: toolName, args: parsedArgs, result });
      const serialized = typeof result === "string" ? result : JSON.stringify(result);
      emit({
        type: "tool_call_result",
        id: tc.id,
        name: toolName,
        preview: serialized.slice(0, 240),
      });
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: serialized,
      });
    }
  }

  emit({ type: "run_finished", bot: bundle.manifest.name, model: servedModel });
  return {
    bot: bundle.manifest.name,
    model: servedModel,
    output: messages[messages.length - 1]?.content ?? "Max tool steps reached.",
    usage: lastUsage,
    toolCalls: executedCalls,
    pendingApprovals,
  };
}

/**
 * Create a reusable nbot client preconfigured with API key, base URL, model, and custom tools.
 */
export function createNbot(defaults: NbotClientOptions = {}) {
  return {
    load: loadBotBundle,
    run: (botDirOrBundle: string | BotBundle, options: RunBotOptions = {}) =>
      runBot(botDirOrBundle, options, defaults),
  };
}
