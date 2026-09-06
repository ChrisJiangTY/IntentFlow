---
description: "面向 dsh 会话的需求 Notebook 持久化编排与历史需求回归独立验证。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session-requirements

[English](README.md) | 中文

## 概述

`dsh-session-requirements` 负责“需求”Notebook 背后的产品轮次协议。它把原始请求记录为 Markdown、进入 Plan 模式、捕获 Plan、把 Todo 投影为稳定的 Task 单元格、记录 Task 执行和批注，并追加最终验证。独立审核者把当前轮次与仍有效的历史需求比较，并把回归证据与主 Agent 的声明分开保存。

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

把插件挂载在可用 `agents`、`subagents` 以及可选 `commands` 的环境中。配置一个已注册的一次性子 Agent provider、提示词字符上限，以及允许审核者使用的确切只读工具名。Web bundle 使用 `spawn` provider 和 `read`、`glob`、`grep`。

生成的 `startRound`、`runTask`、`runAll`、`addTask`、`editTask`、`moveTask`、`withdrawTask` 和 `addNote` Remote 都作用于实时 Agent 的 Session。`startRound` 保留原始输入、追加轮次和 Markdown 事件、开启 Plan 模式并排入一条规划消息。Plan 获得批准后，每个顶层编号 `## N.` 阶段先变成一个 Todo，再变成有序 Task 列表中的一项；该阶段内的 `N.1`、`N.2` 等勾选项始终位于同一个 Task。Todo 第一行提供不依赖技术背景也能看懂的阶段结果；后续各行把完整阶段标题、checkbox 状态、文件、命令、配置、依赖、实现步骤和验证条件保存在 Task 说明中。Task 运行追加提交、处理和终态执行事件；“全部运行”在一个轮次完成后排入下一个待处理 Task，遇到失败即停止。

文本和批注单元格是持久化的 note 事件。被动 Markdown 备注使用 `dispatch: false`，保留原文空白字符，允许为空。`editNote` 在相同轮次和备注标识下追加替换原文；先前事件保持不变，浏览器显示最新版本。创建和编辑均不创建 Agent Turn。批注内容必须非空；明确的 Agent 辅助操作使用 `dispatch: true`，并在主对话中继续。批注和已派发备注不可编辑。Task 可以在执行前编辑、重排或撤回；每次变更都追加一个替换 Task 列表，同时保留此前的日志历史。撤回的 Task 仍然可见，但会被“全部运行”排除。

`addTask` 和 `editTask` 接受空标题或空说明，用于保存尚未写完的单元格，并把它们持久化为待处理 Task。`runTask` 要求至少一个文本字段非空。“全部运行”跳过空草稿；其他 Task 结束后，空草稿不会让本轮继续停留在执行状态。Task 编辑不会派发 Agent 消息；[浏览器编辑器](../../client/ui-requirements/README.zh.md#use-this-package)负责自动保存，并在运行前等待保存完成。

每个父 Agent `turn/end` 之后，配置的独立审核者都会收到当前 Notebook 工件、历史审核快照、用户消息和有界的只读工作区访问。审核完成后追加验证事件。只有确认仍有效的历史需求被意外破坏时才记录回归；只有证据支持时才携带责任 Task；Task 失败或证据不足本身不会被视为回归。

已有的 `commit` Remote 继续提供版本寻址的需求记录，并兼容原有需求审核数据模型。需求 Notebook 的原生 DSH 输入框路径使用产品轮次协议。

-----

<a id="understand-the-implementation"></a>
## 理解实现

本包在 Session 事件词汇中定义轮次、Markdown、Plan、Task 列表、Task 执行、批注和验证的持久化数据。`SessionRequirements` 按 Session 串行执行独立审核，并且只追加不可变事件。流程跟踪把 Plan 模式、Todo、消息和轮次事件连接到当前产品轮次，不把 Agent Turn 当成产品轮次标识。

审核子 Agent 仅允许位于第一层委派深度，并使用明确的只读工具允许列表。插件销毁时会中止活跃子 Agent 并等待 Promise 收敛；只有同一个父 Agent 仍注册在 Session 上时，子 Agent 的完成结果才会写入。

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-requirements](../../client/ui-requirements/README.zh.md)——浏览器 Notebook 投影与原生输入框路由。
- [subagent](../../subagent/subagent/README.zh.md)——一次性子 Agent 执行 seam。
- [session](../../core/session/README.zh.md)——接收 Notebook 事实的持久事件日志。

-----

<a id="model-experience"></a>
## 模型体验

### 需求 Notebook 轮次

#### 模型看到什么

规划消息包含原始用户请求、Markdown 整理、自动进入 Plan 模式的指令、“每个顶层阶段生成一个 Todo”的格式要求，以及保留历史需求的规则。Task 消息只命名一个阶段级 Task，并包含对应 Plan 大点的完整内容。派发的辅助 note 标明对应 Task 和轮次；被动文本和批注 note 留在 Notebook 中，不进入模型输入。审核者收到上一份完整需求快照、当前 Notebook 事件、父轮次证据，并被要求检查工作区后再断言验证或回归。

#### Token 影响

每个新轮次、明确运行的 Task 和派发的辅助 note 都会创建一条普通主 Agent 轮次；被动 note 不会。“全部运行”按序列化方式执行 Task 轮次。每个父轮次完成后触发一次辅助审核者请求，显式执行 `/requirements` 也会触发审核。审核输入受 `maxInputChars` 限制。

#### KV Cache 影响

主 Agent prompt 遵循正常 provider 缓存规则。辅助输入会随 Session 证据和上一份快照变化，因此审核请求从第一个变化的 token 起无法复用。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **Task 输出有长度上限**——task-execution 事件保存有界的助手最终回复；完整工具记录仍在 Session 日志中。
- **验证依赖证据**——审核者只能把未确认或无法归因的问题写入审核文本；红色回归状态必须由明确的 regression 对象触发。
- **Plan 审批仍是显式检查点**——Task 执行等待现有 Plan 模式的审批事件，但 Task 和批注 Remote 仍会独立验证实时 Session 引用。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

参阅[需求 Notebook 流程 Agent Note](../../../.agents/notes/implemented/feature/2026-09-02-requirement-notebook-pipeline.zh.md)。

</details>
