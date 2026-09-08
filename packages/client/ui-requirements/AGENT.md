# 需求执行 Notebook 界面映射

本文档定义需求文档工作流与 DSH Web 界面的对应关系。DSH 保留侧边栏、Session 顶栏、对话/轨迹/需求标签页和底部原生输入框；需求标签页把每个产品轮次显示为 Notebook。

## 核心交互模型

一次产品轮次从底部输入框提交原始需求开始，到所有 Task 通过审核并完成最终验证结束。产品轮次由独立的 `RequirementRoundId` 标识，不把 Agent Turn 当成产品轮次。

```text
原始需求 → 关键歧义判断 → 可选澄清 → 中文需求文档与图谱 → 用户点击生成任务 → Task 块 → 逐项独立审核与图谱染色 → Final Test → 最终验证
```

1. `startRound` 原样保存用户输入，并让主 Agent 以只读方式检查仓库和判断关键歧义。
2. 主 Agent 最多发起两批中文澄清问题，每批 1 至 5 个；不需要澄清时直接提交中文需求文档。
3. 轮次标题显示不可编辑的短摘要；原始输入、问题和回答收在默认折叠的“澄清记录”中。
4. 需求文档包含“简介”和连续编号的需求、用户故事、验收标准。文档可编辑；无效修订不能生成任务。
5. 用户点击需求文档块的“生成任务”后，主 Agent 从确切文档修订生成多个顶层 Task 块。Notebook 不显示 Plan 卡片，也没有 Plan 审批。
6. 每个顶层 Task 块保留对应阶段的全部 `N.x` 子勾选项和中文 `_关联需求：…_`；最后一个块固定为 Final Test。
7. Task 单独运行或按序全部运行。一个 Task 完成后，独立审核者先给出通过、警告或阻塞判定，系统再决定是否继续。
8. “停止全部运行”在当前 Task 及其审核结算后生效。Final Test 通过审核后，系统追加最终验证单元格。
9. 右侧需求图谱聚合当前 Workspace 中全部 Session 的全部轮次；点击本 Session 节点会定位到 Task 或需求文档，点击其他 Session 节点会打开对应 Session。

轮次、澄清、需求文档、图谱、任务列表、Task 执行、“全部运行”、文本/批注、审核和验证都是持久事件。界面只在本地保存选择、折叠、草稿、缩放、图谱开关和临时错误；刷新后从 Session target 与 Session 列表投影重建 Notebook 和 Workspace 图谱。

## 图谱关系与状态

每个节点使用 Session id、`RequirementRoundId` 和文档内需求编号共同标识，因此不同 Session 或不同轮次中的同号需求不会合并。`depends-on` 只连接当前文档内的前置需求；`refines` 与 `supersedes` 只指向同一 Session 中更早轮次的现有节点。系统拒绝未知端点、重复关系、自依赖和依赖环。

节点初始为灰色。映射 Task 进入执行或只有部分验收标准完成时变为蓝色；经过独立审核且覆盖该节点全部验收标准的非 Final Test Task 完成后变为绿色；映射 Task 失败、最终验证失败或确认回归时变为红色。Final Test 的待处理状态不会推迟普通需求节点变绿，但其失败会把覆盖的节点标红。

## 编辑与锁定

- 需求文档在任务执行开始前可以编辑。文档修订后，旧任务列表不再显示，用户必须重新生成任务。
- 任务生成进行期间不能编辑需求文档，防止 Agent 读取的修订与提交结果不一致。
- 任一 Task 开始执行后，需求文档锁定。
- 执行前，普通 Task 可以新增、编辑、重排或撤回；Final Test 可以编辑，但不能撤回、移动或离开末位。
- 执行开始后，已完成、执行中和审核中的 Task 锁定。当前 Task 与审核结算且“全部运行”停止时，后续待处理 Task 才能编辑。

## 审核与状态

Task 执行失败使用 `[!]` 和琥珀色状态。审核者返回 `warning` 时显示警告但允许继续；返回 `blocking`、审核不可用、输出无效或确认历史需求回归时，当前 Task 失败并停止“全部运行”。只有审核证据能够可靠归因时，历史回归才绑定到具体 Task；否则最终验证报告回归但不猜测责任。

Final Test 是固定的最终任务。它覆盖需求文档的全部验收标准，可以修复本轮引入的问题并重新验证，但不得删除测试、放宽断言或隐藏失败。

## 实现映射

| 路径能力 | 实现与证据 |
|---|---|
| 原始输入与摘要 | `requirement/round` 保存输入、状态和只读摘要；`RequirementsView` 渲染轮次标题与折叠记录 |
| 澄清 | `clarify_requirements` 通过 `userQuestions` 交互；`requirement/clarification` 保存问题、答案和失败状态 |
| 需求文档 | `submit_requirements_document` 与 `editDocument` 追加 `requirement/document` 修订；宿主验证中文结构 |
| 需求图谱 | `requirement/graph` 保存完整文档节点与关系；`requirementGraph` Session 投影结合 Task 和验证状态生成节点颜色 |
| 生成任务 | `generateTasks` 排入生成轮次；`submit_requirement_tasks` 从确切文档修订追加 `requirement/task-list` |
| Task 操作 | `runTask`、`runAll`、`stopRunAll`、`addTask`、`editTask`、`moveTask`、`withdrawTask` 追加持久事件 |
| 独立审核 | `requirement/review` 保存逐 Task 判定；只有审核通过后才把执行标成完成 |
| Final Test | 任务列表不变量要求唯一、末位且覆盖所有验收标准；通过后追加 `requirement/validation` |
| 持久化与重放 | `assembly.ts` 按事件类型投影 Notebook 节点；Session 列表携带图谱投影；Session invariant 检查修订、引用、关系和状态转换 |

## 界面控件

顶部工具栏保留“命令”“+代码”“+文本”“全部运行”、停止控件和“需求图谱”开关。需求文档块提供编辑、保存、取消和“生成任务”。摘要不可编辑。Task 输入单元格继续支持自动保存、运行、上下移动、批注、详情、撤回和 Agent 辅助；输出使用 Markdown 渲染并可独立折叠。需求图谱在桌面端占据可关闭的右侧栏，在窄屏下覆盖 Notebook；详情面板继续按需覆盖显示。

底部原生输入框在需求标签页激活时创建新需求轮次；普通“对话”和“轨迹”输入行为不变。Workspace Write、模型选择、推理强度和 Session 指标继续由 DSH 外壳提供。

## 验收与检查

目标路径必须满足：原始输入与澄清可重放；摘要只读；需求文档与图谱可验证和修订；生成任务不依赖 Plan；文档修订会使旧任务和旧当前图谱失效；Task 操作遵守锁定规则；每个 Task 在继续前完成独立审核；节点颜色由 Task 与验证事实派生；Final Test 始终处于末位并覆盖全部验收标准；刷新或重开 Session 后 Notebook 与 Workspace 图谱状态一致。

相关行为测试位于 `packages/session/session-requirements/tests/` 和 `packages/client/ui-requirements/tests/`。`loader-composition.spec.ts` 通过 Loader 启动真实 Cordis 配置，并检查持久轮次与模型可见提示词。
