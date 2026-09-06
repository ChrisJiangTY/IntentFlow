# Agent Note: Requirement evolution view

Status: implemented

English | [中文](2026-08-30-requirement-evolution-view.zh.md)

## Problem

Chat records what the user and agent said, while Trajectory records how the agent worked. Neither surface shows how requirements become clearer or change across Turns, nor whether current code independently supports the resulting requirement set. Treating every user message as a separate requirement loses refinement history; treating an assistant's completion claim as proof makes acceptance self-reported.

## Decision

The Web conversation adds a Requirements view. After every completed parent Turn, a one-shot subagent receives the previous reviewed snapshot and the current Turn's user, assistant, plan, and tool evidence. It treats user prompts as primary requirement evidence, keeps stable requirement identities, classifies each revision, and inspects the current workspace before assigning an audit status. The child is limited to the first delegation level and receives only explicitly configured read-only tools, so it cannot delegate further. The current Notebook presentation is recorded in the [requirement Notebook pipeline note](2026-09-02-requirement-notebook-pipeline.md).

Each review appends a complete `requirement/review` snapshot to the parent Session. Version 2 stores every reviewer-authored title, statement, source summary, code observation, audit summary, and gap in Simplified Chinese and English. Older snapshots remain unchanged, so the client can compare adjacent revisions without reconstructing history from current state; a version 1 plain string remains visible without synthetic browser translation. Failed reviews append failure records and do not invent requirement or code evidence. Automatic and manual reviews share the same serialized per-Session path.

A user-run requirement cell is a separate source of truth. `requirement/user-version` records the exact user-authored title and statement with a stable requirement id and monotonic version before Agent execution starts. The generated `sessionRequirements.commit` Remote rejects stale revisions, appends that durable version, and queues one ordinary user message that describes only the selected change and preserves all other requirements. `requirement/execution` records processing, completion, or failure independently; an execution failure never rolls back the user version. The reviewer must preserve a user-version row's id and source-language text, but remains solely responsible for code evidence and audit status.

The review projection preserves stable requirement identities, user-owned wording, bilingual reviewer content, source references, code evidence, audit findings, and independent execution transitions. The current browser presentation and product-round pipeline are maintained by the [requirement Notebook pipeline note](2026-09-02-requirement-notebook-pipeline.md); the review and user-version protocol recorded here remains its host-side foundation.

## Alternatives considered

**One user message equals one requirement.** Rejected because later prompts commonly clarify, narrow, replace, or withdraw earlier intent.

**A permanent requirements, files, and log three-column layout.** Rejected because it gives equal visual weight to supporting data and obscures the primary question: what changed over time.

**Let the main agent maintain completion status.** Rejected because the author of a change is not an independent source of verification. Assistant replies and plans remain citations for interpretation, not proof.

**Derive the view entirely in the browser.** Rejected because browser-only inference is neither durable nor independently auditable, and it would repeat model work whenever history is reloaded.

**Translate only when the reader switches language.** Rejected because browser-time model translation would add latency, produce different wording on repeated reads, and leave the durable audit record with no exact bilingual rendering.

**Replace the Requirements view with a separate Notebook layout.** Rejected because the time axis and requirement-to-code relationship projection already answer the global-evolution question. Notebook interaction belongs inside the existing requirement cards, not in a new page hierarchy.

**Send edits while the user types.** Rejected because an incomplete draft is not a confirmed requirement. Explicit cell run provides one durable version boundary and one exact main-Agent message.

## Consequences

User-confirmed wording is no longer a reviewer judgment; translation, change classification, and implementation evidence remain model judgments and stay visibly separate. Each completed parent Turn adds one auxiliary reviewer request, and user versions remain traceable through append-only events. The current Notebook presentation and Task interactions are recorded in the [requirement Notebook pipeline note](2026-09-02-requirement-notebook-pipeline.md).

## Testing

Host tests cover bilingual review execution, user-version addition and revision, stale-version rejection, exact main-Agent prompts, execution transitions, and failure records. Client tests keep reviews, user versions, and execution transitions in separate ordered projections, and prove that two drafts remain open while one run submits only its own requirement. A built-artifact HTTP smoke crosses the generated Requirements Remote. Keyless Web snapshots pin English and Chinese content, explicit edit and run controls, the adjacent flat plus geometry, and a valid unsubmitted cell draft. Repository type, documentation, client-copy, configuration, and persistence gates cover package integration.
