import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { discoverBots, loadBotBundle } from "./loader.js";
import { runBot } from "./runner.js";

const HTML_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>nbot — Agentic Coworker UI</title>
  <style>
    :root { --bg:#0b0e14; --panel:#121722; --border:#1f2737; --text:#e6edf3; --muted:#8b949e; --accent:#4f8cff; --green:#3fb950; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: -apple-system, BlinkMacSystemFont, "Inter", sans-serif; background:var(--bg); color:var(--text); display:flex; height:100vh; }
    aside { width:290px; background:var(--panel); border-right:1px solid var(--border); padding:16px; display:flex; flex-direction:column; gap:10px; overflow:auto; }
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
    .msg { max-width:900px; padding:14px 16px; border-radius:10px; border:1px solid var(--border); background:var(--panel); line-height:1.5; font-size:14px; white-space:pre-wrap; }
    .msg.user { align-self:flex-end; background:#192844; border-color:#2c4470; }
    .msg.bot { align-self:flex-start; width:100%; }
    .step-pill { display:inline-block; font-size:11px; padding:3px 8px; border-radius:6px; background:#182235; color:#79b8ff; margin:0 6px 6px 0; border:1px solid #283854; }
    .status-dot { width:8px; height:8px; border-radius:50%; background:var(--green); display:inline-block; margin-right:6px; }
    form { padding:14px 20px; border-top:1px solid var(--border); background:var(--panel); display:flex; gap:10px; align-items:center; }
    input[type=text] { flex:1; background:var(--bg); border:1px solid var(--border); color:var(--text); padding:11px 14px; border-radius:8px; font-size:14px; outline:none; }
    input[type=text]:focus { border-color:var(--accent); }
    label.chk { font-size:12px; color:var(--muted); display:flex; align-items:center; gap:6px; white-space:nowrap; cursor:pointer; }
    button { background:var(--accent); color:#fff; border:none; padding:10px 18px; border-radius:8px; font-weight:600; cursor:pointer; font-size:14px; }
    button:disabled { opacity:0.5; cursor:not-allowed; }
  </style>
</head>
<body>
  <aside>
    <h1><span>nbot</span><span class="badge">Agentic UI</span></h1>
    <div id="bot-list"></div>
  </aside>
  <main>
    <header>
      <div>
        <div id="active-title" style="font-weight:600;font-size:15px;">Select a bot</div>
        <div id="active-meta" class="meta"></div>
      </div>
      <div style="font-size:12px;color:var(--muted)"><span class="status-dot"></span>Local Runner Ready</div>
    </header>
    <div id="feed"></div>
    <form id="run-form">
      <input id="prompt-input" type="text" placeholder="Prompt this bot (or leave blank to run its default SKILL.md workflow)..." />
      <label class="chk"><input id="headed-chk" type="checkbox" checked /> Show Browser</label>
      <button id="run-btn" type="submit">Run Bot</button>
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
      metaEl.textContent = "harness: " + (b.harness || "api") + (b.model ? " · model: " + b.model : "") + (b.browser ? " · browser: Playwright" : "");
      renderBots();
    }

    function renderBots() {
      listEl.innerHTML = "";
      for (const b of bots) {
        const div = document.createElement("div");
        div.className = "bot-item" + (activeBot && activeBot.name === b.name ? " active" : "");
        div.innerHTML = '<div class="bot-name"><span>' + b.name + '</span><span class="badge">' + (b.harness || "api") + '</span></div><div class="bot-desc">' + (b.description || "") + '</div>';
        div.onclick = () => selectBot(b);
        listEl.appendChild(div);
      }
    }

    function appendMsg(cls, text, pills = []) {
      const div = document.createElement("div");
      div.className = "msg " + cls;
      if (pills.length) {
        const pWrap = document.createElement("div");
        for (const p of pills) {
          const span = document.createElement("span");
          span.className = "step-pill";
          span.textContent = p;
          pWrap.appendChild(span);
        }
        div.appendChild(pWrap);
      }
      const body = document.createElement("div");
      body.textContent = text;
      div.appendChild(body);
      feedEl.appendChild(div);
      feedEl.scrollTop = feedEl.scrollHeight;
      return body;
    }

    async function load() {
      const res = await fetch("/api/bots");
      bots = await res.json();
      const preferred = bots.find(b => b.name === "nrouter-pricing-scrape") || bots[0];
      if (preferred) selectBot(preferred);
    }

    formEl.onsubmit = async (e) => {
      e.preventDefault();
      if (!activeBot) return;
      const prompt = inputEl.value.trim();
      inputEl.value = "";
      appendMsg("user", prompt || ("Run " + activeBot.name + " default workflow"));
      const bodyEl = appendMsg("bot", "Running " + activeBot.name + "...", ["harness: " + (activeBot.harness || "api"), headedEl.checked ? "browser: headed" : "browser: headless"]);
      runBtn.disabled = true;
      try {
        const res = await fetch("/api/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bot: activeBot.name, input: prompt || undefined, headed: headedEl.checked })
        });
        const data = await res.json();
        bodyEl.textContent = data.error ? ("Error: " + data.error) : (data.output || "(empty output)");
      } catch (err) {
        bodyEl.textContent = "Error: " + String(err);
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
        harness: b.manifest.harness ?? "api",
        model: b.manifest.model?.model ?? null,
        browser: Boolean(b.manifest.browser?.enabled),
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(bots));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/run") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw || "{}") as { bot?: string; input?: string; headed?: boolean };
      const bots = discoverBots(absBotsDir);
      const match = bots.find((b) => b.manifest.name === body.bot);
      if (!match) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Bot '${body.bot}' not found` }));
        return;
      }

      const env = { ...process.env };
      if (body.headed) env.NBOT_HEADED = "1";

      try {
        if ((match.manifest.harness ?? "api") === "claude-code") {
          const prompt = [
            `Execute bot '${match.manifest.name}' (${match.dir}/SKILL.md).`,
            body.input ? `Input: ${body.input}` : "",
            "Follow the SKILL.md instructions strictly and output the final structured result.",
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
            child.stdout.on("data", (d) => (stdout += d.toString()));
            child.stderr.on("data", (d) => (stderr += d.toString()));
            child.on("error", rejectOut);
            child.on("close", (code) => {
              if (code === 0) resolveOut(stdout.trim());
              else rejectOut(new Error(stderr || `claude exited with code ${code}`));
            });
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ bot: match.manifest.name, output }));
          return;
        }

        if (body.headed) process.env.NBOT_HEADED = "1";
        const result = await runBot(loadBotBundle(match.dir), {
          input: body.input,
          cwd: resolve(absBotsDir, ".."),
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
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
