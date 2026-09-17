# Agent Note: Session requirement code graph

Status: implemented

English | [中文](2026-09-16-session-requirement-code-graph.zh.md)

## Problem

Users need to connect the requirements in one conversation to executable Tasks and actual code modifications. Workspace-wide requirement relations do not identify which Task changed a file. Reviewer file citations can describe reads or existing implementation and cannot establish a mutation.

## Decision

The requirement graph is one Session-scoped `dsh-better-sidebar` tab and is the default tab when that Session becomes active. The type-only default open does not expand a closed sidebar. An explicit content open can subsequently focus its file or browser tab, and the `+` menu can restore a closed graph tab. The Web bundle pins `dsh-better-sidebar` to `0.17.1`, whose required service methods are verified against the shipped DSH `0.1.2-alpha.1` clients. The [progressive graph decision](2026-09-17-progressive-requirement-graph.md) owns its four-layer presentation. Non-withdrawn Tasks join the matching document revision. Acceptance references connect requirements to Tasks. Task execution Turns connect Tasks to recorded mutations. Selecting a node highlights directed ancestors and descendants without traversing sibling branches; selecting a file exposes historical before/after snippets and the responsible Task.

The requirements client computes the current graph in its apply layer. Snippet-bearing graph values stay in a Session-keyed memory map; the sidebar tab metadata contains only a monotonically increasing revision token that requests a render. The adapter observes the active Session and performs one type-only graph open with that exact Session scope when the identity changes. A closed sidebar remains closed, and repeated same-Session state updates do not take focus from another tab. Session changes unsubscribe the previous Notebook source and reset graph interaction state. This avoids persisting code snippets through the sidebar's Session-local storage. The Notebook registers a Session-local reveal callback so graph selection can locate its Task without giving the feature component access to Cordis. Plain clicks on external HTTP or HTTPS Task delivery links open a Session-scoped sidebar browser tab when it is mounted and enabled; failed takeovers and modified clicks retain native browser behavior.

The host's `requirementChanges` projection replays successful `write`, `edit`, and mutating `str_replace_editor` results. Call identifiers and Turns correlate results; applied diff metadata or confirmed creation/editor arguments supply snippets. Reads, failures, and no-op diffs do not create links. The complete projection survives pagination and reconnection without a separate polling API or model request.

This replaces the Workspace aggregation and presentation in the [earlier graph decision](2026-09-08-workspace-requirement-knowledge-graph.md). Its document identities, dependency validation, revision handling, and Task-derived statuses remain authoritative.

## Alternatives considered

**Strict tree layout.** Shared files retain multiple Task parents rather than duplicating the same file under each Task.

**Use reviewer citations as modified files.** Rejected because inspected code is not necessarily modified code, and reviewer requirement ids do not establish a Task mutation.

**Keep a second feature-owned side panel.** Rejected because it duplicates tab closure, horizontal resizing, responsive layout, and browser-tab navigation already owned by `dsh-better-sidebar`.

**Persist the complete graph in sidebar tab metadata.** Rejected because metadata is written to local storage, while graphs can contain historical before/after code snippets. An in-memory graph plus a small revision token preserves rendering without duplicating Session evidence on disk.

## Consequences

The shared sidebar owns horizontal resizing, tab closure, and narrow-screen placement. The graph body scrolls vertically inside that tab. The old Notebook toolbar, command-menu, Task-menu, and inline graph entry points no longer exist. Task stop uses the exact execution message and Turn, removes only its queued input, and preserves unrelated queued work. Review cancellation aborts the task-specific controller and rejects late results; cancelled queued reviews do not start. Stopping a Task also stops ordered advancement, but does not undo code changes. Cancelled Tasks use the existing failed state so they remain retryable without adding a persisted status.

The graph explains recorded work in the current conversation. Edges do not certify behavior or passing tests; displayed Task status remains separate. Shell mutations, delegated changes without parent mutation records, and symbol/line navigation are not inferred. Snippets show historical execution, not current file contents. Retaining snippets increases the projection payload.

## Testing

Focused tests cover default graph selection on sidebar opening, Session rebinding without update feedback loops, disposal, exact document revisions, shared-file attribution, path focusing, safe snippet rendering, Notebook reveal navigation, external delivery-link routing, replay, and rejected reads/failures/no-ops. The recorded Web navigation scenario opens the sidebar directly into the graph and exercises missing mutation evidence and live recorded changes in the assembled Web bundle.
