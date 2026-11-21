import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNbot, discoverBots, loadBotBundle, narrowTools, parseBotBundle } from "../src/index.js";
import type { ToolDefinition } from "../src/types.js";

describe("@nrouter/nbot SDK", () => {
  test("discovers and loads nbot.yaml + SKILL.md bundles", () => {
    const tmp = mkdtempSync(join(tmpdir(), "nbot-test-"));
    try {
      const botDir = join(tmp, "demo-bot");
      mkdirSync(botDir);
      writeFileSync(
        join(botDir, "nbot.yaml"),
        "name: demo-bot\nmodel:\n  model: nrouter/auto\napproval_policy:\n  require_approval:\n    - send_email\n",
      );
      writeFileSync(
        join(botDir, "SKILL.md"),
        "---\nname: demo-bot\nskill_tools:\n  - read_data\n  - send_email\n---\n# Demo\nDo work.\n",
      );

      const discovered = discoverBots(tmp);
      expect(discovered).toHaveLength(1);
      const bundle = loadBotBundle(botDir);
      expect(bundle.manifest.name).toBe("demo-bot");
      expect(bundle.skillFrontmatter.skill_tools).toEqual(["read_data", "send_email"]);

      const tools: ToolDefinition[] = [
        { name: "read_data", description: "read", parameters: {}, execute: () => "ok" },
        { name: "send_email", description: "send", parameters: {}, execute: () => "sent" },
        { name: "unrelated_tool", description: "x", parameters: {}, execute: () => "x" },
      ];
      const narrowed = narrowTools(bundle, tools);
      expect(narrowed.map((t) => t.name)).toEqual(["read_data", "send_email"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("executes allowed tools and blocks approval-gated tools", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "nbot-run-"));
    try {
      const botDir = join(tmp, "ops-bot");
      mkdirSync(botDir);
      writeFileSync(
        join(botDir, "nbot.yaml"),
        "name: ops-bot\napproval_policy:\n  require_approval:\n    - send_email\n",
      );
      writeFileSync(
        join(botDir, "SKILL.md"),
        "---\nname: ops-bot\nskill_tools:\n  - read_data\n  - send_email\n---\n# Ops\n",
      );

      let step = 0;
      let emailExecuted = false;
      const mockFetch: typeof fetch = async () => {
        step++;
        if (step === 1) {
          return new Response(
            JSON.stringify({
              model: "nrouter/auto",
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                      {
                        id: "tc1",
                        type: "function",
                        function: { name: "read_data", arguments: "{}" },
                      },
                      {
                        id: "tc2",
                        type: "function",
                        function: { name: "send_email", arguments: '{"to":"a@b.com"}' },
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            model: "nrouter/auto",
            choices: [{ message: { role: "assistant", content: "Done; email awaiting approval." } }],
          }),
          { status: 200 },
        );
      };

      const client = createNbot({
        apiKey: "test-key",
        fetchImpl: mockFetch,
        tools: [
          { name: "read_data", description: "read", parameters: {}, execute: () => ({ ok: true }) },
          {
            name: "send_email",
            description: "send",
            parameters: {},
            execute: () => {
              emailExecuted = true;
              return "sent";
            },
          },
        ],
      });

      const res = await client.run(botDir);
      expect(emailExecuted).toBe(false);
      expect(res.toolCalls).toHaveLength(1);
      expect(res.toolCalls[0].name).toBe("read_data");
      expect(res.pendingApprovals).toHaveLength(1);
      expect(res.pendingApprovals[0].id).toBe("tc2");
      expect(res.pendingApprovals[0].tool).toBe("send_email");
      expect(res.output).toBe("Done; email awaiting approval.");

      // Resume with approvedToolResults executes the gated tool
      step = 0;
      const resumed = await client.run(botDir, { approvedToolResults: { tc2: true } });
      expect(emailExecuted).toBe(true);
      expect(resumed.pendingApprovals).toHaveLength(0);
      expect(resumed.toolCalls.map((t) => t.name)).toEqual(["read_data", "send_email"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("parseBotBundle supports declarative manifest.tools and manifest.parameters", async () => {
    const bundle = parseBotBundle(
      [
        "name: playground-bot",
        "model:",
        "  model: openai/gpt-4o-mini",
        "parameters:",
        "  max_tokens: 512",
        "  reasoning_effort: medium",
        "tools:",
        "  - name: lookup_order",
        "    description: Look up order by ID",
        "    parameters: { type: object, properties: { id: { type: string } } }",
        "    mockResponse: { status: shipped }",
      ].join("\n"),
      "---\nname: playground-bot\nskill_tools:\n  - lookup_order\n---\nLook up the order.",
    );

    let capturedBody: Record<string, unknown> | undefined;
    let callNum = 0;
    const client = createNbot({
      apiKey: "test-key",
      fetchImpl: async (_url, init) => {
        callNum++;
        capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        if (callNum === 1) {
          return new Response(
            JSON.stringify({
              model: "openai/gpt-4o-mini",
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                      {
                        id: "call_order_1",
                        type: "function",
                        function: { name: "lookup_order", arguments: '{"id":"ord_99"}' },
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            model: "openai/gpt-4o-mini",
            choices: [{ message: { role: "assistant", content: "Order ord_99 has shipped." } }],
          }),
          { status: 200 },
        );
      },
    });

    const result = await client.run(bundle, { input: "Where is ord_99?" });
    expect(capturedBody?.max_tokens).toBe(512);
    expect(capturedBody?.reasoning_effort).toBe("medium");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].result).toEqual({ status: "shipped" });
    expect(result.output).toBe("Order ord_99 has shipped.");
  });
});
