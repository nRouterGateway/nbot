import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
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
        body: text.slice(0, 12000),
      };
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
