# Agent Note: Requirement Notebook pipeline

Status: implemented

English | [中文](2026-09-02-requirement-notebook-pipeline.zh.md)

## Problem

The Requirements view needs to show the product path that users see: a raw request becomes a clarified requirement document, executable Task cells, per-Task review, and final validation. The DSH shell and its bottom composer remain recognizable, while historical requirements need independent regression review instead of being marked red for ordinary task failure.

## Decision

`session-requirements` owns a durable product round identified by `RequirementRoundId`. The [requirement-document decision](2026-09-06-requirement-document-before-tasks.md) owns clarification, document revisions, Task generation, review gates, and Final Test. This note retains the stable Notebook identity, Task-cell editing, note behavior, evidence presentation, and historical-regression styling. `runTask`, `runAll`, `stopRunAll`, `addTask`, `editTask`, `moveTask`, and `withdrawTask` append Task, ordered-run, and execution events that the browser can replay. `addNote` always appends a note event; `dispatch: false` keeps text and comments passive, while `dispatch: true` sends an explicit assistance request to the main conversation.

The browser renders these events in a Figma-aligned Notebook inside the existing DSH shell. The native bottom composer is the only entry point for a new product round. Code-task and text insertion exist only in the top Notebook toolbar; a code editor starts as a compact single row and grows vertically with its content. The view also provides command actions, ordered execution, task editing and movement, withdrawal, comments, on-demand evidence, history and relationship drawers, bottom-canvas zoom, language switching, and review. Task failure is shown with `[!]` and an amber state; it is not a historical regression.

Code insertion creates a durable empty pending Task so new and generated Tasks use the same editor and stable execution identity. Task text autosaves without a confirmation form. Per-Task saves serialize and coalesce pending input; execution waits for the latest save to succeed. Failed saves retain the editable source and block execution. Empty drafts are durable but non-executable, while a single nonblank title or statement is sufficient to run.

Text cells are passive Markdown annotations. They reuse `MarkdownText` for preview and autosave verbatim source under a stable note identity. Each edit appends a `requirement/note` replacement; the view folds revisions into one cell. The invariant includes the event being appended when checking note history, so a dispatched note or comment cannot be rewritten. Notes have no execution action; explicit assistance remains a separate, immutable dispatched comment.

After each parent turn, the independent reviewer receives the current Notebook artifacts, historical review snapshot, parent-turn evidence, and read-only workspace access. It emits a regression only for a confirmed accidental break of an active historical requirement. A Task is marked red only when the reviewer supplies reliable task attribution; otherwise only the final validation cell is red. User-authorized refinement, replacement, and withdrawal are not regressions.

The earlier [requirement evolution view note](2026-08-30-requirement-evolution-view.md) remains the record of the review, stable-identity, and bilingual-evidence decisions. This note supersedes its time-first/right-inspector presentation choice for the current product UI.

## Alternatives considered

**Keep the time-first requirement cards and fixed inspector.** Rejected for the product surface because it hides the ordered transformation from request to requirement document, Task execution, and validation; historical review data remains available through the Notebook validation cell and on-demand details.

**Keep Notebook state only in React.** Rejected because a refreshed or reopened Session would lose the product round and its execution history. Notebook facts are Session events and the assembly builder is their browser projection.

**Use Agent Turns as the Notebook's round identity.** Rejected because planning, task execution, notes, and validation can span multiple turns. `RequirementRoundId` groups those turns without changing the existing Agent lifecycle.

**Color every failed Task red.** Rejected because execution failure and historical regression are different facts. Task execution stores failure independently; red styling requires an explicit reviewer regression.

**Run all Tasks concurrently.** Rejected because ordered Task cells need deterministic dependencies and a clear failure point. `runAll` queues one next Task and stops after a failed turn.

**Require Save before using a new Task.** Rejected because it gives new and existing code cells different interactions and leaves partially written tasks outside the Session log. Markdown annotations also autosave; explicit comment submission remains a separate action.

**Build a separate Markdown renderer for notes.** Rejected because notes need the existing DSH formatting and untrusted-content rules, not a second parser or rendering policy.

## Consequences

The Session log can reconstruct each product round, raw request, clarification, requirement-document revisions, Task order, plain-language Task title, complete technical statement, Task execution output, note dispatch choice, per-Task review, validation result, and historical regression. The DSH composer keeps its existing interaction and routes only while the Requirements view is active; ordinary Chat and Trajectory input behavior is unchanged. A Task cell stores a bounded final assistant response while detailed tool evidence remains in Trajectory and the Session log. Autosave adds Task-list and note revisions during editing; only unacknowledged edits and unsubmitted comments remain tab-local. Reviewer attribution remains evidence-dependent.

## Testing

Session tests cover round creation, exact input preservation, document and Task revisions, task insertion, editing, reordering, withdrawal, passive versus dispatched notes, ordered execution, and review settlement. Requirements client tests cover Notebook ordering, top-only insertion, compact editor growth, execution markers, selected-task actions, note dispatch, on-demand evidence, history and relationships, status colors, and event assembly. The [requirement-document decision](2026-09-06-requirement-document-before-tasks.md) records the additional clarification, generation, review-gate, and Final Test coverage.
