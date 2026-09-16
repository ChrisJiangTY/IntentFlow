# Agent Note: Batched requirement review

Status: implemented

English | [中文](2026-09-16-batched-requirement-review.zh.md)

## Problem

Starting a fresh reviewer after every implementation Task serializes the entire ordered run behind repeated global workspace audits. The repeated calls delay later Tasks even when the implementing Agent Turn ended normally, while the requirement graph can turn green before the comprehensive Final Test has checked the complete round.

## Decision

A normal `implementation` Task becomes completed when its Agent Turn ends normally. Run All waits for whole-Agent quiescence, then queues the next nonempty pending or failed Task; individual Task starts are rejected while that controller is active. Inbox claim binds a Task message to its Turn before model-input assembly, so a pre-step error or early cancellation still settles the Task. An error, cancellation, other non-completed Turn ending, live tool failure, or structured foreground `bash`/`pwsh` non-zero exit, signal, or timeout marks the Task failed and stops Run All. The live tool observer attributes native and nested PTC results through their root call id, cancels the active Turn while retaining unrelated queued input, and leaves the durable tool-result listener as the fallback for synthetic errors. The existing Task execution and Task-list events record these transitions; no Session event format changes.

Only `checkpoint` and `final-test` Tasks enter `reviewing` and start the independent reviewer. A checkpoint remains an explicit intermediate gate. The Final Test reviewer receives the accumulated Requirement Notebook artifacts, Task results, parent-turn evidence, previous requirement snapshot, and read-only workspace tools. It audits all active requirements, regressions, and code evidence in one pass. Final validation is appended only after that review returns a matching non-blocking Final Test verdict without regressions.

The requirement graph treats started or completed mapped work as in progress until successful final validation exists. Completed Task nodes use a separate completed label and do not claim requirement verification. Editing work or adding a nonempty Task returns a completed Final Test to pending, so new work cannot bypass the comprehensive review. Mapped Task failures and recorded regressions can still block nodes immediately. Projection state version 3 replays cached graph state under this rule.

This decision supersedes the per-Task review cadence and stop timing in the [requirement-document decision](2026-09-06-requirement-document-before-tasks.md), the after-each-turn review cadence in the [Notebook pipeline decision](2026-09-02-requirement-notebook-pipeline.md), and the pre-Final-Test green status in the [earlier graph decision](2026-09-08-workspace-requirement-knowledge-graph.md). Those notes retain their other decisions.

## Alternatives considered

**Keep a full reviewer after every Task.** Rejected because each reviewer repeats a global requirement and workspace audit before the dependent sequence can continue.

**Remove independent review entirely.** Rejected because the final requirement, regression, and code-evidence audit must remain independent of the implementing Agent. Explicit checkpoints also remain useful for high-risk intermediate states.

**Run per-Task reviewers concurrently with later Tasks.** Rejected because a late blocking result could arrive after dependent work has started, making ordered stop behavior and evidence attribution ambiguous while retaining the same reviewer cost.

## Consequences

An ordered run starts one execution reviewer per explicit checkpoint plus one for Final Test instead of one per Task. Ordinary Tasks advance with lower latency, while errors and cancellations still stop the sequence. Defects may be discovered later at Final Test, so task authors use checkpoints where an intermediate result must gate dependent work. Requirement nodes remain visually in progress during implementation and become verified only from the final validation fact.

The previous reviewer service, prompt, failure events, cancellation, and read-only tool policy remain in use for checkpoints, Final Test, and manual review. Durable statuses keep their existing vocabulary, so historical Sessions replay without migration.

## Testing

Session tests cover direct implementation advancement, whole-Agent idle sequencing, graceful and pre-step stop, failed Turns, native and nested PTC tool failures, structured non-zero `bash`/`pwsh` outcomes without rendered-text inference, Final Test invalidation after inserted work, checkpoint blocking and retry, one final reviewer call, and final validation. Projection and client tests keep completed mapped work in progress before validation, verify the round after final validation, and distinguish completed Tasks from verified requirements. The recorded Web task-result scenario covers the reduced child-review sequence.
