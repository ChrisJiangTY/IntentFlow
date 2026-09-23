# Agent Note: Bounded recovery and concurrency for Task translation

Status: implemented

English | [中文](2026-09-22-retry-parallel-task-translation.zh.md)

## Problem

Requirement Task generation needs one human-facing title and description for each complete execution statement. A malformed description from one translation child can reject the whole submission after earlier children succeeded, forcing the main Agent to submit again and repeat their work. Serial translation also makes generation latency grow with the number of Tasks even though each child receives an independent, already finalized statement.

## Decision

`submit_requirement_tasks` validates every implementation or checkpoint Task and their collective acceptance references before starting translation. One batch occupies the Session's review queue and starts up to `taskTranslationConcurrency` tool-free children concurrently; the default is three, and the Web profile sets it explicitly. A translation with an invalid title or description, or one that changes the execution statement, retries only that Task up to `taskTranslationMaxAttempts` total attempts, defaulting to two. Provider failures and cancellation do not trigger another attempt. The batch waits for all siblings to settle, preserves the input Task order, then rechecks the live Agent and source revision before appending one Task list. A failed batch appends no partial Task list.

The [human-directed task text decision](../feature/2026-09-15-human-directed-task-text.md) continues to own the complete-statement-first rule, exact statement preservation, and human-edit behavior. Individual edits still use the Session review queue; acceptance reviews wait for an active generation batch rather than interleaving with its children.

## Alternatives considered

**Repeat the whole submission after one invalid translation.** Rejected because valid sibling results consume the same model calls again and delay the user's Task list.

**Start translation while the main Agent drafts Tasks.** Rejected because a child could translate a statement that changes before the complete Task set and its acceptance references pass validation.

**Keep all translations serial.** Rejected because the validated statements are independent and serial scheduling adds their individual latencies.

**Allow unlimited concurrency or retries.** Rejected because provider load and model-call cost need bounded, deployment-configurable controls.

## Consequences

Each Task consumes one child call when its first output is valid; malformed output consumes at most one additional call under the default attempt limit. Parallel translation lowers elapsed time when the provider can serve overlapping requests, while increasing simultaneous provider demand. A failed child still prevents publication, but successful siblings are not rerun merely because another child returned invalid text. Provider failures and cancellation remain visible failures. No Session event format changes are required.

## Testing

Focused host tests cover complete preflight before any child starts, concurrent dispatch, input order despite out-of-order completion, retries isolated to one invalid translation, and no partial Task list when its retry budget is exhausted.

A keyless Web recorded-session snapshot checks concurrent translation through the shipped profile. Replay binds each child to a uniquely matching recorded first user prompt, because concurrent children can reach their first model call in a different order on each run; absent or ambiguous matches retain the existing positional binding.
