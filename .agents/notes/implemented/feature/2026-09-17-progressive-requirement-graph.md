# Agent Note: Progressive four-layer requirement graph

Status: implemented

English | [中文](2026-09-17-progressive-requirement-graph.zh.md)

## Problem

An expanded Session graph obscures which conversation round introduced a requirement. Users need to explore only relevant work while retaining shared Tasks and files, and find code whose parent branches are collapsed.

## Decision

The sidebar graph renders four compact directed layers in one canvas: round document, requirement, Task, and modified file. Its default Layered · Spline presentation keeps four SVG perspective planes mounted with fixed tilt, spacing, order, and dimensions regardless of node count. Planes have pale layer-colored fills and fine perspective grids. Each layer preserves graph data order in centered, balanced rows with at most fifteen columns. Rows shift slightly along the perspective slope. Node scale accounts for both horizontal spacing and row depth; 20 requirements and 27 Tasks occupy two rows, while 41 files occupy three. Task and code spheres have comparable base sizes to requirement spheres. Blue cubic links use vertical endpoint tangents and control distances proportional to the vertical gap. Sidebar width controls uniform canvas scale, including enlargement beyond baseline. Fixed plane area reduces dense-node size; search and branch collapse remain the way to isolate nodes.

Ringed nodes show Session-wide per-layer ordinal numbers unaffected by disclosure or filtering and use the losslessly embedded assets from Figma file `JastOBEf9QnfNAqGqyaSIR`, node `45:2`; titles remain in tooltips, accessible names, and the detail inspector rather than on the canvas. Search and round filtering align left in the top row; Expand all aligns right and reveals all nodes in the active round scope, including unassigned Tasks, without fabricating edges. Zoom remains at the upper right of the graph controls. Document nodes use stable round identities.

The inspector reserves 30% of body height initially and retains its selected size before and after node selection. An accessible horizontal separator adjusts that reservation within 15–60%; resizing changes only the visible graph area, not its scale or plane geometry. Search results overlay the canvas rather than changing its height. Content remains visible, with a single compact right-aligned Notebook action. The [switchable graph layouts decision](2026-09-18-switchable-requirement-graph-layouts.md) owns shared layout geometry; this decision continues to own disclosure, search, shared-node reachability, and details. The [Session graph decision](2026-09-16-session-requirement-code-graph.md) continues to own mutation attribution, Session scoping, and snippet storage.

Only documents are initially visible. Selecting a node opens its details without changing visibility; its `+`/`−` disclosure independently expands or collapses the next layer. Visibility follows expanded outgoing edges from document roots; a shared node remains while any expanded path reaches it. Collapsing a branch discards unreachable descendants' expansion state. Selection highlights directed ancestors and descendants without navigating the Notebook. Explicit detail actions locate documents, requirement headings, or Tasks; file actions open the sidebar viewer.

Search examines all graph nodes, including collapsed and round-filtered nodes. Selecting a result clears the round filter and opens every ancestor path. Unassigned Tasks can become explicit search roots without fabricated requirement edges. Live graph updates retain expansion choices and update counts and status; they do not open collapsed branches. A requirement whose assigned Tasks have completed displays Awaiting final review while its authoritative state remains in progress. Only the existing final-validation projection can verify it.

## Alternatives considered

**Free-camera 3D.** Rejected because rotating labels and occluded nodes impede sidebar reading. The default fixed perspective retains layer depth with ordinary keyboard-accessible controls.

**Strict tree expansion.** Rejected because Tasks and files can have multiple parents. Reachability preserves one shared node and its distinct directed links.

**Search visible cards only.** Rejected because finding hidden code would require knowing its requirement before searching.

## Consequences

Expansion, search, filtering, layout selection, panning, and zoom remain local view state and make no model requests or Session mutations. Round filtering does not erase expansion choices in other rounds. Sidebar resizing remains plugin-owned. The canvas scrolls independently and supports reduced motion. File snippets remain historical evidence, not current file contents or proof of passing tests. Search indexes document text, requirement labels and acceptance references, Task descriptions, and file paths, not snippet contents. Dense graphs still require scrolling or zooming.

## Testing

Component tests cover document-only initialization, one-level disclosure, shared-node collapse, search ancestry, unassigned Tasks, round filtering, live additions, final-review status, explicit navigation, and escaped code evidence. The keyless Web navigation replay exercises sidebar entry, all four layers, delayed mutation arrival, collapsed-code search, and canvas scrolling, with a graph accessibility snapshot.
