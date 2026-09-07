# 需求文档流水线实施计划

[English](2026-09-06-requirement-document-pipeline.md) | 中文

> **供 Claude 使用：** 必须使用子 skill：请使用 superpowers:executing-plans 逐项实施本计划。

**目标：** 使用澄清、可编辑中文需求文档、显式任务生成、经过审核的顺序执行和强制 final-test 任务，取代需求 Notebook 的原始输入/Plan 流程。

**架构：** `dsh-session-requirements` 负责仅追加的轮次状态机和两个模型提交工具：一个发布需求文档，另一个发布结构化任务。`dsh-client-ui-requirements` 把这些持久事件投影为可编辑、可执行的 Notebook 单元格；Task 继续由主 Agent 执行，现有只读审核者成为“全部运行”各 Task 之间的检查点。

**技术栈：** TypeScript、Cordis 服务与事件、Typert Remote、React、Vitest、Testing Library、录制的 Web 快照。

---

### 任务 1：定义持久需求文档生命周期

**文件：**
- 修改：`packages/session/session-requirements/src/types.ts`
- 修改：`packages/session/session-requirements/src/invariant.ts`
- 测试：`packages/session/session-requirements/tests/invariant.spec.ts`

**步骤：**
1. 使用分析、澄清、文档、任务生成、执行、审核和验证状态，取代 Plan 时期的轮次状态与事件。
2. 增加持久澄清、可编辑文档修订、任务列表的来源文档修订、任务种类、审核判定和“全部运行”状态。
3. 在更新不变量前，先编写无效数据和无效关系测试。
4. 运行聚焦的不变量测试和该包的类型检查。

### 任务 2：实现模型负责的文档与任务提交

**文件：**
- 修改：`packages/session/session-requirements/src/index.ts`
- 修改：`packages/session/session-requirements/package.json`
- 测试：`packages/session/session-requirements/tests/session-requirements.spec.ts`

**步骤：**
1. 添加测试，证明 `startRound` 保留原始输入，不会输出已渲染文档或激活 Plan 模式。
2. 在宿主工具注册表中注册 `clarify_requirements`、`submit_requirements_document` 和 `submit_requirement_tasks`。
3. 通过持久事件约束每次澄清调用提出 1 至 5 个问题，并且每轮最多调用两次。
4. 验证中文文档格式，同时允许通过编辑 Remote 持久保存无效草稿。
5. 增加采用乐观文档修订和陈旧任务列表派生规则的 `editDocument` 与 `generateTasks` Remote。
6. 验证顶层任务块、中文需求引用和强制 final-test 末项。
7. 运行聚焦的服务测试。

### 任务 3：通过独立审核控制顺序执行

**文件：**
- 修改：`packages/session/session-requirements/src/index.ts`
- 修改：`packages/session/session-requirements/src/types.ts`
- 测试：`packages/session/session-requirements/tests/session-requirements.spec.ts`

**步骤：**
1. 增加 Task `reviewing` 状态和审核者通过/警告/阻塞判定。
2. 等待审核者结算后，再运行“全部运行”的下一个 Task。
3. 通过或警告时继续；阻塞或审核失败时停止。
4. 增加 `stopRunAll`；允许当前 Task 完成，并阻止下一个 Task 启动。
5. 执行开始后锁定需求文档；空闲时只允许修改待处理的非末位 Task。
6. 允许 final-test Agent 修复本轮失败，并且仅在其审核通过后运行最终验证。
7. 运行聚焦的服务测试，包括失败和暂停路径。

### 任务 4：投影并渲染新的 Notebook 工作流

**文件：**
- 修改：`packages/client/ui-requirements/src/client/contract.ts`
- 修改：`packages/client/ui-requirements/src/client/assembly.ts`
- 修改：`packages/client/ui-requirements/src/client/index.ts`
- 修改：`packages/client/ui-requirements/src/client/RequirementsView.tsx`
- 修改：`packages/client/ui-requirements/src/client/RequirementsView.module.css`
- 修改：`packages/client/ui-requirements/src/client/locales.ts`
- 测试：`packages/client/ui-requirements/tests/assembly.client.spec.ts`
- 测试：`packages/client/ui-requirements/tests/requirements-view.client.spec.tsx`

**步骤：**
1. 使用澄清、文档和“全部运行”节点取代 Markdown/Plan 投影节点。
2. 渲染 `第 X 轮：摘要`；把原始输入和已回答的澄清记录保存在折叠区中。
3. 通过共享 Markdown 渲染器呈现需求 Markdown，并提供预览/编辑自动保存。
4. 增加文档单元格的 `生成任务` 操作、验证诊断、陈旧任务提示和生成前保存顺序。
5. 从“需求”视图移除 Plan 卡片和审批呈现。
6. 保留 Task 编辑和执行控件，同时强制 final-test 不可变规则和“全部运行”停止行为。
7. 运行聚焦的客户端测试，并检查渲染流程。

### 任务 5：更新发布组合证据与文档

**文件：**
- 修改：`packages/session/session-requirements/README.md`
- 修改：`packages/session/session-requirements/README.zh.md`
- 修改：`packages/client/ui-requirements/README.md`
- 修改：`packages/client/ui-requirements/README.zh.md`
- 修改：`packages/client/ui-requirements/AGENT.md`
- 创建：`.agents/notes/implemented/feature/2026-09-06-requirement-document-pipeline.md`
- 创建：`.agents/notes/implemented/feature/2026-09-06-requirement-document-pipeline.zh.md`
- 创建：`.agents/notes/implemented/feature/2026-09-06-requirement-document-pipeline.i18n.yaml`
- 更新：`.agents/notes/implemented/feature/2026-09-02-requirement-notebook-pipeline.md`
- 更新：`.agents/notes/implemented/feature/2026-09-02-requirement-notebook-pipeline.zh.md`
- 更新：相关录制 Web/Session 快照

**步骤：**
1. 记录当前模型可见行为、token 影响、持久化、编辑锁、审核检查点和已知限制。
2. 记录新决策，并与较早的、部分被取代的 Notebook 说明互相链接。
3. 更新产品可见流程的无密钥录制 Session 场景和 Web 预期输出。
4. 运行聚焦包测试、类型检查、变更包 lint、快照检查、文档检查和生产 Web 构建。
5. 在交付前检查 `git diff --check` 和完整差异。
