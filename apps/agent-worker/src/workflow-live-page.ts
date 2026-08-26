// AIGC START
/** Self-contained live DAG viewer. Served at GET /workflow-live. */
export const WORKFLOW_LIVE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenRush · 快车道实时 DAG</title>
  <style>
    :root {
      --bg: #0b0f14;
      --bg-soft: #101720;
      --panel: rgba(16, 23, 32, 0.78);
      --panel-solid: #101720;
      --line: rgba(140, 166, 191, 0.18);
      --text: #eef4fb;
      --muted: #8fa3b8;
      --faint: #65788d;
      --accent: #7c8cff;
      --accent-2: #22d3ee;
      --good: #34d399;
      --warn: #f59e0b;
      --skip: #a78bfa;
      --fail: #f87171;
      --shadow: 0 24px 80px rgba(2, 6, 23, 0.45);
      --radius-xl: 28px;
      --radius-lg: 22px;
      --radius-md: 14px;
      --radius-sm: 10px;
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      --sans: ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: var(--sans);
      color: var(--text);
      background:
        radial-gradient(900px 500px at 12% -10%, rgba(124, 140, 255, 0.22), transparent 60%),
        radial-gradient(900px 500px at 88% 0%, rgba(34, 211, 238, 0.16), transparent 55%),
        linear-gradient(180deg, #0d1420 0%, var(--bg) 40%, #070a0f 100%);
      background-attachment: fixed;
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background-image: linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
      background-size: 56px 56px;
      mask-image: linear-gradient(to bottom, rgba(0,0,0,0.8), transparent 70%);
      opacity: 0.35;
    }
    #app {
      position: relative;
      z-index: 1;
      width: min(1440px, calc(100vw - 40px));
      margin: 0 auto;
      padding: 28px 0 36px;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 18px;
      border: 1px solid var(--line);
      border-radius: var(--radius-xl);
      background: rgba(10, 15, 21, 0.68);
      backdrop-filter: blur(18px);
      box-shadow: var(--shadow);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .logo {
      width: 40px;
      height: 40px;
      border-radius: 14px;
      display: grid;
      place-items: center;
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      box-shadow: 0 12px 28px rgba(34, 211, 238, 0.18);
      flex: none;
    }
    .logo svg { width: 22px; height: 22px; }
    .brand h1 {
      font-size: 16px;
      line-height: 1.2;
      margin: 0;
      letter-spacing: 0.01em;
    }
    .brand p {
      margin: 3px 0 0;
      font-size: 12px;
      color: var(--muted);
    }
    .top-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.03);
      color: var(--muted);
      padding: 8px 12px;
      border-radius: 999px;
      font-size: 12px;
      white-space: nowrap;
    }
    .pill .dot {
      width: 8px;
      height: 8px;
      border-radius: 99px;
      display: inline-block;
      background: var(--accent);
      box-shadow: 0 0 0 4px rgba(124, 140, 255, 0.15);
    }
    .pill.good .dot { background: var(--good); box-shadow: 0 0 0 4px rgba(52, 211, 153, 0.15); }
    .pill.warn .dot { background: var(--warn); box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.15); }
    .pill.fail .dot { background: var(--fail); box-shadow: 0 0 0 4px rgba(248, 113, 113, 0.15); }

    .hero {
      display: grid;
      grid-template-columns: minmax(320px, 460px) 1fr;
      gap: 20px;
      margin-top: 20px;
      align-items: stretch;
    }
    .panel {
      border: 1px solid var(--line);
      border-radius: var(--radius-xl);
      background: var(--panel);
      backdrop-filter: blur(18px);
      box-shadow: var(--shadow);
    }
    .control {
      padding: 22px;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }
    .kicker {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: #c7d2fe;
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-weight: 650;
    }
    .kicker::before {
      content: "";
      width: 10px;
      height: 10px;
      border-radius: 99px;
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      box-shadow: 0 0 18px rgba(124, 140, 255, 0.7);
    }
    .control h2 {
      font-size: clamp(28px, 4vw, 40px);
      line-height: 1.05;
      margin: 0;
      letter-spacing: -0.04em;
    }
    .control h2 span {
      background: linear-gradient(135deg, #ffffff, #bcd0ff 45%, #7dd3fc 90%);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    .control .desc {
      color: var(--muted);
      line-height: 1.8;
      font-size: 14px;
      margin: 0;
    }
    .hint-card {
      display: grid;
      grid-template-columns: 32px 1fr;
      gap: 12px;
      padding: 14px;
      border-radius: 18px;
      background: linear-gradient(135deg, rgba(124, 140, 255, 0.12), rgba(34, 211, 238, 0.08));
      border: 1px solid rgba(124, 140, 255, 0.2);
    }
    .hint-icon {
      width: 32px;
      height: 32px;
      border-radius: 12px;
      display: grid;
      place-items: center;
      background: rgba(255,255,255,0.06);
      color: #dbeafe;
    }
    .hint-card b {
      display: block;
      font-size: 13px;
      margin-bottom: 4px;
    }
    .hint-card span {
      font-size: 12px;
      color: var(--muted);
      line-height: 1.6;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .field label {
      font-size: 12px;
      color: var(--muted);
    }
    .textarea-wrap {
      position: relative;
      border-radius: 18px;
      padding: 1px;
      background: linear-gradient(135deg, rgba(124, 140, 255, 0.55), rgba(34, 211, 238, 0.28), rgba(255,255,255,0.08));
    }
    #intent {
      width: 100%;
      min-height: 108px;
      resize: vertical;
      border: 0;
      outline: none;
      border-radius: 17px;
      background: rgba(8, 13, 19, 0.94);
      color: var(--text);
      padding: 14px 15px;
      font: inherit;
      line-height: 1.7;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
    }
    #intent::placeholder { color: var(--faint); }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .chip {
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.03);
      color: #c9d7e6;
      padding: 8px 10px;
      border-radius: 999px;
      font-size: 12px;
      cursor: pointer;
      transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease;
    }
    .chip:hover {
      transform: translateY(-1px);
      border-color: rgba(124, 140, 255, 0.45);
      background: rgba(124, 140, 255, 0.1);
    }
    .button-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .btn {
      border: 0;
      border-radius: 14px;
      padding: 11px 16px;
      font-size: 13px;
      font-weight: 650;
      cursor: pointer;
      transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
    }
    .btn:hover:not(:disabled) { transform: translateY(-1px); }
    .btn:disabled { opacity: 0.5; cursor: default; }
    .btn-primary {
      color: #08111f;
      background: linear-gradient(135deg, #dbeafe, #93c5fd 40%, #67e8f9);
      box-shadow: 0 14px 30px rgba(59, 130, 246, 0.24);
    }
    .btn-ghost {
      color: var(--text);
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--line);
    }
    .mini-stats {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }
    .stat {
      padding: 12px 14px;
      border-radius: 18px;
      background: rgba(255,255,255,0.03);
      border: 1px solid var(--line);
    }
    .stat .label {
      font-size: 11px;
      color: var(--faint);
      margin-bottom: 6px;
    }
    .stat .value {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .visual {
      display: grid;
      grid-template-rows: auto 1fr;
      overflow: hidden;
      min-height: 0;
    }
    .visual-head {
      padding: 18px 18px 14px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 14px;
      flex-wrap: wrap;
    }
    .visual-head h3 {
      margin: 0;
      font-size: 16px;
    }
    .visual-head p {
      margin: 6px 0 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.6;
    }
    .legend {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .legend span {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: var(--muted);
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.03);
      padding: 6px 9px;
      border-radius: 999px;
    }
    .legend i {
      width: 7px;
      height: 7px;
      border-radius: 99px;
      display: inline-block;
    }
    .visual-body {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 380px;
      min-height: 0;
    }
    #board {
      padding: 16px 18px;
      overflow: auto;
      min-width: 0;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      background:
        radial-gradient(circle at top, rgba(124, 140, 255, 0.05), transparent 30%),
        linear-gradient(180deg, rgba(255,255,255,0.015), rgba(255,255,255,0));
    }
    .empty {
      height: 100%;
      min-height: 280px;
      border: 1px dashed rgba(143, 163, 184, 0.28);
      border-radius: 24px;
      display: grid;
      place-items: center;
      text-align: center;
      color: var(--muted);
      line-height: 1.8;
      padding: 32px;
      background: rgba(255,255,255,0.02);
    }
    .empty .hero-orb {
      width: 96px;
      height: 96px;
      margin: 0 auto 16px;
      border-radius: 50%;
      background:
        radial-gradient(circle at 30% 30%, rgba(255,255,255,0.7), rgba(255,255,255,0) 32%),
        radial-gradient(circle at 70% 70%, rgba(124,140,255,0.9), rgba(34,211,238,0.5) 58%, rgba(15,23,42,0.4) 70%);
      box-shadow: 0 24px 60px rgba(34, 211, 238, 0.18);
      position: relative;
      overflow: hidden;
    }
    .empty .hero-orb::after {
      content: "";
      position: absolute;
      inset: 16px;
      border-radius: inherit;
      border: 1px solid rgba(255,255,255,0.18);
    }
    .empty strong {
      display: block;
      font-size: 18px;
      color: var(--text);
      margin-bottom: 8px;
    }
    .empty code {
      font-family: var(--mono);
      font-size: 12px;
      color: #c7d2fe;
      background: rgba(124, 140, 255, 0.12);
      border: 1px solid rgba(124, 140, 255, 0.2);
      padding: 2px 6px;
      border-radius: 999px;
    }
    .side {
      border-left: 1px solid var(--line);
      padding: 18px;
      background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.015));
      display: flex;
      flex-direction: column;
      gap: 16px;
      min-width: 0;
    }
    .section-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 12px;
      color: var(--muted);
      letter-spacing: 0.02em;
    }
    .section-title .badge {
      font-family: var(--mono);
      color: #c7d2fe;
      border: 1px solid rgba(124, 140, 255, 0.22);
      background: rgba(124, 140, 255, 0.09);
      padding: 3px 7px;
      border-radius: 999px;
      font-size: 10px;
    }
    .log {
      display: flex;
      flex-direction: column;
      gap: 10px;
      overflow: auto;
      max-height: 260px;
      padding-right: 4px;
    }
    .log-line {
      position: relative;
      padding: 10px 12px 10px 34px;
      border-radius: 14px;
      border: 1px solid rgba(140, 166, 191, 0.14);
      background: rgba(255,255,255,0.03);
      color: #c8d5e3;
      font-size: 12px;
      line-height: 1.6;
    }
    .log-line::before {
      content: "";
      position: absolute;
      left: 13px;
      top: 14px;
      width: 7px;
      height: 7px;
      border-radius: 99px;
      background: rgba(143, 163, 184, 0.55);
    }
    .log-line.hot {
      color: var(--text);
      border-color: rgba(124, 140, 255, 0.24);
      background: rgba(124, 140, 255, 0.08);
    }
    .log-line.hot::before {
      background: var(--accent);
      box-shadow: 0 0 0 5px rgba(124, 140, 255, 0.12);
    }
    .output-card {
      border-radius: 18px;
      border: 1px solid rgba(140, 166, 191, 0.16);
      background: rgba(8, 13, 19, 0.55);
      overflow: hidden;
    }
    .output-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      border-bottom: 1px solid rgba(140, 166, 191, 0.12);
      color: var(--muted);
      font-size: 12px;
    }
    .output-actions {
      display: flex;
      gap: 8px;
    }
    .tiny-btn {
      border: 1px solid rgba(140, 166, 191, 0.18);
      background: rgba(255,255,255,0.04);
      color: var(--text);
      border-radius: 10px;
      padding: 6px 10px;
      font-size: 11px;
      cursor: pointer;
    }
    .tiny-btn:hover { border-color: rgba(124, 140, 255, 0.35); }
    #output {
      padding: 14px;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 13px;
      line-height: 1.75;
      color: #dbe7f4;
      max-height: 340px;
      overflow: auto;
    }
    #output.placeholder { color: var(--faint); }

    svg { display: block; width: auto; max-width: 100%; height: auto; }
    .wave-label {
      fill: var(--faint);
      font-size: 10px;
      letter-spacing: 0.06em;
    }
    .edge {
      fill: none;
      stroke: rgba(143, 163, 184, 0.32);
      stroke-width: 1.6;
    }
    .edge.hot { stroke: url(#edgeGrad); stroke-width: 2; }
    .node-box {
      fill: rgba(14, 21, 30, 0.96);
      stroke: rgba(143, 163, 184, 0.22);
      stroke-width: 1.2;
    }
    .node-box.running {
      fill: rgba(24, 40, 72, 0.96);
      stroke: var(--accent);
    }
    .node-box.completed {
      fill: rgba(14, 46, 34, 0.96);
      stroke: var(--good);
    }
    .node-box.skipped {
      fill: rgba(42, 35, 64, 0.96);
      stroke: var(--skip);
    }
    .node-box.failed {
      fill: rgba(70, 24, 24, 0.96);
      stroke: var(--fail);
    }
    .node-title { fill: var(--text); font-size: 12px; font-weight: 700; }
    .node-sub { fill: #9db0c6; font-size: 10px; }
    .node-extra { fill: #c7d2fe; font-size: 10px; }
    .node-box.terminal { fill: rgba(18, 24, 38, 0.96); stroke: rgba(124, 140, 255, 0.45); }
    .node-box.terminal.completed { fill: rgba(14, 46, 34, 0.96); stroke: var(--good); }
    .node-box.terminal.failed { fill: rgba(70, 24, 24, 0.96); stroke: var(--fail); }
    .node-box.selected,
    .node-box.terminal.selected { stroke: #ffffff; stroke-width: 2.4; }
    g[data-node] { cursor: pointer; }
    .inspect {
      overflow: auto;
      max-height: 360px;
      padding: 12px;
      border-radius: 16px;
      border: 1px solid rgba(140, 166, 191, 0.14);
      background: rgba(255,255,255,0.03);
      color: #d5e2ef;
      font-size: 12px;
      line-height: 1.65;
    }
    .inspect.placeholder { color: var(--muted); }
    .inspect .cmd {
      font-family: var(--mono);
      font-size: 11px;
      color: #c7d2fe;
      background: rgba(124, 140, 255, 0.1);
      border: 1px solid rgba(124, 140, 255, 0.2);
      border-radius: 10px;
      padding: 8px 10px;
      margin: 0 0 10px;
      word-break: break-all;
    }
    .inspect .k { color: var(--faint); font-size: 11px; margin: 0 0 6px; }
    .hit-list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 8px; }
    .hit-list a { color: #9ec5ff; text-decoration: none; }
    .hit-list a:hover { text-decoration: underline; }
    .hit-sn { color: var(--muted); font-size: 11px; margin-top: 2px; }
    .node-dot.running { fill: var(--accent); }
    .node-dot.completed { fill: var(--good); }
    .node-dot.skipped { fill: var(--skip); }
    .node-dot.failed { fill: var(--fail); }
    .node-dot.pending { fill: var(--faint); }
    .pulse { animation: pulse 1s ease-in-out infinite; }
    @keyframes pulse { 50% { opacity: 0.55; } }

    @media (max-width: 1100px) {
      .hero { grid-template-columns: 1fr; }
      .visual { min-height: auto; }
      .visual-body { grid-template-columns: 1fr; }
      .side { border-left: 0; border-top: 1px solid var(--line); }
    }
    @media (max-width: 720px) {
      #app { width: min(100vw - 24px, 100%); padding-top: 12px; }
      .topbar, .control { border-radius: 22px; }
      .topbar { padding: 14px; }
      .brand p { display: none; }
      .mini-stats { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div id="app">
    <div class="topbar">
      <div class="brand">
        <div class="logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2l7 4v5c0 4.97-3.5 8.88-7 11-3.5-2.12-7-6.03-7-11V6l7-4z" opacity="0.88"></path>
            <path d="M8 12l2.4 2.4L16.5 8"></path>
          </svg>
        </div>
        <div>
          <h1>OpenRush 快车道</h1>
          <p>意图 → JSON DAG → 引擎执行</p>
        </div>
      </div>
      <div class="top-actions">
        <div class="pill" id="runtimePill"><span class="dot"></span><span id="runtimeText">等待运行</span></div>
        <div class="pill"><span>Catalog</span><span id="catalogText">web.search · HTTP · 工作区 · 高德MCP/mock</span></div>
      </div>
    </div>

    <div class="hero">
      <section class="panel control">
        <div class="kicker">Dynamic Workflow</div>
        <h2>确定性任务，<span>一次规划</span>，直达结果。</h2>
        <p class="desc">输入一句意图，模型会根据当前工具目录当场生成 JSON DAG；之后执行期不再逐轮问模型。适合做演示、验收和对比 agent-loop。</p>

        <div class="hint-card">
          <div class="hint-icon" aria-hidden="true">↗</div>
          <div>
            <b>现在的快车道 catalog</b>
            <span>点下方芯片可切换能力：web.search、http.fetch、fs.read、高德 MCP、coding-tools MCP。不要只用搜索句。</span>
          </div>
        </div>

        <div class="field">
          <label for="intent">意图</label>
          <div class="textarea-wrap">
            <textarea id="intent" rows="4" spellcheck="false">帮我搜一下上海周末带孩子去哪比较合适，免费或低价的都行</textarea>
          </div>
        </div>

        <div class="chips" id="chips">
          <button class="chip" type="button" data-example="帮我搜一下上海周末带孩子去哪比较合适，免费或低价的都行">真实搜索 · 上海亲子攻略</button>
          <button class="chip" type="button" data-example="搜一下 pnpm catalog 在 monorepo 里怎么用">真实搜索 · pnpm catalog</button>
          <button class="chip" type="button" data-example="搜一下 GitHub Actions cache 不命中的常见原因，抓两条结果页面再帮我看一下">搜索+抓页 · Actions cache</button>
          <button class="chip" type="button" data-example="把 https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-7.html 的要点讲一下">官方文档 · TS 5.7 notes</button>
          <button class="chip" type="button" data-example="对比一下 https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-7.html 和 https://pnpm.io/catalogs">双官方文档 · 并行抓取</button>
          <button class="chip" type="button" data-example="读工作区 package.json 和 README.md，用口语介绍这个仓库做什么、怎么启动">coding MCP · 介绍仓库</button>
          <button class="chip" type="button" data-example="在工作区里搜一下 chooseLane 这个函数在哪定义，读那个文件，用口语讲它怎么分流">coding MCP · 查函数</button>
          <button class="chip" type="button" data-example="列出工作区 packages 目录，再读 packages/workflow/package.json，汇总介绍这个包">coding MCP · 看 workflow 包</button>
          <button class="chip" type="button" data-example="汇总工作区的 git_status 和 package.json，告诉我仓库名和工作区是否干净">coding MCP · git 状态</button>
          <button class="chip" type="button" data-example="我周六在上海，想带全家出去玩，推荐附近好玩的地方">出游 · 上海</button>
          <button class="chip" type="button" data-example="周六从上海外滩走到上海博物馆怎么走、大概多久，今天天气怎样">高德 · 步行+天气</button>
        </div>

        <div class="button-row">
          <button class="btn btn-primary" id="runBtn" type="button">运行</button>
          <button class="btn btn-ghost" id="clearBtn" type="button">清空</button>
          <button class="btn btn-ghost" id="demoBtn" type="button">填入搜索示例</button>
        </div>

        <div class="mini-stats">
          <div class="stat">
            <div class="label">状态</div>
            <div class="value" id="statStatus">Idle</div>
          </div>
          <div class="stat">
            <div class="label">节点数</div>
            <div class="value" id="statNodes">0</div>
          </div>
          <div class="stat">
            <div class="label">已完成</div>
            <div class="value" id="statDone">0</div>
          </div>
          <div class="stat">
            <div class="label">工具调用</div>
            <div class="value" id="statCalls">0</div>
          </div>
        </div>
      </section>

      <section class="panel visual">
        <div class="visual-head">
          <div>
            <h3>实时 DAG</h3>
            <p>图有「开始 / 结束」。点任意节点查看检索词、命中列表或抓取内容。「10条命中」表示一次搜索返回了 10 条结果，不是搜了 10 次。</p>
          </div>
          <div class="legend">
            <span><i style="background:var(--faint)"></i>等待</span>
            <span><i style="background:var(--accent)"></i>执行中</span>
            <span><i style="background:var(--good)"></i>完成</span>
            <span><i style="background:var(--skip)"></i>跳过</span>
            <span><i style="background:var(--fail)"></i>失败</span>
          </div>
        </div>
        <div class="visual-body">
          <section id="board"></section>
          <aside class="side">
            <div class="section-title">
              <span>节点详情</span>
              <span class="badge" id="inspectBadge">点击节点</span>
            </div>
            <div id="inspect" class="inspect placeholder">运行后点 DAG 上的「开始」、工具节点或「结束」，查看具体命令和产出。</div>

            <div class="section-title">
              <span>事件流</span>
              <span class="badge" id="eventCount">0 events</span>
            </div>
            <div class="log" id="log"></div>

            <div class="section-title">
              <span>成文</span>
              <span class="badge">Result</span>
            </div>
            <div class="output-card">
              <div class="output-head">
                <span id="outputMeta">尚未运行</span>
                <div class="output-actions">
                  <button class="tiny-btn" id="copyBtn" type="button">复制成文</button>
                </div>
              </div>
              <div id="output" class="placeholder">运行后这里会显示最终文本。</div>
            </div>
          </aside>
        </div>
      </section>
    </div>
  </div>

  <script>
    const NODE_W = 176;
    const FOREACH_W = 108;
    const GATE_W = 132;
    const NODE_H = 52;
    const GAP_X = 18;
    const GAP_Y = 36;
    const PAD = 20;
    const STATUS_LABEL = {
      pending: "等待",
      running: "执行中",
      completed: "完成",
      skipped: "跳过",
      failed: "失败",
    };
    const STATUS_TONE = {
      pending: "",
      running: "warn",
      completed: "good",
      skipped: "",
      failed: "fail",
    };

    let graph = null;
    let nodeStatus = {};
    let nodeMeta = {};
    let nodeItems = {};
    let eventCount = 0;
    let running = false;
    let lastOutput = "";
    let lastIntent = "";
    let failed = false;
    let selectedId = null;
    let selectedIndex = 0;
    let inspectLocked = false;

    function $(id) { return document.getElementById(id); }
    function setRuntime(text, tone) {
      const pill = $("runtimePill");
      pill.className = "pill" + (tone ? " " + tone : "");
      $("runtimeText").textContent = text;
    }
    function setStats(status, total, done) {
      $("statStatus").textContent = status;
      $("statNodes").textContent = String(total ?? 0);
      $("statDone").textContent = String(done ?? 0);
      $("statCalls").textContent = String(totalCalls());
    }
    function foreachTotal(node) {
      if (!node || !node.foreach) return 1;
      const meta = nodeMeta[node.id];
      const n = meta && Number(meta.iterations);
      return n > 1 ? n : 1;
    }
    function shortHost(url) {
      try { return new URL(url).hostname.replace(/^www./, ""); } catch { return ""; }
    }
    function itemStatus(id, index) {
      const items = nodeItems[id];
      if (items && items[index]) return items[index];
      return nodeStatus[id] || "pending";
    }
    function inferForeachFromSearch(searchId, hits) {
      if (!graph || hits == null) return;
      graph.nodes.forEach((n) => {
        if (!n.foreach || String(n.foreach).indexOf(searchId) < 0) return;
        nodeMeta[n.id] = Object.assign({}, nodeMeta[n.id], { iterations: hits });
        if (!nodeItems[n.id] || nodeItems[n.id].length !== hits) {
          nodeItems[n.id] = Array(hits).fill("pending");
        }
      });
    }
    function countDone() {
      return Object.values(nodeStatus).filter((s) => s === "completed").length;
    }
    function countSkipped(output) {
      if (!Array.isArray(output)) return 0;
      return output.filter((row) => row && typeof row === "object" && row.skipped).length;
    }
    function searchHits(output) {
      if (output && Array.isArray(output.results)) return output.results.length;
      return null;
    }
    function searchQuery(output) {
      return output && typeof output.query === "string" ? output.query : "";
    }
    function nodeQuery(node, meta) {
      const fromOut = searchQuery(meta && meta.output);
      if (fromOut) return fromOut;
      const fromMeta = meta && meta.input && typeof meta.input.query === "string" ? meta.input.query : "";
      if (fromMeta) return fromMeta;
      const fromNode = node && node.input && typeof node.input.query === "string" ? node.input.query : "";
      return fromNode;
    }
    function followNode(id, index) {
      if (inspectLocked || !id) return;
      selectedId = id;
      selectedIndex = index || 0;
    }
    function clip(text, n) {
      const s = String(text || "").replace(/\\s+/g, " ").trim();
      return s.length <= n ? s : s.slice(0, n) + "…";
    }
    function selectNode(id, index, fromUser) {
      selectedId = id;
      selectedIndex = index || 0;
      if (fromUser) inspectLocked = true;
      renderInspect();
    }
    function totalCalls() {
      if (!graph) return 0;
      return graph.nodes.reduce((sum, n) => {
        const meta = nodeMeta[n.id];
        if (n.foreach && meta && typeof meta.iterations === "number") return sum + meta.iterations;
        if (nodeStatus[n.id] === "completed" || nodeStatus[n.id] === "failed") return sum + 1;
        return sum;
      }, 0);
    }
    function nodeBadge(node, st) {
      const meta = nodeMeta[node.id];
      if (node.tool === "web.search") {
        const hits = searchHits(meta && meta.output);
        if (hits != null) return hits + "条命中";
        return st === "running" ? "检索中" : "web.search";
      }
      if (node.foreach) {
        if (meta && typeof meta.iterations === "number") {
          const skipped = countSkipped(meta.output);
          return "×" + meta.iterations + (skipped ? " 跳过" + skipped : "");
        }
        return "foreach";
      }
      if (meta && meta.durationMs != null) return meta.durationMs + "ms";
      return STATUS_LABEL[st] || "";
    }
    function nodeSubtitle(node, index, count) {
      const meta = nodeMeta[node.id];
      if (count > 1) {
        const urls = meta && meta.urls;
        return (urls && urls[index] ? shortHost(urls[index]) : node.tool);
      }
      if (node.tool === "web.search") {
        const q = nodeQuery(node, meta);
        return q ? clip(q, 22) : "web.search";
      }
      if (node.tool === "http.fetch") {
        const out = meta && meta.output;
        const url = out && out.url ? String(out.url) : "";
        return url ? clip(shortHost(url) || url, 18) : "http.fetch";
      }
      if (node.tool === "fs.read") {
        const out = meta && meta.output;
        const path = out && out.path ? String(out.path) : "";
        return path || "fs.read";
      }
      return node.tool;
    }
    function endLog(id, payload) {
      const node = graph && graph.nodes.find((n) => n.id === id);
      const bits = ["结束  " + id, payload.status || ""];
      if (node && node.tool === "web.search") {
        const q = nodeQuery(node, { output: payload.output });
        const hits = searchHits(payload.output);
        bits.push("检索 " + (q ? "「" + clip(q, 24) + "」" : "web.search") + " ×1");
        if (hits != null) bits.push(hits + "条命中（一次搜索的结果数）");
      } else if (typeof payload.iterations === "number") {
        bits.push("foreach ×" + payload.iterations);
        const skipped = countSkipped(payload.output);
        if (skipped) bits.push("跳过" + skipped);
      }
      if (payload.durationMs != null) bits.push(payload.durationMs + "ms");
      return bits.filter(Boolean).join(" · ");
    }
    function prettyJson(value) {
      try { return JSON.stringify(value, null, 2); } catch { return String(value); }
    }
    function renderInspect() {
      const box = $("inspect");
      const badge = $("inspectBadge");
      if (!box) return;
      if (!selectedId) {
        badge.textContent = "点击节点";
        box.className = "inspect placeholder";
        box.textContent = "运行后点 DAG 上的「开始」、工具节点或「结束」，查看具体命令和产出。";
        return;
      }
      box.className = "inspect";
      if (selectedId === "__start__") {
        badge.textContent = "开始";
        box.innerHTML = "<div class=\\"k\\">入口</div><pre class=\\"cmd\\">start</pre><div class=\\"k\\">用户意图</div><div>" + escapeHtml(lastIntent || "（空）") + "</div>";
        return;
      }
      if (selectedId === "__end__") {
        badge.textContent = "结束";
        const body = lastOutput ? escapeHtml(clip(lastOutput, 1200)) : "尚未产出成文。";
        box.innerHTML = "<div class=\\"k\\">出口</div><pre class=\\"cmd\\">end</pre><div class=\\"k\\">最终成文</div><div>" + body.replace(/\\n/g, "<br>") + "</div>";
        return;
      }
      const node = graph && graph.nodes.find((n) => n.id === selectedId);
      if (!node) {
        box.className = "inspect placeholder";
        box.textContent = "未找到该节点。";
        return;
      }
      const meta = nodeMeta[node.id] || {};
      const st = nodeStatus[node.id] || "pending";
      badge.textContent = node.tool;
      let cmd = node.tool;
      let body = "";
      if (node.tool === "web.search") {
        const q = nodeQuery(node, meta);
        const hits = searchHits(meta.output) || 0;
        cmd = "web.search query=\\"" + (q || "（尚未返回）") + "\\"";
        body += "<div class=\\"k\\">一次检索，返回 " + hits + " 条命中</div>";
        const results = meta.output && Array.isArray(meta.output.results) ? meta.output.results : [];
        if (results.length) {
          body += "<ol class=\\"hit-list\\">";
          results.forEach((item) => {
            const title = escapeHtml(item && item.title ? item.title : "(无标题)");
            const url = item && item.url ? String(item.url) : "";
            const sn = escapeHtml(clip((item && (item.snippet || item.description)) || "", 160));
            const link = url ? "<a href=\\"" + escapeHtml(url) + "\\" target=\\"_blank\\" rel=\\"noreferrer\\">" + title + "</a>" : title;
            body += "<li>" + link + (sn ? "<div class=\\"hit-sn\\">" + sn + "</div>" : "") + "</li>";
          });
          body += "</ol>";
        } else if (st === "running") {
          body += "<div>正在检索…</div>";
        } else {
          body += "<div>还没有命中列表。</div>";
        }
      } else if (node.tool === "http.fetch") {
        const count = foreachTotal(node);
        const idx = selectedIndex;
        const urls = meta.urls || {};
        let url = urls[idx] || "";
        let content = "";
        let status = "";
        if (count > 1 && Array.isArray(meta.output) && meta.output[idx]) {
          const row = meta.output[idx];
          url = url || String(row.url || "");
          status = row.skipped ? "跳过" : String(row.status || "");
          content = String(row.content || row.error || "");
        } else if (meta.output && typeof meta.output === "object" && !Array.isArray(meta.output)) {
          url = url || String(meta.output.url || "");
          status = String(meta.output.status || "");
          content = String(meta.output.content || "");
        }
        if (!url) {
          const planned = (meta.input && meta.input.url) || (node.input && node.input.url);
          if (planned) url = String(planned);
        }
        cmd = "http.fetch url=\\"" + (url || "（未开始）") + "\\"";
        body += "<div class=\\"k\\">" + (count > 1 ? ("第 " + (idx + 1) + "/" + count + " 页") : "抓取") + (status ? " · HTTP " + escapeHtml(status) : "") + "</div>";
        body += "<div>" + escapeHtml(clip(content, 800) || (st === "running" ? "正在抓取…" : "尚无正文")) + "</div>";
      } else if (node.tool === "fs.read") {
        const path = (meta.output && meta.output.path)
          || (meta.input && meta.input.path)
          || (node.input && node.input.path)
          || "";
        cmd = "fs.read path=\\"" + (path || "（未开始）") + "\\"";
        body += "<div class=\\"k\\">文件内容</div><div>" + escapeHtml(clip(meta.output && meta.output.content, 800) || "尚无内容") + "</div>";
      } else if (node.tool === "text.compose" || node.tool === "article.compose") {
        cmd = node.tool;
        const text = typeof meta.output === "string" ? meta.output : prettyJson(meta.output);
        body += "<div class=\\"k\\">成文</div><div>" + escapeHtml(clip(text, 1000) || "尚未成文") + "</div>";
      } else {
        const planned = meta.input || node.input;
        cmd = planned ? node.tool + " " + clip(prettyJson(planned), 180) : node.tool;
        body += "<div class=\\"k\\">输出</div><pre class=\\"cmd\\">" + escapeHtml(clip(prettyJson(meta.output), 1000) || "尚无输出") + "</pre>";
      }
      const dur = meta.durationMs != null ? " · " + meta.durationMs + "ms" : "";
      box.innerHTML = "<div class=\\"k\\">" + escapeHtml(node.id) + " · " + escapeHtml(STATUS_LABEL[st] || st) + dur + "</div><pre class=\\"cmd\\">" + escapeHtml(cmd) + "</pre>" + body;
    }
    function logLine(text, hot) {
      const el = document.createElement("div");
      el.className = "log-line" + (hot ? " hot" : "");
      el.textContent = text;
      $("log").prepend(el);
      eventCount += 1;
      $("eventCount").textContent = eventCount + " events";
    }
    function clearLog() {
      eventCount = 0;
      $("eventCount").textContent = "0 events";
      $("log").innerHTML = "";
    }
    function setOutput(text, placeholder) {
      const el = $("output");
      el.className = placeholder ? "placeholder" : "";
      el.textContent = text;
      if (!placeholder) lastOutput = text;
    }
    function escapeHtml(text) {
      return String(text).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
    }

    function emptyHtml(mode) {
      if (mode === "planning") {
        return '<div class="empty"><div><div class="hero-orb"></div><strong>规划中…</strong><div>模型正在根据意图和工具目录生成 DAG。当前 catalog 包含 <code>web.search</code>、HTTP 与工作区文件。</div></div></div>';
      }
      return '<div class="empty"><div><div class="hero-orb"></div><strong>等待一次运行</strong><div>适合演示的场景：<br><code>帮我搜一下上海周末带孩子去哪比较合适，免费或低价的都行</code><br><code>把 https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-7.html 的要点讲一下</code></div></div></div>';
    }

    function rootIds(g) {
      return g.nodes.filter((n) => !(n.dependsOn && n.dependsOn.length)).map((n) => n.id);
    }
    function sinkIds(g) {
      return g.nodes.filter((n) => !g.nodes.some((m) => (m.dependsOn || []).indexOf(n.id) >= 0)).map((n) => n.id);
    }
    function endStatus() {
      if (failed) return "failed";
      if (lastOutput) return "completed";
      if (running) return "pending";
      return graph ? "completed" : "pending";
    }

    function layout(g) {
      const pos = {};
      const visWaves = [
        [{ id: "__start__", index: 0, count: 1, boxW: GATE_W, terminal: "start" }],
        ...g.waves.map((wave) =>
          wave.flatMap((id) => {
            const node = g.nodes.find((n) => n.id === id);
            const count = foreachTotal(node);
            const boxW = count > 1 ? FOREACH_W : NODE_W;
            return Array.from({ length: count }, (_, index) => ({ id, index, count, boxW }));
          })
        ),
        [{ id: "__end__", index: 0, count: 1, boxW: GATE_W, terminal: "end" }],
      ];
      const widths = visWaves.map((w) => {
        if (!w.length) return NODE_W;
        const boxW = w[0].boxW;
        return w.length * boxW + Math.max(0, w.length - 1) * GAP_X;
      });
      const maxW = Math.max(...widths, NODE_W);
      visWaves.forEach((wave, ri) => {
        const rowW = widths[ri];
        const y = PAD + 18 + ri * (NODE_H + GAP_Y);
        wave.forEach((slot, ci) => {
          const x = PAD + (maxW - rowW) / 2 + ci * (slot.boxW + GAP_X);
          const p = { x, y, w: slot.boxW };
          pos[slot.id + "#" + slot.index] = p;
          if (slot.index === 0) pos[slot.id] = p;
        });
      });
      return {
        pos,
        visWaves,
        width: maxW + PAD * 2,
        height: PAD + 18 + visWaves.length * (NODE_H + GAP_Y),
      };
    }

    function draw() {
      if (!graph) {
        $("board").innerHTML = emptyHtml(running ? "planning" : "idle");
        renderInspect();
        return;
      }
      const { pos, visWaves, width, height } = layout(graph);
      const bands = visWaves.map((wave, ri) => {
        const y = PAD + 18 + ri * (NODE_H + GAP_Y);
        const first = wave[0];
        const label = first && first.terminal
          ? (first.terminal === "start" ? "入口" : "出口")
          : ((wave.length > 1 ? "并行" : "串行") + " · " + wave.length);
        return '<text class="wave-label" x="' + PAD + '" y="' + (y - 8) + '">' + label + '</text>';
      }).join("");
      const extraEdges = [];
      rootIds(graph).forEach((id) => extraEdges.push({ from: "__start__", to: id }));
      sinkIds(graph).forEach((id) => extraEdges.push({ from: id, to: "__end__" }));
      const foreachOf = (id) => (id === "__start__" || id === "__end__" ? 1 : foreachTotal(graph.nodes.find((n) => n.id === id)));
      const edges = graph.edges.concat(extraEdges).flatMap((e) => {
        const fromN = foreachOf(e.from);
        const toN = foreachOf(e.to);
        const hot = nodeStatus[e.from] === "running" || nodeStatus[e.to] === "running";
        const lines = [];
        for (let i = 0; i < fromN; i += 1) {
          for (let j = 0; j < toN; j += 1) {
            const a = pos[e.from + "#" + i] || pos[e.from];
            const b = pos[e.to + "#" + j] || pos[e.to];
            if (!a || !b) continue;
            const x1 = a.x + (a.w || NODE_W) / 2;
            const y1 = a.y + NODE_H;
            const x2 = b.x + (b.w || NODE_W) / 2;
            const y2 = b.y;
            const mid = (y1 + y2) / 2;
            lines.push('<path class="edge' + (hot ? ' hot' : '') + '" d="M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + mid + ', ' + x2 + ' ' + mid + ', ' + x2 + ' ' + y2 + '"></path>');
          }
        }
        return lines;
      }).join("");
      const terminal = (id, title, sub, st) => {
        const p = pos[id];
        if (!p) return "";
        const selected = selectedId === id ? " selected" : "";
        return '<g data-node="' + id + '" data-index="0"><rect class="node-box terminal ' + st + selected + '" x="' + p.x + '" y="' + p.y + '" width="' + (p.w || GATE_W) + '" height="' + NODE_H + '" rx="16"></rect><text class="node-title" x="' + (p.x + 16) + '" y="' + (p.y + 22) + '">' + title + '</text><text class="node-sub" x="' + (p.x + 16) + '" y="' + (p.y + 38) + '">' + sub + '</text></g>';
      };
      const nodes = graph.nodes.flatMap((n) => {
        const count = foreachTotal(n);
        return Array.from({ length: count }, (_, index) => {
          const p = pos[n.id + "#" + index] || pos[n.id];
          if (!p) return "";
          const st = count > 1 ? itemStatus(n.id, index) : (nodeStatus[n.id] || "pending");
          const extra = count > 1 ? ("#" + (index + 1)) : nodeBadge(n, nodeStatus[n.id] || "pending");
          const sub = nodeSubtitle(n, index, count);
          const pulse = st === "running" ? " pulse" : "";
          const selected = selectedId === n.id && Number(selectedIndex) === index ? " selected" : "";
          const w = p.w || NODE_W;
          return '<g class="' + pulse + '" data-node="' + n.id + '" data-index="' + index + '"><rect class="node-box ' + st + selected + '" x="' + p.x + '" y="' + p.y + '" width="' + w + '" height="' + NODE_H + '" rx="12"></rect><circle class="node-dot ' + st + '" cx="' + (p.x + 14) + '" cy="' + (p.y + 14) + '" r="3.5"></circle><text class="node-title" x="' + (p.x + 26) + '" y="' + (p.y + 18) + '">' + escapeHtml(n.id) + '</text><text class="node-sub" x="' + (p.x + 26) + '" y="' + (p.y + 36) + '">' + escapeHtml(sub) + '</text><text class="node-extra" x="' + (p.x + w - 12) + '" y="' + (p.y + 18) + '" text-anchor="end">' + escapeHtml(extra) + '</text></g>';
        });
      }).join("");
      $("board").innerHTML = '<svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '"><defs><linearGradient id="edgeGrad" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#7c8cff" stop-opacity="0.9"></stop><stop offset="100%" stop-color="#22d3ee" stop-opacity="0.9"></stop></linearGradient></defs>' + bands + edges + terminal("__start__", "开始", "用户意图", "completed") + nodes + terminal("__end__", "结束", "最终成文", endStatus()) + '</svg>';
      renderInspect();
    }

    function applyEvent(ev) {
      if (!ev || !ev.eventType) return;
      if (ev.eventType === "workflow-planning") {
        const via = ev.payload && ev.payload.via;
        setRuntime("规划中", "warn");
        setStats("Planning", 0, 0);
        $("outputMeta").textContent = "规划 DAG 中";
        setOutput("模型正在生成 DAG…", true);
        draw();
        logLine("规划  " + (via === "llm" ? "模型当场生成 DAG" : "无网关，使用出游夹具图"), true);
        return;
      }
      if (ev.eventType === "workflow-graph" && ev.payload) {
        graph = ev.payload;
        nodeStatus = {};
        nodeMeta = {};
        nodeItems = {};
        graph.nodes.forEach((n) => { nodeStatus[n.id] = "pending"; });
        followNode("__start__", 0);
        setRuntime("已规划", "warn");
        setStats("Executing", graph.nodes.length, 0);
        $("outputMeta").textContent = "执行节点中";
        setOutput("DAG 已生成，正在执行节点…", true);
        logLine("图已生成  " + (graph.name || "workflow") + " · " + graph.nodes.length + " 个节点", true);
        draw();
        return;
      }
      if (ev.eventType === "workflow-node-start") {
        const id = ev.payload && ev.payload.nodeId;
        if (id) {
          nodeStatus[id] = "running";
          if (ev.payload.input != null) {
            nodeMeta[id] = Object.assign({}, nodeMeta[id], { input: ev.payload.input });
          }
          followNode(id, 0);
          setRuntime("执行中 · " + id, "warn");
          setStats("Executing", graph ? graph.nodes.length : 0, countDone());
          logLine("开始  " + id + " · " + (ev.payload.tool || ""), true);
        }
        draw();
        return;
      }
      if (ev.eventType === "workflow-foreach") {
        const id = ev.payload && ev.payload.nodeId;
        const total = ev.payload && ev.payload.total;
        if (id && total) {
          nodeMeta[id] = Object.assign({}, nodeMeta[id], { iterations: total });
          nodeItems[id] = Array(total).fill("pending");
          logLine("foreach  " + id + " · 并行 " + total + " 次", true);
        }
        setStats("Executing", graph ? graph.nodes.length : 0, countDone());
        draw();
        return;
      }
      if (ev.eventType === "workflow-foreach-item") {
        const id = ev.payload && ev.payload.nodeId;
        const index = ev.payload && ev.payload.index;
        if (id && index != null) {
          if (!nodeItems[id]) nodeItems[id] = [];
          nodeItems[id][index] = ev.payload.status || "running";
          if (ev.payload.url) {
            const urls = Object.assign({}, (nodeMeta[id] && nodeMeta[id].urls) || {});
            urls[index] = ev.payload.url;
            nodeMeta[id] = Object.assign({}, nodeMeta[id], { urls: urls });
          }
          const host = ev.payload.url ? " · " + shortHost(ev.payload.url) : "";
          logLine("foreach  " + id + " #" + (index + 1) + "/" + (ev.payload.total || "?") + " · " + (ev.payload.status || "") + host, true);
        }
        setStats("Executing", graph ? graph.nodes.length : 0, countDone());
        draw();
        return;
      }
      if (ev.eventType === "workflow-node-end") {
        const id = ev.payload && ev.payload.nodeId;
        if (id) {
          nodeStatus[id] = ev.payload.status || "completed";
          nodeMeta[id] = Object.assign({}, nodeMeta[id], ev.payload);
          const node = graph && graph.nodes.find((n) => n.id === id);
          if (node && node.tool === "web.search") {
            inferForeachFromSearch(id, searchHits(ev.payload.output));
          }
          followNode(id, 0);
          setRuntime("节点更新 · " + id, nodeStatus[id] === "failed" ? "fail" : "warn");
          setStats("Executing", graph ? graph.nodes.length : 0, countDone());
          logLine(endLog(id, ev.payload), true);
        }
        draw();
        return;
      }
      if (ev.eventType === "workflow-fallback") {
        failed = true;
        const reason = (ev.payload && ev.payload.reason) || "fallback";
        const error = (ev.payload && ev.payload.error) || "";
        setRuntime("快车道失败", "fail");
        setStats("Failed", graph ? graph.nodes.length : 0, countDone());
        $("outputMeta").textContent = "未完成 · " + reason;
        setOutput("快车道失败：" + reason + (error ? "\\n" + error : "") + "\\n未再降级到出游 mock。");
        logLine("失败  " + reason + (error ? " · " + error : ""), true);
        followNode("__end__", 0);
        draw();
        return;
      }
      if (ev.eventType === "workflow-error") {
        setRuntime("执行失败", "fail");
        setStats("Error", graph ? graph.nodes.length : 0, countDone());
        $("outputMeta").textContent = "执行失败";
        setOutput(String((ev.payload && ev.payload.error) || "workflow error"));
        logLine("错误  " + String((ev.payload && ev.payload.error) || "workflow error"), true);
        followNode("__end__", 0);
        draw();
        return;
      }
      if (ev.eventType === "workflow-result" || ev.eventType === "workflow-done") {
        if (ev.payload && ev.payload.ok === false) {
          failed = true;
          setRuntime("失败", "fail");
          setStats("Failed", graph ? graph.nodes.length : 0, countDone());
          $("outputMeta").textContent = "未完成";
          if (!lastOutput) {
            setOutput("快车道未完成：" + String((ev.payload && ev.payload.error) || "unknown"));
          }
          followNode("__end__", 0);
          draw();
          return;
        }
        if (ev.payload && ev.payload.degraded) {
          failed = true;
          setRuntime("已降级", "fail");
        }
        const out = ev.payload && (ev.payload.output || ev.payload);
        if (typeof out === "string") {
          setOutput(out);
          $("outputMeta").textContent = (failed ? "降级结果 · " : "完成 · ") + out.length + " chars";
        } else if (out && typeof out.output === "string") {
          setOutput(out.output);
          $("outputMeta").textContent = (failed ? "降级结果 · " : "完成 · ") + out.output.length + " chars";
        }
        if (ev.eventType === "workflow-result" && !failed) {
          setRuntime("完成", "good");
          setStats("Done", graph ? graph.nodes.length : 0, countDone());
        }
        followNode("__end__", 0);
        draw();
      }
    }

    async function run() {
      if (running) return;
      const intent = $("intent").value.trim();
      if (!intent) {
        setRuntime("请填写意图", "fail");
        $("outputMeta").textContent = "输入为空";
        setOutput("请先输入一句意图。", true);
        return;
      }
      lastIntent = intent;
      running = true;
      graph = null;
      nodeStatus = {};
      nodeMeta = {};
      nodeItems = {};
      lastOutput = "";
      failed = false;
      selectedId = "__start__";
      selectedIndex = 0;
      inspectLocked = false;
      $("runBtn").disabled = true;
      $("runBtn").textContent = "执行中…";
      clearLog();
      setRuntime("连接中", "warn");
      setStats("Starting", 0, 0);
      $("outputMeta").textContent = "等待规划";
      setOutput("已提交意图，等待 DAG 生成…", true);
      draw();
      const ac = new AbortController();
      const kill = setTimeout(() => ac.abort(), 180_000);
      const t0 = Date.now();
      const tick = setInterval(() => {
        if (!running) return;
        const s = Math.round((Date.now() - t0) / 1000);
        if (!graph) $("outputMeta").textContent = "规划 DAG 中 · " + s + "s";
      }, 500);
      try {
        const res = await fetch("/workflow-run?stream=1", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({ intent: intent, delayMs: 0, disableFallback: true }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error("HTTP " + res.status);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split("\\n\\n");
          buf = parts.pop();
          for (const part of parts) {
            const line = part.split("\\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            applyEvent(JSON.parse(line.slice(6)));
          }
        }
        if (failed) {
          setRuntime("失败", "fail");
          setStats("Failed", graph ? graph.nodes.length : 0, countDone());
        } else if (!lastOutput) {
          setRuntime("完成", "good");
          setStats("Done", graph ? graph.nodes.length : 0, countDone());
        }
      } catch (err) {
        failed = true;
        setRuntime("失败", "fail");
        setStats("Error", graph ? graph.nodes.length : 0, countDone());
        $("outputMeta").textContent = "请求失败";
        const msg = err && typeof err === "object" && err.name === "AbortError" ? "请求超时（180s）。请刷新后重试，或先用「杭州亲子搜索」示例。" : String(err);
        setOutput(msg);
        logLine(msg, true);
      } finally {
        clearTimeout(kill);
        clearInterval(tick);
        running = false;
        $("runBtn").disabled = false;
        $("runBtn").textContent = "运行";
        followNode("__end__", 0);
        draw();
      }
    }

    $("runBtn").addEventListener("click", run);
    $("board").addEventListener("click", (ev) => {
      const target = ev.target;
      if (!(target instanceof Element)) return;
      const hit = target.closest("[data-node]");
      if (!hit) return;
      selectNode(hit.getAttribute("data-node"), Number(hit.getAttribute("data-index") || 0), true);
      draw();
    });
    $("clearBtn").addEventListener("click", () => {
      if (running) return;
      $("intent").value = "";
      $("intent").focus();
    });
    $("demoBtn").addEventListener("click", () => {
      $("intent").value = "帮我搜一下上海周末带孩子去哪比较合适，免费或低价的都行";
      $("intent").focus();
    });
    $("copyBtn").addEventListener("click", async () => {
      const text = lastOutput || $("output").textContent || "";
      if (!text.trim()) return;
      try {
        await navigator.clipboard.writeText(text);
        $("copyBtn").textContent = "已复制";
      } catch {
        $("copyBtn").textContent = "复制失败";
      }
      setTimeout(() => { $("copyBtn").textContent = "复制成文"; }, 1200);
    });
    $("chips").addEventListener("click", (ev) => {
      const target = ev.target;
      if (!(target instanceof HTMLElement)) return;
      const example = target.getAttribute("data-example");
      if (!example) return;
      $("intent").value = example;
      $("intent").focus();
    });
    $("intent").addEventListener("keydown", (ev) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") run();
    });
    fetch("/workflow-catalog").then((res) => res.json()).then((data) => {
      const bits = ["web.search", "HTTP", "工作区"];
      bits.push(data && data.amap ? "高德 MCP" : "mock");
      if (data && data.coding) bits.push("coding MCP");
      $("catalogText").textContent = bits.join(" · ");
    }).catch(() => undefined);
    draw();
  </script>
</body>
</html>
`;
// AIGC END
