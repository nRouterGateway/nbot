import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ToolContext, ToolDefinition } from "./types.js";

function findOpsPy(cwd: string): string | null {
  const candidates = [
    join(cwd, "bin", "ops.py"),
    join(cwd, "..", "bin", "ops.py"),
    join(cwd, "..", "..", "bin", "ops.py"),
  ];
  for (const p of candidates) {
    const abs = resolve(p);
    if (existsSync(abs)) return abs;
  }
  return null;
}

export const defaultTools: ToolDefinition[] = [
  {
    name: "http_get_public",
    description: "Fetch a public HTTPS JSON or text URL (read-only).",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Public HTTPS URL to fetch" },
      },
      required: ["url"],
    },
    execute: async (args) => {
      const url = String(args.url ?? "");
      if (!url.startsWith("https://")) {
        return { error: "Only https:// URLs are allowed" };
      }
      const resp = await fetch(url, { headers: { "User-Agent": "nbot/0.1" } });
      const text = await resp.text();
      return {
        status: resp.status,
        bytes: text.length,
        truncated: text.length > 12000,
        body: text.slice(0, 12000),
      };
    },
  },
  {
    name: "nrouter_catalog_summary",
    description:
      "Fetch https://app.nrouter.ai/api/public/models, https://api.nrouter.ai/health, and https://app.nrouter.ai/api/health and return exact aggregated counts across all models.",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: async () => {
      const [gwRes, appRes, modelsRes] = await Promise.all([
        fetch("https://api.nrouter.ai/health", { headers: { "User-Agent": "nbot/0.1" } }),
        fetch("https://app.nrouter.ai/api/health", { headers: { "User-Agent": "nbot/0.1" } }),
        fetch("https://app.nrouter.ai/api/public/models", { headers: { "User-Agent": "nbot/0.1" } }),
      ]);
      const gwHealth = await gwRes.json().catch(() => ({ status: gwRes.status }));
      const appHealth = await appRes.json().catch(() => ({ status: appRes.status }));
      const raw = (await modelsRes.json().catch(() => ({}))) as Record<string, unknown>;
      const models = (Array.isArray(raw.data) ? raw.data : Array.isArray(raw) ? raw : []) as Array<
        Record<string, unknown>
      >;

      const providers: Record<string, number> = {};
      const modes: Record<string, number> = {};
      const deprecated: string[] = [];
      const missingPricing: string[] = [];
      let missingBenchmarksCount = 0;

      for (const m of models) {
        const prov = String(m.provider ?? m.maker ?? "unknown");
        providers[prov] = (providers[prov] ?? 0) + 1;
        const mode = String(m.mode ?? "unknown");
        modes[mode] = (modes[mode] ?? 0) + 1;
        const mid = String(m.model_id ?? m.id ?? m.model_name ?? "unknown");
        if (m.is_deprecated) deprecated.push(mid);
        const info = (m.model_info && typeof m.model_info === "object" ? m.model_info : {}) as Record<
          string,
          unknown
        >;
        const hasPrice =
          info.input_cost_per_token != null ||
          m.non_token_pricing != null ||
          m.free_tier_eligible === true;
        if (!hasPrice) missingPricing.push(mid);
        if (!m.benchmarks) missingBenchmarksCount++;
      }

      return {
        gateway_health: gwHealth,
        app_health: appHealth,
        total_models: models.length,
        providers,
        modes,
        deprecated_count: deprecated.length,
        deprecated_sample: deprecated.slice(0, 10),
        missing_pricing_count: missingPricing.length,
        missing_pricing_sample: missingPricing.slice(0, 10),
        missing_benchmarks_count: missingBenchmarksCount,
      };
    },
  },
  {
    name: "nrouter_seo_audit",
    description:
      "Compare https://app.nrouter.ai/api/public/models against https://nrouter.ai/sitemap.xml and return exact model-page parity metrics.",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: async () => {
      const [modelsRes, sitemapRes] = await Promise.all([
        fetch("https://app.nrouter.ai/api/public/models", { headers: { "User-Agent": "nbot/0.1" } }),
        fetch("https://nrouter.ai/sitemap.xml", { headers: { "User-Agent": "nbot/0.1" } }),
      ]);
      const raw = (await modelsRes.json().catch(() => ({}))) as Record<string, unknown>;
      const models = (Array.isArray(raw.data) ? raw.data : Array.isArray(raw) ? raw : []) as Array<
        Record<string, unknown>
      >;
      const sitemapXml = await sitemapRes.text();
      const sitemapModelUrls = (sitemapXml.match(/\/models\//g) ?? []).length;

      return {
        public_catalog_count: models.length,
        sitemap_status: sitemapRes.status,
        sitemap_bytes: sitemapXml.length,
        sitemap_model_urls: sitemapModelUrls,
        parity_delta: models.length - sitemapModelUrls,
        sample_model_ids: models.slice(0, 15).map((m) => m.model_id ?? m.id),
      };
    },
  },
  {
    name: "browser_visit",
    description:
      "Open a URL in a real headless browser (Playwright) using the bot's persistent profile (~/.nbot/profiles/<profile>) and return rendered title, metadata, headings, and visible text.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "HTTPS URL to open in the browser" },
        waitMs: { type: "number", description: "Optional settle wait in ms (default 1500)" },
      },
      required: ["url"],
    },
    execute: async (args, ctx: ToolContext) => {
      const url = String(args.url ?? "");
      if (!url.startsWith("https://") && !url.startsWith("http://localhost")) {
        return { error: "Only https:// or http://localhost URLs are allowed" };
      }
      const pw = await import("playwright-core").catch(() => null);
      if (!pw) {
        return { error: "playwright-core is not installed" };
      }
      const profileName = ctx.bot.manifest.browser?.profile ?? ctx.bot.manifest.name;
      const profileDir = join(homedir(), ".nbot", "profiles", profileName);
      mkdirSync(profileDir, { recursive: true });

      let context;
      try {
        context = await pw.chromium.launchPersistentContext(profileDir, { headless: true });
      } catch {
        context = await pw.chromium.launchPersistentContext(profileDir, {
          headless: true,
          channel: "chrome",
        });
      }

      try {
        const page = context.pages()[0] ?? (await context.newPage());
        const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        const waitMs = Math.min(Math.max(Number(args.waitMs ?? 1500), 0), 5000);
        if (waitMs > 0) await page.waitForTimeout(waitMs);

        const data = await page.evaluate(() => {
          const getMeta = (name: string) =>
            document.querySelector(`meta[name="${name}"]`)?.getAttribute("content") ?? null;
          const canonical =
            document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null;
          const h1 = document.querySelector("h1")?.textContent?.trim() ?? null;
          const text = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim();
          return {
            title: document.title,
            metaDescription: getMeta("description"),
            canonical,
            h1,
            textSnippet: text.slice(0, 4000),
          };
        });

        return {
          url,
          finalUrl: page.url(),
          status: resp?.status() ?? null,
          profile: profileName,
          ...data,
        };
      } finally {
        await context.close();
      }
    },
  },
  {
    name: "shell_exec_ops_py",
    description:
      "Run read-only nrouter-operations `bin/ops.py` subcommands (`trial-reviews`, `inspect`, `logs`).",
    parameters: {
      type: "object",
      properties: {
        subcommand: {
          type: "string",
          enum: ["trial-reviews", "inspect", "logs"],
        },
        target: {
          type: "string",
          description: "Email, org UUID, or request ID (for inspect/logs)",
        },
        plane: {
          type: "string",
          enum: ["prod", "stage"],
          description: "Target plane (default prod)",
        },
      },
      required: ["subcommand"],
    },
    execute: (args, ctx: ToolContext) => {
      const opsPy = findOpsPy(ctx.cwd);
      if (!opsPy) {
        return { error: "bin/ops.py not found from current working directory" };
      }
      const sub = String(args.subcommand ?? "");
      const plane = String(args.plane ?? "prod");
      const cmdArgs = [opsPy, sub];
      if (sub === "trial-reviews") {
        cmdArgs.push("--status", "pending");
      } else {
        const target = String(args.target ?? ctx.target ?? "");
        if (!target) {
          return { error: `subcommand '${sub}' requires target` };
        }
        cmdArgs.push(target, "--plane", plane);
        if (sub === "logs") {
          cmdArgs.push("--days", "7");
        }
      }
      const out = execFileSync("python3", cmdArgs, {
        cwd: resolve(opsPy, "..", ".."),
        encoding: "utf8",
        timeout: 45_000,
      });
      return out.slice(0, 12000);
    },
  },
];
