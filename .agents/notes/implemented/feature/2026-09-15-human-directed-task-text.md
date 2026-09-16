# Agent Note: Human-directed task text

Status: implemented

English | [中文](2026-09-15-human-directed-task-text.zh.md)

## Problem

People edit Notebook descriptions to change what the Agent does. A display-only description lets the Agent execute obsolete instructions. Generating execution text and its human description in one response also leaves the ordering unenforced.

## Decision

The host validates technical tasks before independent, tool-free children translate their titles and descriptions. Translation must return the execution statement verbatim. Human edits instead ask a child to rewrite the complete statement; the host preserves the human's text as both the displayed description and durable `humanInstruction`. Execution and review prioritize that instruction over conflicting older requirements.

The human editor saves on blur or before execution. Saves for each Task serialize and rebase later drafts onto committed execution text. The host checks the edited Task and source document again before committing into the latest list. A sibling Task's saved edit does not invalidate another Task's translation; a changed or withdrawn target still does. Whole-list revision checks reject valid batch saves, while committing the captured list would overwrite sibling edits. Failed or stale transformations preserve the previous durable task and leave an error in the editor. Successful edits reopen the task and a completed Final Test, and invalidate old validation evidence.

This decision supersedes the same-response translation and display-only description editing choices in the [Notebook pipeline note](2026-09-02-requirement-notebook-pipeline.md). That note remains active for Notebook identity, evidence presentation, and passive note semantics.

## Alternatives considered

**Translate within the task-generation response.** This avoids extra requests, but cannot enforce that translation reads an already finalized task. Separate children allow exact preservation checks.

**Change only the displayed summary.** This avoids model latency but contradicts the user's expectation that editing directs the Agent.

**Rewrite after every keystroke.** This spends requests on incomplete instructions. Blur and execution are explicit settlement points; subsequent edits remain queued without replacing the newest local text.

## Consequences

Each generated Task or edited nonempty task costs one additional child run through the configured provider. Full prompts must fit the configured input limit; the host refuses truncation. Mechanical checks enforce generated-language, length, sentence, and technical-noise rules; they do not prove semantic fidelity. User-authored descriptions are not restricted to generated-summary length limits. Unacknowledged drafts remain tab-local.

## Testing

Host tests cover human priority, reopening, stale-result rejection, malformed translations, and unchanged saved state on failure. Browser tests cover direct editing, save settlement, and refresh. The recorded task-text scenario exercises the real Web composition, translation, and human-directed rewriting with a live provider during recording and keyless replay afterward.
