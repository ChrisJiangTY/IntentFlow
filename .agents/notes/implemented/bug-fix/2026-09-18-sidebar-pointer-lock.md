# Agent Note: Sidebar preview pointer lock

Status: implemented

English | [中文](2026-09-18-sidebar-pointer-lock.zh.md)

## Problem

The sidebar's HTML preview denies a game's click-initiated mouse capture because its iframe sandbox omits `allow-pointer-lock`. Repeating the click cannot fix that missing permission.

## Decision

A pnpm patch for `dsh-better-sidebar` 0.17.1 adds `allow-pointer-lock` to HTML preview and browser iframe policies and the HTML response's CSP sandbox. Both iframe and response policies must permit capture. The patch includes source, shipped browser chunks, and declaration literals so reinstalling the pinned dependency preserves the behavior. Other sandbox tokens remain unchanged. Games must still request capture from a user gesture, and the browser retains its escape gesture.

## Alternatives considered

**Disable the preview sandbox.** Rejected because mouse capture does not require granting preview code access to the parent application's origin.

**Retry inside the game.** Rejected because game code cannot grant the iframe a missing sandbox permission.

## Consequences

Games can capture mouse movement after a click without unlocking the preview. The dependency patch must be reviewed when updating the sidebar version. No earlier active decision record owns this permission.

## Testing

The Web browser test opens an HTML file through the installed sidebar, verifies actual pointer capture and parent-document isolation, then removes the permission and reloads to reproduce the refusal.
