import { loadBotBundle } from "./loader.js";
import { defaultTools } from "./tools.js";
import type {
  BotBundle,
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

  if (options.dryRun) {
    return {
      bot: bundle.manifest.name,
      model,
      output: `[dry-run] Ready to run ${bundle.manifest.name} on ${baseUrl} (${model}) with tools: ${activeTools.map((t) => t.name).join(", ") || "none"}`,
      toolCalls: [],
      pendingApprovals: [],
    };
  }

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
      throw new Error(`Gateway ${baseUrl} returned HTTP ${resp.status}: ${errText}`);
    }

    const data = (await resp.json()) as {
      model?: string;
      usage?: Record<string, unknown>;
      choices: Array<{
        message: OpenAIMessage;
      }>;
    };

    servedModel = data.model ?? servedModel;
    lastUsage = data.usage ?? lastUsage;
    const msg = data.choices?.[0]?.message;
    if (!msg) {
      throw new Error("Gateway returned empty choices");
    }

    messages.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      if (!msg.content && openAITools.length > 0 && step === 0 && model !== "openai/gpt-4o-mini") {
        // Model returned an empty tool_calls frame (e.g., finish_reason="tool_calls" with []).
        // Retry once with a verified tool-calling model while keeping tools attached so real tools execute.
        model = "openai/gpt-4o-mini";
        messages.pop();
        continue;
      }
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

      if (!tool) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ error: `Unknown tool '${toolName}'` }),
        });
        continue;
      }

      if (isApprovalRequired(bundle, tool)) {
        pendingApprovals.push({
          tool: toolName,
          args: parsedArgs,
          reason: `Tool '${toolName}' requires human approval per nbot.yaml`,
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
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: typeof result === "string" ? result : JSON.stringify(result),
      });
    }
  }

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
