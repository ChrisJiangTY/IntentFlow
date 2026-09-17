---
description: "Durable clarification, Chinese requirement-document generation, executable task orchestration, and independent review for the dsh Requirements Notebook."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-requirements

English | [中文](README.zh.md)

## Summary

`dsh-session-requirements` turns one raw product request into a replayable Chinese requirement document before implementation begins. The main Agent asks only material clarification questions, then generates an editable document and its requirement graph. On explicit user action, it creates ordered executable Task blocks whose execution progress updates the graph. A mandatory last Final Test receives one comprehensive review and produces the round validation.

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

`generateTasks` queues a read-only main-Agent turn against one valid document revision. `submit_requirement_tasks` validates complete technical tasks before separate tool-free children translate their titles and human descriptions. Translation must return the execution statement unchanged. Generated descriptions use Chinese, at most two sentences and 120 characters, with mechanically checked exclusions for commands and execution statistics. Semantic fidelity remains a model responsibility.

Human edits through `editTask` rewrite the complete execution statement and preserve the user's description verbatim. The durable `humanInstruction` overrides conflicting older generated requirements in execution and review. A successful edit or a newly added nonempty Task returns a completed Final Test to pending; old validation is not current evidence. Concurrent edits to different Tasks merge into the latest list; changes to the edited Task or source document reject stale rewrites. Failed saves leave the persisted Task unchanged. Agent-side text edits receive a new translation. Running, reviewing, and withdrawn Tasks remain locked.

Run All starts and continues with the first nonempty pending or failed Task in list order, skipping completed and withdrawn Tasks. A normally completed implementation Task advances directly to the next Task without starting a reviewer. A checkpoint advances only after its review passes. Retrying Run All includes all previously failed Tasks before Final Test. Stop Run All takes effect after the current Task and any required checkpoint or Final Test review settle.

Stopping an individual Task removes its queued message or cancels its active turn while preserving unrelated queued input. During review, it aborts the task reviewer and rejects late results. The Task settles as failed and remains retryable; Run All cannot advance after this stop. Existing file modifications remain on disk.

A normal implementation Turn becomes completed when the Agent Turn ends normally. A non-completed Turn ending, including error or cancellation, marks the Task failed and stops Run All. Individual tool errors and command failures remain available to the Agent for recovery and do not cancel the Task. Only checkpoint and Final Test Tasks enter `reviewing`; their independent reviewer must return the matching Task identity and a `passed`, `warning`, or `blocking` verdict. Passed and warning verdicts advance execution, while a blocking verdict, reviewer failure, or confirmed historical regression marks the Task failed and stops Run All. Final Test can repair failures introduced by the current round and rerun checks, but its prompt forbids deleting tests, weakening assertions, or hiding failures. Its reviewer audits all active requirements, regressions, Task results, and workspace code evidence in one pass. A passed Final Test appends the final validation event.

Each Task attempt starts one independent read-only health check after `taskHealthCheckAfterMs` of execution, defaulting to one hour. The Task continues during diagnosis. A `stop` verdict with a reason and concrete evidence fails that same active attempt, stops Run All, and cancels its Turn while preserving unrelated queued input. A `continue` verdict, unavailable child, invalid verdict, or diagnostic timeout leaves execution running. `taskHealthCheckTimeoutMs` defaults to five minutes and limits only the diagnostic child. Task settlement or disposal aborts the diagnostic and rejects late verdicts.

Text and comment cells remain durable note events. Passive Markdown uses `dispatch: false`; explicit Agent assistance uses `dispatch: true` and follows up in the main conversation. The existing `commit` Remote remains available for version-addressed requirement records used by the historical-review model.

The `requirementNotebook` Session projection reconstructs saved cells across the complete log. It retains document revisions, each revision's latest task list, and every execution attempt's output; unrelated conversation messages do not affect it. Existing sessions reconstruct this value from their recorded events. The browser reads it independently of paginated Chat history, with sequence-ordered projection updates preventing stale reconnect baselines from replacing newer saved content.

