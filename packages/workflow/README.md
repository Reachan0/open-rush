# @open-rush/workflow

OpenRush 进程内 JSON DAG 工作流引擎（dynamic workflow MVP）。

确定性多工具任务：**一次生成 DSL + 引擎执行**，失败则降级回逐轮 agent-loop。不改 DSH / 不上 Claude Code workflow。

## 运行

```bash
pnpm --filter @open-rush/workflow test
pnpm --filter @open-rush/workflow bench
```

把 DSL 画成 Mermaid：

```ts
import { weekendTripDsl, workflowToMermaid } from '@open-rush/workflow';
console.log(workflowToMermaid(weekendTripDsl()));
```

聊天主路 `POST /prompt` 会先分流：开放网页搜索、多源汇总（链接/工作区文件）或已点明城市的出游走 **快车道**（一次生成 DAG）；含糊「附近」、写代码、修 bug 仍走 DSH/Claude Code。快车道 catalog = `web.search`（Keenable）+ `http.fetch` + `fs.read` + `text.compose` + 出游 mock。规划失败则退回通用 agent。

```bash
# 实时 DAG：填写意图后点「运行」。先出现「规划中」，收到 workflow-graph 后再画图
open http://localhost:8787/workflow-live
```

```bash
curl -s http://localhost:8787/workflow-run \
  -H 'content-type: application/json' \
  -d '{"intent":"我周六想带全家出去玩，帮我推荐附近好玩的地方"}'
```
