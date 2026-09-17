---
description: "dsh 需求 Notebook 的持久澄清、中文需求文档生成、可执行任务编排和独立审核。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session-requirements

[English](README.md) | 中文

## 概述

`dsh-session-requirements` 在实现开始前，把一条原始产品需求转换成可重放的中文需求文档。主 Agent 只询问影响结果的关键问题，然后生成可编辑文档及其需求图谱；用户明确操作后，再生成一组有序的可执行 Task 块，并用执行进度更新图谱。固定处于末尾的 Final Test 接受一次综合审核，并生成本轮最终验证。

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

`generateTasks` 针对有效文档修订排入只读主 Agent 轮次。`submit_requirement_tasks` 先校验完整技术任务，再由独立且无工具权限的子 Agent 翻译标题与人类说明。翻译必须原样返回执行说明。生成的摘要使用中文，最多两句、120字，并机械检查命令和步骤统计等内容；语义忠实度仍由模型负责。

人类通过 `editTask` 编辑说明时，系统重写完整执行任务并原样保留用户说明。持久字段 `humanInstruction` 在执行和审核中优先于冲突的旧生成需求。保存成功或新增非空 Task 后，已完成的 Final Test 回到待执行状态，旧验证不再作为当前证据。不同 Task 的并发编辑合并到最新列表；被编辑 Task 或源文档发生变化时拒绝陈旧改写。保存失败不改变持久任务。编辑 Agent 技术文本会重新翻译摘要。运行中、审核中和已撤回的 Task 保持锁定。

“全部运行”启动和续跑时都按列表顺序选择第一个非空的待执行或失败 Task，跳过已完成和已撤回 Task。普通实现 Task 正常完成后不启动审核者，直接进入下一个 Task；检查点只有在审核通过后才继续。重新点击“全部运行”会在 Final Test 前包含所有此前失败的 Task。“停止全部运行”在当前 Task 及任何必要的检查点或 Final Test 审核结算后生效。

停止单个 Task 会移除其排队消息或取消其活动 Turn，同时保留无关排队输入。审核期间会中断该任务的审核者并拒绝迟到结果。Task 结算为失败且可重试；此次停止后“全部运行”不能继续推进。已有文件修改仍保留在磁盘上。

普通实现 Task 的 Agent 轮次正常结束时直接标记为已完成。Turn 非正常结束（包括错误或取消）会把 Task 标记为失败并停止“全部运行”。单次工具错误和命令失败仍交给 Agent 恢复处理，不会取消 Task。只有检查点和 Final Test Task 进入 `reviewing`；其独立审核者必须返回匹配的 Task 标识，以及 `passed`、`warning` 或 `blocking` 判定。`passed` 和 `warning` 允许继续执行；`blocking`、审核失败或确认的历史需求回归会把当前 Task 标记为失败并停止“全部运行”。Final Test 可以修复本轮引入的问题并重新运行检查，但其提示词禁止删除测试、放宽断言或隐藏失败。它的审核者会一次性检查全部活跃需求、回归、Task 结果和工作区代码证据。Final Test 通过后，系统追加最终验证事件。

每次 Task 执行达到 `taskHealthCheckAfterMs` 后启动一次独立只读健康检查，默认一小时。诊断期间 Task 继续运行。带有原因和具体证据的 `stop` 判定会将同一次活动执行标记为失败、停止“全部运行”并取消其 Turn，同时保留无关排队输入。`continue` 判定、子 Agent 不可用、判定无效或诊断超时都让执行继续。`taskHealthCheckTimeoutMs` 默认五分钟，只限制诊断子 Agent。Task 结算或销毁时中止诊断，并拒绝迟到判定。

文本和批注单元格继续使用持久 note 事件。被动 Markdown 使用 `dispatch: false`；明确的 Agent 辅助使用 `dispatch: true`，并在主对话中继续。现有 `commit` Remote 继续提供历史审核模型使用的版本寻址需求记录。

`requirementNotebook` Session 投影会从完整日志重建已保存的单元格。它保留文档修订、每个修订的最新任务列表以及每次执行的输出；无关的对话消息不会影响它。已有 Session 会从记录的事件重建该值。浏览器独立于聊天历史分页读取该投影，并通过按序列号更新投影，防止重连时过期的基线覆盖较新的已保存内容。