The optional Session projection service folds each Session's graph, current Task list, and final validation into the client-visible `requirementGraph` value. During historical replay it deterministically extracts nodes from valid requirement documents that predate graph events, with an empty relation list, so existing Notebook rounds appear immediately after upgrade. A node is pending before mapped work starts, in progress after mapped work starts or completes, verified only after the comprehensive Final Test review appends successful validation, and blocked after a mapped failure or recorded regression. Completed Task nodes use a separate completed label and do not imply requirement verification. The standard Session-list projection carries this value; the requirement graph UI selects only the current Session. The `requirementChanges` projection correlates successful mutation results by call id and Turn, retains applied snippets, and excludes reads, failed calls, and no-op diffs. It supports `write`, `edit`, and mutating `str_replace_editor`; unrecorded shell or delegated mutations are not inferred.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package registers three model tools for clarification, document submission, and task submission. Append-only round, clarification, document, graph, task-list, task-execution, Run All, note, review, and validation events let the browser rebuild the Notebook without storing product state in React. Document, graph, and Task-list revisions remain explicit, so a document edit invalidates older generated Tasks and their current graph without rewriting history.

Task execution binds the queued message to its Agent Turn when the inbox claims it, before model-input assembly, so pre-step failure and cancellation still settle the exact Task. The final reply contains only delivery results and notes, including limitations or failure. Turn completion records the last nonempty assistant reply without concatenating progress messages. After a normal implementation Turn, Run All waits for whole-Agent quiescence before queuing the next Task; checkpoint and Final Test Turns start the independent reviewer, whose settlement decides whether ordered execution continues. The in-memory Run All controller owns only live continuation and stop requests; every user-visible state transition is durable.

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

The first main-Agent prompt contains the raw request, clarification policy, document structure, and prior graph index. Task generation submits complete execution statements. Translation children see each exact statement; revision children additionally see the human's latest instruction. Task execution and review receive durable user direction, which takes precedence over conflicting old requirements. Child prompts and results remain reconstructable from child Session logs.

#### Token effect

Each generation invokes one main-Agent turn and one tool-free child per Task. A human or nonempty Agent-side task edit invokes one child through `reviewerProvider`, without executing the task. Transformation and acceptance children share serialized review scheduling, cancellation, and disposal. Full transformation prompts must fit `maxInputChars`; oversized input fails without truncation. Acceptance review calls are limited to explicit checkpoints and the mandatory Final Test. A long-running Task additionally starts one concurrent health child through the same provider and read-only tool allowlist; its prompt contains Task details and recent Turn evidence bounded by `maxInputChars`.

#### KV Cache effect

Main prompts follow normal provider caching rules. Document revisions, generated Tasks, and Session evidence change later requests from their first changed token. Reviewer requests also vary with the accumulated evidence and prior snapshot.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Clarification is deliberately bounded** — after the configured batches, unresolved material ambiguity leaves the round waiting for user direction instead of guessing.
- **Task generation is revision-locked** — the document cannot change while a generation turn is active; retry or edit after that turn settles.
- **Task output is bounded** — a task-execution event stores a bounded final assistant response; the complete tool transcript remains in Trajectory and the Session log.
- **Health checks are one-shot** — evidence is bounded, diagnosis may be inconclusive, and a continuing Task is not periodically rechecked. Runtime watches are not restored across plugin reloads.
- **Review failure stops gated progress** — a missing, invalid, unavailable, or blocking checkpoint or Final Test review fails the current Task and requires an explicit retry.
- **Graph relations are Session-local** — document authoring can reference earlier rounds from the same Session, and the browser can aggregate those graphs by Workspace; cross-Session relation authoring is not supported.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

See the [batched requirement review Agent Note](../../../.agents/notes/implemented/feature/2026-09-16-batched-requirement-review.md) and the [Workspace requirement knowledge graph Agent Note](../../../.agents/notes/implemented/feature/2026-09-08-workspace-requirement-knowledge-graph.md).

</details>
