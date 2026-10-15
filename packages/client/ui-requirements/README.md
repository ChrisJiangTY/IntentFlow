---
description: "Notebook presentation for requirement clarification, editable Chinese documents, executable Task blocks, and independent validation in the dsh Web conversation."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-requirements

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-requirements` registers the Requirements tab beside Chat and Trajectory. It presents requirement rounds with summaries, clarification, document revisions, executable Task blocks, checkpoint reviews, and final validation, and presents standalone task rounds without a requirement document. Its `dsh-better-sidebar` tab traces the current Session's requirements and Tasks to recorded file modifications.

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

The RECO workspace places Chat, Trace, and Requirements beside `+ Code`, `+ Text`, and Run all in one navigation row. These actions operate on the current Session's requirement document and Tasks; their cards, labels, and status come from recorded Session data rather than example text in the [desktop design](https://www.figma.com/design/JastOBEf9QnfNAqGqyaSIR/Untitled?node-id=67-96). The 33 px Session header and 40 px navigation row align both dividers with the right-sidebar tabs; the Chat and right-panel toggles sit at the workspace's upper-right corner without reserving tab width. The sidebar retains its file, graph, and subagent views beneath the Chat overlay. Change the interface language in Settings at the lower left; the workspace follows the shared locale, while user-authored text, Agent output, filenames, and code retain their recorded content.

Settings → General also controls conversation and Requirements Notebook reading text from 12 to 17 px, with 14 px as the default. Round, clarification, document, and Task headings remain only one to three pixels above the chosen body size. Compact labels and the requirement graph retain their own sizing.

Click an inline-code `.html` or `.htm` delivery filename to preview the page in the right sidebar. Relative paths resolve against the current Session's working directory; absolute paths retain their location. The viewer reports missing files, and the Notebook reports an unavailable viewer or working directory.

Submit input through the right Chat composer, which asks whether a plain prompt is normal conversation, a requirement, or a standalone task. A requirement adds input to the latest requirement round and asks the Agent to submit a complete revised document; if no requirement round exists, it starts one. Previous revisions and execution results remain available. A standalone task creates a new task-only round with one pending Task and no document. Requirement round headings display the Agent-generated, read-only summary in the largest type. Directly below, the default-collapsed Requirement clarification section holds the combined input, including additions, and every clarification question and answer; the requirement document follows that section. Task-only rounds display their Task without clarification or document cells.

Each time the Requirements view opens, the Notebook scrolls to the latest cell. A round the user collapsed stays closed when switching views, so the user must expand it manually.

When ambiguity is resolved, the Notebook renders the requirement document as a compact Markdown preview. The document card's upper-right Expand document button reveals the complete text, which scrolls with the Notebook; Collapse document restores the preview. Edit opens the source in place with explicit Save and Cancel controls. Saving creates a new document revision; an invalid revision displays its validation issues and disables Generate Tasks. Tasks generated from older document revisions remain visible and read-only, and their prior validation is marked historical. Manual editing remains locked after a Task from the current revision begins; a new requirement prompt asks the Agent for a new editable revision while preserving prior results.

Generate Tasks is the document block's execution action. It asks the main Agent to inspect the repository and first produce ordered top-level technical Task blocks from the exact document revision, then translate each finished Agent Task into a concise human task description. Each Task includes verification for its scope, and their acceptance references cover the document together. The Requirements view contains no Plan card and no Plan approval action.

The left Notebook shows each Task in one compact card with a thin outer border and a divider between its title row and borderless human description. Pending and failed Task titles and descriptions share one edit: moving focus within the card keeps the draft; leaving the card or running the Task saves both fields together. Complete execution instructions remain outside each cell in a default-collapsed disclosure. Saving a changed human description rewrites the execution instructions. Pending saves show Updating task; failures retain the draft and block execution. Human edits to completed Tasks reopen them for execution. Editing or adding nonempty work invalidates prior round validation. A recorded Final Test, when present, also returns to pending and cannot be moved or withdrawn.

Run All executes one Task at a time and disables individual Task starts while it is active. A normal implementation Task advances directly after its Agent Turn completes and the Agent becomes idle; abnormal Turn endings and cancellations stop the sequence. Individual tool errors remain recoverable within the Turn; long-running Tasks receive the [Task health check](../../session/session-requirements/README.md#use-this-package). Checkpoints wait for an independent intermediate review, where a passed or warning result continues and a blocking or failed result stops. Stop Run All remains visible during ordered execution and takes effect after the current Task and any required review settle. Once all active Tasks complete, one independent read-only reviewer audits all requirements, regressions, Task results, and code evidence on the last settled Task before final validation appears. Recorded Task lists with a Final Test keep that Task executable.

The selected Task provides run, move, details, withdrawal, and assistance actions when allowed. The collapsible result below the instruction disclosure shows only Deliverables and retains links. A plain click on an external HTTP or HTTPS delivery opens a Session-scoped browser tab in the right sidebar when that tab is available; otherwise the anchor keeps its native browser behavior. Modified clicks always keep native behavior. Task status markers remain visible; notes, review summaries, and execution details stay outside the result display. Recognized delivery sections are extracted from historical Markdown; unstructured output stays in details and Trajectory instead of becoming an invented result. The Notebook displays text notes but hides comments and their creation control; saved comments remain in the Session log.

Requirement graph is the default right-sidebar tab for the current Session; preparing it does not expand a closed sidebar, and an explicit file or browser open can take focus normally. The `+` menu restores a closed graph tab. A circular icon button at the canvas's upper left toggles two deterministic presentations of the same documents → requirements → Tasks → modified files: Layered · Spline is the default fixed four-plane view with shallow ordered rows, readable node sizes, and blue curved links; Radial · Concentric maps the types from the center to three outer rings.

Switching layout preserves disclosure, search, round filtering, selection, zoom, and the inspector split. It brings a selected node into view after the geometry changes; without a selection, it returns the canvas to its origin. Numbered ringed nodes use the Figma assets; hovering exposes the title and selecting opens the details below.

Initially, document nodes and standalone Tasks appear as roots. Each node's `+`/`−` independently expands or collapses the next layer, preserving shared nodes while another expanded parent reaches them. Search and round controls align left in the first row, while Expand all aligns right and reveals every node in the selected round scope, including unassigned Tasks. The graph-control row keeps the 28px layout toggle left and zoom right. Its icon shows the current view; its tooltip names the current and next view. Search includes collapsed nodes and reveals all ancestor paths. Node numbers follow their Session-wide layer order, independent of disclosure and filtering. Live updates preserve expansion choices.

Every layout scales uniformly with sidebar width; vertical overflow remains scrollable and the manual zoom remains available. Dense rings or rows reduce node scale, while search and branch collapse isolate relevant nodes. The sidebar owns horizontal resizing. The latest requirement document is selected by default unless a later standalone Task round exists; the graph and details inspector each start with half the body height. Its horizontal separator supports pointer dragging and arrow/Home/End keys within 15–60%. Selection preserves the chosen split; documents and extracted requirement sections render as Markdown below the graph. Content is always visible, with one compact right-aligned Locate Notebook button. Code paths open the sidebar file viewer, and Locate Notebook on a file targets its first recorded owning Task.

Acceptance references connect requirements to Tasks; execution Turn ids connect Tasks to successful recorded file mutations. Selecting a node highlights its directed ancestors and descendants. Explicit detail actions locate the Notebook document, requirement heading, or Task, or open a code file in a sidebar tab. File details retain historical before/after snippets. Completed mapped Tasks show their in-progress requirement as Awaiting final review, not Verified; only successful final validation verifies requirements. Search can locate unassigned Tasks without inventing requirement links.

A running Task exposes a stop button in place of Run. Stop cancels its queued message, active execution, or required review, and prevents Run All from advancing. After cancellation settles, the failed Task can run again. Cancellation does not undo file modifications.

Task execution failure uses `[!]` and an amber state. A checkpoint or final round review warning has its own warning presentation without blocking ordered execution. A confirmed accidental regression uses red only when the reviewer records that evidence; Task attribution appears only when the reviewer can support it.

The Notebook projection consumes append-only `requirement/round`, `requirement/clarification`, `requirement/document`, `requirement/task-list`, `requirement/task-execution`, `requirement/run-all`, `requirement/note`, `requirement/review`, and `requirement/validation` events, together with user-version and execution events. The graph joins the current Session's `requirementGraph` and `requirementChanges` projections with its complete Notebook, including standalone Tasks. Graph interaction state is tab-local; durable graph data comes only from the current Session projections.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package contributes target-specific Event Definitions, an append-only snapshot builder, a Session selector hook, and a `conversation.view` registration. The conversation shell passes its registered view tabs and selection action to the Requirements view for the shared navigation row. The right Chat composer is the only prompt entry point; its explicit requirement and task intents call generated `sessionRequirements` Remotes. Document revisions, Task order, edits, withdrawals, notes, executions, and Run All state remain replayable Session facts.

The Notebook reads the host's complete `requirementNotebook` projection through the Session projection subscription. Chat pagination, refreshes, and stream reconnection cannot remove saved cells. Each document revision retains its task list, and each execution attempt retains its delivery output, including while a revised task runs again. Current tasks remain editable under the normal locks; older document tasks are read-only. A task-only round reads its revision-zero task list without inventing a document. The package registers one graph descriptor through the injected `betterSidebar` service. When a Session becomes active, the adapter performs a type-only open with that Session scope; it prepares the graph without expanding the sidebar and does not repeat the open for same-Session state changes. Session changes replace the graph source and reset tab-local interaction state. The apply layer joins current-document or task-only Tasks with their execution attempts without reading other Session logs, keeps snippet-bearing graphs in memory, and writes only a revision token to tab metadata when the current graph changes. Product copy belongs to the typed `requirements` locale namespace.

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

See the [right Chat and intent Agent Note](../../../.agents/notes/implemented/feature/2026-09-29-session-right-chat-intents.md), the [RECO workspace presentation Agent Note](../../../.agents/notes/implemented/feature/2026-09-24-reco-requirements-workspace.md), the [round validation Agent Note](../../../.agents/notes/implemented/simplification/2026-09-24-validate-round-without-final-test.md), the [progressive graph Agent Note](../../../.agents/notes/implemented/feature/2026-09-17-progressive-requirement-graph.md), the [switchable graph layouts Agent Note](../../../.agents/notes/implemented/feature/2026-09-18-switchable-requirement-graph-layouts.md), and the [Workspace requirement knowledge graph Agent Note](../../../.agents/notes/implemented/feature/2026-09-08-workspace-requirement-knowledge-graph.md).

</details>
