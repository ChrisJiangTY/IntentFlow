# Agent Note: Guide plan output as a hierarchical checklist

Status: implemented

English | [中文](2026-09-03-plan-checklist-output.zh.md)

## Problem

Plan mode accepts one opaque Markdown string from `exit_plan_mode`, so the model can produce a readable plan without a consistent task decomposition format. A flat or prose-only plan makes implementation order, completion state, and the relationship between phases, tasks, and concrete actions harder to review.

## Decision

The repository's base, standard, ptc, and cordis plan-mode presets guide the model to submit the complete plan in one `exit_plan_mode` call as a hierarchical Markdown checklist. Chinese requests use `# 任务列表`; other requests use the equivalent title in the request language. The guidance requires numbered phase headings, stable hierarchical task IDs such as `1.1`, checkbox states, and indented bullets for concrete actions. `[x]` means work completed and verified during inspection; `[ ]` means proposed work.

Requirement Notebook rounds add a post-approval instruction: `todo_write` creates one Todo per top-level numbered `## N.` phase in the same order, not one Todo per child checklist item. Each Todo starts with a plain-language outcome for the whole phase and then preserves the phase heading, every `N.x` checkbox and indented detail, files, commands, configuration, dependencies, implementation steps, and validation conditions until the next `##` heading. The host uses the first line as the Task title and the remaining lines as its technical statement; legacy single-line Todos retain the generic `Task N` title.

The `dsh-plan-mode` package continues to validate only that the submitted value is non-empty Markdown beginning with a heading. Deployments retain control of the `section` text and can choose another output convention.

## Alternatives considered

**Parse and enforce the checklist in `exit_plan_mode`.** Rejected because the tool stores and reviews an opaque Markdown plan, and a parser would turn one presentation convention into a package-wide wire requirement without providing task scheduling or execution semantics.

**Add the format guidance only to the Web preset.** Rejected because headless and Cordis-based compositions also mount plan mode, and different presets would produce different review formats for the same feature.

**Load a separate template file automatically.** Rejected because it adds a file-loading dependency to prompt assembly and hides the deployment-owned guidance. The preset `section` remains the explicit source of the model instruction.

## Consequences

Plan reviews from repository presets have a predictable one-shot checklist layout that exposes phase order, task status, and implementation details. Each Requirement Notebook Task cell represents one complete top-level phase and presents a human-readable outcome before the phase's child tasks and details. The format remains guidance rather than validation: a model or custom deployment can submit other Markdown that still satisfies the existing heading check. The four preset copies must remain aligned when the repository changes this guidance, while custom deployments can override it through `section`.

Verification covers the four preset prompt sections, bilingual Requirement Notebook instructions, Todo-to-Task projection, paired package READMEs, translation-pair consistency, and the existing plan-mode behavior suite.
