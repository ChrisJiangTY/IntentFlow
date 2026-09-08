# Agent Note: Workspace requirement knowledge graph

Status: implemented

English | [中文](2026-09-08-workspace-requirement-knowledge-graph.zh.md)

## Problem

The Requirements Notebook records documents, Tasks, reviews, and validation, but a user working across multiple Sessions cannot see which requirements depend on others or which outcomes are already implemented. A graph built only from the open Session would hide other requirement rounds in the same project. A graph whose colors live only in React would also lose its meaning after refresh and could disagree with the durable Task and review state.

## Decision

Each valid requirement-document revision has one complete `requirement/graph` event. Its nodes come from the document's numbered requirements and acceptance criteria. The document authoring tool also supplies directed relations with a concise Chinese reason. `depends-on` connects nodes inside the current document. `refines` and `supersedes` connect a current node to an existing node from an earlier round in the same Session. The host rejects duplicate nodes and relations, unknown or identical endpoints, cross-round dependencies, same-round history links, and dependency cycles.

The graph is revision-aligned with `requirement/document`. A valid browser edit rebuilds its nodes and keeps only relations whose endpoints remain valid. An invalid edit appends the document draft without a graph for that revision, so the read projection removes the stale current graph instead of presenting it as current.

`dsh-session-requirements` registers the `requirementGraph` Session projection when the standard projection service is present. The fold combines graph events with the matching Task list and validation. For valid documents recorded before graph events existed, it reconstructs document nodes during replay and leaves relations empty; a later graph event replaces that fallback. Projection state version 2 forces an existing cached fold to replay with this historical reconstruction rule. A node is gray while no mapped implementation work is complete, blue while mapped work is active or only partly complete, green when completed independently reviewed non-final Tasks cover every acceptance criterion, and red after a mapped Task failure, failed validation, or recorded regression. A pending Final Test does not hold an otherwise complete node at blue; a failed Final Test maps back to every acceptance criterion it covers and turns those nodes red.

The browser does not read other Session logs. The standard Session list already carries host-computed projection values for open and unopened Sessions. `dsh-client-ui-requirements` finds the Workspace containing the current Session, uses that Workspace's ordered `sessionIds` as the exact membership set, and combines each member's `requirementGraph` value. A stable browser node key contains Session id, round id, and requirement id, so equal document numbers never merge across Sessions or rounds.

The graph is a collapsible right sidebar on desktop and an overlay drawer on narrow screens. It shows one horizontal round lane per Session, labeled relations, and the four status colors. Selecting a current-Session node expands its round and scrolls to a mapped Task or the requirement document. Selecting another Session's node opens that Session; the user can select the node there to locate its cell. Relation authoring remains Session-local, so Workspace aggregation does not infer cross-Session dependencies.

## Alternatives considered

**Read every Workspace Session log in the browser.** Rejected because React would own a second history-loading path, duplicate host folding, and load unopened Sessions only to rebuild data the Session projection system already carries.

**Add a graph-specific polling Remote.** Rejected because polling would create stale intervals and a second delivery mechanism beside the existing Session-list projection stream. The standard projection provides the same cold and live value through one lifecycle.

**Store colors in graph events.** Rejected because color is derived state. Persisting it would duplicate Task and validation facts and require synchronization after every review, retry, document edit, and regression.

**Require Final Test before any node becomes green.** Rejected because a completed independently reviewed implementation Task is sufficient evidence for the criteria it covers. Final Test is still authoritative for demotion when it fails.

**Merge nodes with matching titles or requirement numbers.** Rejected because the same label can express different requirements in separate Sessions or later rounds. Stable compound identity preserves history and avoids false equivalence.

## Consequences

Every requirement graph can be reconstructed from the Session log, and node status always follows durable Task and validation facts. Workspace navigation can show unopened Session requirements without new network polling or browser log access. Document edits cannot leave an older graph presented as current. The graph adds one bounded projection value to each Session summary and one complete graph event per valid document revision.

The authoring Agent sees only its current Session's historical graph index. It can express dependencies inside the current document and history relations to earlier rounds in that Session, but it cannot create relations between separate Sessions. Cross-Session nodes still appear together in the Workspace sidebar as separate Session lanes.

## Testing

Session tests cover graph creation, relation endpoint validation, dependency cycles, revision replacement, pending-to-active-to-verified status, failed mapped work, Final Test behavior, and regression demotion. Client tests cover exact Workspace membership, compound node identity, relation projection, sidebar visibility, local Task location, and navigation to another Session. The recorded Web navigation scenario includes the graph beside the Notebook and verifies a failed mapped requirement is red. Focused host and client TypeScript builds verify both compiler faces.
