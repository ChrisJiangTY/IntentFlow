# 需求执行 Notebook 界面映射

本文档定义需求文档工作流与 DSH Web 界面的对应关系。DSH 保留侧边栏、Session 顶栏、对话/轨迹/需求标签页和底部原生输入框；需求标签页把每个产品轮次显示为 Notebook。

## 核心交互模型

一次产品轮次从底部输入框提交原始需求开始，到所有 Task 完成并通过最终集中审核结束。产品轮次由独立的 `RequirementRoundId` 标识，不把 Agent Turn 当成产品轮次。

```text
原始需求 → 关键歧义判断 → 可选澄清 → 中文需求文档与图谱 → 用户点击生成任务 → 普通 Task 连续执行／检查点审核 → Final Test → 集中审核与最终验证
```

1. `startRound` 原样保存用户输入，并让主 Agent 以只读方式检查仓库和判断关键歧义。
2. 主 Agent 最多发起两批中文澄清问题，每批 1 至 5 个；不需要澄清时直接提交中文需求文档。
3. 轮次标题显示不可编辑的短摘要；原始输入、问题和回答收在默认折叠的“澄清记录”中。
4. 需求文档包含“简介”和连续编号的需求、用户故事、验收标准。文档可编辑；无效修订不能生成任务。
5. 用户点击需求文档块的“生成任务”后，主 Agent 从确切文档修订生成多个顶层 Task 块。Notebook 不显示 Plan 卡片，也没有 Plan 审批。
6. 主 Agent 先确定每个顶层 Task 的完整执行说明，再从该说明翻译出给人阅读的准确任务说明；最后一个块固定为 Final Test。
7. Task 单独运行或按序全部运行。普通实现 Task 的 Agent Turn 正常完成后直接进入下一 Task；执行异常、取消或命令失败会立即停止。只有 `checkpoint` 和 `final-test` 启动独立审核者。
8. “停止全部运行”在当前 Task 及任何必要审核结算后生效。Final Test 审核一次性检查全部需求、回归、Task 结果和代码证据；通过后系统追加最终验证单元格。
9. 右侧需求图谱仅展示当前 Session，按用户需求、Task、实际记录的文件修改分为三列；点击节点高亮关联路径，点击文件查看历史修改片段，需求和任务可定位 Notebook 单元格。

轮次、澄清、需求文档、图谱、任务列表、Task 执行、“全部运行”、文本/批注、审核和验证都是持久事件。界面只在本地保存选择、折叠、草稿、缩放、图谱开关和临时错误；刷新后从 Session target 与 Session 列表投影重建 Notebook 和当前 Session 图谱。

## 图谱关系与状态

每个节点使用 Session id、`RequirementRoundId` 和文档内需求编号共同标识，因此不同 Session 或不同轮次中的同号需求不会合并。`depends-on` 只连接当前文档内的前置需求；`refines` 与 `supersedes` 只指向同一 Session 中更早轮次的现有节点。系统拒绝未知端点、重复关系、自依赖和依赖环。

节点初始为灰色。映射 Task 开始执行或完成后变为蓝色，并在最终集中审核前保持“进行中”；Final Test 审核通过并追加成功验证后才变为绿色。映射 Task 失败、最终验证失败或确认回归时变为红色。Task 层的“已完成”只表示该 Agent Turn 正常结束，不表示对应需求已经验证。

## 编辑与锁定

- 需求文档在任务执行开始前可以编辑。文档修订后，旧任务列表保持可见且只读，用户需要生成当前修订的任务。
- 任务生成进行期间不能编辑需求文档，防止 Agent 读取的修订与提交结果不一致。
- 任一 Task 开始执行后，需求文档锁定。
- 执行前，普通 Task 可以新增、编辑、重排或撤回；新增非空 Task 会使已完成的 Final Test 回到待执行状态。Final Test 可以编辑，但不能撤回、移动或离开末位。
- 执行中和审核中的 Task 锁定；人类修改已完成 Task 的说明会重写执行任务并重新标记为待执行。当前 Task 与任何必要审核结算且“全部运行”停止时，后续待处理 Task 才能编辑。

## 审核与状态

普通实现 Task 的 Agent Turn 正常结束时写入完成并直接继续；非正常结束写入失败并停止“全部运行”。只有检查点和 Final Test 等待审核。审核者返回 `warning` 时显示警告但允许继续；返回 `blocking`、审核不可用、输出无效或确认历史需求回归时，当前 Task 失败并停止“全部运行”。只有审核证据能够可靠归因时，历史回归才绑定到具体 Task；否则最终验证报告回归但不猜测责任。

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
| 独立审核 | `requirement/review` 只保存检查点和 Final Test 判定；普通实现 Task 由正常 Turn 结束直接完成 |
| Final Test | 任务列表不变量要求唯一、末位且覆盖所有验收标准；审核全部需求、回归与代码证据后追加 `requirement/validation` |
| 持久化与重放 | `requirementNotebook` 从完整日志重建单元格与每次执行结果，`assembly.ts` 转成 Notebook 节点；聊天分页和重连不清空已保存内容；Session invariant 检查修订、引用、关系和状态转换 |

## 界面控件

顶部工具栏保留“命令”“+代码”“+文本”“全部运行”、停止控件和“需求图谱”开关。需求文档块提供编辑、保存、取消和“生成任务”。轮次摘要不可编辑。左侧 Notebook 完全面向人：Task 单元格显示标题、可直接编辑的人类任务说明和状态。完整 Agent 运行说明放在紧接单元格之后的同级折叠区，默认收起，点击小三角打开；执行前可编辑，锁定后只读。Task 继续支持自动保存、运行、上下移动、详情、撤回和 Agent 辅助；输出使用 Markdown 渲染并可独立折叠。Notebook 不显示批注或创建批注入口，历史批注仍保存在 Session 日志中。需求图谱在桌面端占据可关闭的右侧栏，在窄屏下覆盖 Notebook；详情面板继续按需覆盖显示。

底部原生输入框在需求标签页激活时创建新需求轮次；普通“对话”和“轨迹”输入行为不变。Workspace Write、模型选择、推理强度和 Session 指标继续由 DSH 外壳提供。

## 验收与检查

目标路径必须满足：原始输入与澄清可重放；摘要只读；需求文档与图谱可验证和修订；生成任务不依赖 Plan；文档修订会使旧任务和旧当前图谱失效；Task 操作遵守锁定规则；普通 Task 正常完成并等到 Agent 停稳后直接继续，命令/工具错误立即失败，检查点和 Final Test 才审核；新增非空工作会使 Final Test 失效；最终审核前需求节点不显示“已验证”；节点颜色由 Task 与验证事实派生；Final Test 始终处于末位并覆盖全部验收标准；刷新或重开 Session 后 Notebook 与当前 Session 图谱状态一致。

相关行为测试位于 `packages/session/session-requirements/tests/` 和 `packages/client/ui-requirements/tests/`。`loader-composition.spec.ts` 通过 Loader 启动真实 Cordis 配置，并检查持久轮次与模型可见提示词。
