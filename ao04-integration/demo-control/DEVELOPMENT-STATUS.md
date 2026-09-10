# AO-04 固定演示台开发状态

更新时间：2026-09-09

## T0 核查记录

- 允许写目录：本 OpenRush worktree、`ao04-fastlane-controller`；未修改其他目录。
- OpenRush 分支：`feature/ao04-fastlane`，开始时存在用户 dirty 改动及未跟踪文件，已保留。
- 控制器分支：`feature/ao04-fastlane`，开始时存在用户 dirty 改动及未跟踪文件，已保留。
- 适用说明：OpenRush worktree 的 `AGENTS.md` 已读取；控制器目录未发现更深层 `AGENTS.md`。
- 旧控制台和旧逐 Run 控制器文件均未删除；固定演示模式通过显式 `AO04_SERVICE_DEMO=1` 接入。
- 旧控制器已有 `ReliabilityController`、`ManagedInstance`、`ProtectedTool`、受管 launcher、故障注入与恢复策略；固定演示复用这些能力，不复制第二套恢复策略。

## T1-T4 实施进度

- [x] 固定服务生命周期 API：`GET /demo/services/ao04-demo-local`，以及 `start`、`fault`、`reset`、`stop`、`policy`。
- [x] 固定服务调用上下文与 busy/epoch 隔离：启动/基线准入、reset 和受保护调用共享 invocation lock；reset 停止旧 token 后重建进程并清理依赖故障标记；立即故障持锁执行并写 `fault.applied`。
- [x] 实时业务观测：固定服务状态使用存活进程上的只读 `/work` HTTP 观测和时间戳，不以 baseline 或故障文件冒充实时健康。
- [x] OpenRush demo 模式不再按每 Run 创建 experiment：固定使用 `ao04-demo-local`，不存在时明确失败；旧模式仍按原逻辑创建/访问 experiment。
- [x] 固定演示控制台改为启动/模拟退出/模拟持续超时/重置，并保留 localhost、Origin、nonce、token 不落浏览器边界。
- [x] 演示任务与能力表更新：固定只读三步 DSL，后置 read 依赖 `ao04_read_status` 成功；页面不要求 Session、Run 或预约。
- [x] 策略边界：只接受 `auto` / `alert_only`；故障实际生效后当前 service epoch 禁止切换策略，必须 reset。

## T5 验收进度

### 已实际运行并通过

控制器 worktree：

```text
python -m py_compile src/reliability/*.py
PYTHONPATH=. python -m unittest tests.test_reliability_instance tests.test_reliability_protected tests.test_reliability_control_app -v
Ran 37 tests ... OK
PYTHONPATH=. python -m unittest tests.test_reliability_real_process -v
Ran 3 tests ... OK
```

覆盖了 reset 存活进程真实重建、timeout/silent 清理、service epoch/generation/PID 隔离、立即故障 busy 原子性、未准入拒绝、实时业务状态反例、策略白名单与故障后锁定，以及真实受管 HTTP 进程退出恢复。

OpenRush worktree：

```text
cd ao04-integration/demo-control && PYTHONPATH=. python -m unittest test_server -v
Ran 5 tests ... OK
pnpm --filter @open-rush/dsh-tool-ao04 check
pnpm --filter @open-rush/dsh-tool-ao04 test -- src/__tests__/read-status-tool.test.ts src/__tests__/plugin.test.ts
Test Files 2 passed; Tests 8 passed
```

已尝试的 OpenRush agent-worker 检查未能作为通过证据：

- `pnpm --filter @open-rush/agent-worker check`：失败，当前 worktree 的 workspace 依赖（`@open-rush/agent-runtime`、`@open-rush/mcp`、`@lux/prompts`）缺少可解析构建入口，另有既有 `effectiveSystemPrompt` 类型错误。
- `pnpm --filter @open-rush/agent-worker test -- src/__tests__/ao04-experiment.test.ts`：目标测试本身有 11 个通过，但 Vitest 收集其它测试套件时因上述 workspace 依赖入口缺失而失败（3 个 suite resolve/mock 错误）。

控制器全量测试：

```text
PYTHONPATH=. python -m unittest discover -s tests -v
Ran 111 tests
```

可靠性、生命周期及固定服务相关测试通过；旧 `test_web_demo` replay 测试失败/报错，因为当前控制器 worktree 缺少既有冻结文件 `results/run-20260908-gpt6-r4/summary.json` 与 `runs.csv`，并出现旧首页 404。这些冻结证据属于既有环境缺失，本次未补写、删除或修改。

