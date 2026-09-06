# 需求执行 Notebook 界面映射

本文档定义第三版 Jupyter 风格界面与 DSH 用户路径的对应关系。DSH 保留侧边栏、Session 顶栏、对话/轨迹/需求标签页和底部原生对话输入框；需求标签页把产品轮次显示为 Notebook。

## 核心交互模型

一次产品轮次从底部输入框提交原始需求开始，到本轮 Task 完成并通过最终验证结束。产品轮次有独立的 `RequirementRoundId`，不把 Agent Turn 当成轮次标识。

1. `startRound` 原样保存用户输入，追加需求 Markdown，并自动打开 Plan 模式。
2. Plan 由 `exit_plan_mode` 持久化；用户批准 Plan 后，`todo_write` 按 Plan 中的顶层编号 `## N.` 阶段生成有序 Task Notebook，同一阶段内的所有 `N.x` 勾选项保留在同一个 Todo。
3. 每个 Task 有稳定 `RequirementTaskId`、顺序、说明、执行状态和有界 Agent 输出，可单独执行或由“全部运行”按序执行；人话阶段标题与包含完整 Plan 大点的缩进正文属于同一个可编辑源，输出在输入单元格边框外以完整 Markdown 格式显示。
4. 左侧单元格运行按钮和底部 DSH 对话输入框都把内容发送到当前 Session 的主对话执行链路；单元格运行发送当前 Task，底部输入框发送新需求、补充反馈或普通消息，二者都不创建独立执行对话。
5. 全部实现 Task 完成后，审核子 Agent 生成最终验证 Notebook；验证同时检查本轮需求和仍有效的历史需求。
6. 下一轮仍从 DSH 底部输入框开始，旧轮次和需求基线保留在 Session 日志中。

用户从需求 Notebook 提交需求后，主对话默认执行以下路径：

```text
用户需求 → 主对话默认进入 Plan → Plan 获批后拆分为 Task 单元格 → Task 执行完成 → 生成验证单元格
```

需求 Markdown、Plan、Task 列表、Task 执行、文本/批注、验证和轮次状态都是持久事件。界面只在本地保存选择、折叠、草稿、缩放和临时错误；刷新后从 Session target 重建 Notebook。

## 审核子 Agent 与红色状态

审核者读取历史审核快照、本轮 Markdown、Plan、Task 列表、Task 执行、文本/批注和只读工作区证据。只有本轮未授权地改变仍有效历史需求时，才产生 `regression`；用户明确的细化、替换、撤回不是回归。能够可靠归因时，验证记录 `taskId`，对应 Task 与验证单元格同时标红；不能归因时只标红验证单元格。Task 执行失败显示 `[!]` 与琥珀色状态，不表示历史回归。

## 实现状态审计

| 路径能力 | 实现与证据 | 状态 |
|---|---|---|
| 原生输入与产品轮次 | `ui-conversation` 读取当前 view，把需求输入路由到 `startRound`；`session-requirements` 追加 `requirement/round` | 满足 |
| Markdown 与自动 Plan | `requirement/markdown` 保存原始输入；`startRound` 调用 `planMode.set(agent, true)` | 满足 |
| Plan 与 Task 拆分 | 捕获 `exit_plan_mode`；审批后捕获 `todo/write`，每个顶层 `## N.` 阶段生成一个 Todo，其首行作为人话标题，后续行保留整个阶段 | 满足 |
| Task Notebook | `RequirementsView` 渲染说明、状态、输出、运行按钮、悬浮工具栏、详情抽屉和回归样式 | 满足 |
| Task 操作 | `runTask`、`runAll`、`addTask`、`editTask`、`moveTask`、`withdrawTask` 均为生成 Remote 并追加持久事件 | 满足 |
| 文本与批注 | `+文本` 和单元格批注通过 `addNote({ dispatch: false })` 持久保存但不执行；星光辅助使用 `dispatch: true` 发送到主对话 | 满足 |
| 最终验证与历史回归 | 每个父 Turn 结束后独立审核；`requirement/validation` 保存结果、失败 Task、回归需求和可选 Task 归因 | 满足 |
| DSH 第三版视觉 | 需求页采用 Figma Notebook 的固定顶部工具栏、轮次标题、单元格、蓝色选中框、右侧状态条和红/琥珀错误状态；底部输入框仍为 DSH 原生组件 | 满足 |
| 持久化与重放 | `assembly.ts` 按事件类型投影所有 Notebook 节点；Session invariant 检查版本、关联和状态转换 | 满足 |

## 第三版功能作用与状态

下表逐项记录第三版 Notebook 草稿中的功能作用和当前实现。`+代码` 与 `+文本` 只能出现在 Notebook 顶部工具栏；轮次标题、单元格之间和底部都不得出现其他添加按钮。工具栏固定在 Notebook 顶部，多轮滚动时仍可操作；右侧不显示独立的中英文切换控件，语言切换保留在“命令”菜单中。新建代码单元格以约 50px 的单行编辑器开始，并随输入内容自动向下增高。

