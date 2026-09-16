# Agent Note: Notebook state independent of Chat history

Status: implemented

English | [中文](2026-09-15-notebook-history-retention.zh.md)

## Problem

The Notebook can lose visible cells when a Chat history window is replaced by a recent page. A task update can remain in that page while its source document is outside it, causing the browser to hide the entire task list. Saved content must remain available across refreshes and reconnects, and rerunning a task must retain its previous delivery.

## Decision

The host folds the complete Session log into `requirementNotebook`. It retains document revisions, the latest task list per document revision, the latest cell values, and each task execution attempt. The browser subscribes to this projection independently of the Chat event window. The standard projection sequence rule rejects older baselines after newer updates have arrived. Existing Sessions rebuild the projection from their durable logs.

The Notebook keeps older document tasks visible and read-only, orders rounds by their product round number, and renders delivery outputs from every execution attempt. Editing a human description or starting another attempt does not erase earlier deliveries. The [Notebook pipeline](../feature/2026-09-02-requirement-notebook-pipeline.md) retains ownership of editing and orchestration; this decision supersedes only its window-based reconstruction mechanism. The [delivery display](../feature/2026-09-15-notebook-delivery-results.md) continues to extract only delivery sections.

## Alternatives considered

**Increase the Chat page size.** Rejected because any finite tail can omit an older document or cell as a Session grows.

**Keep old cells only in browser memory.** Rejected because a fresh page or another browser still lacks the omitted history, and accumulated values can conceal a failed save.

**Load all Chat history for the Notebook.** Rejected because tool output and model streaming history are not needed to reconstruct task cells. A separate projection carries the required durable records.

## Consequences

Saved Notebook content survives Chat pagination and transport replacement without model calls. Projection size grows with document revisions, cells, reviews, and execution attempts, but excludes unrelated tool and model streaming events. Unacknowledged edits remain local drafts; this decision does not turn an unsuccessful autosave into durable content.

## Testing

Recorded-session projection tests verify reconstruction and persisted-schema validation. Component tests retain prior deliveries during another attempt and keep old-document tasks read-only. The navigation browser scenario restores edited tasks, notes, and deliveries after more than one page of later messages, refreshes the browser, and forces a WebSocket reconnect before receiving another saved note.
