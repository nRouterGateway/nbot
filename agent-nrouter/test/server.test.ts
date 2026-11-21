import { afterEach, describe, expect, test } from "bun:test";
import type { AddressInfo } from "node:net";
import type { Fetcher } from "../src/run.ts";
import { createNrouterEngine, TOKEN_HEADER } from "../src/server.ts";

function sseStreamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

describe("agent-nrouter AG-UI harness", () => {
  const servers: Array<ReturnType<typeof createNrouterEngine>> = [];
  afterEach(async () => {
    while (servers.length) {
      const s = servers.pop()!;
      await new Promise<void>((r) => s.close(() => r()));
    }
  });

  async function startServer(
    env: Record<string, string | undefined>,
    fetcher?: Fetcher,
  ): Promise<string> {
    const srv = createNrouterEngine({ env, fetcher });
    servers.push(srv);
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const port = (srv.address() as AddressInfo).port;
    return `http://127.0.0.1:${port}`;
  }

  test("answers /health without token and enforces constant-time x-openbot-agent-token on /", async () => {
    const base = await startServer({
      MANAGED_AGENT_TOKEN: "secret-token-123",
      NROUTER_API_KEY: "sk-nrouter-test",
    });

    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok", harness: "agent-nrouter" });

    const unauth = await fetch(`${base}/`, { method: "POST", body: "{}" });
    expect(unauth.status).toBe(401);
  });

  test("streams AG-UI text and tool-call events from nRouter SSE completion", async () => {
    const mockFetch: Fetcher = async (url) => {
      expect(String(url)).toBe("https://api.nrouter.ai/v1/chat/completions");
      return new Response(
        sseStreamFromChunks([
          'data: {"choices":[{"delta":{"content":"Checking "}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"pricing..."}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_99","function":{"name":"browser_visit","arguments":"{\\"url\\":\\"https://nrouter.ai\\"}"}}]}}]}\n\n',
          "data: [DONE]\n\n",
        ]),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    };

    const base = await startServer(
      {
        MANAGED_AGENT_TOKEN: "secret-token-123",
        NROUTER_API_KEY: "sk-nrouter-test",
      },
      mockFetch,
    );

    const resp = await fetch(`${base}/`, {
      method: "POST",
      headers: {
        [TOKEN_HEADER]: "secret-token-123",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        threadId: "t1",
        runId: "r1",
        messages: [{ role: "user", content: "Open nrouter.ai" }],
        tools: [{ name: "browser_visit", description: "Visit URL" }],
      }),
    });

    expect(resp.status).toBe(200);
    const rawSse = await resp.text();
    const events = rawSse
      .split("\n\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)));

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "RUN_STARTED",
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_END",
      "RUN_FINISHED",
    ]);
    expect(events[5].toolCallName).toBe("browser_visit");
    expect(events[6].delta).toBe('{"url":"https://nrouter.ai"}');
  });
});
