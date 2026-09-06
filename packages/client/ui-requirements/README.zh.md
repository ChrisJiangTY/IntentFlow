---
description: "dsh Web 对话中需求轮次、计划、任务执行与独立验证的 Notebook 呈现。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-requirements

[English](README.md) | 中文

## 概述

`dsh-client-ui-requirements` 在“对话”和“轨迹”旁注册“需求”标签页。它保留 DSH 侧边栏、Session 顶栏、标签页和原生底部输入框，并把每个需求轮次呈现为包含需求 Markdown、Plan、可执行 Task、文本或批注和最终验证的 Notebook。

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

在“需求”标签页激活时，从 DSH 底部输入框提交新需求。输入框会把原始文本路由到 `sessionRequirements.startRound`；宿主记录产品轮次和 Markdown 工件、开启 Plan 模式并排入规划消息。原始输入保留为轮次来源，不会被推断出的标题替换。

Notebook 按顺序展示所有轮次。每轮包含需求 Markdown、捕获的 Plan、由 Todo 生成的 Task 单元格、持久化文本或批注以及最终验证单元格。固定在顶部的工具栏是插入代码 Task 和文本单元格的唯一位置，因此 Notebook 滚动经过多个轮次时仍能使用这些操作。工具栏提供命令、审核和按序“全部运行”；语言切换保留在“命令”菜单中，不在右侧单独占用控件。新代码 Task 编辑器从紧凑单行开始，并随内容向下增高。每个自动生成的 Task 对应一个顶层编号 Plan 阶段，而不是其中一个子勾选项；单元格小标依次使用 `TASK1`、`TASK2`。Task 先用人话标题说明整个阶段完成后会得到什么，再在缩进正文中完整保留阶段标题、所有子勾选项、技术细节、实现步骤和验证条件。标题与正文组成带边框输入单元格中的同一个可编辑源；Agent 回复紧接在下方，以无边框 Markdown 输出完整保留标题、段落、列表、表格、行内代码和围栏代码。每个输出默认展开，左侧箭头可独立收起或恢复该答案。选中的 Task 提供运行、上下移动、批注、编辑、详情、撤回和 Agent 辅助操作；缩放控件位于 Notebook 画布底部。

插入代码会在本轮 Task 列表末尾创建一个持久化空 Task，并聚焦其编辑器。新建和已有 Task 都随输入自动保存，不显示保存或取消按钮。同一 Task 的保存请求按序处理，保存期间的新输入会被保留。左侧运行按钮和“全部运行”都先等待最新编辑持久化，再开始执行；保存失败时保留输入并阻止执行，直到重试成功。只写一行标题也可以运行；完全空白的单元格不可运行，“全部运行”会跳过它。

插入文本会创建不带运行按钮的被动 Markdown 备注。备注复用 DSH 的 `MarkdownText` 渲染器显示标题、列表、表格和代码块。“编辑”切换到 Markdown 原文；“预览”或离开编辑器后恢复排版结果。编辑按序自动保存，保留空白字符，不显示保存或取消按钮。保存失败时保留原文并提供重试。重新打开 Session 后，同一备注标识显示最新保存的原文。显式插入批注仍保留保存、取消按钮；已派发的 Agent 辅助批注不可编辑。

Task 执行失败使用 `[!]` 和琥珀色 Task 状态。审核者确认仍有效的历史需求被意外破坏时，如果能够归因到具体 Task，就把该 Task 标红；无法归因时只把验证单元格标红。用户明确授权的细化、替换和撤回属于正常需求生命周期变化，不渲染为回归。

该投影消费只追加的 `requirement/round`、`requirement/markdown`、`requirement/plan`、`requirement/task-list`、`requirement/task-execution`、`requirement/note` 和 `requirement/validation` 事件，以及已有的审核、用户版本和执行事件。React 状态只保存选择、折叠、草稿、缩放和临时操作状态；持久 Notebook 内容从 Session target 重建。

-----

<a id="understand-the-implementation"></a>
## 理解实现

本包贡献 target 专属 Event Definition、只追加快照 builder、Session selector hook、`conversation.view` 注册和提供给 `ui-conversation` 的输入框路由。原生 DSH 输入框仍是发起产品轮次的唯一入口。Notebook 变更调用生成的 `sessionRequirements` Remote，因此 Task 顺序、Task 编辑、撤回、批注和执行都能作为 Session 事实重放。

视图不替换底部输入框，也不保留固定右侧检查器。选中单元格后按需打开详情。产品文案由类型化的 `requirements` locale namespace 持有；审核者生成的双语内容来自持久的审核与验证事件。

-----

<a id="further-exploration"></a>
## 进一步探索

- [session-requirements](../../session/session-requirements/README.zh.md)——宿主编排与持久 Notebook 事件词汇。
- [ui-conversation](../ui-conversation/README.zh.md)——DSH 外壳、原生输入框和视图路由。
- [ui-trajectory](../ui-trajectory/README.zh.md)——相邻活动记录表。

-----

<a id="model-experience"></a>
## 模型体验

无，因为这个浏览器侧 package 只调用宿主所有的 Remote；所有由此产生的规划、Task、派发辅助和审核者模型请求都由 `session-requirements` 负责。

#### KV Cache 影响

宿主所有的轮次、Task 和明确派发的辅助 prompt 遵循正常 provider 缓存规则；被动 note、本地选择、折叠、缩放和视图切换不影响模型缓存。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **Task 输出有长度上限**——每个 Task 保存有界的 Agent 最终回复；详细工具证据仍在“轨迹”和 Session 日志中。
- **Task 归因依赖审核证据**——只有证据支持时审核者才把回归归因到 Task；否则验证会报告回归但不会猜测责任。
- **未确认的编辑仅存在当前标签页**——关闭标签页可能丢失尚未完成或失败的自动保存内容及未提交的批注；已确认保存的 Task 和 Markdown 备注编辑从 Session 日志重建。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

参阅[需求 Notebook 流程 Agent Note](../../../.agents/notes/implemented/feature/2026-09-02-requirement-notebook-pipeline.zh.md)。

</details>
