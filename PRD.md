# Product Requirements Document (PRD): `nbot`

- **Project Name:** `nbot` (independent open-source repository — *not* `nrouter-nbot`)
- **License:** MIT (preserving original `CopilotKit/openbot` MIT copyright notices)
- **Status:** Skeleton & PRD Ready (Implementation Pending)

---

## 1. Problem & Motivation

Traditional rigid cron jobs work well for deterministic database sweeps and financial invariants, but they are brittle and expensive to maintain for:
- Fuzzy or shifting external data (provider model inventory, Arena benchmarks, SEO audits)
- Proactive customer success (e.g., monitoring usage/latency/budget burn for accounts like Minima AI and drafting check-ins)
- Exception triage (investigating why a Stripe capture or FinOps reconciliation landed in a mismatch)

`nbot` solves this by providing an independent, open-source, installable, skill-driven AI coworker runtime where each bot (`cs-nbot`, `seo-nbot`, `finops-nbot`, etc.) is a portable bundle of `SKILL.md` + MCP/REST tools + `nbot.yaml`.

---

## 2. Release Strategy (Phased)

### v1 — Full Parity Copy + Rebrand (Zero Functionality Loss)
- **Goal:** Ship `nbot` v1 by copying the `CopilotKit/openbot` (MIT) codebase as our starting point (including Intelligence, workspace UI, slash commands, Skills vs. Capabilities, Contextual Narrowing, Approval Cards, Teach-a-Bot, and `agent-computer` Playwright browser), then owning it independently with no upstream sync dependency.
- **Constraint:** **Zero functionality loss** in v1.
- **Rebrand:** Rename product branding/terminology to `nbot` while retaining MIT attribution.
- **LLM Default:** Support pointing to `https://api.nrouter.ai/v1` (`nrouter/auto`) alongside OpenAI, Anthropic, OpenRouter, Gemini, and Ollama.

### v2 — nRouter Harness, Open-Source npm CLI, & Optional OpenSandbox
- **nRouter Harness:** Replace or make optional any external Intelligence cloud dependency with a pure nRouter-native harness (local SQLite threads/memory + `api.nrouter.ai/v1` + Vercel AI SDK + MCP Hub) for zero external lock-in.
- **npm Package:** Publish `nbot` (`npx nbot` / `npm i -g nbot`) with `nbot init`, `nbot install <skill-or-bot>`, `nbot run`, `nbot login`, `nbot ui`.
- **Persistent Browser Login:** Leverage `agent-computer` (Playwright) with per-bot `userDataDir` (`~/.nbot/profiles/<bot>/`) so bots can log in once (including 2FA/SSO) and stay authenticated across scheduled runs.
- **OpenSandbox Reference:** For bots that execute untrusted code or arbitrary shell commands, integrate optional sandbox isolation modeled on `opensandbox-group/OpenSandbox` (Docker runtime first; API/MCP-only bots run without a sandbox).

---

## 3. Separation of Concerns (Internal vs. Open Source)

- **`nbot` (this repo — Open Source):** Generic engine, UI, CLI, skill/tool loader, and non-sensitive example skills (`_template`, `seo-nbot` skeleton, `cs-nbot` skeleton). **Never contains internal PII, customer case data, or production secrets.**
- **`nrouter-operations` (Private / Founder-Only):** Will consume `nbot` as a package/runtime in the future to run private ops bots (`ops-nbot` using `bin/ops.py`, `templates/`, and `cases/`).

---

## 4. Portable Bot Bundle Spec (Target)

Each installable `nbot` (e.g., `cs-nbot`, `seo-nbot`) is defined with open standards:

```text
<bot-name>/
├── nbot.yaml    # trigger (cron/webhook/manual), model (nrouter/auto), approval policy
├── SKILL.md     # instructions, workflow steps, declared skill_tools
└── mcp.json     # optional scoped MCP servers / OpenAPI endpoints
```

---

## 5. Non-Goals (v1)

- Do **not** maintain an ongoing upstream git merge workflow — `nbot` is independent after the initial copy.
- Do **not** replace deterministic financial/GDPR `pg_cron` jobs (reservation sweeps, credit ledger, Stripe capture math, retention purges).
- Do **not** require Kubernetes/Firecracker sandboxes for API-only or MCP-only bots.
- Do **not** couple `nbot` to `nrouter-operations` private schemas or credentials.