| 功能 | 作用 | 当前第三版状态 |
|---|---|---|
| Notebook 页面 | 展示当前 Session 的需求执行过程 | 已实现 |
| `命令` | 打开审核、折叠、关系图、语言等操作 | 已实现 |
| `+ 代码` | 在最新轮次顶部新增可执行需求单元格 | 已实现，且仅有顶部入口 |
| `+ 文本` | 在最新轮次顶部新增章节标题、说明或 Markdown 注释 | 已实现，且仅有顶部入口；保存为不立即执行的持久 note |
| `全部运行` | 按顺序执行多个需求单元格 | 已实现，遇到失败立即停止 |
| 轮次标题 | 按产品需求轮次分组 | 已实现，如“第 1 轮”“第 2 轮” |
| 折叠箭头 | 展开或收起某一轮的全部单元格 | 已实现 |
| `[ ]` | 已提交、等待 Agent 执行 | 已实现 |
| `[*]` | Agent 已开始执行但尚未获得 Turn 编号 | 已实现 |
| `[n]` | 表示该单元格对应的 Agent Turn | 已实现，如 `[11]` |
| `[!]` | 表示执行失败 | 已实现 |
| 单元格运行按钮 | 将当前需求 Task 发送到主对话中执行，不创建独立执行对话 | 已实现 |
| 单元格编辑器 | 编辑人话任务标题和完整技术说明 | 已实现；约 50px 单行起始高度，随内容自动增高 |
| 单元格输出 | 在输入单元格外展示实现摘要、代码反馈、缺口和关联文件 | 已实现；无边框并保留完整 Markdown 格式，默认展开，左侧箭头可独立折叠 |
| 蓝色边框 | 表示当前选中的需求单元格 | 已实现 |
| 右侧状态条 | 快速表示需求执行和审核状态 | 已实现；等待灰、执行蓝、完成绿、失败琥珀、历史回归红 |
| 上移/下移 | 调整需求的执行顺序 | 已实现 |
| 编辑 | 修改当前需求 | 已实现 |
| 删除/撤回 | 撤回需求，但不删除历史记录 | 已实现于“更多”菜单 |
| 更多菜单 | 查看历史、证据、来源、关系和审核操作 | 已实现 |
| 批注 | 给需求增加持久补充反馈，但不立即执行 | 已实现 |
| Gemini/星光按钮 | 携带当前单元格引用打开主对话，请求 Agent 解释或优化当前需求 | 已实现 |
| 缩放控件 | 调整 Notebook 显示比例 | 已实现 |
| Notebook 滚动 | 浏览完整需求文档 | 已实现，底部原生输入框固定保留 |
| 关系图 | 查看需求与代码之间的关系 | 已实现，从“命令”或“更多”进入按需抽屉 |
| 需求详情 | 查看版本、审核证据、来源、关联文件和缺口 | 已实现为按需抽屉，不常驻占用 Notebook |
| 底部对话输入框 | 将新需求、补充反馈或普通消息发送到当前 Session 的主对话中执行 | 已实现 |
| Workspace Write | 控制当前会话的工作区权限模式 | 已保留 |
| 模型与 High | 选择模型和推理强度 | 已保留 |
| Session 指标 | 展示当前会话的运行状态或消耗信息 | 已保留 |

控件的当前实现语义如下：顶部 `+代码` 创建 Task，顶部 `+文本` 和批注通过 `addNote({ dispatch: false })` 形成不立即执行的持久 Notebook 事件；星光按钮通过 `addNote({ dispatch: true })` 把引用当前 Task 的请求发送到主对话并切回对话视图。左侧单元格运行按钮和“全部运行”都通过主对话执行 Task，底部 DSH 输入框也通过同一主对话处理新需求、补充反馈和普通消息；“全部运行”按序执行并在失败处停止。执行已经排入但还没有 Turn 编号时显示 `[*]`，取得 Turn 编号后显示 `[n]`，执行失败显示 `[!]`；审核确认历史需求回归时使用红色状态。关系图和详情从命令或更多菜单进入，不占用 Notebook 常驻区域。

## 验收与检查

目标路径必须满足：原始需求可重放；Markdown、Plan、Task、执行和验证顺序可见；Task 操作独立持久化；下一轮审核能区分授权变化和意外回归；回归与执行失败颜色不混淆；刷新或重开 Session 后 Notebook 状态一致。相关行为测试位于 `packages/session/session-requirements/tests/session-requirements.spec.ts`、`packages/client/ui-requirements/tests/requirements-view.client.spec.tsx`、`packages/client/ui-requirements/tests/assembly.client.spec.ts` 和 `packages/client/ui-conversation/tests/skeleton.client.spec.tsx`。

实现决策：Plan 继续使用 DSH 已有的显式批准点；“全部运行”按序执行并在失败处停止；Task 保存有界 Agent 最终输出，完整工具证据留在轨迹和 Session 日志；文本/批注持久但默认不派发，只有明确的星光辅助操作才发送到主对话；只有审核证据能支持归因时才把回归绑定到 Task。
