# Agent Note: IntentFlow product presentation

Status: implemented

English | [中文](2026-09-07-intentflow-product-presentation.zh.md)

## Problem

The browser application inherits DeepSeek Harness product copy and its fish mark even when the deployed product is IntentFlow. The mismatched name, symbol, slogan, and first-run notice make the product identity inconsistent and do not explain the requirement-to-implementation workflow.

## Decision

The Web product surfaces present IntentFlow as the application identity. The initial and reactive document titles use `IntentFlow Local Build`; the install manifest uses `IntentFlow` for both its full and short names; the localized sidebar fallback uses `IntentFlow Local Build` or `IntentFlow 本地构建`.

The empty-session hero describes the product outcome with `Turn intent into working software` and `让意图自然流向实现`. The versioned first-run welcome names IntentFlow, explains that it turns clarified requirements into executable tasks and working software, and directs the user to choose a Workspace, configure a model provider, and describe the desired result. The copy revision advances the acknowledgement version so an installation that accepted the earlier notice sees the new welcome once.

The product mark depicts three intent streams converging on a diamond result node. A square, code-native SVG renders the sidebar and conversation hero at small sizes, while the browser favicon and generated transparent 512×512 PNG carry the same visual identity into browser tabs and installed Web applications. The streams inherit each host surface's primary ink; the result node retains the violet brand accent.

Technical interfaces retain their existing names. The `dsh` executable, `DSH_*` environment variables, package names, boot globals, durable data, and runtime protocol wording remain unchanged. DeepSeek remains a provider name wherever the UI refers to the official DeepSeek adapter or its models.

## Alternatives considered

**Replace only the sidebar label.** Rejected because the browser title, install metadata, empty-session hero, and welcome dialog would continue to present conflicting identities.

**Rename every DSH technical identifier.** Rejected because those identifiers are runtime and package interfaces rather than browser branding. Renaming them would create a repository-wide protocol migration without improving the visible IntentFlow experience.

**Rename the DeepSeek provider.** Rejected because DeepSeek identifies an actual model provider and must remain distinguishable from the IntentFlow product.

**Keep the inherited fish mark beside the new product name.** Rejected because it visually assigns DeepSeek's product identity to IntentFlow and keeps the rebrand incomplete even after the copy changes.

## Consequences

The browser presents one product name, one product mark, and a workflow-specific promise in both supported locales. Existing installations receive the revised welcome once. The source tree still contains DSH and DeepSeek Harness terms where they accurately identify inherited technical interfaces, so the rebrand remains scoped to product presentation rather than internal repackaging.

## Testing

Locale and component tests pin the sidebar, hero, product mark, document-title, and welcome copy. Browser tests pin the built shell, favicon, PWA manifest, first-run flow, hero lifecycle, and hot-reload source replacement. The Web snapshot lane and a live built application verify the assembled presentation.
