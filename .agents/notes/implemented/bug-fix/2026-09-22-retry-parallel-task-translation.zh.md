# Agent Note: Task 翻译的有界恢复与并发

Status: implemented

[English](2026-09-22-retry-parallel-task-translation.md) | 中文

## Problem

需求 Task 生成需要为每份完整执行说明生成面向人的标题和说明。如果一个翻译子 Agent 返回的说明格式不合格，即使其他子 Agent 已成功，整次提交仍会失败，迫使主 Agent 重新提交并重复已经完成的工作。串行翻译也会使生成耗时随 Task 数量增加，尽管每个子 Agent 接收的都是独立且已经定稿的说明。

## Decision

`submit_requirement_tasks` 在开始翻译前校验所有实施 Task 或检查点 Task，以及它们对验收标准的共同覆盖。一个生成批次占用 Session 的审核队列，最多并发启动 `taskTranslationConcurrency` 个无工具权限的子 Agent；默认值为 3，Web profile 也显式设置此值。翻译结果如果标题或说明无效，或者改动了执行说明，系统只重试该 Task，最多尝试 `taskTranslationMaxAttempts` 次，默认值为 2。提供方失败和取消不会触发再次尝试。批次等待所有子 Agent 结算，保留输入的 Task 顺序，随后重新检查存活 Agent 和来源修订，再追加一份 Task 列表。失败批次不会追加部分 Task 列表。

[人类指令驱动 Task 文本的决定](../feature/2026-09-15-human-directed-task-text.zh.md)继续负责先确定完整执行说明、逐字保留说明及人类编辑行为。单项编辑继续使用 Session 审核队列；验收审核会等待活跃生成批次，不会插入该批次的子 Agent 之间。

## Alternatives considered

**一条翻译无效就重复整次提交。** 予以放弃，因为已合格的其他结果也会重新消耗模型调用，延迟向用户展示 Task 列表。

**主 Agent 起草 Task 时就开始翻译。** 予以放弃，因为完整 Task 集合及其验收标准引用通过校验前，执行说明仍可能发生变化。

**继续串行翻译全部 Task。** 予以放弃，因为已校验的说明相互独立，串行调度会累加各次翻译耗时。

**允许无限并发或无限重试。** 予以放弃，因为提供方负载和模型调用成本需要有界、可按部署调整的控制。

## Consequences

首个结果有效时，每个 Task 使用一次子 Agent 调用；按默认尝试次数，无效结果最多增加一次调用。提供方能够同时处理请求时，并发翻译可缩短等待时间，但会提高瞬时请求量。子 Agent 失败仍会阻止发布，不过某个子 Agent 的文本无效不会迫使其他已成功子 Agent 重做。提供方失败和取消仍然作为失败返回。无需修改 Session 事件格式。

## Testing

聚焦宿主测试覆盖启动子 Agent 前完成全部预检、并发派发、子 Agent 逆序完成时维持输入顺序、仅重试单项无效翻译，以及重试次数用尽后不会发布部分 Task 列表。

无密钥 Web 已记录会话快照通过发布的 profile 检查并发翻译。由于并发子 Agent 每次运行到达首次模型调用的顺序可能不同，回放会按唯一匹配的已记录首条用户提示绑定每个子 Agent；无匹配或匹配不唯一时仍沿用原有的按位置绑定方式。
