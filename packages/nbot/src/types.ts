export interface BotModelConfig {
  base_url?: string;
  model?: string;
  api_key_env?: string;
}

export interface BotApprovalPolicy {
  auto_run?: string[];
  require_approval?: string[];
}

export interface BotBrowserConfig {
  enabled?: boolean;
  profile?: string;
}

export interface DeclarativeToolSpec {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  requiresApproval?: boolean;
  mockResponse?: unknown;
}

export interface BotManifest {
  name: string;
  version?: string;
  description?: string;
  harness?: "api" | "claude-code" | "nbot" | "nrouter";
  trigger?: {
    type?: string;
    cron?: string;
  };
  model?: BotModelConfig;
  parameters?: Record<string, unknown>;
  tools?: DeclarativeToolSpec[];
  approval_policy?: BotApprovalPolicy;
  browser?: BotBrowserConfig;
  sandbox?: "none" | "docker" | "local" | "e2b";
}

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  skill_tools?: string[];
}

export interface BotBundle {
  dir: string;
  manifest: BotManifest;
  skillRaw: string;
  skillBody: string;
  skillFrontmatter: SkillFrontmatter;
}

export interface ToolContext {
  bot: BotBundle;
  target?: string;
  cwd: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresApproval?: boolean;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown> | unknown;
}

export interface PendingApproval {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  reason: string;
}

export interface NbotClientOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  tools?: ToolDefinition[];
  fetchImpl?: typeof fetch;
}

export type HarnessStreamEvent =
  | { type: "run_started"; bot: string; model: string }
  | { type: "text_delta"; delta: string }
  | { type: "tool_call_start"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_call_result"; id: string; name: string; preview: string }
  | { type: "approval_required"; id: string; name: string; args: Record<string, unknown>; reason: string }
  | { type: "run_finished"; bot: string; model: string }
  | { type: "run_error"; message: string };

export interface RunBotOptions {
  target?: string;
  input?: string;
  cwd?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxSteps?: number;
  extraTools?: ToolDefinition[];
  /** Approved tool-call IDs or tool names mapped to approved execution results (or `true` to execute the gated tool). */
  approvedToolResults?: Record<string, unknown>;
  dryRun?: boolean;
  onEvent?: (event: HarnessStreamEvent) => void;
}

export interface RunBotResult {
  bot: string;
  model: string;
  output: string;
  usage?: Record<string, unknown>;
  toolCalls: Array<{ name: string; args: Record<string, unknown>; result: unknown }>;
  pendingApprovals: PendingApproval[];
}
