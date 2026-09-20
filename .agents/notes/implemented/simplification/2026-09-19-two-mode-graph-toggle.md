# Agent Note: Two-mode requirement graph toggle

Status: implemented

English | [中文](2026-09-19-two-mode-graph-toggle.zh.md)

## Problem

Four layout choices and a wide selector consume sidebar space. Users need direct access to the layered and concentric views while keeping the graph prominent.

## Decision

The graph offers Layered · Spline and Radial · Concentric through one 28px circular icon button at the upper left. Clicking, Enter, or Space toggles between them. The icon depicts the active view; localized tooltip text identifies the active and next views, and the pressed state identifies radial mode. Search, disclosure, selection, zoom, and inspector size retain their existing behavior.

Stress and circle layouts, their geometry helpers, styles, locale entries, and supported-behavior tests are removed. This decision supersedes the four-mode selector in the [switchable graph layouts decision](../feature/2026-09-18-switchable-requirement-graph-layouts.md), which continues to own shared layout geometry and state preservation.

## Alternatives considered

**Keep a two-option dropdown.** Rejected because a binary view change does not need a wide text field and a separate selection step.

**Hide the extra modes but retain their algorithms.** Rejected because inaccessible implementations would retain code and tests without providing a supported user action.

## Consequences

Users give up force-based clustering and perimeter-sector exploration. Restoring either requires an explicit product decision and interaction design. The remaining geometry and Session associations stay unchanged. Component tests cover round-trip toggling and retained state; keyless Web replay checks keyboard activation, circular button geometry, and the updated accessibility snapshot.
