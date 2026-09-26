# Agent Note: RECO requirements workspace presentation

Status: implemented

English | [中文](2026-09-24-reco-requirements-workspace.zh.md)

## Problem

The Requirements Notebook, conversation navigation, and right sidebar are parts of one desktop workspace, but separate control rows and inconsistent card proportions obscure their relationship. A screenshot-derived replacement could also change execution behavior or display sample content in place of the current Session's facts. The interface needs one visual hierarchy in both languages while preserving the recorded requirement workflow.

## Decision

The [desktop Figma frame](https://www.figma.com/design/JastOBEf9QnfNAqGqyaSIR/Untitled?node-id=67-96) guides the RECO workspace presentation. The conversation shell passes its registered Chat, Trace, and Requirements tabs and selection callback to the Requirements view. That view places those tabs and the `+ Code`, `+ Text`, and Run all actions on one navigation row. The 32 px Session log action sets a 33 px floor for the Session header; the 40 px navigation row shares both dividers with the right sidebar's border-box tab strip. The sidebar's two layout toggles stay in the viewport's upper-right corner instead of taking tab width. The selected tab, disabled actions, and command menu continue to reflect the existing view and Task state.

Notebook document and Task cells follow the reference frame's card widths, heights, inner spacing, typography, selected border, and floating action placement at its desktop size. Each round starts with its largest type for the read-only heading, followed by default-collapsed Requirement clarification and then the document card. The card shows a compact Markdown preview by default; its upper-right action expands the complete document into the Notebook's outer scroll or restores the preview. The cells still render the current Session projection, including revised documents, Task status, execution results, and clarification state. Viewport and sidebar resizing retain the existing scroll and responsive behavior instead of treating the reference image as a fixed bitmap.

Notebook reading text uses the persisted conversation font-size preference: 14 px by default, adjustable from 12 to 17 px in Settings. Round, clarification, document, and Task headings track that preference with a one-to-three-pixel increment; compact labels and graph nodes keep their own size. The shared preference avoids a second Notebook-only setting.

RECO is the visible product name. The language control remains in Settings at the lower left, and the Requirements view reads the shared locale for its controls. Localized interface copy changes with that selection; user-authored content, Agent output, paths, and code retain their recorded text. The right graph keeps its four-layer data, node and edge behavior, search, disclosure, zoom, and inspector; the bottom composer remains the conversation shell's input. Presentation changes do not add Session events, Remotes, or Agent steps.

## Alternatives considered

**Render a second independent tab bar or a separate Requirements language switch.** Rejected because duplicated view and locale state can disagree with the conversation shell and Settings. Passing the registered tabs and observing the shared locale keeps one owner for each selection.

**Recreate the screenshot with fixed example documents and Tasks.** Rejected because sample text would conceal current Session status and make execution controls misleading. The live projection supplies every cell and state-dependent action.

**Replace the graph or bottom composer as part of the visual pass.** Rejected because both components have independent behavior and ownership. Scoped alignment and Notebook styling provide the requested composition without changing graph exploration or input routing.

## Consequences

The desktop frame provides a measurable reference for card proportions and row alignment; narrow layouts still respond to available space. Expanded documents can lengthen Notebook scrolling without changing the compact default card or bottom input. Visual and locale checks must exercise real seeded Session states because empty placeholders cannot verify selected, completed, editing, and clarification cells. Requirement execution, graph interaction, and bottom input keep their existing owners and tests.