可选的 Session 投影服务会把每个 Session 的图谱、当前 Task 列表和最终验证折叠为客户端可见的 `requirementGraph` 值。重放历史时，投影会从早于图谱事件的有效需求文档中确定性提取节点，并使用空关系列表，因此升级后现有 Notebook 轮次也会立即显示。映射工作开始前节点处于待实现；映射工作开始或完成后处于进行中；只有综合 Final Test 审核追加成功验证后才处于已验证；映射任务失败或记录回归后处于失败或回归状态。已完成的 Task 节点使用单独的“已完成”标签，不表示需求已经验证。标准 Session 列表投影携带该值，需求图谱界面仅选择当前 Session。`requirementChanges` 投影按调用标识与 Turn 关联成功的修改结果，保留已应用片段，排除读取、失败调用和无变化 diff。它支持 `write`、`edit` 与修改型 `str_replace_editor`，不会推断没有记录的 Shell 或委派修改。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本包注册 3 个模型工具，分别用于澄清、提交文档和提交任务。仅追加的轮次、澄清、文档、图谱、任务列表、任务执行、“全部运行”、note、审核和验证事件让浏览器无需在 React 中保存产品状态，也能重建 Notebook。文档、图谱和任务列表使用明确修订号，因此编辑文档会使旧任务及其当前图谱失效，但不会改写历史。

收件箱领取排队消息时，Task 执行就在模型输入组装前绑定到对应 Agent Turn，因此步骤前失败和取消仍能结算到确切 Task。最终回复仅包含交付结果和说明，包括限制或失败情况。轮次完成时记录最后一条非空助手回复，不拼接进度消息。普通实现轮次正常结束后，“全部运行”等待整个 Agent 停稳，再排入下一个 Task；检查点和 Final Test 轮次启动独立审核者，由审核结算决定是否继续按序执行。内存中的“全部运行”控制器只负责实时续跑和停止请求；所有用户可见的状态转换都持久保存。

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

第一个主 Agent 提示词包含原始需求、澄清策略、文档结构和历史图谱索引。任务生成提交完整执行说明。翻译子 Agent 读取确切说明，改写子 Agent 额外读取人类最新指令。执行和审核读取持久的人类指令，并优先遵守它而非冲突的旧需求。子 Agent 提示词和结果可从其 Session 日志重建。

#### Token 影响

每次生成调用一个主 Agent 轮次，并为每个 Task 调用一个无工具权限的子 Agent。人类编辑或非空的 Agent 技术编辑通过 `reviewerProvider` 调用一个子 Agent，但不执行任务。转换与验收子 Agent 共享串行审核调度、取消和销毁机制。完整转换提示词必须符合 `maxInputChars`，超限报错且不截断。验收审核调用仅限明确的检查点和固定的 Final Test。长时间运行的 Task 会额外使用相同提供方和只读工具允许列表启动一次并发健康检查子 Agent；其提示词包含 Task 详情与近期 Turn 证据，总长度由 `maxInputChars` 限制。

#### KV Cache 影响

主提示词遵循正常的提供方缓存规则。文档修订、生成任务和 Session 证据会从第一个变化的 token 起改变后续请求。审核请求也会随累计证据和上一份快照变化。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **澄清次数有明确上限**——达到配置的批次数后，如果仍有关键歧义，本轮会等待用户决定，不会自行猜测。
- **任务生成锁定文档修订**——生成轮次进行期间不能修改文档；请在该轮次结算后重试或编辑。
- **Task 输出有长度上限**——task-execution 事件保存有界的助手最终回复；完整工具记录仍在“轨迹”和 Session 日志中。
- **健康检查只诊断一次**——证据有长度上限，诊断可能无法得出结论，继续执行的 Task 不会被周期复查。插件重新加载后不恢复运行时计时器。
- **审核失败会停止受门控执行**——检查点或 Final Test 的审核结果缺失、无效、不可用或为 `blocking` 时，当前 Task 失败并需要明确重试。
- **图谱关系限定在 Session 内**——文档创作可以引用同一 Session 的更早轮次，浏览器可以按 Workspace 聚合这些图谱；系统不支持跨 Session 关系创作。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

参阅[集中需求审核 Agent Note](../../../.agents/notes/implemented/feature/2026-09-16-batched-requirement-review.zh.md)和[Workspace 需求知识图谱 Agent Note](../../../.agents/notes/implemented/feature/2026-09-08-workspace-requirement-knowledge-graph.zh.md)。

</details>
