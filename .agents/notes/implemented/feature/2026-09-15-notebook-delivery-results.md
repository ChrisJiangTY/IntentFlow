# Agent Note: Notebook delivery results

Status: implemented

English | [中文](2026-09-15-notebook-delivery-results.zh.md)

## Problem

Progress messages and verification reports obscure what a task delivered. People need the product result and its limitations without reading the execution transcript.

## Decision

Task execution requests exactly two final sections: delivery results and notes. The host saves the last nonempty assistant reply instead of concatenating progress messages. Raw messages and tool evidence remain in the Session log.

The Notebook parses Markdown and displays only recognized delivery sections, including historical delivery-file headings. It preserves links and shows an explicit placeholder when delivery sections are absent. Notes, review summaries, and additional notices are not part of the result display; Task status markers still distinguish failures from completion. The independent review still consumes the complete execution evidence.

Task prompts ask the delivery section to use 50–300 visible Chinese characters to say what the Task produced, how to open or use it, and what pending or failed Task comes next. When no other pending or failed Task remains, the prompt asks for one or two changes suited to the delivered result. The range and wording are model instructions, not host validation; Notebook still displays only the recognized section, and raw evidence remains in the Session log.

This narrows result presentation in the [Notebook pipeline](2026-09-02-requirement-notebook-pipeline.md); its identity, review, and persistence decisions remain active.

## Alternatives considered

**Only change the prompt.** This leaves historical reports noisy and cannot enforce the visible section count when a model adds commentary.

**Ask another model to rewrite every saved result.** This adds latency and risks changing delivery claims. Deterministic section selection preserves the authored results without another model request.

**Delete detailed evidence.** This prevents independent review and investigation. Presentation hides unrelated sections without deleting source events.

## Consequences

Unstructured historical reports show a placeholder and remain available in details and Trajectory; the browser does not infer deliverables from arbitrary prose. Section selection cannot prove that a claim is true or prevent irrelevant prose inside a recognized section. Execution status and independent review remain authoritative.

## Testing

Component and parser tests cover historical headings, links, fenced pseudo-headings, missing sections, and omission of progress and verification text. Host tests distinguish progress from the final reply. The recorded Web task-result scenario exercises the final-report prompt and independent review with a live model during recording and keyless replay afterward.
