# Agent Note: Session requirement code graph

Status: implemented

English | [中文](2026-09-16-session-requirement-code-graph.zh.md)

## Problem

Users need to connect the requirements in one conversation to executable Tasks and actual code modifications. Workspace-wide requirement relations do not identify which Task changed a file. Reviewer file citations can describe reads or existing implementation and cannot establish a mutation.

## Decision

The right-side requirement graph displays three fixed columns for the current Session: document requirements, non-withdrawn Tasks from the matching document revision, and shared file nodes. Acceptance references connect requirements to Tasks. Task execution Turns connect Tasks to recorded mutations. Selecting a node highlights directed ancestors and descendants without traversing sibling branches; selecting a file exposes historical before/after snippets and the responsible Task.

The host's `requirementChanges` projection replays successful `write`, `edit`, and mutating `str_replace_editor` results. Call identifiers and Turns correlate results; applied diff metadata or confirmed creation/editor arguments supply snippets. Reads, failures, and no-op diffs do not create links. The complete projection survives pagination and reconnection without a separate polling API or model request.

This replaces the Workspace aggregation and presentation in the [earlier graph decision](2026-09-08-workspace-requirement-knowledge-graph.md). Its document identities, dependency validation, revision handling, and Task-derived statuses remain authoritative.

## Alternatives considered

**Free-floating or strict tree layout.** Fixed columns preserve the requirement-to-code reading order while shared files retain multiple Task parents.

**Use reviewer citations as modified files.** Rejected because inspected code is not necessarily modified code, and reviewer requirement ids do not establish a Task mutation.

## Consequences

The graph has a keyboard-accessible draggable left edge and an independently scrolling body. Task stop uses the exact execution message and Turn, removes only its queued input, and preserves unrelated queued work. Review cancellation aborts the task-specific controller and rejects late results; cancelled queued reviews do not start. Stopping a Task also stops ordered advancement, but does not undo code changes. Cancelled Tasks use the existing failed state so they remain retryable without adding a persisted status.

The graph explains recorded work in the current conversation. Edges do not certify behavior or passing tests; displayed Task status remains separate. Shell mutations, delegated changes without parent mutation records, and symbol/line navigation are not inferred. Snippets show historical execution, not current file contents. Retaining snippets increases the projection payload.

## Testing

Focused tests cover Session exclusion, exact document revisions, shared-file attribution, path focusing, safe snippet rendering, replay, and rejected reads/failures/no-ops. The recorded Web navigation scenario exercises the three columns, missing mutation evidence, and live recorded changes.
