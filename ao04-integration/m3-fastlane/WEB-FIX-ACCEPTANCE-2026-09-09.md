# M3 两项页面缺陷修复验收（2026-09-09）

结论：本轮两项缺陷已修复，并通过真实 Next 页面 → DSH → workflow_run → AO04 → 本地 Flask 的回归。不是 M3 全项目验收，也不是新的 80 次统计实验。

## 修复

1. 工具卡片一直 Running 的根因是并发入库序号冲突。v1 开关关闭时，worker stream 用本地计数器，可靠性 watch 用 EventStore 分配序号；可靠性事件占据同一序号后，工具结果被视为重复而丢弃。AO04 模式现统一使用 `appendAssignSeq`，不改变 v1 扩展事件的启用条件。
2. DAG 现识别 `workflow_run` 的结构化图和明确的 `OPENRUSH_WORKFLOW_DAG:` 结果，兼容成功输出和失败 errorText。快车道结果附带执行器记录的节点状态，缺失记录为 pending；计划输入不能证明完成，模型复述不能把节点标绿。成功图显示已完成，失败图保留未执行节点。

## 本次真实页面结果

证据根目录：`results/web-e2e-20260909T035021831Z/`。

| 用例 | Run | 结果 |
| --- | --- | --- |
| `evidence/fixed-exit` | `200dd6de-76e7-4f3f-af1c-d5277e85aad4` | 真实 PID 更换、至少三次健康及业务验证；同一工具调用 ID 的 input/output 均入库；卡片 Completed、DAG 3/3 完成 |
| `evidence/fixed-timeout-retry` | `a56af081-b7d6-4d56-9456-a7a3e2b16181` | 三次超时后锁定降级；卡片 Error；DAG 为 completed / failed / pending，1/3 完成；刷新后卡片、DAG 和可靠性事件保留 |
| `evidence/fixed-timeout` | `cfd105db-cd78-45d6-b56d-f0b2403053f9` | 模型生成工具参数时停滞，未开始正式工具调用；主动页面取消，保留为未完成尝试，不计作处置成功 |

两个完成用例各有 408 条 Run 事件。`fix-acceptance.json` 记录调用 ID、终态、节点状态和源码哈希。检查验证了事件序号严格递增、成功/错误工具终态与调用 ID 对应、真实故障与恢复/降级证据存在。

故障通过后台实验控制 API 注入；页面发消息、工具卡片、DAG、可靠性和刷新通过真实应用浏览器操作。登录为既有开发登录绕过，不是生产认证验收。测试使用固定 DSL，不证明自由自然语言规划稳定。

## 检查结果与边界

- 62 个针对性测试通过：Web 14、控制面 32、快车道工具 16。
- 将隔离测试副本临时恢复为旧序号行为时，冲突反例失败；恢复修复后通过。运行服务加载的编译产物不受该反例检查影响。
- control-plane 与快车道插件编译成功；插件类型检查通过。
- Web 全量类型检查仍有 preview route 的 Buffer 类型，以及 cancel/abort 测试的既有类型错误；control-plane 全量类型检查有跨包测试导入的 rootDir 问题。未宣称全仓检查通过。
- 本轮没有重新执行处置进行中取消、旧租约迟到取消，也未重跑历史 80 次批次。此前仅看到取消按钮不等于本轮取消闭环已重新验收。
- 自然语言规划及模型服务长时间停滞仍是后续问题；成功/降级页面修复不能消除这些限制。

## 子任务审查

使用本机 Claude Code 执行子任务。工具字段兼容子任务未复现真实故障，且按顺序猜调用归属可能配错并行结果，未采纳；原 diff 保存在 `rejected-mapper-compatibility.patch`。DAG 子任务的宽泛自然语言解析已收窄为实际工具协议。

独立只读审查在 `fix-readonly-review.txt`。采纳 output 无法解析时应继续尝试 errorText 的意见并补测试。未标记的纯 JSON 用于兼容结构化 DSL，不把普通模型文字当执行证据；workflow_run 在读取记录状态后提前返回，不经过旧 workflow.plan 的 compose 回复推断逻辑。

一个子任务为运行测试在 worktree 根目录安装了依赖，超出其分配子目录，仍位于 CMCC_internship 项目内，已向用户说明；后续验证使用现有隔离环境。未 commit/push，未删除用户文件。证据目录含私有运行配置及依赖缓存，不应整体作为交付包发送。
