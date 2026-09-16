# Agent Note: Requirement document before Tasks

Status: implemented

English | [中文](2026-09-06-requirement-document-before-tasks.zh.md)

## Problem

The Requirements Notebook needs an explicit, reviewable definition of the requested outcome before implementation Tasks exist. Rendering the raw request as if it were the finished requirement loses clarification decisions, while using generic Plan mode makes implementation approval stand in for requirement acceptance. Task execution also needs a deterministic last validation step and an independent decision about whether each Task may advance the sequence.

## Decision

The [batched requirement review decision](2026-09-16-batched-requirement-review.md) supersedes this note's per-Task review cadence and Run All stop timing. This note retains the requirement-document, Task-generation, editing, and Final Test invariants.

`startRound` preserves the raw request and queues an ambiguity-analysis turn without entering Plan mode. The main Agent first performs read-only repository inspection. It calls `clarify_requirements` only for material choices that the repository cannot resolve, asks one to five related Chinese questions per batch, and may use at most the configured number of batches. The question and answer records remain collapsed in the Notebook after settlement. If material ambiguity remains after the limit, the Agent leaves the round awaiting user input instead of guessing.

The Agent submits a complete Chinese requirement document through `submit_requirements_document`. The document contains `# 需求文档`, `## 简介`, and `## 需求`; it has no glossary. Each numbered requirement includes a user story and numbered acceptance criteria. A separate summary of at most 30 Chinese characters labels the round and is read-only. The document body is editable before execution. Every edit appends a validated revision; an invalid revision stays visible but cannot generate Tasks.

The user starts task generation from the document block. `generateTasks` binds one model request to one exact valid document revision, and the document remains locked until that request settles. `submit_requirement_tasks` creates one executable block per top-level phase while retaining its `N.x` checklist items inside that block. Every item is mandatory and cites real acceptance-criterion references with `_关联需求：…_`. The host appends one separately supplied Final Test, requires it to cover every acceptance criterion, and keeps it last.

Any document edit invalidates the visible generated Task list. Any Task execution locks the document permanently for that round. Before execution, users can add, edit, reorder, or withdraw pending Tasks. During execution, completed, in-progress, and reviewing Tasks stay locked; future pending Tasks can change after the current Task and review settle and ordered execution has stopped. Final Test remains editable but cannot be moved or withdrawn.

Every successful Task turn enters an independent review before it becomes complete. The reviewer returns the matching Task identity with a `passed`, `warning`, or `blocking` verdict. Passed and warning results allow ordered execution to continue. A blocking verdict, unavailable or invalid review, or confirmed historical regression fails the Task and stops Run All. `stopRunAll` records the stop request and takes effect after the current Task and review settle.

Final Test runs only after all preceding Tasks settle successfully. Its execution prompt permits fixes for failures introduced by the current round and repeated verification, but forbids deleting tests, weakening assertions, or hiding failures. The independent review of Final Test is the final Task gate; a passing result appends the round validation.

The [Requirement Notebook pipeline note](2026-09-02-requirement-notebook-pipeline.md) continues to own stable Notebook identities, durable notes, task-cell presentation, and evidence-based historical-regression styling. This note supersedes its Plan-derived requirement and Task creation path.

## Alternatives considered

**Keep Plan mode and Plan approval.** Rejected because the user needs to review the clarified requirement document, not approve an implementation Plan that also acts as the requirement definition. Generic Plan mode remains available outside the Requirements Notebook.

**Always ask a fixed questionnaire.** Rejected because repository facts and unambiguous requests do not need user input. Questions are limited to material user-owned choices, with a bounded second batch for dependent ambiguity.

**Create one Task block per child checklist item.** Rejected because users need phase-level execution cells with related implementation and verification steps together. Child items remain editable inside one top-level Task block.

**Let Task completion advance without independent review.** Rejected because the implementing Agent's final response is not independent evidence. The reviewer verdict controls the terminal Task state and ordered continuation.

**Treat Final Test as an ordinary removable Task.** Rejected because every generated execution sequence needs one comprehensive last check that covers all acceptance criteria. Users may refine its checks but cannot remove or reorder it.

**Allow editing the round summary.** Rejected because it is navigation metadata derived from the accepted document, while the document is the user-editable source.

## Consequences

The Session log reconstructs the raw request, clarification decisions, accepted document revisions, Task generation source revision, edits, execution, per-Task review, ordered-run state, Final Test, and validation. The user has one requirement-review point before implementation without coupling the Notebook to Plan mode. Revision and lifecycle locks prevent stale generation and post-execution requirement rewrites. Ordered execution has more model calls and can stop on reviewer availability, but it never silently treats an unreviewed Task as complete.

## Testing

Session tests cover ambiguity analysis, clarification persistence, Chinese document validation, revision locking, Task generation and references, Final Test invariants, Task editing, ordered stop, blocking review, retry, and final validation. A Loader composition test boots the package from `cordis.yml` and observes the durable round plus model-visible no-Plan analysis prompt. Client assembly and React tests cover clarification history, read-only summary, document editing and invalidation, task-generation action, locks, reviewer states, Run All stop, and Final Test presentation. Focused TypeScript builds verify the host and client compiler faces.
