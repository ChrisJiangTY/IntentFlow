# Workspace 需求知识图谱实施计划

[English](2026-09-08-workspace-requirement-knowledge-graph.md) | 中文

> **供 Claude 使用：** 必须使用子 skill：请使用 superpowers:executing-plans 逐项实施本计划。

**目标：** 为需求 Notebook 增加可开关的右侧栏，汇总当前 Workspace 的全部需求轮次，展示需求依赖关系，并在映射的 Task 与验证结算时，把节点状态从待处理更新为执行中、已验证或受阻。

**架构：** `dsh-session-requirements` 在每个有效需求文档修订旁追加一条完整的 `requirement/graph` 事件，并注册 `requirementGraph` Session 投影。该投影把文档、生成的 Task 映射、经过审核的 Task 状态和最终验证折叠为有界的单 Session 图谱。现有 Session 列表投影会把实时值与冷历史值送到浏览器；`dsh-client-ui-requirements` 以 Workspace `sessionIds` 作为成员真源合并这些单 Session 图谱，无需在 React 中读取其他 Session 日志。

**技术栈：** TypeScript、Cordis Session 事件与投影、Zod、React、SVG/CSS 图谱展示、Vitest、Testing Library、录制的 Web 快照。

---

### 任务 1：定义持久图谱类型与投影

**文件：**
- 修改：`packages/session/session-requirements/src/types.ts`
- 新建：`packages/session/session-requirements/src/projection.ts`
- 修改：`packages/session/session-requirements/src/invariant.ts`
- 修改：`packages/session/session-requirements/src/index.ts`
- 测试：`packages/session/session-requirements/tests/invariant.spec.ts`
- 测试：`packages/session/session-requirements/tests/projection.spec.ts`

**步骤：**
1. 增加图谱节点、关系和完整轮次图谱事件类型；使用轮次加需求编号标识节点，并保留全部验收标准引用。
2. 在运行时不变量中验证图谱修订、节点唯一性、关系端点、关系种类和文档修订归属。
3. 通过可选的 `sessionProjections` 服务注册 `requirementGraph` Session 投影。
4. 把图谱事件、当前 Task 列表、Task 审核结果和最终验证折叠为灰、蓝、绿、红四种节点状态。
5. 证明 Final Test 不会延迟普通需求的完成状态，同时映射 Task 失败或后续回归可以把绿色节点降为红色。

### 任务 2：随需求文档构建图谱事实

**文件：**
- 修改：`packages/session/session-requirements/src/index.ts`
- 修改：`packages/session/session-requirements/package.json`
- 测试：`packages/session/session-requirements/tests/session-requirements.spec.ts`
- 测试：`packages/session/session-requirements/tests/loader-composition.spec.ts`

**步骤：**
1. 为 `submit_requirements_document` 增加必填但可为空的关系数组，并要求关系说明使用中文。
2. 从已验证 Markdown 中解析顶层需求和验收标准，然后在文档事件后追加完整图谱事件。
3. 根据当前轮次验证依赖关系端点，并且只允许细化或取代关系指向同一 Session 中已存在的轮次。
4. 用户在浏览器编辑文档时，从 Markdown 重建节点，并仅保留端点仍存在的关系；无效草稿不发布新的图谱修订。
5. 在后续轮次的创作提示中包含当前 Session 的图谱索引，让主 Agent 可以声明明确的细化和取代关系，无需臆造不透明标识。

### 任务 3：聚合并渲染 Workspace 图谱

**文件：**
- 新建：`packages/client/ui-requirements/src/client/knowledge-graph.ts`
- 新建：`packages/client/ui-requirements/src/client/RequirementGraphPanel.tsx`
- 修改：`packages/client/ui-requirements/src/client/RequirementsView.tsx`
- 修改：`packages/client/ui-requirements/src/client/RequirementsView.module.css`
- 修改：`packages/client/ui-requirements/src/client/locales.ts`
- 修改：`packages/client/ui-requirements/src/client/index.ts`
- 测试：`packages/client/ui-requirements/tests/knowledge-graph.client.spec.ts`
- 测试：`packages/client/ui-requirements/tests/requirements-view.client.spec.tsx`

**步骤：**
1. 通过 `useWorkspaces` 确定当前 Workspace；使用其有序 `sessionIds` 作为准确聚合集，并在项目未分组时回退到当前 Session。
2. 使用 Session id、轮次 id 和需求 id 生成稳定的 Workspace 节点键；保留各轮历史，不合并同名节点。
3. 渲染桌面端固定侧栏和窄屏覆盖式抽屉，包含显式开关、状态图例、轮次泳道、可访问节点和带标签的依赖路径。
4. 侧栏打开时保持 Notebook 与输入框尺寸正确，并避免现有详情面板破坏流式布局。
5. 点击当前 Session 节点时展开并滚动到映射的 Task 或需求文档；点击其他 Session 节点时打开对应 Session。

### 任务 4：更新文档、派生证据与验证

**文件：**
- 修改：`packages/session/session-requirements/README.md`
- 修改：`packages/session/session-requirements/README.zh.md`
- 修改：`packages/client/ui-requirements/README.md`
- 修改：`packages/client/ui-requirements/README.zh.md`
- 新建：`.agents/notes/implemented/feature/2026-09-08-workspace-requirement-knowledge-graph.md`
- 新建：`.agents/notes/implemented/feature/2026-09-08-workspace-requirement-knowledge-graph.zh.md`
- 更新：生成的持久化目录与能力目录
- 更新：相关录制 Session 与 Web 快照

**步骤：**
1. 记录事件归属、投影传递、Workspace 成员关系、图谱状态含义、关系方向、编辑行为和限制。
2. 记录为何使用 Session 投影传递，而不是在浏览器中读取日志或新增图谱专用轮询 Remote。
3. 更新模型可见工具快照和产品可见 Web 快照。
4. 运行聚焦的宿主、投影、客户端、不变量、Loader、类型检查、文档和 Web 构建检查。
5. 在桌面与窄屏下检查正在运行的 Web 界面，然后运行 `git diff --check` 并审阅完整差异，不修改无关的品牌调整。
