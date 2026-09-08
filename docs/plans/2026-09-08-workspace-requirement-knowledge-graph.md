# Workspace Requirement Knowledge Graph Implementation Plan

English | [中文](2026-09-08-workspace-requirement-knowledge-graph.zh.md)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a collapsible Requirements Notebook sidebar that combines every requirement round in the current Workspace, shows requirement dependencies, and changes each node from pending to active, verified, or blocked as its mapped Tasks and validation settle.

**Architecture:** `dsh-session-requirements` appends one complete `requirement/graph` event beside each valid requirement-document revision and registers a `requirementGraph` Session projection. The projection folds documents, generated Task mappings, reviewed Task states, and final validation into a bounded per-Session graph. Existing Session-list projection delivery carries live and cold values to the browser; `dsh-client-ui-requirements` uses Workspace `sessionIds` as the membership authority and combines those per-Session graphs without reading other Session logs in React.

**Tech Stack:** TypeScript, Cordis Session events and projections, Zod, React, SVG/CSS graph presentation, Vitest, Testing Library, recorded Web snapshots.

---

### Task 1: Define the durable graph vocabulary and projection

**Files:**
- Modify: `packages/session/session-requirements/src/types.ts`
- Create: `packages/session/session-requirements/src/projection.ts`
- Modify: `packages/session/session-requirements/src/invariant.ts`
- Modify: `packages/session/session-requirements/src/index.ts`
- Test: `packages/session/session-requirements/tests/invariant.spec.ts`
- Test: `packages/session/session-requirements/tests/projection.spec.ts`

**Steps:**
1. Add graph node, relation, and complete round-graph event types; identify nodes by round plus requirement number and retain every acceptance-criterion reference.
2. Validate graph revisions, node uniqueness, relation endpoints, relation kinds, and document-revision ownership in the runtime invariant.
3. Register a `requirementGraph` Session projection through the optional `sessionProjections` service.
4. Fold graph events, current Task lists, Task review outcomes, and final validation into gray, blue, green, and red node states.
5. Prove that Final Test does not delay ordinary requirement completion, while a failed mapped Task or later regression can demote a green node to red.

### Task 2: Build graph facts with the requirement document

**Files:**
- Modify: `packages/session/session-requirements/src/index.ts`
- Modify: `packages/session/session-requirements/package.json`
- Test: `packages/session/session-requirements/tests/session-requirements.spec.ts`
- Test: `packages/session/session-requirements/tests/loader-composition.spec.ts`

**Steps:**
1. Extend `submit_requirements_document` with a required relation array that may be empty and uses Chinese explanations.
2. Parse top-level requirements and acceptance criteria from the validated Markdown, then append a complete graph event after the document event.
3. Validate dependency endpoints against the current round and allow refinement or supersession links only to existing rounds in the same Session.
4. On a browser document edit, rebuild nodes from Markdown and retain only relations whose endpoints still exist; invalid drafts publish no new graph revision.
5. Include the existing Session graph index in later-round authoring prompts so the main Agent can identify explicit refinement and supersession links without inventing opaque identities.

### Task 3: Aggregate and render the Workspace graph

**Files:**
- Create: `packages/client/ui-requirements/src/client/knowledge-graph.ts`
- Create: `packages/client/ui-requirements/src/client/RequirementGraphPanel.tsx`
- Modify: `packages/client/ui-requirements/src/client/RequirementsView.tsx`
- Modify: `packages/client/ui-requirements/src/client/RequirementsView.module.css`
- Modify: `packages/client/ui-requirements/src/client/locales.ts`
- Modify: `packages/client/ui-requirements/src/client/index.ts`
- Test: `packages/client/ui-requirements/tests/knowledge-graph.client.spec.ts`
- Test: `packages/client/ui-requirements/tests/requirements-view.client.spec.tsx`

**Steps:**
1. Resolve the current Workspace from `useWorkspaces`; use its ordered `sessionIds` as the exact aggregation set and fall back to the current Session for an ungrouped project.
2. Build stable Workspace node keys from Session id, round id, and requirement id; preserve per-round history rather than merging matching labels.
3. Render a fixed desktop side pane and a narrow-screen overlay drawer with an explicit open/close control, status legend, round lanes, accessible nodes, and labeled dependency paths.
4. Keep the Notebook and composer dimensions intact while the pane is open; prevent the existing details inspector from corrupting the flow layout.
5. Clicking a local node expands and scrolls to its mapped Task or requirement document; clicking a node in another Session opens that Session.

### Task 4: Update documentation, generated evidence, and verification

**Files:**
- Modify: `packages/session/session-requirements/README.md`
- Modify: `packages/session/session-requirements/README.zh.md`
- Modify: `packages/client/ui-requirements/README.md`
- Modify: `packages/client/ui-requirements/README.zh.md`
- Create: `.agents/notes/implemented/feature/2026-09-08-workspace-requirement-knowledge-graph.md`
- Create: `.agents/notes/implemented/feature/2026-09-08-workspace-requirement-knowledge-graph.zh.md`
- Update: generated persistence and capability catalogs
- Update: relevant recorded Session and Web snapshots

**Steps:**
1. Document event ownership, projection delivery, Workspace membership, graph state semantics, relation direction, edit behavior, and limitations.
2. Record why Session projection delivery is used instead of browser-side log reads or a graph-specific polling Remote.
3. Update model-visible tool snapshots and product-visible Web snapshots.
4. Run focused host, projection, client, invariant, Loader, typecheck, documentation, and Web build checks.
5. Inspect the running Web UI at desktop and narrow widths, then run `git diff --check` and review the complete diff without modifying unrelated branding work.
