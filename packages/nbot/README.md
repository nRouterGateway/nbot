# `@nrouter/nbot`

Lightweight, skill-driven AI coworker **SDK & CLI** built on `nbot.yaml` + `SKILL.md` bundles, defaulting to `https://api.nrouter.ai/v1` (`nrouter/auto`) and compatible with OpenAI, OpenRouter, Anthropic, and Ollama.

## Install

```bash
npm install @nrouter/nbot
# or run via CLI
npx @nrouter/nbot --help
```

## SDK Usage

```ts
import { createNbot } from "@nrouter/nbot";

const client = createNbot({
  apiKey: process.env.NROUTER_API_KEY,
  baseUrl: "https://api.nrouter.ai/v1",
  model: "nrouter/auto",
});

const result = await client.run("./bots/catalog-nbot", {
  input: "Check catalog health and summarize anomalies.",
});

console.log(result.output);
console.log(result.pendingApprovals);
```

## CLI Usage

```bash
nbot list ./bots
nbot run ./bots/catalog-nbot
nbot run ./bots/cs-nbot --target customer@example.com
nbot init my-bot
nbot login seo-nbot https://app.nrouter.ai
```
