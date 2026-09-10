# AO-04 项目质量检查演示台

访问 `http://127.0.0.1:8766/`。这是答辩用的固定服务控制台：操作者不需要填写
Session、Run、experimentId、端口或 PID。OpenRush 访问 `http://127.0.0.1:3100/`。

## 如何演示

1. 在 8766 点“重置演示”，确认质量检查服务为“运行中”、接口为“可用”。
2. 正常场景直接复制任务；故障场景先点“模拟进程退出”或“模拟持续超时”。故障会作用到真实本地 Flask 进程。
3. 点“复制项目检查任务”，打开 OpenRush 聊天，粘贴并发送。任务通过 `workflow_run` 执行 `collect_evidence → quality_check → release_policy`。
4. `collect_evidence` 读取项目证据；`quality_check` 通过 AO-04 调用质量服务并生成 `quality-report.json`；成功后才读取交付规则。
5. 8766 看 AO-04 处置时间线；OpenRush Workflow 面板看质量报告以及后续节点是否继续或跳过。

进程退出场景应看到 PID 更换、三次健康/业务/归属验证、质量报告成功生成和 `3/3` 节点完成。持续超时场景应看到三次尝试后降级锁定，质量检查失败，`release_policy` 明确标为“跳过”。

“重置演示”会停止当前受管进程、清除故障并重新做基线。修改“自动处置/仅告警”策略前先重置。

## 保护能力

| 能力 | 当前行为 | 保护范围与限制 |
|---|---|---|
| 启动前健康基线 | 基线通过后才准入 | 实验用 tool_app 的健康与业务检查 |
| 进程退出恢复 | 有界重启，连续三次健康、业务和归属验证 | 自动模式；不能保证所有故障可修复 |
| 持续超时 | 三次调用后降级、锁定 | 不宣称依赖恢复 |
| 仅告警对照 | 单次失败，不自动修复 | 用于展示自动处置的区别 |
| 缺失产物 | 声称完成但产物不存在时转人工 | 当前模拟业务产物 |
| 工作流依赖门控 | 受保护步骤失败，依赖它的后续节点不执行 | 工作流必须包含受保护工具和 dependsOn |
| 取消与 Run 隔离 | 后台仍携带 Run 和租约代次，拒绝过期身份 | 页面不暴露这些内部标识 |
| 事件展示 | 中文状态、PID、验证、原始事件 | 图中的组件关系不是每个节点的执行证据 |
| 所有工具自动保护 | 尚未实现 | 搜索、高德、普通 read 等不会自动获得 AO-04 保护 |
| 任意服务接入 | 尚未通用化 | 新依赖需适配探测、业务验证、恢复动作与权限 |

业务链路：项目证据 → OpenRush 对话 → `workflow_run` 快车道 → 项目质量检查（技术入口 `ao04_read_status`）→ AO-04 控制器 → 质量检查服务 → `quality-report.json`。
质量检查服务是新增的演示业务依赖，不是快车道自身必需的基础设施；AO-04 展示的是如何保护一个实际业务工具。

## 启动与测试

固定服务演示台不要求输入 Session、Run、experimentId、端口或 PID。控制器启动后，8766 页面通过本机服务端代理读取固定服务 `ao04-demo-local`；控制器凭据只在服务端环境中读取，不进入浏览器。

```sh
# 终端 1：固定服务控制器
cd /Users/chenxuanchong/projects/CMCC_internship/ao04-fastlane-controller
AO04_CONTROL_PORT=18080 AO04_SERVICE_DEMO=1 \
  /Users/chenxuanchong/projects/CMCC_internship/ao04-experiment/.venv/bin/python -m src.reliability.control_app

# 终端 2：演示控制台
cd /Users/chenxuanchong/projects/CMCC_internship/open-rush/.worktrees/ao04-fastlane/ao04-integration/demo-control
AO04_CONTROL_URL=http://127.0.0.1:18080 AO04_CONTROL_TOKEN="$AO04_CONTROL_TOKEN" \
  /Users/chenxuanchong/projects/CMCC_internship/ao04-experiment/.venv/bin/python server.py --port 8766
```

Open `http://127.0.0.1:8766/`. Use **启动服务**, then **模拟进程退出** or **模拟持续超时**; copy the task into the OpenRush project and send it. The fixed service is reused across independent Runs, while each invocation still carries an internal lease so a stale Run cannot cancel or replace a newer Run.

本目录已有测试只覆盖控制台代理协议：

```sh
PYTHONPATH=. python -m unittest test_server -v
```

OpenRush worker 修改后先以不清理模式构建 workspace 依赖，再执行检查和测试（不要使用 `pnpm clean`）：

```sh
cd /Users/chenxuanchong/projects/CMCC_internship/open-rush/.worktrees/ao04-fastlane
pnpm --filter @open-rush/agent-worker build
pnpm --filter @open-rush/agent-worker check
pnpm --filter @open-rush/agent-worker test
```

控制器凭据和模型密钥不会写入证据或打印。旧运行配置可参考 `ao04-integration/m3-fastlane/web-e2e-current.json`，但不作为本轮验收结果。

## 本次人工验收（2026-09-10）

- 真实退出联动：固定服务 PID `51428 → 51504`，同一 incident 连续三次验证通过；OpenRush DAG `3/3` 完成，`post` 成功执行。
- 真实持续超时联动：PID `50710` 保持不变，三次调用后 `degraded/locked`；OpenRush DAG `pre=完成、protected=失败、post=跳过`。
- 锁定后的再次调用返回 `circuit_open`，没有新增控制器事件或依赖尝试。
- 这些是交互验收证据，不替代 AO-04 的正式冻结批次，也不是新一轮统计实验。
- 仍未在真实页面重新验收 alert_only、缺产物和点击取消杀进程；这些路径已有控制器/worker 单测与独立验收脚本。
