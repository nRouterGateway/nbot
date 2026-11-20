# `nbot` Build & Release TODO

## Phase 0: Repo & Initial Code Copy
- [ ] Create GitHub repository `nbot` (open-source, MIT License) and add `origin` remote.
- [x] Copy the `CopilotKit/openbot` codebase into `/Users/gurukallam/nr/nbot` as our independent starting point (no `.git` from upstream — own history only).
- [x] Preserve MIT `LICENSE` and original CopilotKit copyright notice; add `nbot` attribution.

## Phase 1: v1 — Rebrand & Boot (Zero Functionality Loss)
- [x] Verify install, typecheck, and build work 1:1 (`bun install`, `bun run typecheck`, `bun run build` across `app`, `@openbot/shared`, `@openbot/recorder-extension`, `@openbot/management-agent`).
- [ ] Verify runtime boot (`bun run dev` / Docker) with `.env` and `https://api.nrouter.ai/v1` (`nrouter/auto`).
- [ ] Update UI branding, docs, and package metadata to **`nbot`**.
- [ ] Publish v1 (push to GitHub).

## Phase 2: nRouter Harness & Multi-Provider Support (v2)
- [ ] Add unified provider layer (Vercel AI SDK or OpenAI-compatible + Anthropic/Gemini adapters) defaulting to `api.nrouter.ai/v1` (`nrouter/auto`), while supporting OpenAI, Anthropic, OpenRouter, and Ollama.
- [ ] Add optional "local/nRouter-only mode" (SQLite threads + local `SKILL.md` synthesis) so users can run `nbot` with zero external Intelligence cloud dependency.
- [ ] Add first-class MCP client support for connecting nRouter APIs and external tools.
- [ ] Add per-bot persistent Playwright `userDataDir` (`~/.nbot/profiles/<bot>/`) and `nbot login <bot> <url>` flow.

## Phase 3: OpenSandbox Reference Integration (Optional / Shell Bots Only)
- [ ] Reference `opensandbox-group/OpenSandbox` (`@alibaba-group/opensandbox` / Docker runtime) for container isolation patterns.
- [ ] Add optional `sandbox: docker` flag in `nbot.yaml` for bots that execute untrusted code/CLI (keep `sandbox: none` default for API/MCP-only bots).

## Phase 4: npm Package Release
- [ ] Expose CLI binary (`nbot init`, `nbot install`, `nbot run`, `nbot login`, `nbot ui`).
- [ ] Test clean install via `npx nbot` in an empty directory.
- [ ] Publish to npm and tag `v1.0.0` / `v2.0.0`.

## Phase 5: Future `nrouter-operations` & First Production `nbots`
- [ ] Wire `nrouter-operations` to consume `nbot` as a package (keeping `cases/` and `~/.nrouter_admin_keys/` strictly private).
- [ ] Build starter `cs-nbot` (e.g., customer health monitoring for Minima AI — read-only + draft approval card).
- [ ] Build starter `seo-nbot` (model catalog vs. `nrouter.ai` SEO/AEO/GEO audit + PR draft).
- [ ] Build starter `finops-triage-nbot` (investigates `pg_cron` reconciliation/catalog exceptions).
