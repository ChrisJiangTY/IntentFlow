---
description: "dsh Web 对话中需求澄清、可编辑中文需求文档、可执行 Task 块和独立验证的 Notebook 呈现。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-requirements

[English](README.md) | 中文

## 概述

`dsh-client-ui-requirements` 在“对话”和“轨迹”旁注册“需求”标签页。它把每条原始需求显示为带简短摘要的产品轮次，其中包含折叠的澄清记录、可编辑中文需求文档、可执行 Task 块、逐 Task 审核和最终验证。可折叠的右侧栏把当前 Workspace 的全部需求轮次合并为一张知识图谱。

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

在“需求”标签页激活时，通过 DSH 底部输入框提交新需求。输入框把原始文本路由到 `sessionRequirements.startRound`。轮次标题随后显示 Agent 生成的只读摘要。原始输入以及每个澄清问题和回答保留在默认折叠的澄清记录中。

歧义解决后，Notebook 使用 Markdown 渲染完整需求文档。“编辑”会在原位置打开源文本，并提供明确的“保存”和“取消”控件。保存会创建新的文档修订；无效修订显示验证问题并禁用“生成任务”。如果已有 Task 来自更早的文档修订，保存后会隐藏这些 Task。任务生成期间以及 Task 执行开始后，文档不能修改。

“生成任务”是需求文档块的执行操作。它要求主 Agent 检查仓库，并从确切文档修订生成有序的顶层 Task 块。“需求”视图不包含 Plan 卡片或 Plan 审批操作。每个生成的 Task 把所有子勾选项保留在对应顶层块内，并显示中文需求引用。所有 Task 都是必做项；Final Test 始终是最后一个块。

执行前，用户可以新增、编辑、移动或撤回普通待处理 Task。Final Test 保持可编辑，但不能移动或撤回。一个 Task 开始后，已完成、执行中和审核中的单元格会锁定。当前 Task 与审核结算并停止“全部运行”后，后续待处理 Task 才能编辑。

“全部运行”一次只执行一个 Task，并等待其独立审核。审核通过或警告时继续下一个 Task；审核阻塞或失败时停止。按序执行期间始终显示“停止全部运行”，该操作会在当前 Task 及其审核结算后生效。只有此前所有 Task 都已完成时，Final Test 才能运行；它通过自身审核后生成最终验证。

状态允许时，选中的 Task 继续提供运行、移动、批注、编辑、详情、撤回和 Agent 辅助操作。Agent 输出在输入单元格下方使用 Markdown 渲染，并可独立折叠。被动文本备注和批注继续作为可重放的 Notebook 事件。缩放控件位于 Notebook 画布底部。需求图谱会常驻 Notebook 右侧，直到用户关闭；窄屏下则显示为覆盖式抽屉。

图谱以当前 Workspace 的有序 `sessionIds` 作为成员来源，并按 Session、轮次和需求编号保留每个节点。早于图谱事件的历史文档会贡献确定性重建的节点，但不会臆造关系。灰色表示映射的实现工作尚未完成，蓝色表示映射工作正在执行或部分完成，绿色表示全部验收标准已有完成且通过独立审核的 Task，红色表示映射 Task 失败，或验证记录了失败或回归。点击当前 Session 的节点会定位到映射 Task 或需求文档；点击其他 Session 的节点会先打开该 Session，然后可再次点击同一节点定位单元格。

Task 执行失败使用 `[!]` 和琥珀色状态。审核警告使用独立的警告样式，但不会阻止按序执行。只有审核者记录确认的意外回归证据时才使用红色；只有审核者能够提供依据时才显示 Task 归因。

Notebook 投影消费仅追加的 `requirement/round`、`requirement/clarification`、`requirement/document`、`requirement/task-list`、`requirement/task-execution`、`requirement/run-all`、`requirement/note`、`requirement/review` 和 `requirement/validation` 事件，以及用户版本和执行事件。图谱读取 Session 列表已经携带的宿主计算 `requirementGraph` 值，因此实时 Session 和未打开 Session 都可参与聚合。React 状态只保存选择、折叠、草稿、缩放、图谱开关和临时操作状态。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本包贡献 target 专属 Event Definition、仅追加快照 builder、Session selector hook、`conversation.view` 注册和提供给 `ui-conversation` 的输入框路由。原生 DSH 输入框仍是发起新产品轮次的唯一入口。Notebook 变更调用生成的 `sessionRequirements` Remote，因此文档修订、Task 顺序、编辑、撤回、note、执行和“全部运行”状态都能作为 Session 事实重放。

该视图为每个轮次、文档、Task 列表、Task 执行、审核、“全部运行”请求和 note 选择最新事件修订。只有 Task 列表的 `documentRevision` 与当前文档修订相同时才会渲染。Workspace 聚合不会在 React 中读取其他 Session 日志，而是合并 Session 摘要中的图谱投影并按 Workspace 成员关系过滤。产品文案属于类型化的 `requirements` locale namespace；审核者生成的双语内容来自持久审核和验证事件。

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

- **未确认的编辑仅存在当前标签页**——关闭标签页可能丢失待处理或失败的自动保存、尚未保存的文档编辑或未提交的批注。
- **Task 输出有长度上限**——每个 Task 保存有界的 Agent 最终回复；详细工具证据仍在“轨迹”和 Session 日志中。
- **Task 归因依赖审核证据**——只有证据支持时审核者才把回归归因到 Task；否则最终验证报告回归但不会猜测责任。
- **关系限定在单个 Session 内**——创作 Agent 可以关联自身 Notebook 历史中的轮次；Workspace 视图会合并多个 Session，但不会推断不同 Session 之间的依赖。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

参阅[Workspace 需求知识图谱 Agent Note](../../../.agents/notes/implemented/feature/2026-09-08-workspace-requirement-knowledge-graph.zh.md)。

</details>
