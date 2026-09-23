# Agent Note: Task tool-error recovery and long-running diagnosis

Status: implemented

English | [中文](2026-09-17-task-tool-error-recovery.zh.md)

## Problem

Cancelling a Task when any tool fails prevents the implementing Agent from recovering. A stale-file edit needs a fresh read; a failed command can require a corrected command. Neither establishes that the Task or Agent Turn has failed. Unbounded faulty execution still needs independent diagnosis.

## Decision

The Requirements controller does not cancel Tasks on native or nested tool errors, Bash failures, signals, or command timeouts. Normal implementation Turn completion completes the Task. Non-completed Turn endings and explicit user stops still stop ordered execution. Checkpoint and final round reviews use the same independent reviewer.

Each execution attempt starts one read-only child after a configurable hour of runtime. The main Task continues while the child inspects bounded Task and current-Turn evidence. Only a completed `stop` verdict containing a reason and concrete evidence stops that same active attempt. Tool failures, duration, and unfinished work alone are not sufficient grounds. A healthy, inconclusive, unavailable, malformed, or timed-out diagnosis leaves the Task running. The child has a separate configurable five-minute timeout and cannot spawn descendants. Settlement, Session disposal, and plugin disposal abort diagnosis; stale results cannot stop later work.

This partially supersedes the immediate tool-failure cancellation in [batched requirement review](../feature/2026-09-16-batched-requirement-review.md). That note remains active for review cadence, ordered execution, and final graph validation. The implementation uses Requirements plugin lifecycle hooks, not changes to the core Agent Loop.

## Alternatives considered

**Stop on every tool error.** Rejected because expected recoverable errors prevent the Agent from receiving feedback and repairing its approach.

**Stop automatically at one hour.** Rejected because elapsed time does not distinguish productive work from a loop. Diagnosis supplies evidence before cancellation.

**Run an acceptance reviewer after each Task.** Rejected because execution health and requirement verification serve different purposes; repeated acceptance reviews delay the full run.

## Consequences

Recoverable tool errors remain in the normal model-visible transcript. A long Task incurs one extra diagnostic call, not periodic review calls. The diagnosis uses bounded evidence and can miss problems; runtime timers are not restored across plugin reloads. Cancellation does not roll back existing file changes. No Session event format changes are required.

## Testing

Focused tests exercise native and nested tool recovery, real Agent Loop continuation after a non-zero Bash exit, ordinary completion, one-hour scheduling, evidence-backed stop and continue verdicts, malformed verdicts, diagnostic timeout, late results, and disposal. Checkpoint and final round tests preserve acceptance review behavior.
