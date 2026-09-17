# Agent Note: Progressive four-layer requirement graph

Status: implemented

English | [中文](2026-09-17-progressive-requirement-graph.zh.md)

## Problem

An expanded Session graph obscures which conversation round introduced a requirement. Users need to explore only relevant work while retaining shared Tasks and files, and find code whose parent branches are collapsed.

## Decision

The sidebar graph renders four compact directed layers in one canvas: round document, requirement, Task, and modified file. SVG perspective planes establish depth while keeping all visible layers in view. Ringed spherical HTML nodes show a short identifier and one-line summary; the detail inspector owns revision, status, and count metadata. Document nodes use stable round identities. The [Session graph decision](2026-09-16-session-requirement-code-graph.md) continues to own mutation attribution, Session scoping, and snippet storage; this decision replaces its fixed-column presentation.

Only documents are initially visible. Selecting a node opens its details without changing visibility; its `+`/`−` disclosure independently expands or collapses the next layer. Visibility follows expanded outgoing edges from document roots; a shared node remains while any expanded path reaches it. Collapsing a branch discards unreachable descendants' expansion state. Selection highlights directed ancestors and descendants without navigating the Notebook. Explicit detail actions locate documents, requirement headings, or Tasks; file actions open the sidebar viewer.

Search examines all graph nodes, including collapsed and round-filtered nodes. Selecting a result clears the round filter and opens every ancestor path. Unassigned Tasks can become explicit search roots without fabricated requirement edges. Live graph updates retain expansion choices and update counts and status; they do not open collapsed branches. A requirement whose assigned Tasks have completed displays Awaiting final review while its authoritative state remains in progress. Only the existing final-validation projection can verify it.

## Alternatives considered

**Free-camera 3D.** Rejected because rotating labels and occluded nodes impede sidebar reading. Fixed perspective retains layer depth with ordinary keyboard-accessible controls.

**Strict tree expansion.** Rejected because Tasks and files can have multiple parents. Reachability preserves one shared node and its distinct directed links.

**Search visible cards only.** Rejected because finding hidden code would require knowing its requirement before searching.

## Consequences

Expansion, search, filtering, panning, and zoom remain local view state and make no model requests or Session mutations. Round filtering does not erase expansion choices in other rounds. Sidebar resizing remains plugin-owned. The canvas scrolls independently and supports reduced motion. File snippets remain historical evidence, not current file contents or proof of passing tests. Search indexes document text, requirement labels and acceptance references, Task descriptions, and file paths, not snippet contents. Dense graphs still require scrolling or zooming.

## Testing

Component tests cover document-only initialization, one-level disclosure, shared-node collapse, search ancestry, unassigned Tasks, round filtering, live additions, final-review status, explicit navigation, and escaped code evidence. The keyless Web navigation replay exercises sidebar entry, all four layers, delayed mutation arrival, collapsed-code search, and canvas scrolling, with a graph accessibility snapshot.
