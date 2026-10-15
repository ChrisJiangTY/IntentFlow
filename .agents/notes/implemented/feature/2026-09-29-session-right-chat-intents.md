# Agent Note: Session right Chat and explicit prompt intents

Status: implemented

English | [中文](2026-09-29-session-right-chat-intents.zh.md)

## Problem

The Requirements Notebook and its graph occupy the main workspace, while the only full composer sits below the left pane. A user who reads the Notebook and graph must return to the left edge to submit input. The Chat transcript also occupies a separate main tab, so the user cannot keep the Notebook and conversation visible together. A single undifferentiated prompt submission cannot reliably distinguish ordinary conversation from a requirement revision or a standalone task.

## Decision

The first upper-right panel control opens a Chat surface over the existing right sidebar. It uses that sidebar's resizable width and restores the sidebar's prior content when closed. The right Chat reads the current Session's Conversation binding and displays the same transcript as the left Chat tab; it does not create a second Session or Agent. A newly created blank Session retains the centered Hero composer for its first prompt. Opening right Chat moves that input to the right; after the first turn, the left Chat remains a transcript view and the complete Session composer lives in the right Chat. Session selection changes both transcript views and the composer together; the separate subagent conversation remains in the sidebar beneath the Chat overlay.

Submitting a plain prompt from the right composer first asks the user to choose normal conversation, requirement, or standalone task. Cancel preserves the draft. Normal conversation uses the existing Session send path. Requirement submission appends a new revision to the latest requirement round in the Session, preserving earlier revisions and Task results. Standalone task submission creates a task-only round with one pending Task and no requirement document; the user explicitly runs that Task through the existing Task controls. The selected intent is routed explicitly rather than inferred from prompt wording or the selected main tab.

The right Chat reuses the Conversation transcript and composer behavior, including attachments, references, commands, access and model controls, queueing, steering, and stopping. The panel control no longer opens the bottom terminal; it owns the right Chat overlay instead. Prompt intent affects only plain prompt submission, so existing command and interaction handling remains with its established owner.

The Web minimal preset explicitly allows only its bash and editor tools. Its tool policy is applied at the selected Agent scope and inherited by its children; switching a blank Session's preset replaces that policy after the configured tool names are checked. The Web test scaffold preserves the shipped preset policy when adding test-specific configuration.

The preview packer collects bare package names from Loader entries, traverses nested configuration only for group entries, resolves each declared dependency from its workspace, and retains explicit external Loader entrypoints as reachable roots. A packed Web image check covers the actual Better Sidebar module entrypoint. Better Sidebar's API and upload requests use the existing worker transport when available; ordinary Web pages keep browser fetch. Preview uploads pass raw `ArrayBuffer` bytes supported by that transport.

## Alternatives considered

**Add Chat as another sidebar tab.** The user asked for a full overlay in the sidebar's existing geometry, with the prior Files, graph, or subagent content restored on close. A tab would alter the sidebar's tab selection and make restoration dependent on tab history.

**Open an independent Chat Session.** A second Session would split the log, Agent state, and context, so the right transcript and left Chat could disagree. Both views use one Session binding instead.

**Infer intent from text or the active main view.** A prompt can be a question, a change request, or a direct task regardless of which tab is selected. Explicit selection keeps the routing observable until a separate model router is designed.

**Put a task-only request into a requirement document.** That would invent a document and requirement nodes for work the user identified as one direct task. A task-only round records the Task without a fabricated requirement revision.

## Consequences

One Session log and one input state govern both Chat displays. The right panel's available width limits transcript and composer space, but the existing resize control lets the user adjust it. Requirement append must preserve historical execution evidence while moving the current document and Task list to a new revision. Task-only rounds require explicit projection and graph handling because they have no document. The intent dialog adds one choice to plain prompt submission and leaves the draft intact when dismissed.
