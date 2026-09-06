---
description: "Durable requirement Notebook orchestration and independent historical-regression validation for dsh sessions."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-requirements

English | [中文](README.zh.md)

## Summary

`dsh-session-requirements` owns the product-round protocol behind the Requirements Notebook. It records the raw request as Markdown, enters Plan mode, captures the Plan, projects Todo items into stable Task cells, records task execution and notes, and appends final validation. The independent reviewer compares the current round with active historical requirements and emits regression evidence separately from main-Agent claims.

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

Mount the plugin where `agents`, `subagents`, and optionally `commands` are available. Configure a registered one-shot provider, a prompt character limit, and the exact read-only tool names exposed to the reviewer. The Web bundle uses the `spawn` provider with `read`, `glob`, and `grep`.

The generated Remotes `startRound`, `runTask`, `runAll`, `addTask`, `editTask`, `moveTask`, `withdrawTask`, and `addNote` operate on the live Agent's Session. `startRound` preserves the raw input, appends the round and Markdown events, enables Plan mode, and queues one planning message. After Plan approval, each top-level numbered `## N.` phase becomes one Todo and then one ordered Task-list entry; its `N.1`, `N.2`, and other checklist items remain together in that Task. The Todo's first line supplies a plain-language phase outcome. Its following lines preserve the complete phase heading, checkbox states, files, commands, configuration, dependencies, implementation steps, and validation conditions as the Task statement. Task runs append submitted, processing, and terminal execution events; Run all queues the next pending task after a completed turn and stops after a failed turn.

Text and comment cells are durable note events. Passive Markdown notes use `dispatch: false`, preserve source whitespace, and may be empty. `editNote` appends replacement source under the same round and note identity; prior events remain unchanged, and the browser displays the latest version. Neither creation nor editing creates an Agent turn. Comments require nonblank content; the explicit Agent-assistance action uses `dispatch: true` and follows up in the main conversation. Comments and dispatched notes cannot be edited. A task can be edited, reordered, or withdrawn before execution; each mutation appends a replacement Task list while retaining prior log history. A withdrawn task remains visible but is excluded from Run all.

`addTask` and `editTask` accept empty title or statement strings for partially authored cells and persist them as pending Tasks. `runTask` requires at least one nonblank text field. Run all skips empty drafts, which do not hold the round in the executing state after other Tasks finish. Task edits do not dispatch an Agent message; [the browser editor](../../client/ui-requirements/README.md#use-this-package) controls autosave and waits for it before running.

After each parent `turn/end`, the configured one-shot reviewer receives the current Notebook artifacts, historical review snapshot, user messages, and bounded read-only workspace access. A completed review appends a validation event. The validation marks confirmed accidental breaks of active historical requirements as regressions, carries the responsible Task only when evidence supports attribution, and never treats a failed Task or missing evidence as a regression by itself.

The existing `commit` Remote remains available for version-addressed requirement records and compatibility with the requirement-review data model. The Notebook round protocol is the path used by the Requirements tab's native DSH composer.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The package defines the durable round, Markdown, Plan, Task-list, Task-execution, note, and validation payloads in the Session event vocabulary. `SessionRequirements` serializes independent reviews per Session and appends only immutable events. Pipeline tracking joins plan-mode, Todo, message, and turn events to the current product round without treating an Agent Turn as a product-round identity.

The review child is limited to the first delegation level and receives an explicit read-only tool allowlist. Disposal aborts active children and drains their promises before teardown. A completed child result is committed only while the exact parent Agent remains registered for the Session.

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-requirements](../../client/ui-requirements/README.md) — browser Notebook projection and native composer routing.
- [subagent](../../subagent/subagent/README.md) — one-shot child execution seam.
- [session](../../core/session/README.md) — durable event log receiving Notebook facts.

-----

<a id="model-experience"></a>
## Model Experience

### Requirement Notebook turns

#### What the model sees

The planning message contains the raw user request, its Markdown framing, the automatic Plan-mode instruction, the required one-Todo-per-top-level-phase format, and the historical-requirement preservation rule. A Task message names exactly one phase-level Task and includes the complete Plan section. A dispatched assistance note identifies its Task and round; passive text and comment notes remain in the Notebook without entering model input. The reviewer receives the previous complete requirement snapshot, current Notebook events, parent-turn evidence, and instructions to inspect the workspace before asserting verification or regression.

#### Token effect

Each new round, explicitly run Task, and dispatched assistance note creates one ordinary main-Agent turn. Passive notes do not. Run all serializes Task turns. Each completed parent turn triggers one auxiliary reviewer request, and `/requirements` triggers an explicit review. Reviewer input is bounded by `maxInputChars`.

#### KV Cache effect

Main prompts follow normal provider caching rules. Auxiliary input changes with the Session evidence and prior snapshot, so reuse ends at the first changed token in the reviewer request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Task output is bounded** — the task-execution event stores a bounded final assistant response; the full tool transcript remains in the Session log.
- **Validation is evidence-based** — the reviewer can report an unconfirmed or unattributed concern only as review text; red regression state requires the explicit regression object.
- **Plan approval remains an explicit checkpoint** — Task execution waits for the existing Plan-mode approval event, while task and note Remotes still validate their own live Session references.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

See the [requirement Notebook pipeline Agent Note](../../../.agents/notes/implemented/feature/2026-09-02-requirement-notebook-pipeline.md).

</details>
