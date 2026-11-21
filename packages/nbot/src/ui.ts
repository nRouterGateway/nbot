import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { discoverBots, loadBotBundle } from "./loader.js";
import { runBot } from "./runner.js";
import type { HarnessStreamEvent } from "./types.js";

const HTML_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>nbot — First-Class Agentic Coworker UI</title>
  <style>
    :root { --bg:#0b0e14; --panel:#121722; --border:#1f2737; --text:#e6edf3; --muted:#8b949e; --accent:#4f8cff; --green:#3fb950; --amber:#d29922; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: -apple-system, BlinkMacSystemFont, "Inter", sans-serif; background:var(--bg); color:var(--text); display:flex; height:100vh; }
    aside { width:300px; background:var(--panel); border-right:1px solid var(--border); padding:16px; display:flex; flex-direction:column; gap:10px; overflow:auto; }
    aside h1 { font-size:16px; margin:0 0 8px; display:flex; align-items:center; justify-content:space-between; }
    .badge { font-size:11px; padding:2px 7px; border-radius:99px; background:#1c2536; color:var(--accent); border:1px solid #2b3954; }
    .bot-item { padding:10px 12px; border-radius:8px; border:1px solid transparent; cursor:pointer; background:#161c29; }
    .bot-item:hover { border-color:#2d3b55; }
    .bot-item.active { border-color:var(--accent); background:#182235; }
    .bot-name { font-weight:600; font-size:13px; display:flex; justify-content:space-between; align-items:center; }
    .bot-desc { font-size:12px; color:var(--muted); margin-top:4px; line-height:1.35; }
    main { flex:1; display:flex; flex-direction:column; min-width:0; }
    header { padding:14px 20px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; background:var(--panel); }
    header .meta { font-size:12px; color:var(--muted); margin-top:2px; }
    #feed { flex:1; padding:20px; overflow:auto; display:flex; flex-direction:column; gap:14px; }
    .msg { max-width:920px; padding:14px 16px; border-radius:10px; border:1px solid var(--border); background:var(--panel); line-height:1.55; font-size:14px; }
    .msg.user { align-self:flex-end; background:#192844; border-color:#2c4470; white-space:pre-wrap; }
    .msg.bot { align-self:flex-start; width:100%; }
    .steps { display:flex; flex-direction:column; gap:6px; margin-bottom:10px; }
    .tool-step { font-size:12px; padding:7px 10px; border-radius:7px; background:#151d2c; border:1px solid #24314a; color:#9ecbff; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }
    .tool-step.done { border-color:#234732; color:#7ee787; }
    .approval-card { padding:12px; border-radius:8px; background:#241d11; border:1px solid var(--amber); margin-bottom:10px; font-size:13px; }
    .approval-actions { margin-top:8px; display:flex; gap:8px; }
    .btn-approve { background:var(--green); color:#fff; border:none; padding:6px 12px; border-radius:6px; cursor:pointer; font-size:12px; font-weight:600; }
    .btn-reject { background:#30363d; color:var(--text); border:1px solid #484f58; padding:6px 12px; border-radius:6px; cursor:pointer; font-size:12px; }
    .bot-text { white-space:pre-wrap; }
    .status-dot { width:8px; height:8px; border-radius:50%; background:var(--green); display:inline-block; margin-right:6px; }
    form { padding:14px 20px; border-top:1px solid var(--border); background:var(--panel); display:flex; gap:10px; align-items:center; }
    input[type=text] { flex:1; background:var(--bg); border:1px solid var(--border); color:var(--text); padding:11px 14px; border-radius:8px; font-size:14px; outline:none; }
    input[type=text]:focus { border-color:var(--accent); }
    label.chk { font-size:12px; color:var(--muted); display:flex; align-items:center; gap:6px; white-space:nowrap; cursor:pointer; }
    button.primary { background:var(--accent); color:#fff; border:none; padding:10px 18px; border-radius:8px; font-weight:600; cursor:pointer; font-size:14px; }
    button.primary:disabled { opacity:0.5; cursor:not-allowed; }
  </style>
</head>
<body>
  <aside>
    <h1><span>nbot</span><span class="badge">AG-UI SSE</span></h1>
    <div id="bot-list"></div>
  </aside>
  <main>
    <header>
      <div>
        <div id="active-title" style="font-weight:600;font-size:15px;">Select a bot</div>
        <div id="active-meta" class="meta"></div>
      </div>
      <div style="font-size:12px;color:var(--muted)"><span class="status-dot"></span>nRouter Harness Live</div>
    </header>
    <div id="feed"></div>
    <form id="run-form">
      <input id="prompt-input" type="text" placeholder="Prompt this bot (or leave blank to run its default SKILL.md workflow)..." />
      <label class="chk"><input id="headed-chk" type="checkbox" checked /> Show Browser</label>
      <button id="run-btn" class="primary" type="submit">Run Bot</button>
    </form>
  </main>
  <script>
    let bots = [];
    let activeBot = null;
    const listEl = document.getElementById("bot-list");
    const titleEl = document.getElementById("active-title");
    const metaEl = document.getElementById("active-meta");
    const feedEl = document.getElementById("feed");
    const formEl = document.getElementById("run-form");
    const inputEl = document.getElementById("prompt-input");
    const headedEl = document.getElementById("headed-chk");
    const runBtn = document.getElementById("run-btn");

    function selectBot(b) {
      activeBot = b;
      titleEl.textContent = b.name;
      metaEl.textContent = "harness: " + (b.harness || "nrouter-api") + (b.model ? " · model: " + b.model : "") + (b.browser ? " · browser: Playwright" : "");
      renderBots();
    }

    function renderBots() {
      listEl.innerHTML = "";
      for (const b of bots) {
        const div = document.createElement("div");
        div.className = "bot-item" + (activeBot && activeBot.name === b.name ? " active" : "");
        div.innerHTML = '<div class="bot-name"><span>' + b.name + '</span><span class="badge">' + (b.harness || "nrouter") + '</span></div><div class="bot-desc">' + (b.description || "") + '</div>';
        div.onclick = () => selectBot(b);
        listEl.appendChild(div);
      }
    }

    async function load() {
      const res = await fetch("/api/bots");
      bots = await res.json();
      const preferred = bots.find(b => b.name === "seo-nbot") || bots[0];
      if (preferred) selectBot(preferred);
    }

    formEl.onsubmit = async (e) => {
      e.preventDefault();
      if (!activeBot) return;
      const prompt = inputEl.value.trim();
      inputEl.value = "";

      const uDiv = document.createElement("div");
      uDiv.className = "msg user";
      uDiv.textContent = prompt || ("Run " + activeBot.name + " default workflow");
      feedEl.appendChild(uDiv);

      const bDiv = document.createElement("div");
      bDiv.className = "msg bot";
      const stepsEl = document.createElement("div");
      stepsEl.className = "steps";
      const textEl = document.createElement("div");
      textEl.className = "bot-text";
      textEl.textContent = "Starting " + activeBot.name + "...";
      bDiv.appendChild(stepsEl);
      bDiv.appendChild(textEl);
      feedEl.appendChild(bDiv);

      const stepMap = new Map();
      let startedText = false;
      runBtn.disabled = true;

      try {
        const res = await fetch("/api/run-stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bot: activeBot.name, input: prompt || undefined, headed: headedEl.checked })
        });
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\\n\\n")) !== -1) {
            const raw = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 2);
            if (!raw.startsWith("data:")) continue;
            const ev = JSON.parse(raw.slice(5).trim());
            if (ev.type === "tool_call_start") {
              const s = document.createElement("div");
              s.className = "tool-step";
              s.textContent = "⚡ Running " + ev.name + "(" + JSON.stringify(ev.args || {}) + ")...";
              stepsEl.appendChild(s);
              stepMap.set(ev.id, s);
            } else if (ev.type === "tool_call_result") {
              const s = stepMap.get(ev.id);
              if (s) {
                s.className = "tool-step done";
                s.textContent = "✓ " + ev.name + " -> " + (ev.preview || "ok");
              }
            } else if (ev.type === "approval_required") {
              const c = document.createElement("div");
              c.className = "approval-card";
              c.innerHTML = "<strong>Approval Required:</strong> <code>" + ev.name + "</code><div style='margin-top:4px;color:#d0d7de;'>" + ev.reason + "</div>";
              const act = document.createElement("div");
              act.className = "approval-actions";
              const okB = document.createElement("button");
              okB.className = "btn-approve";
              okB.textContent = "Approve & Resume";
              okB.onclick = async () => {
                okB.disabled = true;
                c.innerHTML = "⚡ Approved <code>" + ev.name + "</code> — resuming...";
                try {
                  const resumeRes = await fetch("/api/run", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      bot: activeBot.name,
                      input: prompt || undefined,
                      headed: headedEl.checked,
                      approvedToolResults: { [ev.name]: true, [ev.id]: true }
                    })
                  });
                  const resumeData = await resumeRes.json();
                  c.innerHTML = "✓ Approved &amp; executed <code>" + ev.name + "</code>";
                  if (resumeData.output) {
                    textEl.textContent = resumeData.output;
                  }
                } catch (resumeErr) {
                  c.innerHTML = "Error resuming: " + String(resumeErr);
                }
              };
              const noB = document.createElement("button");
              noB.className = "btn-reject";
              noB.textContent = "Dismiss";
              noB.onclick = () => { c.innerHTML = "✕ Dismissed <code>" + ev.name + "</code>"; };
              act.appendChild(okB);
              act.appendChild(noB);
              c.appendChild(act);
              stepsEl.appendChild(c);
            } else if (ev.type === "text_delta") {
              if (!startedText) { textEl.textContent = ""; startedText = true; }
              textEl.textContent += ev.delta;
            } else if (ev.type === "run_error") {
              textEl.textContent = "Error: " + ev.message;
            }
            feedEl.scrollTop = feedEl.scrollHeight;
          }
        }
        if (!startedText && textEl.textContent.startsWith("Starting ")) {
          textEl.textContent = "(Completed with no text output)";
        }
      } catch (err) {
        textEl.textContent = "Error: " + String(err);
      } finally {
        runBtn.disabled = false;
      }
    };

    load();
  </script>
</body>
</html>`;

export function startUiServer(botsDir: string, port = 4242) {
  const absBotsDir = resolve(botsDir);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(HTML_PAGE);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/bots") {
      const bots = discoverBots(absBotsDir).map((b) => ({
        name: b.manifest.name,
        description: b.manifest.description ?? "",
        harness: b.manifest.harness ?? "nrouter",
        model: b.manifest.model?.model ?? null,
        browser: Boolean(b.manifest.browser?.enabled),
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(bots));
      return;
    }

    if (req.method === "POST" && (url.pathname === "/api/run-stream" || url.pathname === "/api/run")) {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw || "{}") as {
        bot?: string;
        input?: string;
        headed?: boolean;
        approvedToolResults?: Record<string, unknown>;
      };
      const bots = discoverBots(absBotsDir);
      const match = bots.find((b) => b.manifest.name === body.bot);
      if (!match) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Bot '${body.bot}' not found` }));
        return;
      }

      const isStream = url.pathname === "/api/run-stream";
      if (isStream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        });
      }

      const sendEvent = (ev: HarnessStreamEvent) => {
        if (isStream && !res.writableEnded) {
          res.write(`data: ${JSON.stringify(ev)}\n\n`);
        }
      };

      const env = { ...process.env };
      if (body.headed) env.NBOT_HEADED = "1";
      else delete env.NBOT_HEADED;

      try {
        if ((match.manifest.harness ?? "api") === "claude-code") {
          sendEvent({ type: "run_started", bot: match.manifest.name, model: "claude-code" });
          const prompt = [
            `Execute bot '${match.manifest.name}' (${match.dir}/SKILL.md).`,
            body.input ? `Input: ${body.input}` : "",
            "IMPORTANT: Do NOT inspect git status or comment on uncommitted files. Execute ONLY the SKILL.md task and print the complete Markdown output/comparison table directly in your response.",
          ]
            .filter(Boolean)
            .join("\n");

          const output = await new Promise<string>((resolveOut, rejectOut) => {
            const child = spawn("claude", ["-p", prompt, "--allowedTools", "Read,Bash"], {
              cwd: resolve(absBotsDir, ".."),
              env,
            });
            let stdout = "";
            let stderr = "";
            child.stdout.on("data", (d) => {
              const s = d.toString();
              stdout += s;
              sendEvent({ type: "text_delta", delta: s });
            });
            child.stderr.on("data", (d) => (stderr += d.toString()));
            child.on("error", rejectOut);
            child.on("close", (code) => {
              if (code === 0) resolveOut(stdout.trim());
              else rejectOut(new Error(stderr || `claude exited with code ${code}`));
            });
          });
          sendEvent({ type: "run_finished", bot: match.manifest.name, model: "claude-code" });
          if (isStream) res.end();
          else {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ bot: match.manifest.name, output }));
          }
          return;
        }

        if (body.headed) process.env.NBOT_HEADED = "1";
        else delete process.env.NBOT_HEADED;

        const result = await runBot(loadBotBundle(match.dir), {
          input: body.input,
          cwd: resolve(absBotsDir, ".."),
          approvedToolResults: body.approvedToolResults,
          onEvent: isStream ? sendEvent : undefined,
        });
        if (isStream) res.end();
        else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sendEvent({ type: "run_error", message });
        if (isStream) res.end();
        else {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: message }));
        }
      }
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(port, () => {
    console.log(`nbot Agentic UI running at http://localhost:${port} (bots: ${absBotsDir})`);
  });
  return server;
}
