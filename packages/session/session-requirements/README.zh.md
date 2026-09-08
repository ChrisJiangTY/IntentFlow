---
description: "dsh 需求 Notebook 的持久澄清、中文需求文档生成、可执行任务编排和独立审核。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session-requirements

[English](README.md) | 中文

## 概述

`dsh-session-requirements` 在实现开始前，把一条原始产品需求转换成可重放的中文需求文档。主 Agent 只询问影响结果的关键问题，然后生成可编辑文档及其需求图谱；用户明确操作后，再生成一组有序的可执行 Task 块，并用审核后的进度更新图谱。固定处于末尾的 Final Test 负责生成本轮最终验证。

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

请在提供 `agents`、`subagents`、`tools` 和 `userQuestions` 的环境中挂载该插件。配置项包括：已注册的一次性审核提供方、审核提示词字符上限、审核者可使用的确切只读工具、最大澄清批次数和每批最大问题数。Web 组合包允许两批澄清，每批最多 5 个问题。

`startRound` 把原始输入保存在 `requirement/round` 中，并排入一个主 Agent 分析轮次。提示词要求 Agent 在提问前以只读方式检查仓库。某项决定必须由用户作出且会显著改变结果时，Agent 调用 `clarify_requirements`；原始问题和答案保存为持久的 `requirement/clarification` 事件。在配置上限内，Agent 可以继续询问下一批问题。否则，Agent 调用 `submit_requirements_document`，不会进入 Plan 模式，也不会修改文件。

提交的文档必须是中文 Markdown，包含 `# 需求文档`、`## 简介` 和 `## 需求`，后面依次列出连续编号的需求、用户故事与验收标准。`submit_requirements_document` 还会提交当前文档内的真实依赖，以及指向同一 Session 更早轮次的明确细化或替代关系。宿主验证文档、图谱端点和依赖环后，再追加 `requirement/document` 与 `requirement/graph`。浏览器可通过 `editDocument` 追加新的文档修订；有效编辑会重建图谱节点，只保留端点仍存在的关系；无效修订仍然可见，不会发布当前图谱，也不能生成 Task。任务生成期间以及任何 Task 开始执行后，文档都禁止编辑。

`generateTasks` 针对一个确切的有效文档修订排入只读主 Agent 轮次。`submit_requirement_tasks` 至少提交一个实现或检查点块，并单独提交一个 Final Test 块。每个块包含一个顶层阶段的全部子勾选项，使用中文 `_关联需求：…_` 引用真实验收标准，且所有块都是必做项。宿主把 Final Test 固定在末尾，并拒绝未覆盖全部验收标准的列表。

执行开始前，可以新增、编辑、重排或撤回待处理 Task；Final Test 可以编辑，但不能撤回或移动。执行开始后，已完成和正在运行的 Task 保持锁定。只有当前 Task 及其审核结算后，才能修改后续待处理 Task。`runTask` 在主对话中排入一个 Task。`runAll` 在每次审核通过后继续按序执行；`stopRunAll` 会在当前 Task 及其审核结算后停止。

每个完成的 Task 轮次都会进入 `reviewing`。独立审核者必须返回匹配的 Task 标识，以及 `passed`、`warning` 或 `blocking` 判定。`passed` 和 `warning` 允许继续执行；`blocking`、审核失败或确认的历史需求回归会把当前 Task 标记为失败并停止“全部运行”。Final Test 可以修复本轮引入的问题并重新运行检查，但其提示词禁止删除测试、放宽断言或隐藏失败。Final Test 通过后，系统追加最终验证事件。

文本和批注单元格继续使用持久 note 事件。被动 Markdown 使用 `dispatch: false`；明确的 Agent 辅助使用 `dispatch: true`，并在主对话中继续。现有 `commit` Remote 继续提供历史审核模型使用的版本寻址需求记录。

