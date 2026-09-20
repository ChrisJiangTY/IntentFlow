# Agent Note: Switchable requirement graph layouts

Status: implemented

English | [中文](2026-09-18-switchable-requirement-graph-layouts.zh.md)

## Problem

One fixed arrangement cannot keep a dense four-layer Session graph readable for every question. A user may need to inspect chronological layer flow, identify a relation-centered cluster, compare broad connectivity, or follow cross-layer links around a compact perimeter without losing the current graph exploration state.

## Decision

The requirement graph presents the same visible nodes and directed edges through Layered · Spline and Radial · Concentric. Layered keeps fixed perspective planes, ordered rows, and curved top-to-bottom links. Radial places document nodes near the center and requirement, Task, and code nodes on progressively larger rings. The [two-mode control decision](../simplification/2026-09-19-two-mode-graph-toggle.md) owns the circular toggle and removal of the stress and sector-circle presentations.

Every presentation uses center-based node coordinates, a presentation-owned canvas extent, density-aware node scale, background regions, and precomputed SVG edge paths. The renderer offsets edge endpoints near the node rings and preserves directional markers. The graph uniformly fits the active extent to the sidebar width; manual zoom and scrolling remain available. These package-local algorithms reproduce the selected ELK and Cytoscape visual families without embedding or claiming to run either layout engine.

Changing presentation preserves disclosure, search text and results, round filtering, the selected node and inspector content, zoom, and the inspector split. It recalculates geometry and edge routing, then brings a selected node into view or returns an unselected canvas to its origin. A Session switch remounts the keyed graph panel and therefore restores Layered · Spline together with the other Session-local view defaults. The [progressive requirement graph decision](2026-09-17-progressive-requirement-graph.md) continues to own disclosure, search, shared-node reachability, and details; this decision owns shared layout geometry.

## Alternatives considered

**Embed ELK and Cytoscape layout runtimes.** Rejected because two independent graph engines would add substantial browser code and result coordination while still requiring product-specific semantic ordering, background regions, DOM-node integration, and post-processing. Deterministic local algorithms provide the requested visual families without implying an engine that is not present.

**Choose one adaptive layout automatically.** Rejected because no density heuristic knows whether the user is comparing layers, following a cluster, inspecting overall connectivity, or reducing crossings. An explicit toggle keeps the spatial interpretation under user control.

**Use an unconstrained random force simulation.** Rejected because positions would drift across renders and Sessions, making graph snapshots, spatial memory, and browser replay unreliable. Deterministic geometry keeps positions reproducible.

## Consequences

Layout switching remains local view state and makes no model request or Session mutation. The two presentations always share the same Session nodes and directed edges, disclosure model, node ordinals, selection, and details. The radial presentation uses a larger square extent, so a narrow sidebar may require zooming or scrolling; dense graphs reduce node scale rather than dropping nodes. The deterministic geometry supports focused unit tests, component state-preservation tests, and keyless browser replay. Adding another presentation requires extending the closed layout-mode list, typed locale entries, pure geometry module, renderer regions, and the same state-preservation coverage.

## Testing

Pure layout tests cover deterministic finite coordinates, in-bounds node centers, background-region variants, the default layered geometry, radial ring ordering, edge paths, and empty graphs. Component tests switch through both presentations while retaining expanded nodes, search, round filtering, selection, zoom, and inspector size, and verify that a Session change restores the default. The keyless Web navigation replay exercises both toggle states against a fully expanded Session graph and preserves selected code details.
