---
description: "Notebook presentation for requirement clarification, editable Chinese documents, executable Task blocks, and independent validation in the dsh Web conversation."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-requirements

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-requirements` registers the Requirements tab beside Chat and Trajectory. It presents each raw request as a summarized product round with collapsed clarification history, an editable Chinese requirement document, executable Task blocks, per-Task reviews, and final validation. The view keeps the DSH sidebar, Session header, tabs, and native bottom composer.

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

Submit a new requirement through the DSH bottom composer while the Requirements tab is active. The composer routes the raw text to `sessionRequirements.startRound`. The round header later displays the Agent-generated summary as read-only text. The original input and every clarification question and answer remain available inside the collapsed clarification record.

When ambiguity is resolved, the Notebook renders the complete requirement document as Markdown. Edit opens the source in place with explicit Save and Cancel controls. Saving creates a new document revision; an invalid revision displays its validation issues and disables Generate Tasks. A saved revision hides Tasks generated from an older document revision. The document cannot change while generation is running or after Task execution begins.

Generate Tasks is the document block's execution action. It asks the main Agent to inspect the repository and produce ordered top-level Task blocks from the exact document revision. The Requirements view contains no Plan card and no Plan approval action. Each generated Task keeps all child checklist items inside its top-level block and displays Chinese requirement references. Every Task is required; Final Test is always the last block.

Before execution, users can add, edit, move, or withdraw ordinary pending Tasks. Final Test remains editable but cannot be moved or withdrawn. Once a Task starts, completed, in-progress, and reviewing cells are locked. Future pending Tasks become editable after the current Task and review settle and Run All is stopped.

Run All executes one Task at a time and waits for its independent review. A passed or warning review continues to the next Task; a blocking or failed review stops. Stop Run All remains visible during ordered execution and takes effect after the current Task and review settle. Final Test runs only after every preceding Task completes and produces the final validation after its own review passes.

The selected Task retains run, move, comment, edit, details, withdrawal, and Agent-assistance actions when their state permits. Agent output renders below the input cell as Markdown and can be collapsed independently. Passive text notes and comments remain replayable Notebook events. Zoom stays at the bottom of the Notebook canvas, while relationship and evidence panels open only on demand.

Task execution failure uses `[!]` and an amber state. A warning review has its own warning presentation without blocking ordered execution. A confirmed accidental regression uses red only when the reviewer records that evidence; Task attribution appears only when the reviewer can support it.

The projection consumes append-only `requirement/round`, `requirement/clarification`, `requirement/document`, `requirement/task-list`, `requirement/task-execution`, `requirement/run-all`, `requirement/note`, `requirement/review`, and `requirement/validation` events, together with user-version and execution events. React state contains only selection, folding, drafts, zoom, and transient action state; durable Notebook content is rebuilt from the Session target.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package contributes target-specific Event Definitions, an append-only snapshot builder, a Session selector hook, a `conversation.view` registration, and a composer route supplied to `ui-conversation`. The native DSH composer remains the only entry point for a new product round. Notebook mutations call generated `sessionRequirements` Remotes, so document revisions, Task order, edits, withdrawals, notes, executions, and Run All state are replayable Session facts.

The view selects the latest event revision for each round, document, Task list, Task execution, review, Run All request, and note. A Task list renders only when its `documentRevision` equals the current document revision. Product copy belongs to the typed `requirements` locale namespace; reviewer-authored bilingual content comes from durable review and validation events.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [session-requirements](../../session/session-requirements/README.md) — host clarification, document, Task, and review orchestration.
- [ui-conversation](../ui-conversation/README.md) — DSH shell, native composer, and view routing.
- [ui-trajectory](../ui-trajectory/README.md) — detailed execution evidence.

-----

<a id="model-experience"></a>
## Model Experience

None, as this browser package calls host-owned Remotes and `session-requirements` owns every resulting analysis, task-generation, Task, dispatched assistance, and reviewer model request.

#### KV Cache effect

Host-owned prompts follow normal provider caching rules. Local selection, folding, drafts, zoom, and view changes do not affect the model cache. Saving a document does not call a model; Generate Tasks creates a new main-Agent request against that revision.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Unacknowledged edits are tab-local** — closing the tab can lose a pending or failed autosave, an unsaved document edit, or an unsubmitted comment.
- **Task output is bounded** — each Task retains a bounded final Agent response; detailed tool evidence remains in Trajectory and the Session log.
- **Task attribution is reviewer evidence** — the reviewer assigns a regression to a Task only when the evidence supports that relationship; otherwise final validation reports the regression without guessing.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

See the [requirement document before tasks Agent Note](../../../.agents/notes/implemented/feature/2026-09-06-requirement-document-before-tasks.md).

</details>
