---
description: "dsh Web 对话中需求澄清、可编辑中文需求文档、可执行 Task 块和独立验证的 Notebook 呈现。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-requirements

[English](README.md) | 中文

## 概述

`dsh-client-ui-requirements` 在“对话”和“轨迹”旁注册“需求”标签页。它把每条原始需求显示为带简短摘要的产品轮次，其中包含折叠的澄清记录、可编辑中文需求文档、可执行 Task 块、检查点审核和最终验证。它的 `dsh-better-sidebar` 标签页把当前 Session 的用户需求、Task 与已记录的文件修改串联起来。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

点击交付结果中以行内代码显示的 `.html` 或 `.htm` 文件名，可在右侧栏预览网页。相对路径按当前 Session 的工作目录解析，绝对路径保留原位置。文件缺失时查看器显示错误，查看器或工作目录不可用时 Notebook 显示提示。

在“需求”标签页激活时，通过 DSH 底部输入框提交新需求。输入框把原始文本路由到 `sessionRequirements.startRound`。轮次标题随后显示 Agent 生成的只读摘要。原始输入以及每个澄清问题和回答保留在默认折叠的澄清记录中。

歧义解决后，Notebook 使用 Markdown 渲染完整需求文档。“编辑”会在原位置打开源文本，并提供明确的“保存”和“取消”控件。保存会创建新的文档修订；无效修订显示验证问题并禁用“生成任务”。来自更早文档修订的 Task 保持可见且只读。任务生成期间以及 Task 执行开始后，文档不能修改。

“生成任务”是需求文档块的执行操作。它要求主 Agent 检查仓库，先从确切文档修订生成有序的顶层技术 Task，再把每个已经确定的 Agent Task 翻译成简洁的人类任务说明。“需求”视图不包含 Plan 卡片或 Plan 审批操作。所有 Task 都是必做项；Final Test 始终是最后一个块。

左侧 Notebook 显示 Task 标题、可直接编辑的人类说明和状态。完整执行说明位于单元格外，默认折叠。离开人类说明编辑区或运行任务时，系统保存最新输入并重写执行说明。保存中显示“正在更新任务”，失败保留草稿并阻止执行。人类编辑已完成 Task 会将其重新标记为待执行；编辑或新增非空工作也会让已完成的 Final Test 回到待执行状态。Final Test 不能移动或撤回。

