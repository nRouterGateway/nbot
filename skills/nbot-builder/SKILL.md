---
name: nbot-builder
description: Build and evolve the independent open-source `nbot` repository from its PRD, initial `CopilotKit/openbot` copy, and `OpenSandbox` reference.
---

# `nbot` Builder Skill

Use this skill when resuming work on the standalone `nbot` repository (`/Users/gurukallam/nr/nbot`).

## Core Rules

1. **Independent Open-Source Repo:** `nbot` is a separate, independent repository named `nbot` (not `nrouter-nbot`), kept outside `nrouter-brain`, with **no upstream git remote/merge dependency**. Never commit internal customer PII, `nrouter-operations/cases/`, or `~/.nrouter_admin_keys/` secrets here.
2. **v1 Parity First:** Start from a one-time copy of `CopilotKit/openbot` (MIT) so v1 retains 100% of functionality (including Intelligence, UI, Skills vs. Capabilities, Contextual Narrowing, Approval Cards, Teach-a-Bot, and `agent-computer` Playwright), then build and own it ourselves.
3. **Preserve MIT Attribution:** Keep `CopilotKit/openbot`'s MIT copyright notice in `LICENSE`.
4. **v2 Harness & Providers:** Route default inference through `https://api.nrouter.ai/v1` (`nrouter/auto`), while supporting OpenAI, Anthropic, Gemini, OpenRouter, and Ollama.
5. **Minimal Sandbox Footprint:** API/MCP-only bots (`cs-nbot`, `finops-nbot`, `seo-nbot` read/draft) do **not** require a separate sandbox. Only reference `OpenSandbox` patterns (Docker runtime) when a bot executes untrusted code or arbitrary shell commands.
6. **Future `nrouter-operations` Integration:** Design `nbot` so external workspaces like `nrouter-operations` can import/run `nbot` as a package with their own private skills and tools.

## Workflow When Building

1. Read [PRD.md](../../PRD.md) and [TODO.md](../../TODO.md).
2. Pick the next unchecked item in `TODO.md`.
3. Update `TODO.md` checkboxes as milestones are verified.
