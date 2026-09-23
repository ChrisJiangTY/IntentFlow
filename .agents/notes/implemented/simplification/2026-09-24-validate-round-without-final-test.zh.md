# Agent Note: 不生成 Final Test 的需求轮次验证

Status: implemented

[English](2026-09-24-validate-round-without-final-test.md) | 中文

## Problem

生成的 Final Test 会重复实现 Task 和检查点 Task 已负责的验证。它让独立审核者必须先等待额外的可执行 Task 及其翻译请求，才能判断已完成的轮次是否满足需求。

## Decision

[需求文档决策](../feature/2026-09-06-requirement-document-before-tasks.zh.md)负责文档修订和任务生成；本决策替代其中强制生成 Final Test 的规则。[集中审核决策](../feature/2026-09-16-batched-requirement-review.zh.md)仍负责中间检查点审核与独立的本轮审核。

新生成的任务列表只包含实现 Task 和检查点 Task。每个 Task 都包含自身范围内的验证，所有 Task 的 `requirement_refs` 合计覆盖当前文档的每条验收标准。`submit_requirement_tasks` 在发布列表前验证这些引用。已经记录且包含 `final-test` Task 的列表仍可按记录的顺序读取和执行。

所有未撤回 Task 成功结算后，宿主把一次独立只读审核附在最后结算的 Task 上。审核者读取累计的 Notebook 工件、Task 结果、父级 Turn 证据、先前需求快照和工作区证据。匹配且非阻塞、无回归的判定会追加现有的 `requirement/validation` 事件。阻塞结果、审核失败或确认的回归会让该 Task 失败，本轮保持未验证。编辑工作或新增非空 Task 会使先前的本轮验证失效，因此下次成功完成后需要重新审核。

## Alternatives considered

**保留单独生成的 Final Test。** 予以放弃，因为实现 Task 和检查点 Task 已经验证各自范围内的验收标准。额外执行会重复工作，并推迟独立的本轮判定。

**Task 完成后不进行独立的本轮审核。** 予以放弃，因为实现 Agent 自己的结果无法独立评估跨 Task 证据及历史回归。明确的检查点仍可保护中间依赖。

**每个 Task 继续前都审核。** 予以放弃，因为重复的全局审核会延迟依赖工作。当中间结果必须阻止后续任务时，仍可使用检查点。

## Consequences

新生成的轮次少一个 Task 和一次翻译请求，同时保留一次独立最终审核和现有验证事件。无论最后结算的是哪个 Task，需求节点都只根据成功的本轮验证变为已验证。已记录的 Final Test Task 保留在原有任务列表中，因此重放不会丢弃此前的执行或验证证据。`editTask` 和 `withdrawTask` 会拒绝使任何验收标准失去 Task 引用的修改。撤回多余的最后一个待处理 Task 后，系统会在最后一个已完成 Task 上重新发起只读本轮审核。
