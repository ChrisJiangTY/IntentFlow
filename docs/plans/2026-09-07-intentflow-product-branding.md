# IntentFlow Product Branding Design

English | [中文](2026-09-07-intentflow-product-branding.zh.md)

## Goal

Present the browser application consistently as IntentFlow while preserving the technical identifiers inherited from the underlying runtime.

## Scope

The browser document title, PWA manifest, sidebar fallback name, empty-session hero, and first-run welcome use IntentFlow copy. The Chinese experience leads with `IntentFlow 本地构建` and `让意图自然流向实现`; the English experience uses `IntentFlow Local Build` and `Turn intent into working software`.

The IntentFlow mark uses three curved streams converging on a diamond result node to represent the path from intent to implementation. A square SVG component supplies crisp sidebar and hero rendering at 24px and 34px, the favicon uses the same geometry with light- and dark-scheme colors, and a transparent generated 512×512 PNG supplies install metadata.

The welcome explains the product path in three actions: choose a Workspace, configure a model provider, and describe what to build. Its acknowledgement version changes with the copy so an existing installation presents the new identity once.

DeepSeek remains the name of the DeepSeek model provider. The `dsh` command, `DSH_*` environment variables, package names, durable formats, and runtime protocol text remain stable because they are technical interfaces rather than product presentation.

## Verification

Locale-owned component tests pin both languages. Component and browser tests cover the product mark, built title, favicon, PWA metadata, welcome dialog, sidebar fallback, hero lifecycle, and client-plugin hot reload. A built Web run is inspected at desktop and narrow viewport widths after the focused test lanes pass.
