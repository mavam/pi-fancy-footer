---
title: Show time left until provider quota resets
type: breaking
authors:
  - mavam
  - codex
created: 2026-07-27T15:41:25.313521Z
---

Provider quota windows now show how long remains until they reset, directly
next to the window they describe. The primary window countdown is enabled by
default for Claude and Codex.

The `providerStatus.showReset` setting now accepts `"off"`, `"primary"`, or
`"all"`. Replace `true` with `"primary"` and `false` with `"off"` before
upgrading.
