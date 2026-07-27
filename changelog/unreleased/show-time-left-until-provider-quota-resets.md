---
title: Show time left until provider quota resets
type: change
authors:
  - mavam
  - codex
prs:
  - 25
created: 2026-07-27T16:15:39.108568Z
---

Provider quota windows now show how long remains until they reset, directly
next to the window they describe. Countdown display is enabled by default for
every reported Claude and Codex window.

The `providerStatus.showReset` setting now accepts `"off"`, `"primary"`, or
`"all"`. Replace `true` with `"primary"` and `false` with `"off"` before
upgrading.
