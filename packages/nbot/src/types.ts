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

export interface BotManifest {
  name: string;
  version?: string;
  description?: string;
  trigger?: {
    type?: string;
    cron?: string;
  };
  model?: BotModelConfig;
  approval_policy?: BotApprovalPolicy;
  browser?: BotBrowserConfig;
  sandbox?: "none" | "docker";
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

export interface RunBotOptions {
  target?: string;
  input?: string;
  cwd?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxSteps?: number;
  extraTools?: ToolDefinition[];
  dryRun?: boolean;
}

export interface RunBotResult {
  bot: string;
  model: string;
  output: string;
  usage?: Record<string, unknown>;
  toolCalls: Array<{ name: string; args: Record<string, unknown>; result: unknown }>;
  pendingApprovals: PendingApproval[];
}
