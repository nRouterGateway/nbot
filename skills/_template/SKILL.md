---
name: example-nbot-skill
description: Portable nbot skill template (compatible with OpenBot, nbot, Claude Code, Antigravity, and Codex).
skill_tools:
  - nrouter_api_read
  - draft_message
---

# Example `nbot` Skill Template

Replace this template to define a new portable `nbot` (e.g., `cs-nbot`, `seo-nbot`, `finops-nbot`).

## Trigger
- **Schedule / Event:** e.g., Daily at 09:00 UTC or on webhook alert.
- **Model:** `nrouter/auto` via `https://api.nrouter.ai/v1` (or any configured OpenAI/Anthropic/OpenRouter/Ollama provider).

## Instructions
1. Gather read-only context using the declared `skill_tools`.
2. Analyze anomalies, trends, or pending items.
3. Produce a concise summary and recommended action.

## Guardrails & Approval Policy
- **Auto-run:** Read-only queries, scoring, tagging, and drafting.
- **Require Human Approval:** Sending external emails/messages, mutating production billing/catalog state, or opening/merging PRs.
