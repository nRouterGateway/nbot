# nbot

**`nbot`** is an independent, open-source, lightweight, skill-driven AI coworker framework.

- **v1 Starting Point:** Bootstrapped from a one-time copy of [`CopilotKit/openbot`](https://github.com/CopilotKit/openbot) (MIT License), preserving **100% of v1 functionality** (including Intelligence, workspace UI, Skills vs. Capabilities, Contextual Narrowing, Approval Cards, Teach-a-Bot, and `agent-computer` Playwright browser automation) with zero functionality loss — and then owned and evolved independently as **`nbot`**.
- **Sandbox Reference:** References [`opensandbox-group/OpenSandbox`](https://github.com/opensandbox-group/OpenSandbox) for optional container/microVM isolation when running untrusted code or shell-heavy bots (API/MCP-only bots run directly without a separate sandbox).
- **nRouter Harness Ready:** Designed to route inference through `https://api.nrouter.ai/v1` (`nrouter/auto` or any model), while remaining provider-agnostic (OpenAI, Anthropic, Gemini, OpenRouter, Ollama).
- **Future Consumers:** Separate from internal private repos like `nrouter-operations`, which will consume `nbot` as a package/runtime for internal ops bots in the future.

## Quick Links

- [PRD.md](./PRD.md) — Product Requirements Document (v1 parity + v2 nRouter harness & npm release)
- [TODO.md](./TODO.md) — Step-by-step build & release checklist
- [skills/nbot-builder/SKILL.md](./skills/nbot-builder/SKILL.md) — Agent build skill for implementing `nbot`
- [skills/_template/SKILL.md](./skills/_template/SKILL.md) — Portable `nbot` skill template (`cs-nbot`, `seo-nbot`, etc.)
