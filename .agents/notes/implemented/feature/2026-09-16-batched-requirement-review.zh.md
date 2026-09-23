# Agent Note: 集中需求审核

Status: implemented

[English](2026-09-16-batched-requirement-review.md) | 中文

## Problem

每个实现 Task 完成后都启动新的审核者，会让整个按序运行持续等待重复的全局工作区审核。即使实现 Agent Turn 正常结束，重复调用仍会延迟后续 Task；同时，需求图谱可能在综合审核检查完整轮次前提前变绿。

## Decision

`implementation` Task 的 Agent Turn 正常结束时，该 Task 直接变为已完成。“全部运行”等待整个 Agent 停稳，再排入下一个非空的待执行或失败 Task；该控制器活动期间拒绝单独启动其他 Task。收件箱领取消息时就在模型输入组装前把 Task 绑定到 Turn，因此步骤前错误或提前取消仍会结算该 Task。非正常 Turn 结束会停止“全部运行”。[Task 恢复决策](../bug-fix/2026-09-17-task-tool-error-recovery.zh.md)替代本文对工具失败立即取消的决定，并负责长时间运行 Task 的诊断规则。现有 Task 执行与任务列表事件记录这些转换，不改变 Session 事件格式。

明确的 `checkpoint` Task 进入 `reviewing` 并接受中间判定。所有有效 Task 成功结算后，最后结算的 Task 接受[本轮验证决策](../simplification/2026-09-24-validate-round-without-final-test.zh.md)所述的独立审核。审核者读取累积的需求 Notebook 产物、Task 结果、父级 Turn 证据、先前需求快照和只读工作区工具，一次性审核全部活跃需求、回归与代码证据。只有审核返回匹配、非阻塞且无回归的判定后，系统才追加最终验证。

成功的最终验证出现前，需求图谱把已经开始或完成的映射工作视为“进行中”。已完成的 Task 节点使用单独的“已完成”标签，不表示需求已经验证。编辑工作或新增非空 Task 会使先前验证失效，因此新工作不能绕过综合审核。已记录任务列表若包含 Final Test，该任务也回到待执行状态。映射 Task 失败和已记录回归仍可立即阻塞节点。投影状态版本 3 会按该规则重放缓存的图谱状态。

本决定替代[需求文档决策](2026-09-06-requirement-document-before-tasks.zh.md)中的逐 Task 审核频率与停止时机、[Notebook 流水线决策](2026-09-02-requirement-notebook-pipeline.zh.md)中的每轮次后审核频率，以及[原图谱决策](2026-09-08-workspace-requirement-knowledge-graph.zh.md)中的提前变绿规则。[本轮验证决策](../simplification/2026-09-24-validate-round-without-final-test.zh.md)替代生成的 Final Test，同时保留本文的审核频率。

## Alternatives considered

**每个 Task 后保留完整审核者。** 予以放弃，因为每个审核者都会重复全局需求与工作区审核，依赖序列只能等待审核结束后继续。

**完全取消独立审核。** 予以放弃，因为最终的需求、回归与代码证据审核必须独立于实现 Agent。明确的检查点也继续适用于高风险中间状态。

**后续 Task 与逐 Task 审核者并发运行。** 予以放弃，因为阻塞结果可能在依赖工作开始后才返回，使按序停止行为和证据归因含糊，同时仍保留相同的审核成本。

## Consequences

按序运行不再为每个 Task 启动执行审核者，而是为每个明确检查点启动一次，并在最后一个有效 Task 后启动一次本轮审核。普通 Task 以更低延迟继续，Turn 错误和取消仍会停止序列。缺陷可能到本轮审核才被发现，因此当中间结果必须阻塞依赖工作时，任务作者应使用检查点。需求节点在实现期间保持“进行中”，只根据最终验证事实变为“已验证”。

审核者服务、提示词、失败事件、取消机制和只读工具策略用于检查点、本轮审核、已记录的 Final Test Task 和手动审核。持久状态沿用现有词汇，因此已记录的 Session 无需迁移即可重放。

## Testing

Session 测试覆盖实现 Task 直接推进、整个 Agent 空闲后续跑、平稳停止与步骤前停止、失败 Turn、原生与嵌套 PTC 工具失败、不依赖渲染文本的结构化 `bash`/`pwsh` 非零结果、插入工作后验证失效、检查点阻塞与重试、单次最终审核者调用和最终验证。投影与客户端测试确保完成的映射工作在验证前保持“进行中”，在最终验证后验证整个轮次，并区分“已完成”Task 与“已验证”需求。录制的 Web Task 结果场景覆盖减少后的子审核序列。
