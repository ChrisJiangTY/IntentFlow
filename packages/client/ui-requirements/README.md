---
description: "Notebook presentation for requirement rounds, plans, task execution, and independent validation in the dsh Web conversation."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-requirements

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-requirements` registers the Requirements tab beside Chat and Trajectory. It keeps the DSH sidebar, Session header, tabs, and native bottom composer, while presenting each requirement round as a Notebook containing the raw requirement Markdown, the Plan, executable Task cells, notes, and a final validation cell.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Submit a new requirement through the DSH bottom composer while the Requirements tab is active. The composer routes the raw text to `sessionRequirements.startRound`; the host records the product round and Markdown artifact, enables Plan mode, and queues the planning message. The raw input remains the round source rather than being replaced by an inferred title.

The Notebook renders rounds in order. Each round contains the Markdown requirement, the captured Plan, Todo-derived Task cells, durable text or comment cells, and the final validation cell. The fixed top toolbar is the only place that inserts code-task and text cells, so these actions remain available while the Notebook scrolls through multiple rounds. It provides commands, review, and ordered Run all execution; language switching remains in the Command menu instead of occupying a separate control on the right. A new code-task editor starts as a compact single row and grows vertically with its content. Each generated Task represents one top-level numbered Plan phase rather than one child checklist item, and its cell label uses `TASK1`, `TASK2`, and so on. It starts with a plain-language title that explains the whole phase outcome; the indented body preserves the phase heading, all child checklist items, technical details, implementation steps, and validation conditions. The title and body form one editable source inside the bordered input cell. The Agent response renders immediately below it as an unbordered Markdown output that preserves headings, paragraphs, lists, tables, inline code, and fenced code. Each output starts expanded and has a left disclosure arrow that independently collapses or restores its answer. A selected Task exposes run, move, comment, edit, details, withdrawal, and Agent-assistance actions, while zoom stays at the bottom of the Notebook canvas.

Code insertion creates a durable empty Task at the end of the round's Task list and focuses its editor. New and existing Task cells autosave as the user types, without Save or Cancel controls. Edits to each Task are serialized, with newer input retained while a save is pending. The left run button and Run all wait for the latest edits to persist before execution; save failure retains the input and blocks execution until a retry succeeds. A title-only Task can run; a completely empty cell cannot run and is skipped by Run all.

Text insertion creates a passive Markdown note with no run button. The note reuses DSH's `MarkdownText` renderer for headings, lists, tables, and code blocks. Edit switches to Markdown source; Preview or leaving the editor restores the rendered note. Changes autosave in order, preserving whitespace, without Save or Cancel controls. A failed save retains the source and offers retry. Reopening the Session displays the latest saved source under the same note identity. Explicit comment insertion retains Save and Cancel controls; dispatched Agent-assistance comments cannot be edited.

Task execution failures use `[!]` and an amber task state. A confirmed accidental regression of an active historical requirement uses a red Task cell when the reviewer can attribute it, and a red validation cell otherwise. User-authorized refinement, replacement, and withdrawal remain ordinary requirement lifecycle changes and are not rendered as regressions.

The projection consumes append-only `requirement/round`, `requirement/markdown`, `requirement/plan`, `requirement/task-list`, `requirement/task-execution`, `requirement/note`, and `requirement/validation` events, together with the existing review, user-version, and execution events. React state contains only selection, folding, draft, zoom, and transient action state; durable Notebook content is rebuilt from the Session target.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The package contributes target-specific Event Definitions, an append-only snapshot builder, a Session selector hook, a `conversation.view` registration, and a composer route supplied to `ui-conversation`. The native DSH composer remains the only entry point for a new product round. Notebook mutations call generated `sessionRequirements` Remotes, so task order, task edits, withdrawals, notes, and executions are replayable Session facts.

The view has no replacement bottom input and no fixed right inspector. Details open on demand from a selected cell. Product copy is owned by the typed `requirements` locale namespace; reviewer-authored bilingual content comes from durable review and validation events.

-----

<a id="further-exploration"></a>
## Further Exploration

- [session-requirements](../../session/session-requirements/README.md) — host orchestration and durable Notebook event vocabulary.
- [ui-conversation](../ui-conversation/README.md) — DSH shell, native composer, and view routing.
- [ui-trajectory](../ui-trajectory/README.md) — adjacent activity ledger.

-----

<a id="model-experience"></a>
## Model Experience

None, as this browser-side package only invokes host-owned Remotes; `session-requirements` owns every resulting planning, Task, dispatched assistance, and reviewer model request.

#### KV Cache effect

Host-owned round, Task, and explicitly dispatched assistance prompts follow normal provider caching rules; passive notes, local selection, folding, zoom, and view changes do not affect the model cache.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Task output is bounded** — each Task retains a bounded final Agent response; detailed tool evidence remains in the Trajectory and Session log.
- **Task attribution is reviewer evidence** — the reviewer assigns a regression to a Task only when the evidence supports that relationship; otherwise validation reports the regression without guessing.
- **Unacknowledged edits are tab-local** — pending or failed autosaves and unsubmitted comments can be lost when the tab closes; acknowledged Task and Markdown note edits are rebuilt from the Session log.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

See the [requirement Notebook pipeline Agent Note](../../../.agents/notes/implemented/feature/2026-09-02-requirement-notebook-pipeline.md).

</details>
