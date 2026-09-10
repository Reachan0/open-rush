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

聊天默认走 DSH。快车道作为原生工具 `workflow_run` 挂在 loop 上：说明里列出已接能力（`web.search` / `http.fetch` / 工作区读搜与 git / 高德或出游演示 / `text.compose`），由模型判断这句需求能不能一次跑完。live 页和 `POST /workflow-run` 仍直达引擎。

```bash
# 实时 DAG：填写意图后点「运行」。先出现「规划中」，收到 workflow-graph 后再画图
open http://localhost:8787/workflow-live
```

```bash
curl -s http://localhost:8787/workflow-run \
  -H 'content-type: application/json' \
  -d '{"intent":"我周六想带全家出去玩，帮我推荐附近好玩的地方"}'
```
