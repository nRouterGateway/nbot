/**
 * HTTP/SSE AG-UI server for `agent-nrouter`:
 *  - `GET /health` -> 200 `{ status: "ok", harness: "agent-nrouter" }` (no auth)
 *  - `POST /` -> AG-UI SSE event stream protected by constant-time `x-openbot-agent-token`
 */
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { type AgUiEvent, type Fetcher, type RunAgentInput, runNrouterAgent } from "./run.ts";

export const TOKEN_HEADER = "x-openbot-agent-token";
const MAX_BODY_BYTES = 64 * 1024 * 1024;

function sameToken(offered: string, expected: string): boolean {
  const a = Buffer.from(offered, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_BODY_BYTES) {
      throw Object.assign(new Error("Request body too large"), { status: 413 });
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface EngineOptions {
  env?: Record<string, string | undefined>;
  fetcher?: Fetcher;
}

export function createNrouterEngine(options: EngineOptions = {}): Server {
  const env = options.env ?? process.env;

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { status: "ok", harness: "agent-nrouter" });
    }

    const expectedToken = (env.MANAGED_AGENT_TOKEN ?? "").trim();
    if (!expectedToken) {
      return sendJson(res, 503, { error: "MANAGED_AGENT_TOKEN is not configured." });
    }

    const offeredToken = String(req.headers[TOKEN_HEADER] ?? "");
    if (!offeredToken || !sameToken(offeredToken, expectedToken)) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }

    if (req.method !== "POST" || url.pathname !== "/") {
      return sendJson(res, 404, { error: "Not found" });
    }

    let input: RunAgentInput;
    try {
      const raw = await readBody(req);
      input = JSON.parse(raw || "{}") as RunAgentInput;
    } catch (err) {
      const status = (err as { status?: number })?.status ?? 400;
      return sendJson(res, status, {
        error: err instanceof Error ? err.message : "Invalid JSON body",
      });
    }

    const controller = new AbortController();
    req.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });

    const emit = (event: AgUiEvent) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    };

    await runNrouterAgent(input, {
      env,
      fetcher: options.fetcher,
      signal: controller.signal,
      emit,
    });

    if (!res.writableEnded) {
      res.end();
    }
  });
}
