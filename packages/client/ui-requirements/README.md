---
description: "Notebook presentation for requirement clarification, editable Chinese documents, executable Task blocks, and independent validation in the dsh Web conversation."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-requirements

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-requirements` registers the Requirements tab beside Chat and Trajectory. It presents each raw request as a summarized product round with collapsed clarification history, an editable Chinese requirement document, executable Task blocks, checkpoint reviews, and final validation. A collapsible right sidebar traces the current Session's requirements through Tasks to recorded file modifications.

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

When ambiguity is resolved, the Notebook renders the complete requirement document as Markdown. Edit opens the source in place with explicit Save and Cancel controls. Saving creates a new document revision; an invalid revision displays its validation issues and disables Generate Tasks. Tasks generated from older document revisions remain visible and read-only. The document cannot change while generation is running or after Task execution begins.

Generate Tasks is the document block's execution action. It asks the main Agent to inspect the repository and first produce ordered top-level technical Task blocks from the exact document revision, then translate each finished Agent Task into a concise human task description. The Requirements view contains no Plan card and no Plan approval action. Every Task is required; Final Test is always the last block.

The left Notebook shows Task titles, directly editable human descriptions, and status. Complete execution instructions remain outside each cell in a default-collapsed disclosure. Leaving the human editor or running a task saves the latest input and rewrites its execution instructions. Pending saves show Updating task; failures retain the draft and block execution. Human edits to completed Tasks reopen them for execution. Editing or adding nonempty work also returns a completed Final Test to pending. Final Test cannot be moved or withdrawn.

Run All executes one Task at a time and disables individual Task starts while it is active. A normal implementation Task advances directly after its Agent Turn completes and the Agent becomes idle; abnormal Turn endings, cancellations, and command/tool errors stop the sequence. Checkpoints wait for an independent review, where a passed or warning result continues and a blocking or failed result stops. Stop Run All remains visible during ordered execution and takes effect after the current Task and any required review settle. Final Test runs only after every preceding Task completes, then one comprehensive reviewer checks all requirements, regressions, Task results, and code evidence before producing final validation.

The selected Task provides run, move, details, withdrawal, and assistance actions when allowed. The collapsible result below the instruction disclosure shows only Deliverables and retains links. Task status markers remain visible; notes, review summaries, and execution details stay outside the result display. Recognized delivery sections are extracted from historical Markdown; unstructured output stays in details and Trajectory instead of becoming an invented result. The Notebook displays text notes but hides comments and their creation control; saved comments remain in the Session log. The requirement graph stays beside the Notebook until closed and becomes an overlay on narrow screens.

The graph has three fixed columns: user requirements, Tasks, and modified files. It reads only the current Session. Acceptance references connect requirements to Tasks; execution Turn ids connect Tasks to successful recorded file mutations. Shared files appear once. Requirements stay in progress after mapped Tasks complete and become verified only after successful final validation; a Task's completed label does not claim that its requirement is verified. Selecting a node highlights its directed ancestors and descendants; selecting a file opens its historical before/after snippets. Requirement selection and the Task inspector can locate Notebook cells. Zoom and Show all affect only this panel. Drag the left edge to resize the panel; its content scrolls vertically independently of the Notebook.

A running Task exposes a stop button in place of Run. Stop cancels its queued message, active execution, or required review, and prevents Run All from advancing. After cancellation settles, the failed Task can run again. Cancellation does not undo file modifications.

Task execution failure uses `[!]` and an amber state. A checkpoint or Final Test warning has its own warning presentation without blocking ordered execution. A confirmed accidental regression uses red only when the reviewer records that evidence; Task attribution appears only when the reviewer can support it.

The Notebook projection consumes append-only `requirement/round`, `requirement/clarification`, `requirement/document`, `requirement/task-list`, `requirement/task-execution`, `requirement/run-all`, `requirement/note`, `requirement/review`, and `requirement/validation` events, together with user-version and execution events. The graph reads only the current row's `requirementGraph` and `requirementChanges` projections and joins them with the complete Notebook. React state contains only selection, folding, drafts, zoom, graph visibility, and transient action state.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package contributes target-specific Event Definitions, an append-only snapshot builder, a Session selector hook, a `conversation.view` registration, and a composer route supplied to `ui-conversation`. The native DSH composer remains the only entry point for a new product round. Notebook mutations call generated `sessionRequirements` Remotes, so document revisions, Task order, edits, withdrawals, notes, executions, and Run All state are replayable Session facts.

The Notebook reads the host's complete `requirementNotebook` projection through the Session projection subscription. Chat pagination, refreshes, and stream reconnection cannot remove saved cells. Each document revision retains its task list, and each execution attempt retains its delivery output, including while a revised task runs again. Current tasks remain editable under the normal locks; older document tasks are read-only. The graph joins current-document Tasks and their execution attempts without reading other Session logs. Product copy belongs to the typed `requirements` locale namespace.

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

- **Unacknowledged edits are tab-local** — closing the tab can lose a pending or failed autosave or an unsaved document edit.
- **Task output is bounded** — each Task retains a bounded final Agent response; detailed tool evidence remains in Trajectory and the Session log.
- **Task attribution is reviewer evidence** — the reviewer assigns a regression to a Task only when the evidence supports that relationship; otherwise final validation reports the regression without guessing.
- **Relations stay inside one Session** — the authoring Agent can link rounds from its own Notebook history; the Workspace view combines Sessions but does not infer dependencies between separate Sessions.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

See the [batched requirement review Agent Note](../../../.agents/notes/implemented/feature/2026-09-16-batched-requirement-review.md) and the [Workspace requirement knowledge graph Agent Note](../../../.agents/notes/implemented/feature/2026-09-08-workspace-requirement-knowledge-graph.md).

</details>
