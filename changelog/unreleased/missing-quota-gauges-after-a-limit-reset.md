---
title: Missing quota gauges after a limit reset
type: bugfix
authors:
  - mavam
  - claude
prs:
  - 28
created: 2026-07-29T07:06:57.482743Z
---

The provider quota widget no longer disappears when a quota window resets.
Previously, a reset that happened while you were away — such as the weekly limit
rolling over overnight — hid the `5h` and `7d` gauges entirely until your next
agent turn.

A window past its reset time now reads `0%` until the provider reports the new
period, and a reset that falls inside the status cache lifetime no longer leaves
the previous period's percentage on screen.
