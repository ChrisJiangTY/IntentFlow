# Agent Note: 需求 Notebook 流程

Status: implemented

[English](2026-09-02-requirement-notebook-pipeline.md) | 中文

## Problem

“需求”视图需要展示用户实际经历的产品路径：原始请求变成澄清后的需求文档、可执行 Task 单元格、检查点审核和最终验证。DSH 外壳和底部输入框保持原有识别度，同时需要通过独立审核检查历史需求回归，而不能把普通 Task 失败标成红色。

## Decision

[集中需求审核决策](2026-09-16-batched-requirement-review.zh.md)替代本说明中的每个父级 Turn 结束后审核频率。本说明继续负责 Notebook 标识、呈现、证据与历史回归样式。

`session-requirements` 负责由 `RequirementRoundId` 标识的持久产品轮次。[需求文档决策](2026-09-06-requirement-document-before-tasks.zh.md)负责澄清、文档修订和任务生成；[本轮验证决策](../simplification/2026-09-24-validate-round-without-final-test.zh.md)负责最终审核。本说明继续负责稳定 Notebook 标识、Task 单元格编辑、note 行为、证据呈现和历史回归样式。`runTask`、`runAll`、`stopRunAll`、`addTask`、`editTask`、`moveTask` 和 `withdrawTask` 追加 Task、按序运行和执行事件，浏览器可以据此重放。`addNote` 始终追加 note 事件；`dispatch: false` 使文本和批注保持被动，`dispatch: true` 则把明确的辅助请求发送到主对话。

浏览器在现有 DSH 外壳内渲染与 Figma 对齐、完全面向人的 Notebook。新进入的 Session 默认选中需求视图，但用户已保存且仍有效的视图选择优先；需求视图不可用时回退到对话视图。每次进入需求视图时，Notebook 会滚动到最新单元格。轮次折叠选择按 Session 保留在当前页面中，因此切换视图不会自动展开用户收起的轮次。原生底部输入框是发起新产品轮次的唯一入口。任务生成先确定完整的 Agent 执行说明，再把该说明翻译成简洁的人类任务说明。人类说明可在 Task 单元格内编辑；技术说明位于紧接单元格之后的同级折叠区，默认由小三角收起，执行前可编辑，锁定后只读。视图还提供命令、按序执行、Task 移动、撤回、批注、按需证据/历史/关系抽屉、画布底部缩放和审核。控件跟随“设置”中选定的共享界面语言。Task 失败使用 `[!]` 和琥珀色状态，不表示历史需求回归。

插入代码会创建持久化的空白待处理 Task，使新建 Task 和生成的 Task 使用同一个编辑器及稳定的执行标识。Task 文本自动保存，无需确认表单。同一 Task 的保存按序执行，并合并等待期间的新输入；执行必须等待最新保存成功。保存失败会保留可编辑内容并阻止执行。空草稿可以持久化，但不可执行；标题或说明中至少一个非空即可运行。

文本单元格是被动 Markdown 备注。它复用 `MarkdownText` 预览，并在稳定的备注标识下逐字自动保存原文。每次编辑追加一个 `requirement/note` 替换事件；视图把多个修订合并为一个单元格。不变量检查备注历史时包含正在追加的事件，因此已派发备注或批注不能被改写。备注没有执行操作；显式辅助请求仍是独立且不可修改的派发批注。

明确的检查点和全部有效 Task 完成后，独立审核者收到当前 Notebook 工件、历史审核快照、父轮次证据和只读工作区访问。只有确认仍有效的历史需求被意外破坏时才产生回归。只有审核者提供可靠 Task 归因时才把 Task 标红，否则只把最终验证单元格标红。用户授权的细化、替换和撤回不是回归。

较早的[需求演化视图说明](2026-08-30-requirement-evolution-view.zh.md)仍然记录审核、稳定标识和双语证据决定。本说明替代其中关于当前产品界面采用时间轴和固定检查器的选择。

## Alternatives considered

**保留以时间为主轴的需求卡片和固定检查器。** 对产品界面而言予以放弃，因为它隐藏了从请求到需求文档、Task 执行和验证的有序转换；历史审核数据仍通过 Notebook 验证单元格和按需详情可见。

**只在 React 中保存 Notebook 状态。** 予以放弃，因为刷新或重新打开 Session 会丢失产品轮次和执行历史。Notebook 事实写入 Session 事件；[历史保留决策](../bug-fix/2026-09-15-notebook-history-retention.zh.md)负责独立于聊天分页的完整投影。

**使用 Agent Turn 作为 Notebook 轮次标识。** 予以放弃，因为规划、Task 执行、批注和验证可能跨越多个 Turn。`RequirementRoundId` 在不改变 Agent 生命周期的前提下把这些 Turn 归入同一轮。

**所有失败 Task 都显示红色。** 予以放弃，因为执行失败和历史回归是不同事实。Task 执行独立保存失败；红色样式必须由审核者明确产生的 regression 触发。

**并发运行全部 Task。** 予以放弃，因为有序 Task 单元格需要确定的依赖关系和清晰的失败点。`runAll` 一次排入下一个 Task，并在某轮失败后停止。

**要求先保存才能使用新 Task。** 予以放弃，因为这使新建和已有代码单元格的交互不同，并把尚未写完的 Task 留在 Session 日志之外。Markdown 备注也自动保存；显式提交批注仍是独立操作。

**用第二个模型轮次生成人类说明。** 原决策因延迟和漂移而拒绝该方式；[人类指令驱动任务文本决策](2026-09-15-human-directed-task-text.zh.md)替代这一选择，负责独立翻译、原文校验及通过人类编辑重写执行任务。

**为备注单独实现 Markdown 渲染器。** 予以放弃，因为备注需要的是现有 DSH 格式和不可信内容处理规则，而不是第二套解析器或渲染策略。

## Consequences

Session 日志可以重建每个产品轮次、原始需求、澄清、需求文档修订、Task 顺序、人类任务说明、完整技术说明、Task 执行输出、note 派发选择、检查点与本轮审核、验证结果和历史回归。DSH 输入框保留原有交互，只在需求视图激活时路由；普通“对话”和“轨迹”输入行为不变。Task 单元格保存有界的助手最终回复，详细工具证据仍在轨迹和 Session 日志中。编辑会通过自动保存增加 Task 列表和备注修订；人类编辑遵循[任务文本决策](2026-09-15-human-directed-task-text.zh.md)，并重新打开任务。只有未确认的编辑及未提交的批注仍只存在当前标签页。审核者归因仍取决于证据。

## Testing

[交付结果决策](2026-09-15-notebook-delivery-results.zh.md)负责两段式结果展示和最终消息选择；完整证据仍可在该展示区域之外查看。

Session 测试覆盖轮次创建、原始输入精确保留、文档和 Task 修订、Task 插入、编辑、重排、撤回、被动与派发 note、按序执行和审核结算。需求客户端测试覆盖最新单元格定位、按 Session 保留收起轮次、Notebook 顺序、顶部唯一添加入口、紧凑编辑器增长、执行标记、选中 Task 操作、note 派发、按需证据、历史与关系、状态颜色和事件装配。[需求文档决策](2026-09-06-requirement-document-before-tasks.zh.md)记录澄清与生成覆盖；[本轮验证决策](../simplification/2026-09-24-validate-round-without-final-test.zh.md)负责最终审核行为。