### 真实页面验收状态

- 已确认隔离 E2E 元数据和服务配置存在于 `ao04-integration/m3-fastlane/results/web-e2e-20260909T035021831Z`，包含控制器、agent-worker、control-worker、web 日志及 `private-control.json`。
- 该环境当时 `agent-worker`（18787）和 web（3100）可访问；控制器端口（18081）返回 404（控制器没有 `/health` 路由），不能据此证明固定 demo API 已完成页面验收。
- 尚未完成一套新的、可复现的浏览器点击证据：start、两次正常任务、exit 恢复、三次 timeout 后 degraded/locked、locked 不绕过、reset、alert_only、390px 窄屏和 controller disconnect unknown state。
- 尚未完成真实 OpenRush workflow 的后置节点跳过/继续证据；当前已有固定 DSL 和工具接线，但仍需在依赖完整构建与运行环境后验收。

## 本轮继续修复（2026-09-09）

- [x] 固定服务调用释放：新增带 `runId` + `bindingGeneration` 的 `/experiments/<id>/release`，正常结束只释放本次 Run 绑定；旧 Run 释放请求不能清掉新 Run。
- [x] 取消隔离：未绑定服务拒绝取消；取消必须携带并匹配当前 Run 租约，避免共享固定服务被无主/迟到取消永久污染。
- [x] worker 本地检查自举：`agent-worker` 的 `precheck`/`pretest` 先以不清理模式构建上游 workspace 包，修复直接运行 worker check/test 时缺失 `dist` 构建入口的问题。
- [x] 绑定 tombstone 过期检查：worker 不再把已释放的本地租约当作当前租约。
- [x] 保持旧模式：`AO04_SERVICE_DEMO` 未启用时仍按逐 Run experiment 创建逻辑；固定服务只在显式 demo 配置启用。

### 本轮代码与单测结果

控制器（无清理构建/测试）：

```text
python -m py_compile src/reliability/*.py                         PASS
PYTHONPATH=. python -m unittest tests.test_reliability_parallel \
  tests.test_reliability_control_app tests.test_reliability_instance -v
Ran 35 tests ... OK
```

OpenRush worker（上游 workspace 构建输出保留）：

```text
pnpm --filter @open-rush/agent-worker build       PASS
pnpm --filter @open-rush/agent-worker check       PASS
pnpm --filter @open-rush/agent-worker test        PASS (6 files, 66 tests)
```

修复了 worker AO04 测试文件中的多余闭合，随后重新完成 build/check/test；测试现覆盖 release 与 cancel 的 Run/generation headers。

全控制器测试仍为 `113` 个，其中 `109` 个相关/可靠性测试通过；`test_web_demo` 的 3 个旧冻结 replay 数据缺失失败和 1 个旧首页 404 保持原状，未恢复或改写禁止的冻结证据。未运行 `pnpm clean`，未删除任何输出。

### 页面验收交接

本轮完成代码修复、构建和单测；没有浏览器工具，因此不能宣称真实页面点击验收完成。主 agent 需使用新的启动说明验证固定服务两轮正常调用、退出恢复、持续超时锁定/不绕过、alert-only、缺产物、取消隔离、controller disconnect unknown 状态及 390px 窄屏，并分别保存新的证据。旧 `m3-fastlane/web-e2e-current.json` 仅作隔离栈配置参考，不计为本轮成绩。


1. 在 workspace 依赖构建入口可用后重新运行 agent-worker `check`、相关 Vitest、TypeScript build/lint。
2. 启动/校验隔离控制器固定 demo API，再进行真实 8766 页面及 390px 浏览器验收；不能把旧运行元数据当作本轮成功证据。
3. 完成固定 DSL 在 OpenRush 中的真实 workflow 运行，记录受保护节点成功时后置节点继续、失败/降级时后置节点跳过。
4. 控制器全量测试仍受旧冻结 replay/web demo 数据缺失影响；不恢复旧冻结证据，不修改禁止目录。
5. 未 commit、push 或 merge。

## 已知保护

- 不修改 `open-rush` 原 main、`deepseek-harness`、原 ao04-experiment 或旧冻结证据。
- 不执行 `rm`、`pkill`、`kill -9`；受管进程停止只走已有 token 定向路径。
- 测试临时文件仅写在允许目录内且不删除。
- 保留所有先前存在的用户 dirty 改动；没有使用裸 `git stash`，没有覆盖或重置用户文件。
- 不 commit/push/merge。
