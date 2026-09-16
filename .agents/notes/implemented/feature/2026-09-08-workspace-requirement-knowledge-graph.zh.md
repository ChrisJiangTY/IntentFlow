# Agent Note：Workspace 需求知识图谱

Status: implemented

[English](2026-09-08-workspace-requirement-knowledge-graph.md) | 中文

## Problem

“需求”Notebook 会记录文档、Task、审核和验证，但跨多个 Session 工作的用户无法直接看到需求之间的依赖，也无法判断哪些结果已经实现。只根据当前 Session 构建图谱会隐藏同一项目中的其他需求轮次。只在 React 中保存颜色也会在刷新后丢失含义，并可能与持久 Task 和审核状态不一致。

## Decision

[Session 需求代码图谱](2026-09-16-session-requirement-code-graph.zh.md)替代本说明的 Workspace 聚合、跨 Session 导航和图谱呈现。本说明保留持久需求标识、关系验证、修订和状态决定。

[集中需求审核决策](2026-09-16-batched-requirement-review.zh.md)替代本说明中“独立审核的实现 Task 可在 Final Test 前把需求变绿”的规则。本说明继续负责其他状态优先级和失败归因决定。

每个有效需求文档修订都有一条完整的 `requirement/graph` 事件。节点来自文档中编号的需求和验收标准。文档创作工具还会提交带简短中文原因的有向关系。`depends-on` 连接当前文档内的节点；`refines` 和 `supersedes` 把当前节点连接到同一 Session 更早轮次中的现有节点。宿主拒绝重复节点和关系、未知或相同端点、跨轮次依赖、同轮次历史关系以及依赖环。

图谱修订与 `requirement/document` 对齐。浏览器中的有效编辑会重建节点，并只保留端点仍然有效的关系。无效编辑会追加文档草稿，但不会为该修订生成图谱，因此读取投影会移除陈旧的当前图谱，而不会继续把它显示为当前状态。

标准投影服务存在时，`dsh-session-requirements` 会注册 `requirementGraph` Session 投影。该折叠把图谱事件与匹配的 Task 列表和验证结合。对于早于图谱事件的有效需求文档，它会在重放期间重建文档节点并保持关系为空；后续图谱事件会替换这份回建结果。投影状态版本 2 会强制现有缓存折叠使用这条历史回建规则重新回放。没有映射实现工作完成时节点为灰色；映射工作活跃或只有部分完成时为蓝色；经过独立审核的非最终 Task 覆盖全部验收标准时为绿色；映射 Task 失败、验证失败或记录回归后为红色。待处理的 Final Test 不会让本可完成的节点停留在蓝色；Final Test 失败时会根据其覆盖的验收标准把对应节点变为红色。

浏览器不会读取其他 Session 日志。标准 Session 列表已经为已打开和未打开的 Session 携带宿主计算的投影值。`dsh-client-ui-requirements` 查找包含当前 Session 的 Workspace，使用该 Workspace 的有序 `sessionIds` 作为准确成员集合，并合并每个成员的 `requirementGraph` 值。稳定的浏览器节点键包含 Session id、轮次 id 和需求 id，因此相同的文档编号不会跨 Session 或轮次合并。

桌面端把图谱显示为可折叠的右侧栏，窄屏端则显示为覆盖式抽屉。图谱为每个 Session 展示一条横向轮次泳道、带标签的关系和四种状态颜色。选择当前 Session 节点会展开对应轮次，并滚动到映射 Task 或需求文档。选择其他 Session 节点会打开对应 Session；用户可在那里再次选择节点以定位单元格。关系创作仍限定在 Session 内，因此 Workspace 聚合不会推断跨 Session 依赖。

## Alternatives considered

**在浏览器中读取每个 Workspace Session 的日志。** 予以放弃，因为 React 会拥有第二条历史加载路径，重复宿主折叠逻辑，并且仅为重建 Session 投影系统已经携带的数据而加载未打开的 Session。

**增加图谱专用轮询 Remote。** 予以放弃，因为轮询会产生陈旧的定时器，并在现有 Session 列表投影流之外增加第二套传递机制。标准投影通过一个生命周期同时提供冷历史值与实时值。

**把颜色存入图谱事件。** 予以放弃，因为颜色是派生状态。持久化颜色会重复 Task 与验证事实，并要求在每次审核、重试、文档编辑和回归后保持同步。

**要求 Final Test 完成后节点才能变绿。** 予以放弃，因为完成并通过独立审核的实现 Task 已经能够为其覆盖的验收标准提供证据。Final Test 失败时仍具有把节点降级的权威性。

**合并标题或需求编号相同的节点。** 予以放弃，因为同一标签在不同 Session 或后续轮次中可能表达不同需求。稳定的复合标识可以保留历史并避免错误等价。

## Consequences

每张需求图谱都能从 Session 日志重建，节点状态始终跟随持久 Task 和验证事实。Workspace 导航无需新增网络轮询或浏览器日志访问，即可显示未打开 Session 的需求。文档编辑不会让旧图谱继续冒充当前图谱。每个 Session 摘要增加一个有界的投影值，每个有效文档修订增加一条完整图谱事件。

创作 Agent 只会看到当前 Session 的历史图谱索引。它可以表达当前文档内的依赖，以及指向该 Session 更早轮次的历史关系，但不能创建不同 Session 之间的关系。跨 Session 节点仍会在 Workspace 侧栏中按不同 Session 泳道共同显示。

## Testing

Session 测试覆盖图谱创建、关系端点验证、依赖环、修订替换、待处理到执行中再到已验证的状态、映射工作失败、Final Test 行为和回归降级。客户端测试覆盖准确 Workspace 成员、复合节点标识、关系投影、侧栏可见性、本地 Task 定位和跳转到其他 Session。录制的 Web 导航场景在 Notebook 旁包含图谱，并验证映射失败的需求显示为红色。聚焦的宿主与客户端 TypeScript 构建验证两个编译目标。
