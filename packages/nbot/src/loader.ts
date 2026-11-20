import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import YAML from "yaml";
import type { BotBundle, BotManifest, SkillFrontmatter } from "./types.js";

/**
 * Parse YAML frontmatter and markdown body from a SKILL.md file.
 */
export function parseSkillMarkdown(raw: string): {
  frontmatter: SkillFrontmatter;
  body: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: raw.trim() };
  }
  const parsed = (YAML.parse(match[1]) ?? {}) as SkillFrontmatter;
  return {
    frontmatter: parsed,
    body: match[2].trim(),
  };
}

/**
 * Load a portable nbot bundle (`nbot.yaml` + `SKILL.md`) from a directory.
 */
export function loadBotBundle(botDir: string): BotBundle {
  const absDir = resolve(botDir);
  const manifestPath = join(absDir, "nbot.yaml");
  const skillPath = join(absDir, "SKILL.md");

  if (!existsSync(manifestPath)) {
    throw new Error(`Missing nbot.yaml in ${absDir}`);
  }
  if (!existsSync(skillPath)) {
    throw new Error(`Missing SKILL.md in ${absDir}`);
  }

  const manifest = YAML.parse(readFileSync(manifestPath, "utf8")) as BotManifest;
  if (!manifest?.name) {
    throw new Error(`nbot.yaml in ${absDir} must define 'name'`);
  }

  const skillRaw = readFileSync(skillPath, "utf8");
  const { frontmatter, body } = parseSkillMarkdown(skillRaw);

  return {
    dir: absDir,
    manifest,
    skillRaw,
    skillBody: body,
    skillFrontmatter: frontmatter,
  };
}

/**
 * Discover all bot bundles under a parent directory (each containing `nbot.yaml`).
 */
export function discoverBots(rootDir: string): BotBundle[] {
  const absRoot = resolve(rootDir);
  if (!existsSync(absRoot)) {
    return [];
  }
  const entries = readdirSync(absRoot, { withFileTypes: true });
  const bundles: BotBundle[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = join(absRoot, entry.name);
    if (existsSync(join(candidate, "nbot.yaml")) && existsSync(join(candidate, "SKILL.md"))) {
      bundles.push(loadBotBundle(candidate));
    }
  }
  return bundles.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}
