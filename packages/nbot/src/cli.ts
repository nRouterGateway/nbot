#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { discoverBots, loadBotBundle } from "./loader.js";
import { runBot } from "./runner.js";

function parseFlags(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function printHelp() {
  console.log(`nbot — Skill-driven AI coworker CLI (@nrouter/nbot)

Usage:
  nbot list [bots-dir]
  nbot run <bot-dir> [--target <target>] [--model <model>] [--base-url <url>] [--input <prompt>] [--dry]
  nbot init <bot-name> [--dir <parent-dir>]
  nbot login <bot-name> <url>
`);
}

async function cmdLogin(botName: string, url: string) {
  const profileDir = join(homedir(), ".nbot", "profiles", botName);
  mkdirSync(profileDir, { recursive: true });
  const pw = await import("playwright-core").catch(() => null);
  if (!pw) {
    console.error("playwright-core is not installed. Install it to use `nbot login`.");
    process.exit(1);
  }
  console.log(`Opening persistent browser profile at ${profileDir} -> ${url}`);
  console.log("Complete login/2FA in the browser window, then close the browser window to save session.");
  const context = await pw.chromium.launchPersistentContext(profileDir, { headless: false });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(url);
  await new Promise<void>((res) => context.on("close", () => res()));
  console.log(`Session saved for '${botName}'.`);
}

function cmdInit(botName: string, parentDir: string) {
  const targetDir = resolve(parentDir, botName);
  if (existsSync(join(targetDir, "nbot.yaml"))) {
    console.error(`Bot already exists at ${targetDir}`);
    process.exit(1);
  }
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(
    join(targetDir, "nbot.yaml"),
    `name: ${botName}
version: 1.0.0
description: Custom nbot coworker
trigger:
  type: manual
model:
  base_url: https://api.nrouter.ai/v1
  model: nrouter/auto
approval_policy:
  auto_run:
    - http_get_public
  require_approval: []
sandbox: none
`,
    "utf8",
  );
  writeFileSync(
    join(targetDir, "SKILL.md"),
    `---
name: ${botName}
description: Custom skill for ${botName}
skill_tools:
  - http_get_public
---

# ${botName}

## Instructions
1. Gather context using declared \`skill_tools\`.
2. Produce a concise, accurate report.
`,
    "utf8",
  );
  console.log(`Created bot '${botName}' at ${targetDir}`);
}

async function main() {
  const { positional, flags } = parseFlags(process.argv.slice(2));
  const cmd = positional[0];

  if (!cmd || flags.help || cmd === "help") {
    printHelp();
    return;
  }

  if (cmd === "list") {
    const dir = resolve(positional[1] ?? "./bots");
    const bots = discoverBots(dir);
    if (bots.length === 0) {
      console.log(`No bots found in ${dir}`);
      return;
    }
    for (const b of bots) {
      console.log(`- ${b.manifest.name}: ${b.manifest.description ?? ""}`);
    }
    return;
  }

  if (cmd === "init") {
    const name = positional[1];
    if (!name) {
      console.error("Usage: nbot init <bot-name>");
      process.exit(1);
    }
    cmdInit(name, typeof flags.dir === "string" ? flags.dir : ".");
    return;
  }

  if (cmd === "login") {
    const name = positional[1];
    const url = positional[2];
    if (!name || !url) {
      console.error("Usage: nbot login <bot-name> <url>");
      process.exit(1);
    }
    await cmdLogin(name, url);
    return;
  }

  if (cmd === "run") {
    const botDir = positional[1];
    if (!botDir) {
      console.error("Usage: nbot run <bot-dir> [options]");
      process.exit(1);
    }
    const bundle = loadBotBundle(botDir);
    const harness =
      (typeof flags.harness === "string" ? flags.harness : undefined) ??
      bundle.manifest.harness ??
      "api";

    if (harness === "claude-code") {
      const prompt = [
        `Execute bot '${bundle.manifest.name}' (${bundle.dir}/SKILL.md).`,
        typeof flags.target === "string" ? `Target: ${flags.target}` : "",
        typeof flags.input === "string" ? `Input: ${flags.input}` : "",
        "Follow the SKILL.md instructions strictly and output the final structured result.",
      ]
        .filter(Boolean)
        .join("\n");
      const res = spawnSync("claude", ["-p", prompt, "--allowedTools", "Read,Bash"], {
        stdio: "inherit",
        cwd: process.cwd(),
      });
      process.exit(res.status ?? 1);
    }

    const res = await runBot(bundle, {
      target: typeof flags.target === "string" ? flags.target : undefined,
      model: typeof flags.model === "string" ? flags.model : undefined,
      baseUrl: typeof flags["base-url"] === "string" ? flags["base-url"] : undefined,
      input: typeof flags.input === "string" ? flags.input : undefined,
      cwd: process.cwd(),
      dryRun: Boolean(flags.dry),
    });
    console.log(`==> Bot: ${res.bot} | Model: ${res.model}`);
    if (res.toolCalls.length > 0) {
      console.log(`==> Tool calls executed: ${res.toolCalls.map((t) => t.name).join(", ")}`);
    }
    if (res.pendingApprovals.length > 0) {
      console.log(`==> Pending approvals: ${JSON.stringify(res.pendingApprovals, null, 2)}`);
    }
    console.log(`\n${res.output}`);
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  printHelp();
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
