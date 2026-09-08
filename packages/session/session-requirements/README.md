---
description: "Durable clarification, Chinese requirement-document generation, executable task orchestration, and independent review for the dsh Requirements Notebook."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-requirements

English | [中文](README.zh.md)

## Summary

`dsh-session-requirements` turns one raw product request into a replayable Chinese requirement document before implementation begins. The main Agent asks only material clarification questions, then generates an editable document and its requirement graph. On explicit user action, it creates ordered executable Task blocks whose reviewed progress updates the graph. A mandatory last Final Test produces the round validation.

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

Mount the plugin where `agents`, `subagents`, `tools`, and `userQuestions` are available. Configure a registered one-shot reviewer provider, the review prompt character limit, the exact read-only tools available to the reviewer, the maximum clarification batches, and the maximum questions per batch. The Web bundle uses two batches of at most five questions.

`startRound` preserves the raw input in `requirement/round` and queues a main-Agent analysis turn. The prompt requires read-only repository inspection before questions. When a decision belongs to the user and materially changes the result, the Agent calls `clarify_requirements`; the answers and the original questions are durable `requirement/clarification` events. The Agent can ask another batch within the configured limit. It otherwise calls `submit_requirements_document` without entering Plan mode or modifying files.

The submitted document is Chinese Markdown with `# 需求文档`, `## 简介`, and `## 需求`, followed by consecutively numbered requirements, user stories, and acceptance criteria. `submit_requirements_document` also submits real dependencies within the current document and explicit refinement or supersession links to earlier rounds in the same Session. The host validates the document, graph endpoints, and dependency cycles before appending `requirement/document` and `requirement/graph`. The browser may append a new document revision through `editDocument`; a valid edit rebuilds graph nodes and retains only relations whose endpoints still exist, while an invalid revision remains visible, publishes no current graph, and cannot generate Tasks. Editing is blocked while task generation runs and after any Task execution begins.

`generateTasks` queues a read-only main-Agent turn against one exact valid document revision. `submit_requirement_tasks` commits at least one implementation or checkpoint block plus one separate Final Test block. Each block contains all child checklist items for one top-level phase, uses Chinese `_关联需求：…_` references to real acceptance criteria, and is mandatory. The host places Final Test last and rejects a list that does not cover every acceptance criterion.

Before execution, pending Tasks can be added, edited, reordered, or withdrawn; Final Test can be edited but cannot be withdrawn or moved. Once execution starts, completed and running Tasks remain locked. Future pending Tasks can change only after the current Task and its review settle. `runTask` queues one Task in the main conversation. `runAll` continues in order after each accepted review, and `stopRunAll` stops after the current Task and review settle.

Each completed Task turn enters `reviewing`. The independent reviewer must return the matching Task identity and a `passed`, `warning`, or `blocking` verdict. Passed and warning verdicts advance execution; a blocking verdict, reviewer failure, or confirmed historical regression marks the Task failed and stops Run All. Final Test can repair failures introduced by the current round and rerun checks, but its prompt forbids deleting tests, weakening assertions, or hiding failures. A passed Final Test appends the final validation event.

Text and comment cells remain durable note events. Passive Markdown uses `dispatch: false`; explicit Agent assistance uses `dispatch: true` and follows up in the main conversation. The existing `commit` Remote remains available for version-addressed requirement records used by the historical-review model.

The optional Session projection service folds each Session's graph, current Task list, and final validation into the client-visible `requirementGraph` value. During historical replay it deterministically extracts nodes from valid requirement documents that predate graph events, with an empty relation list, so existing Notebook rounds appear immediately after upgrade. A node is pending before mapped work completes, in progress while mapped work runs or only some acceptance criteria are complete, verified when reviewed non-final Tasks cover all of its acceptance criteria, and blocked after a mapped failure or recorded regression. The standard Session-list projection carries this value for both open and unopened Sessions so a browser can combine it by Workspace without reading foreign logs.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package registers three model tools for clarification, document submission, and task submission. Append-only round, clarification, document, graph, task-list, task-execution, Run All, note, review, and validation events let the browser rebuild the Notebook without storing product state in React. Document, graph, and Task-list revisions remain explicit, so a document edit invalidates older generated Tasks and their current graph without rewriting history.

Task execution joins the queued message to its Agent turn. Turn completion records output and starts the independent reviewer; only the reviewer settlement writes the Task terminal state and decides whether ordered execution continues. The in-memory Run All controller owns only the live continuation and stop request, while every user-visible state transition is durable.

The reviewer child is limited to the first delegation level and receives an explicit read-only tool allowlist. Disposal aborts active children and drains their promises. A completed child result is committed only while the exact parent Agent remains registered for the Session.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-requirements](../../client/ui-requirements/README.md) — browser Notebook projection and native composer routing.
- [user-questions](../../interaction/user-questions/README.md) — interactive clarification request handling.
- [subagent](../../subagent/subagent/README.md) — one-shot reviewer execution.
- [session](../../core/session/README.md) — durable event log receiving Notebook facts.

-----

<a id="model-experience"></a>
## Model Experience

### Requirement Notebook turns

#### What the model sees

The first main-Agent prompt contains the raw request, the clarification policy, the exact Chinese document structure, the current Session's prior graph index, and prohibitions against Plan mode, file edits, and early task generation. The Agent submits dependencies plus explicit refinement or supersession links with the document and uses an empty relation list when no relation exists. A generation prompt contains the accepted document revision and the required Task and Final Test formats. A Task prompt names exactly one Task and its linked acceptance criteria. The reviewer receives the prior requirement snapshot, current Notebook events including graph facts, parent-turn evidence, and read-only workspace instructions.

#### Token effect

Each new round, task-generation request, explicitly run Task, and dispatched assistance note creates one ordinary main-Agent turn. Clarification answers continue the active analysis turn through the user-question interaction. Passive notes and document edits do not call a model. Each completed Task turn triggers one auxiliary reviewer request; manual `/requirements` review also triggers one. Reviewer input is bounded by `maxInputChars`.

#### KV Cache effect

Main prompts follow normal provider caching rules. Document revisions, generated Tasks, and Session evidence change later requests from their first changed token. Reviewer requests also vary with the accumulated evidence and prior snapshot.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Clarification is deliberately bounded** — after the configured batches, unresolved material ambiguity leaves the round waiting for user direction instead of guessing.
- **Task generation is revision-locked** — the document cannot change while a generation turn is active; retry or edit after that turn settles.
- **Task output is bounded** — a task-execution event stores a bounded final assistant response; the complete tool transcript remains in Trajectory and the Session log.
- **Review failure stops progress** — a missing, invalid, unavailable, or blocking reviewer result fails the current Task and requires an explicit retry.
- **Graph relations are Session-local** — document authoring can reference earlier rounds from the same Session, and the browser can aggregate those graphs by Workspace; cross-Session relation authoring is not supported.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

See the [Workspace requirement knowledge graph Agent Note](../../../.agents/notes/implemented/feature/2026-09-08-workspace-requirement-knowledge-graph.md).

</details>