“全部运行”一次只执行一个 Task，活动期间禁止单独启动其他 Task。普通实现 Task 的 Agent Turn 正常完成且 Agent 停稳后直接继续；Turn 非正常结束和取消会停止序列。单次工具错误仍可在 Turn 内恢复；长时间运行的 Task 接受[任务健康检查](../../session/session-requirements/README.zh.md#use-this-package)。检查点等待独立审核；审核通过或警告时继续，审核阻塞或失败时停止。按序执行期间始终显示“停止全部运行”，该操作会在当前 Task 及任何必要审核结算后生效。只有此前所有 Task 都已完成时，Final Test 才能运行；随后由一个综合审核者检查全部需求、回归、Task 结果和代码证据，再生成最终验证。

状态允许时，选中的 Task 提供运行、移动、详情、撤回和辅助操作。运行说明下方的可折叠结果区仅显示“交付结果”并保留链接。右侧栏浏览器 tab 可用时，普通点击外部 HTTP 或 HTTPS 交付链接会在其中打开当前 Session 的页面；否则链接保留浏览器原生行为。带修饰键的点击始终保留原生行为。任务状态标记继续显示；说明、审核摘要和执行详情不进入结果展示。历史 Markdown 仅提取可识别的交付章节；非结构化输出保留在详情和轨迹中，不编造交付结果。Notebook 显示文本备注，但隐藏批注及其创建入口；已保存的批注保留在 Session 日志中。

“需求图谱”是当前 Session 的默认右侧栏标签页；准备图谱不会展开已关闭的右侧栏，明确打开文件或浏览器时仍可正常获得焦点。标签页关闭后可从 `+` 菜单恢复。画布左上角的圆形图标按钮可以切换同一份文档 → 具体需求 → Task → 修改文件数据的两种确定性呈现：“分层 · 曲线”是默认的固定四平面视图，采用少量有序行、清晰的节点尺寸和蓝色曲线；“径向 · 同心环”把四类节点从圆心映射到三个外环。

切换布局会保留展开状态、搜索、轮次筛选、选中节点、缩放和详情区比例。几何变化后，系统会把已选节点带回可见区域；没有选中节点时则回到画布原点。带数字编号的圆环节点使用 Figma 素材；悬停显示标题，选择后在下方显示详情。

默认仅显示文档节点。各节点的 `+`/`−` 独立展开或收起下一层，只要仍有其他已展开父节点可达，共享节点就会保留。首行的搜索和轮次筛选靠左，“全部展开”靠右，并显示当前轮次筛选范围内的全部节点，包括未关联需求的 Task。图谱控制行把 28px 布局切换按钮放在左侧，缩放放在右侧。图标表示当前视图，悬停提示说明当前视图及下一视图。搜索包含折叠节点，并展开结果的全部祖先路径。数字按 Session 内各层完整节点顺序编号，不受折叠与筛选影响。实时更新保留展开选择。

每种布局随侧栏宽度等比缩放；垂直溢出时可滚动查看，手动缩放仍可用。密集的圆环或行会缩小节点，可通过搜索和收起分支聚焦相关节点。右侧栏负责横向调宽。独立滚动的详情区默认预留 30% 的内容高度。横向分隔线支持鼠标拖动和方向键、Home、End，在 15–60% 之间调节。选择节点保留调节后的比例；内容始终显示，仅保留靠右的紧凑“定位 Notebook”按钮。代码路径可打开侧栏文件查看器，文件的 Notebook 定位指向其首个已记录的所属 Task。

验收标准引用连接需求与 Task，执行 Turn 标识连接 Task 与成功记录的文件修改。选择节点高亮有向祖先与后代；详情中的明确操作可定位 Notebook 文档、需求标题或 Task，也可在侧栏标签页打开代码文件。文件详情保留历史修改前后片段。映射 Task 全部完成时，“进行中”需求显示为“待终验”，不会显示“已验证”；只有最终验证成功后才验证需求。搜索可定位未关联 Task，但不会凭空添加需求连线。

Task 运行时，运行按钮替换为停止按钮。停止操作取消该任务的排队消息、执行或必要审核，并阻止“全部运行”继续推进。取消结算后，失败状态的 Task 可再次运行。取消不会撤销文件修改。

Task 执行失败使用 `[!]` 和琥珀色状态。检查点或 Final Test 的审核警告使用独立的警告样式，但不会阻止按序执行。只有审核者记录确认的意外回归证据时才使用红色；只有审核者能够提供依据时才显示 Task 归因。

Notebook 投影消费仅追加的 `requirement/round`、`requirement/clarification`、`requirement/document`、`requirement/task-list`、`requirement/task-execution`、`requirement/run-all`、`requirement/note`、`requirement/review` 和 `requirement/validation` 事件，以及用户版本和执行事件。图谱仅读取当前 Session 行中的 `requirementGraph` 与 `requirementChanges` 投影，并与完整 Notebook 关联。图谱交互状态只存在当前标签页；持久图谱数据仅来自当前 Session 投影。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本包贡献 target 专属 Event Definition、仅追加快照 builder、Session selector hook、`conversation.view` 注册和提供给 `ui-conversation` 的输入框路由。原生 DSH 输入框仍是发起新产品轮次的唯一入口。Notebook 变更调用生成的 `sessionRequirements` Remote，因此文档修订、Task 顺序、编辑、撤回、note、执行和“全部运行”状态都能作为 Session 事实重放。

Notebook 通过 Session 投影订阅读取宿主完整的 `requirementNotebook` 投影。聊天分页、刷新和流重连不会移除已保存的单元格。每个文档修订保留对应任务列表，每次执行保留交付结果，修改后的任务重新执行时也会保留此前结果。当前任务遵守正常编辑锁定规则；旧文档任务保持只读。本包通过注入的 `betterSidebar` 服务注册一个图谱描述符。Session 变为活动状态时，适配器使用该 Session scope 执行仅指定类型的打开；它会准备图谱而不展开右侧栏，也不会因同一 Session 的状态变化重复打开。Session 变化会替换图谱数据源并重置标签页本地交互状态。apply 层关联当前文档的 Task 与执行记录而不读取其他 Session 日志，把含代码片段的图谱保留在内存中，并仅在当前图谱变化时把修订标记写入标签页元数据。产品文案属于类型化的 `requirements` locale namespace。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [session-requirements](../../session/session-requirements/README.zh.md)——宿主澄清、文档、Task 和审核编排。
- [ui-conversation](../ui-conversation/README.zh.md)——DSH 外壳、原生输入框和视图路由。
- [ui-trajectory](../ui-trajectory/README.zh.md)——详细执行证据。

-----

<a id="model-experience"></a>
## 模型体验

无，因为这个浏览器包只调用宿主所有的 Remote，并且所有由此产生的分析、任务生成、Task、派发辅助和审核者模型请求都由 `session-requirements` 负责。

#### KV Cache 影响

宿主所有的提示词遵循正常的提供方缓存规则。本地选择、折叠、草稿、缩放和视图切换不影响模型缓存。保存文档不会调用模型；“生成任务”会针对该修订创建新的主 Agent 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **未确认的编辑仅存在当前标签页**——关闭标签页可能丢失待处理或失败的自动保存或尚未保存的文档编辑。
- **Task 输出有长度上限**——每个 Task 保存有界的 Agent 最终回复；详细工具证据仍在“轨迹”和 Session 日志中。
- **Task 归因依赖审核证据**——只有证据支持时审核者才把回归归因到 Task；否则最终验证报告回归但不会猜测责任。
- **关系限定在单个 Session 内**——创作 Agent 可以关联自身 Notebook 历史中的轮次；Workspace 视图会合并多个 Session，但不会推断不同 Session 之间的依赖。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

参阅[集中需求审核 Agent Note](../../../.agents/notes/implemented/feature/2026-09-16-batched-requirement-review.zh.md)、[渐进式图谱 Agent Note](../../../.agents/notes/implemented/feature/2026-09-17-progressive-requirement-graph.zh.md)、[可切换图谱布局 Agent Note](../../../.agents/notes/implemented/feature/2026-09-18-switchable-requirement-graph-layouts.zh.md)和[Workspace 需求知识图谱 Agent Note](../../../.agents/notes/implemented/feature/2026-09-08-workspace-requirement-knowledge-graph.zh.md)。

</details>