可选的 Session 投影服务会把每个 Session 的图谱、当前 Task 列表和最终验证折叠为客户端可见的 `requirementGraph` 值。重放历史时，投影会从早于图谱事件的有效需求文档中确定性提取节点，并使用空关系列表，因此升级后现有 Notebook 轮次也会立即显示。映射工作完成前节点处于待实现；映射工作正在执行或只有部分验收标准完成时处于进行中；经过审核的非最终 Task 覆盖全部验收标准时处于已验证；映射任务失败或记录回归后处于失败或回归状态。标准 Session 列表投影会为已打开和未打开的 Session 携带该值，因此浏览器可以按 Workspace 合并，而无需读取其他 Session 的日志。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本包注册 3 个模型工具，分别用于澄清、提交文档和提交任务。仅追加的轮次、澄清、文档、图谱、任务列表、任务执行、“全部运行”、note、审核和验证事件让浏览器无需在 React 中保存产品状态，也能重建 Notebook。文档、图谱和任务列表使用明确修订号，因此编辑文档会使旧任务及其当前图谱失效，但不会改写历史。

Task 执行把排入的消息关联到对应 Agent 轮次。轮次完成时先记录输出并启动独立审核者；只有审核结算后，系统才写入 Task 终态并决定是否继续按序执行。内存中的“全部运行”控制器只负责实时续跑和停止请求，所有用户可见的状态转换都持久保存。

审核子 Agent 只能使用第一层委派，并采用明确的只读工具允许列表。插件销毁时会中止活跃子 Agent 并等待其 Promise 结算。只有同一个父 Agent 仍注册在 Session 上时，系统才会提交子 Agent 的完成结果。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-requirements](../../client/ui-requirements/README.zh.md)——浏览器 Notebook 投影与原生输入框路由。
- [user-questions](../../interaction/user-questions/README.zh.md)——交互式澄清请求处理。
- [subagent](../../subagent/subagent/README.zh.md)——一次性审核者执行。
- [session](../../core/session/README.zh.md)——接收 Notebook 事实的持久事件日志。

-----

<a id="model-experience"></a>
## 模型体验

### 需求 Notebook 轮次

#### 模型看到什么

第一个主 Agent 提示词包含原始需求、澄清策略、确切的中文文档结构、当前 Session 的历史图谱索引，以及禁止进入 Plan 模式、修改文件和提前生成任务的要求。Agent 随文档提交依赖及明确的细化或替代关系；没有关系时使用空列表。任务生成提示词包含已接受的文档修订，以及 Task 与 Final Test 的格式要求。Task 提示词只指定一个 Task 及其关联验收标准。审核者收到上一份需求快照、包含图谱事实的当前 Notebook 事件、父轮次证据和只读工作区指令。

#### Token 影响

每个新轮次、任务生成请求、明确运行的 Task 和已派发的辅助 note 都会创建一个普通主 Agent 轮次。澄清答案通过用户问题交互继续当前分析轮次。被动 note 和文档编辑不调用模型。每个完成的 Task 轮次会触发一次辅助审核请求；手动执行 `/requirements` 也会触发一次审核。审核输入受 `maxInputChars` 限制。

#### KV Cache 影响

主提示词遵循正常的提供方缓存规则。文档修订、生成任务和 Session 证据会从第一个变化的 token 起改变后续请求。审核请求也会随累计证据和上一份快照变化。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **澄清次数有明确上限**——达到配置的批次数后，如果仍有关键歧义，本轮会等待用户决定，不会自行猜测。
- **任务生成锁定文档修订**——生成轮次进行期间不能修改文档；请在该轮次结算后重试或编辑。
- **Task 输出有长度上限**——task-execution 事件保存有界的助手最终回复；完整工具记录仍在“轨迹”和 Session 日志中。
- **审核失败会停止执行**——审核结果缺失、无效、不可用或为 `blocking` 时，当前 Task 失败并需要明确重试。
- **图谱关系限定在 Session 内**——文档创作可以引用同一 Session 的更早轮次，浏览器可以按 Workspace 聚合这些图谱；系统不支持跨 Session 关系创作。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

参阅[Workspace 需求知识图谱 Agent Note](../../../.agents/notes/implemented/feature/2026-09-08-workspace-requirement-knowledge-graph.zh.md)。

</details>
