# Agent Note: Validate requirement rounds without a generated Final Test

Status: implemented

English | [中文](2026-09-24-validate-round-without-final-test.zh.md)

## Problem

The generated Final Test repeats verification already assigned to implementation and checkpoint Tasks. It creates another executable Task and translation request before the independent reviewer can decide whether the completed round satisfies its requirements.

## Decision

The [requirement-document decision](../feature/2026-09-06-requirement-document-before-tasks.md) owns document revisions and task generation; this decision replaces its mandatory Final Test. The [batched review decision](../feature/2026-09-16-batched-requirement-review.md) still owns intermediate checkpoint reviews and the independent round audit.

New generated task lists contain implementation and checkpoint Tasks. Each Task includes verification for its own scope, and the union of their `requirement_refs` covers every acceptance criterion in the active document. `submit_requirement_tasks` validates those references before publishing the list. Task lists already recorded with a `final-test` Task remain readable and executable under their recorded order.

After every non-withdrawn Task settles successfully, the host attaches one independent read-only audit to the last settled Task. The reviewer reads the accumulated Notebook artifacts, Task results, parent-Turn evidence, previous requirement snapshot, and workspace evidence. A matching non-blocking verdict without regressions appends the existing `requirement/validation` event. A blocking result, reviewer failure, or confirmed regression fails the Task and leaves the round unverified. Editing work or adding a nonempty Task invalidates earlier round validation, so the next successful completion requires a fresh audit.

## Alternatives considered

**Keep a separate generated Final Test.** Rejected because the implementation and checkpoint Tasks already verify their scoped acceptance criteria. The extra execution repeats work and delays the independent round decision.

**Accept Task completion without independent round review.** Rejected because the implementing Agent's own results do not independently assess cross-Task evidence or historical regressions. Explicit checkpoints still protect intermediate dependencies.

**Review every Task before continuing.** Rejected because repeated global audits delay dependent work. Checkpoints remain available when an intermediate result must gate the next Task.

## Consequences

Generated rounds have one fewer Task and translation request while retaining one independent final audit and the existing validation event. Requirement nodes become verified only from successful round validation, regardless of which Task settled last. Recorded Final Test Tasks remain part of their existing task lists, so replay does not discard earlier execution or validation evidence. `editTask` and `withdrawTask` reject changes that would leave an acceptance criterion without a Task reference. Withdrawing a redundant last pending Task reopens the read-only round review on the last completed Task.
