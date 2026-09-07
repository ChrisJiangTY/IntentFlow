# Requirement Document Pipeline Implementation Plan

English | [中文](2026-09-06-requirement-document-pipeline.zh.md)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Requirement Notebook's raw-input/Plan flow with clarification, an editable Chinese requirement document, explicit task generation, sequential reviewed execution, and a mandatory final-test task.

**Architecture:** `dsh-session-requirements` owns an append-only round state machine and two model commit tools: one publishes the requirement document, the other publishes structured tasks. `dsh-client-ui-requirements` projects those durable events into editable and executable Notebook cells; task execution remains on the main Agent, while the existing read-only reviewer becomes a gate between Run All tasks.

**Tech Stack:** TypeScript, Cordis services and events, Typert remotes, React, Vitest, Testing Library, recorded Web snapshots.

---

### Task 1: Specify the durable requirement-document lifecycle

**Files:**
- Modify: `packages/session/session-requirements/src/types.ts`
- Modify: `packages/session/session-requirements/src/invariant.ts`
- Test: `packages/session/session-requirements/tests/invariant.spec.ts`

**Steps:**
1. Replace Plan-era round states and events with analysis, clarification, document, task-generation, execution, review, and validation states.
2. Add durable clarification and editable document revisions, source document revisions on task lists, task kinds, review verdicts, and Run All state.
3. Write invalid-payload and invalid-relation tests before updating the invariant.
4. Run the focused invariant tests and typecheck the package.

### Task 2: Implement model-owned document and task commits

**Files:**
- Modify: `packages/session/session-requirements/src/index.ts`
- Modify: `packages/session/session-requirements/package.json`
- Test: `packages/session/session-requirements/tests/session-requirements.spec.ts`

**Steps:**
1. Add tests proving `startRound` preserves raw input without emitting a rendered document or activating Plan mode.
2. Register `clarify_requirements`, `submit_requirements_document`, and `submit_requirement_tasks` in the host tool registry.
3. Enforce one-to-five questions per clarification call and at most two calls per round through durable events.
4. Validate the Chinese document format while allowing invalid drafts to persist through the edit Remote.
5. Add `editDocument` and `generateTasks` Remotes with optimistic document revisions and stale task-list derivation.
6. Validate top-level task blocks, Chinese requirement references, and the mandatory final-test tail.
7. Run focused service tests.

### Task 3: Gate sequential execution through independent review

**Files:**
- Modify: `packages/session/session-requirements/src/index.ts`
- Modify: `packages/session/session-requirements/src/types.ts`
- Test: `packages/session/session-requirements/tests/session-requirements.spec.ts`

**Steps:**
1. Add task `reviewing` and reviewer pass/warning/blocking verdicts.
2. Delay the next Run All task until the reviewer settles.
3. Continue on pass or warning; stop on blocking or reviewer failure.
4. Add `stopRunAll`; let the current task finish and prevent the next task from starting.
5. Lock requirement documents after execution begins; keep only pending non-final tasks mutable while idle.
6. Let the final-test Agent repair current-round failures and run final validation only after its review passes.
7. Run focused service tests, including failure and pause paths.

### Task 4: Project and render the new Notebook workflow

**Files:**
- Modify: `packages/client/ui-requirements/src/client/contract.ts`
- Modify: `packages/client/ui-requirements/src/client/assembly.ts`
- Modify: `packages/client/ui-requirements/src/client/index.ts`
- Modify: `packages/client/ui-requirements/src/client/RequirementsView.tsx`
- Modify: `packages/client/ui-requirements/src/client/RequirementsView.module.css`
- Modify: `packages/client/ui-requirements/src/client/locales.ts`
- Test: `packages/client/ui-requirements/tests/assembly.client.spec.ts`
- Test: `packages/client/ui-requirements/tests/requirements-view.client.spec.tsx`

**Steps:**
1. Replace Markdown/Plan projection nodes with clarification/document/Run All nodes.
2. Render `第 X 轮：摘要`; keep raw input and answered clarification records in a collapsed disclosure.
3. Render the requirement Markdown through the shared Markdown renderer with preview/edit autosave.
4. Add the document-cell `生成任务` action, validation diagnostics, stale-task indication, and save-before-generate ordering.
5. Remove the Plan card and approval presentation from the Requirements view.
6. Preserve task editing and execution controls while enforcing final-test immutability and Run All stop behavior.
7. Run focused client tests and inspect the rendered flow.

### Task 5: Update shipped composition evidence and documentation

**Files:**
- Modify: `packages/session/session-requirements/README.md`
- Modify: `packages/session/session-requirements/README.zh.md`
- Modify: `packages/client/ui-requirements/README.md`
- Modify: `packages/client/ui-requirements/README.zh.md`
- Modify: `packages/client/ui-requirements/AGENT.md`
- Create: `.agents/notes/implemented/feature/2026-09-06-requirement-document-pipeline.md`
- Create: `.agents/notes/implemented/feature/2026-09-06-requirement-document-pipeline.zh.md`
- Create: `.agents/notes/implemented/feature/2026-09-06-requirement-document-pipeline.i18n.yaml`
- Update: `.agents/notes/implemented/feature/2026-09-02-requirement-notebook-pipeline.md`
- Update: `.agents/notes/implemented/feature/2026-09-02-requirement-notebook-pipeline.zh.md`
- Update: relevant recorded Web/session snapshots

**Steps:**
1. Document the current model-visible behavior, token effects, persistence, edit locks, review gate, and known limitations.
2. Record the new decision and cross-link the older partially superseded Notebook note.
3. Update the keyless recorded-session scenario and Web expected output for the product-visible flow.
4. Run focused package tests, typecheck, lint on changed packages, snapshot checks, documentation checks, and a production Web build.
5. Review `git diff --check` and the final diff before handoff.
